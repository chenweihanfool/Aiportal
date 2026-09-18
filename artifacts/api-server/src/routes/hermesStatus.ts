import { Router, type Request, type Response } from "express";
import {
  db,
  hermesStatusSnapshotTable,
  hermesActivityLogTable,
  hermesGraphSnapshotTable,
  type HermesStatusSnapshotRow,
  type HermesGraphEvent,
  type HermesGraphPersonRelation,
  type HermesGraphCaseMeta,
} from "@workspace/db";
import { desc, eq } from "drizzle-orm";

const router = Router();

const ADMIN_PASSWORD = process.env["ADMIN_PASSWORD"] ?? "85097110";

// Vault 本人（"使用者" alias 已在 2026-09-08 併檔進這個名字，見
// Events/2026-09-08_People-alias手動併檔完成使用者併入陳韋翰.md）——他幾乎
// 是每一筆事件的參與者，「這陣子最活躍」這個指標的意義是「最近誰跟我互動
// 最多」，不是「我自己最活躍」，本人自己永遠奪冠對這個問題沒有任何資訊
// 量，所以只在算 mostActivePerson 時把他濾掉；人物節點本身、degree、其他
// 統計都不受影響，他仍然正常出現在圖上跟人數計算裡。
const SELF_PERSON_NAME = "陳韋翰";

// Data collected by services/hermes-status/collect.ps1 on the deploy host
// (Windows Task Scheduler, every few minutes) — CPU/RAM/disk via CIM, docker
// container health via `docker ps`, scheduled-task results via
// Get-ScheduledTaskInfo. Not a SUMMARY_SOURCES entry / doesn't feed the HHI
// composite — this is operational monitoring, not a happiness dimension, so
// it's a standalone route like /mind-index/history, not wired into
// lib/summarySources.ts.
router.post("/admin/hermes-status", async (req: Request, res: Response) => {
  const authorized = req.headers["x-admin-password"] === ADMIN_PASSWORD;
  if (!authorized) {
    return res.status(403).json({ message: "需要管理員權限" });
  }

  const body = req.body as Record<string, unknown>;
  const num = (key: string): number | null => (typeof body[key] === "number" ? (body[key] as number) : null);
  const arr = (key: string): unknown[] => (Array.isArray(body[key]) ? (body[key] as unknown[]) : []);

  const row = {
    id: "latest",
    cpuPercent: num("cpuPercent"),
    memPercent: num("memPercent"),
    disks: arr("disks") as HermesStatusSnapshotRow["disks"],
    containers: arr("containers") as HermesStatusSnapshotRow["containers"],
    scheduledTasks: arr("scheduledTasks") as HermesStatusSnapshotRow["scheduledTasks"],
  };

  await db
    .insert(hermesStatusSnapshotTable)
    .values(row)
    .onConflictDoUpdate({
      target: hermesStatusSnapshotTable.id,
      set: { ...row, computedAt: new Date() },
    });

  return res.json({ success: true });
});

// Single event append — the collector script POSTs one entry per new
// update.log line it finds since the last run. Not an upsert like the
// snapshot above: the same day can have multiple deploys/backups, so this
// is append-only (hermes_activity_log has no date/id conflict target).
router.post("/admin/hermes-activity", async (req: Request, res: Response) => {
  const authorized = req.headers["x-admin-password"] === ADMIN_PASSWORD;
  if (!authorized) {
    return res.status(403).json({ message: "需要管理員權限" });
  }

  const body = req.body as Record<string, unknown>;
  const source = typeof body["source"] === "string" ? body["source"] : null;
  const message = typeof body["message"] === "string" ? body["message"] : null;
  if (!source || !message) {
    return res.status(400).json({ message: "source 與 message 為必填字串" });
  }
  const occurredAt = typeof body["occurredAt"] === "string" ? new Date(body["occurredAt"]) : new Date();

  await db.insert(hermesActivityLogTable).values({ source, message, occurredAt });

  return res.json({ success: true });
});

// 30 分鐘沒更新就標記過期——跟心智指標的 36 小時門檻是同一套 staleness 概念，
// 但這裡資料本來就該每幾分鐘更新一次，門檻要跟著實際更新頻率縮短，不是照抄
// 別的資料源的門檻數字。
const STALE_THRESHOLD_MS = 30 * 60 * 1000;

router.get("/hermes-status", async (req: Request, res: Response) => {
  const unlocked = req.headers["x-admin-password"] === ADMIN_PASSWORD;
  if (!unlocked) {
    return res.status(403).json({ message: "需要解鎖私領域才能查看" });
  }

  const [row] = await db
    .select()
    .from(hermesStatusSnapshotTable)
    .where(eq(hermesStatusSnapshotTable.id, "latest"))
    .limit(1);

  if (!row) {
    return res.json({ available: false });
  }

  const stale = Date.now() - row.computedAt.getTime() > STALE_THRESHOLD_MS;

  return res.json({
    available: true,
    cpuPercent: row.cpuPercent,
    memPercent: row.memPercent,
    disks: row.disks ?? [],
    containers: row.containers ?? [],
    scheduledTasks: row.scheduledTasks ?? [],
    computedAt: row.computedAt.toISOString(),
    stale,
  });
});

// HERMES's "事人物三實體 + 案件脈絡層" knowledge structure —
// collect.ps1 re-scans every Events/*.md file's frontmatter each run and
// POSTs the full current set (not a diff, same "whole payload overwrite"
// shape as hermes-status above). `events` carries case/objects fields
// directly (Events frontmatter is authoritative for those), so case nodes,
// object nodes, and every events-derived metric below are computed from
// `events` at read time — only `personRelations` (People/*.md 的
// `## 關係人物`，Events 完全沒有這個資訊) and `cases`（Cases/*.md
// frontmatter 的 name/status，純粹補案件節點的顯示狀態）是額外真的需要
// collect.ps1 另外掃、另外存的東西。
router.post("/admin/hermes-graph", async (req: Request, res: Response) => {
  const authorized = req.headers["x-admin-password"] === ADMIN_PASSWORD;
  if (!authorized) {
    return res.status(403).json({ message: "需要管理員權限" });
  }

  const body = req.body as Record<string, unknown>;
  const events = Array.isArray(body["events"]) ? (body["events"] as HermesGraphEvent[]) : [];
  const personRelations = Array.isArray(body["personRelations"])
    ? (body["personRelations"] as HermesGraphPersonRelation[])
    : [];
  const cases = Array.isArray(body["cases"]) ? (body["cases"] as HermesGraphCaseMeta[]) : [];

  await db
    .insert(hermesGraphSnapshotTable)
    .values({ id: "latest", events, personRelations, cases })
    .onConflictDoUpdate({
      target: hermesGraphSnapshotTable.id,
      set: { events, personRelations, cases, computedAt: new Date() },
    });

  return res.json({ success: true });
});

router.get("/hermes-graph", async (req: Request, res: Response) => {
  const unlocked = req.headers["x-admin-password"] === ADMIN_PASSWORD;
  if (!unlocked) {
    return res.status(403).json({ message: "需要解鎖私領域才能查看" });
  }

  const [row] = await db
    .select()
    .from(hermesGraphSnapshotTable)
    .where(eq(hermesGraphSnapshotTable.id, "latest"))
    .limit(1);

  if (!row || !row.events) {
    return res.json({ available: false });
  }

  const events = row.events;
  const personRelations = row.personRelations ?? [];
  const caseMetaByName = new Map((row.cases ?? []).map((c) => [c.name, c]));

  // 人物節點 + degree（連結數）從 events.participants 反推——People/*.md
  // 只是 HERMES 自己維護的反查快取，不是另一份要另外信任的來源。同一個
  // person 名稱視為同一個節點（沒有跨事件的 id，用顯示名稱本身當 key，跟
  // frontmatter 的 `[[人名]]` wikilink 語意一致）。案件節點／物件節點是同一
  // 套邏輯：從 events 的 case / objects 欄位反推，名稱本身當 key。
  const peopleByName = new Map<string, { name: string; eventCount: number; firstDate: string }>();
  const casesByName = new Map<string, { name: string; eventCount: number }>();
  const objectsByName = new Map<string, { name: string; objectType: string | null; eventCount: number }>();
  const edges: Array<{ person: string; eventId: string; role: string }> = [];
  const caseEdges: Array<{ eventId: string; case: string }> = [];
  const objectEdges: Array<{ eventId: string; object: string }> = [];
  let totalParticipantLinks = 0;
  let orphanEventCount = 0;
  let trueOrphanEventCount = 0;

  for (const ev of events) {
    const participants = ev.participants ?? [];
    if (participants.length === 0) orphanEventCount++;
    // 「真孤兒」＝沒有任何關聯（無 participants 也無案件）——案件鏈（C4 補鏈）
    // 讓事件有歸屬但不算人物關聯，只看 participants 會把已歸檔的事件也算成孤兒
    if (participants.length === 0 && !(typeof ev.case === "string" && ev.case.length > 0)) trueOrphanEventCount++;
    totalParticipantLinks += participants.length;
    for (const p of participants) {
      edges.push({ person: p.person, eventId: ev.id, role: p.role });
      const existing = peopleByName.get(p.person);
      if (existing) {
        existing.eventCount++;
        if (ev.date < existing.firstDate) existing.firstDate = ev.date;
      } else {
        peopleByName.set(p.person, { name: p.person, eventCount: 1, firstDate: ev.date });
      }
    }

    if (typeof ev.case === "string" && ev.case.length > 0) {
      caseEdges.push({ eventId: ev.id, case: ev.case });
      const existing = casesByName.get(ev.case);
      if (existing) existing.eventCount++;
      else casesByName.set(ev.case, { name: ev.case, eventCount: 1 });
    }

    for (const o of ev.objects ?? []) {
      objectEdges.push({ eventId: ev.id, object: o.object });
      const existing = objectsByName.get(o.object);
      if (existing) existing.eventCount++;
      else objectsByName.set(o.object, { name: o.object, objectType: o.objectType, eventCount: 1 });
    }
  }

  // 人↔人關係是雙向的，但 L3 在 People/*.md 兩邊各自的檔案都會寫一筆（陳
  // 韋翰.md 記一筆到呂駿欣、呂駿欣.md 也記一筆回陳韋翰），collect.ps1 是照
  // 檔案掃的，所以同一段關係在 personRelations 裡通常會出現兩次（from/to
  // 對調）。用排序過的 [from, to] 當 key 去重，避免圖上同一對人之間畫出兩
  // 條疊在一起的邊；兩邊描述文字不一定完全一樣，保留先出現的那筆即可，不
  // 是要在這裡做語意合併。
  const personRelationByKey = new Map<string, { from: string; to: string; description: string }>();
  for (const rel of personRelations) {
    const key = [rel.from, rel.to].sort().join("|");
    if (!personRelationByKey.has(key)) personRelationByKey.set(key, rel);
  }
  const dedupedPersonRelations = Array.from(personRelationByKey.values());

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const newEventsThisWeek = events.filter((ev) => ev.date >= weekAgo).length;
  const newPeopleThisWeek = Array.from(peopleByName.values()).filter((p) => p.firstDate >= weekAgo).length;

  const people = Array.from(peopleByName.values()).sort((a, b) => b.eventCount - a.eventCount);
  const mostActiveOthers = people.filter((p) => p.name !== SELF_PERSON_NAME);
  const mostActivePerson = mostActiveOthers.length > 0
    ? { name: mostActiveOthers[0].name, eventCount: mostActiveOthers[0].eventCount }
    : null;
  const cases = Array.from(casesByName.values()).sort((a, b) => b.eventCount - a.eventCount);
  const objects = Array.from(objectsByName.values()).sort((a, b) => b.eventCount - a.eventCount);
  const activeCasesCount = cases.filter((c) => (caseMetaByName.get(c.name)?.status ?? "active") === "active").length;

  return res.json({
    available: true,
    computedAt: row.computedAt.toISOString(),
    metrics: {
      peopleCount: people.length,
      eventsCount: events.length,
      casesCount: cases.length,
      objectsCount: objects.length,
      avgParticipantsPerEvent: events.length > 0 ? Math.round((totalParticipantLinks / events.length) * 10) / 10 : 0,
      orphanEventRatioPct: events.length > 0 ? Math.round((orphanEventCount / events.length) * 100) : 0,
      trueOrphanEventRatioPct: events.length > 0 ? Math.round((trueOrphanEventCount / events.length) * 100) : 0,
      newEventsThisWeek,
      newPeopleThisWeek,
      mostActivePerson,
      activeCasesCount,
      personRelationsCount: dedupedPersonRelations.length,
    },
    graph: {
      people: people.map((p) => ({ name: p.name, eventCount: p.eventCount })),
      events: events.map((ev) => ({
        id: ev.id,
        date: ev.date,
        title: ev.title,
        status: ev.status,
        tags: ev.tags ?? [],
        case: ev.case ?? null,
      })),
      cases: cases.map((c) => ({ name: c.name, eventCount: c.eventCount, status: caseMetaByName.get(c.name)?.status ?? null })),
      objects: objects.map((o) => ({ name: o.name, objectType: o.objectType, eventCount: o.eventCount })),
      edges,
      caseEdges,
      objectEdges,
      personRelations: dedupedPersonRelations,
    },
  });
});

router.get("/hermes-activity", async (req: Request, res: Response) => {
  const unlocked = req.headers["x-admin-password"] === ADMIN_PASSWORD;
  if (!unlocked) {
    return res.status(403).json({ message: "需要解鎖私領域才能查看" });
  }

  const limitParam = Number(req.query["limit"]);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 20;

  const rows = await db
    .select()
    .from(hermesActivityLogTable)
    .orderBy(desc(hermesActivityLogTable.occurredAt))
    .limit(limit);

  return res.json({
    activity: rows.map((r) => ({ id: r.id, occurredAt: r.occurredAt.toISOString(), source: r.source, message: r.message })),
  });
});

export default router;
