import { Router, type Request, type Response } from "express";
import { db, hermesTimelineEntryTable, hermesGraphSnapshotTable, mindIndexHistoryTable, happinessIndexHistoryTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { isAuthorized } from "../lib/adminSession";
import { taipeiDateString } from "../lib/summarySources";
import {
  CHILD_LEVEL,
  buildChildren,
  buildList,
  isLevel,
  sortDayEvents,
  toChip,
  validateEntries,
  type EventRef,
  type ReportRow,
  type TimelineLevel,
} from "../lib/hermesTimeline";

const router = Router();

// 時間軸（日／週／月／季／年摘要）。資料由 HERMES 的 hermes-timeline-pusher.py 增量 upsert 進來；
// 前端在關係圖頁的「時間軸」分頁讀取。設計：kb-pipeline docs/timeline-design.md。
// 內容含個人日記衍生資料 → GET／POST 都走跟 hermes-graph 一樣的 admin-password 私領域閘。

const LIST_COLUMNS = {
  level: hermesTimelineEntryTable.level,
  periodKey: hermesTimelineEntryTable.periodKey,
  startDate: hermesTimelineEntryTable.startDate,
  endDate: hermesTimelineEntryTable.endDate,
  title: hermesTimelineEntryTable.title,
  summary: hermesTimelineEntryTable.summary,
  generation: hermesTimelineEntryTable.generation,
  rangeInferred: hermesTimelineEntryTable.rangeInferred,
  periodNote: hermesTimelineEntryTable.periodNote,
};

async function loadRows(level: TimelineLevel): Promise<ReportRow[]> {
  const rows = await db.select(LIST_COLUMNS).from(hermesTimelineEntryTable).where(eq(hermesTimelineEntryTable.level, level));
  return rows as ReportRow[];
}

async function loadEvents(): Promise<EventRef[]> {
  const [snap] = await db
    .select({ events: hermesGraphSnapshotTable.events })
    .from(hermesGraphSnapshotTable)
    .where(eq(hermesGraphSnapshotTable.id, "latest"))
    .limit(1);
  return (snap?.events ?? []).map((e) => ({ id: e.id, date: e.date, title: e.title, createdAt: e.createdAt ?? null }));
}

async function loadMindScores(): Promise<Map<string, number | null>> {
  // 直接讀表（伺服端），不經 /api/mind-index/history——那支固定只回近 30 天。
  const rows = await db.select({ date: mindIndexHistoryTable.date, score: mindIndexHistoryTable.score }).from(mindIndexHistoryTable);
  return new Map(rows.map((r) => [String(r.date), r.score ?? null]));
}

async function loadHappinessScores(): Promise<Map<string, number>> {
  // 幸福指數當日「顯示分數」（displayed_score：與儀表板歷史圖／/api/happiness/history 同一個數字）。
  // 只有 23:55 快照 job 會寫入這張表，所以「今天」在快照前沒有值——徽章不顯示，不用即時暫定值冒充。
  const rows = await db.select({ date: happinessIndexHistoryTable.date, score: happinessIndexHistoryTable.displayedScore }).from(happinessIndexHistoryTable);
  return new Map(rows.map((r) => [String(r.date), r.score]));
}

router.post("/admin/hermes-timeline", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) {
    return res.status(403).json({ message: "需要管理員權限" });
  }
  const parsed = validateEntries(req.body);
  if (!parsed.ok) return res.status(400).json({ message: parsed.error });

  await db
    .insert(hermesTimelineEntryTable)
    .values(parsed.entries)
    .onConflictDoUpdate({
      target: [hermesTimelineEntryTable.level, hermesTimelineEntryTable.periodKey],
      set: {
        startDate: sql`excluded.start_date`,
        endDate: sql`excluded.end_date`,
        title: sql`excluded.title`,
        summary: sql`excluded.summary`,
        bodyMd: sql`excluded.body_md`,
        generation: sql`excluded.generation`,
        rangeInferred: sql`excluded.range_inferred`,
        periodNote: sql`excluded.period_note`,
        sourcePath: sql`excluded.source_path`,
        contentHash: sql`excluded.content_hash`,
        updatedAt: new Date(),
      },
    });
  return res.json({ success: true, upserted: parsed.entries.length });
});

// 列表：只回摘要（不含全文），游標分頁，新→舊。
router.get("/hermes-timeline", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) {
    return res.status(403).json({ message: "需要解鎖私領域才能查看" });
  }
  const level = req.query["level"] ?? "day";
  if (!isLevel(level)) return res.status(400).json({ message: "level 必須是 day／week／month／quarter／year" });
  const limitRaw = Number(req.query["limit"] ?? 30);
  const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 30;
  const cursor = typeof req.query["cursor"] === "string" ? req.query["cursor"] : null;

  const [rows, events, mindScores, hhiScores] = await Promise.all([
    loadRows(level),
    loadEvents(),
    level === "day" ? loadMindScores() : Promise.resolve(new Map<string, number | null>()),
    level === "day" ? loadHappinessScores() : Promise.resolve(new Map<string, number>()),
  ]);
  const { items, nextCursor } = buildList({
    level, rows, events, mindScores, hhiScores, today: taipeiDateString(new Date()), limit, cursor,
  });
  return res.json({ level, items, nextCursor });
});

// 單筆：含原文與下層期間（開對話框時才取）。
router.get("/hermes-timeline/:level/:periodKey", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) {
    return res.status(403).json({ message: "需要解鎖私領域才能查看" });
  }
  const level = String(req.params["level"]);
  const periodKey = String(req.params["periodKey"] ?? "");
  if (!isLevel(level) || !periodKey) return res.status(400).json({ message: "level／periodKey 不合法" });

  const [entry] = await db
    .select()
    .from(hermesTimelineEntryTable)
    .where(and(eq(hermesTimelineEntryTable.level, level), eq(hermesTimelineEntryTable.periodKey, periodKey)))
    .limit(1);

  const today = taipeiDateString(new Date());
  const events = await loadEvents();
  const childLevel = CHILD_LEVEL[level];

  if (!entry) {
    // 沒有日報的日子：只要當天有事件或任一分數（知識庫健康／幸福指數），仍可開啟（降級內容，明示 hasReport=false）
    if (level === "day") {
      const [scores, hhi] = await Promise.all([loadMindScores(), loadHappinessScores()]);
      const evs = events.filter((e) => e.date === periodKey && e.date <= today);
      if (evs.length > 0 || scores.has(periodKey) || hhi.has(periodKey)) {
        return res.json({
          level, periodKey, startDate: periodKey, endDate: periodKey, title: periodKey, summary: "", bodyMd: "",
          hasReport: false, rangeInferred: false, periodNote: null, generation: null,
          eventCount: evs.length, events: sortDayEvents(evs).map(toChip),
          mindScore: scores.get(periodKey) ?? null, hhiScore: hhi.get(periodKey) ?? null, children: [],
        });
      }
    }
    return res.status(404).json({ message: "查無此期間" });
  }

  const evs = events.filter((e) => e.date >= entry.startDate && e.date <= entry.endDate && e.date <= today);
  const mindScore = level === "day" ? ((await loadMindScores()).get(periodKey) ?? null) : null;
  const hhiScore = level === "day" ? ((await loadHappinessScores()).get(periodKey) ?? null) : null;
  const children = childLevel ? buildChildren(await loadRows(childLevel), entry.startDate, entry.endDate) : [];
  return res.json({
    level, periodKey, startDate: entry.startDate, endDate: entry.endDate, title: entry.title, summary: entry.summary,
    bodyMd: entry.bodyMd, hasReport: true, rangeInferred: entry.rangeInferred, periodNote: entry.periodNote,
    generation: entry.generation, eventCount: evs.length,
    events: level === "day" ? sortDayEvents(evs).map(toChip) : [],
    mindScore, hhiScore, children,
  });
});

export default router;
