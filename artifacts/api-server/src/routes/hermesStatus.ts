import { Router, type Request, type Response } from "express";
import {
  db,
  hermesStatusSnapshotTable,
  hermesActivityLogTable,
  hermesGraphSnapshotTable,
  hermesPipelineSnapshotTable,
  hermesStatusHistoryTable,
  hermesPipelineHistoryTable,
  type HermesStatusSnapshotRow,
  type HermesGraphEvent,
  type HermesGraphPersonRelation,
  type HermesGraphCaseMeta,
  type HermesGraphHubNarrative,
  type HermesPipelineLayerStatus,
} from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { isAuthorized } from "../lib/adminSession";
import { taipeiDateString } from "../lib/summarySources";
import { notifyOnAlertTransition } from "../lib/notify";

const router = Router();

// Vault 本人（"使用者" alias 已在 2026-09-08 併檔進這個名字，見
// Events/2026-09-08_People-alias手動併檔完成使用者併入陳韋翰.md）——他幾乎
// 是每一筆事件的參與者，「這陣子最活躍」這個指標的意義是「最近誰跟我互動
// 最多」，不是「我自己最活躍」，本人自己永遠奪冠對這個問題沒有任何資訊
// 量，所以只在算 mostActivePerson 時把他濾掉；人物節點本身、degree、其他
// 統計都不受影響，他仍然正常出現在圖上跟人數計算裡。
const SELF_PERSON_NAME = "陳韋翰";

// Windows SCHED_S_TASK_RUNNING / SCHED_S_TASK_HAS_NOT_RUN — same two magic
// result codes App.tsx's isTaskFailed() treats as "not actually a failure".
// Duplicated here (not imported — gis-portal and api-server don't share a
// UI-logic package) because the daily history snapshot below needs the same
// "is this task row failed" judgment the frontend already makes per-row;
// keep in sync with App.tsx's isTaskFailed/isContainerFailed if that logic
// ever changes.
const TASK_RUNNING_RESULT = 267009;
const TASK_NOT_YET_RUN_RESULT = 267011;

function isTaskFailedRow(t: { lastTaskResult: number | null }): boolean {
  const isRunning = t.lastTaskResult === TASK_RUNNING_RESULT;
  const isPending = t.lastTaskResult === TASK_NOT_YET_RUN_RESULT;
  return t.lastTaskResult !== null && !isRunning && !isPending && t.lastTaskResult !== 0;
}

function isContainerFailedRow(c: { status: string; health: string | null }): boolean {
  return !/up/i.test(c.status) || c.health === "unhealthy";
}

// Data collected by services/hermes-status/collect.ps1 on the deploy host
// (Windows Task Scheduler, every few minutes) — CPU/RAM/disk via CIM, docker
// container health via `docker ps`, scheduled-task results via
// Get-ScheduledTaskInfo. Not a SUMMARY_SOURCES entry / doesn't feed the HHI
// composite — this is operational monitoring, not a happiness dimension, so
// it's a standalone route like /mind-index/history, not wired into
// lib/summarySources.ts.
router.post("/admin/hermes-status", async (req: Request, res: Response) => {
  const authorized = isAuthorized(req.headers["x-admin-password"]);
  if (!authorized) {
    return res.status(403).json({ message: "需要管理員權限" });
  }

  const body = req.body as Record<string, unknown>;
  const num = (key: string): number | null => (typeof body[key] === "number" ? (body[key] as number) : null);
  const arr = (key: string): unknown[] => (Array.isArray(body[key]) ? (body[key] as unknown[]) : []);

  // NonNullable — arr() always returns an array (never the column's nullable
  // "not written yet" state), so the history aggregation below can safely
  // .reduce()/.filter() without a null check that could never actually fire.
  const disks = arr("disks") as NonNullable<HermesStatusSnapshotRow["disks"]>;
  const containers = arr("containers") as NonNullable<HermesStatusSnapshotRow["containers"]>;
  const scheduledTasks = arr("scheduledTasks") as NonNullable<HermesStatusSnapshotRow["scheduledTasks"]>;

  const row = {
    id: "latest",
    cpuPercent: num("cpuPercent"),
    memPercent: num("memPercent"),
    disks,
    containers,
    scheduledTasks,
  };

  await db
    .insert(hermesStatusSnapshotTable)
    .values(row)
    .onConflictDoUpdate({
      target: hermesStatusSnapshotTable.id,
      set: { ...row, computedAt: new Date() },
    });

  // 每日一筆的趨勢紀錄——跟 mind/social index 同一套「每次 push 就 upsert
  // 今天那列」模式，見 hermesStatusHistory.ts 的說明。這裡只是把同一包資料
  // 多算幾個彙總欄位存下來，不是另外呼叫一次來源。
  const worstDiskPercent = disks.reduce<number | null>(
    (worst, d) => (worst === null || d.percentUsed > worst ? d.percentUsed : worst),
    null,
  );
  const failedContainers = containers.filter((c) => isContainerFailedRow(c));
  const failedTasks = scheduledTasks.filter((t) => isTaskFailedRow(t));
  const historyRow = {
    date: taipeiDateString(new Date()),
    cpuPercent: row.cpuPercent,
    memPercent: row.memPercent,
    worstDiskPercent,
    containersHealthy: containers.length - failedContainers.length,
    containersTotal: containers.length,
    tasksFailed: failedTasks.length,
    tasksTotal: scheduledTasks.length,
  };
  await db
    .insert(hermesStatusHistoryTable)
    .values(historyRow)
    .onConflictDoUpdate({
      target: hermesStatusHistoryTable.date,
      set: { ...historyRow, computedAt: new Date() },
    });

  // 狀態改變才推播，不是每次 push 都發——見 notify.ts 的說明。
  notifyOnAlertTransition(
    "hermes-containers",
    failedContainers.length > 0,
    "Aiportal: HERMES containers",
    `${failedContainers.length} 個容器異常：${failedContainers.map((c) => c.name).join("、")}`,
    "容器已恢復正常",
  );
  notifyOnAlertTransition(
    "hermes-tasks",
    failedTasks.length > 0,
    "Aiportal: HERMES scheduled tasks",
    `${failedTasks.length} 個排程任務失敗：${failedTasks.map((t) => t.name).join("、")}`,
    "排程任務已恢復正常",
  );

  return res.json({ success: true });
});

// Single event append — the collector script POSTs one entry per new
// update.log line it finds since the last run. Not an upsert like the
// snapshot above: the same day can have multiple deploys/backups, so this
// is append-only (hermes_activity_log has no date/id conflict target).
router.post("/admin/hermes-activity", async (req: Request, res: Response) => {
  const authorized = isAuthorized(req.headers["x-admin-password"]);
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
  const unlocked = isAuthorized(req.headers["x-admin-password"]);
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

// 每日趨勢——跟 /happiness/history、/mind-index/history 同樣的形狀跟
// private-zone 密碼閘門，給 CPU/RAM/磁碟/容器健康/排程任務成功率畫趨勢線。
router.get("/hermes-status/history", async (req: Request, res: Response) => {
  const unlocked = isAuthorized(req.headers["x-admin-password"]);
  if (!unlocked) {
    return res.status(403).json({ message: "需要解鎖私領域才能查看" });
  }

  const daysParam = Number(req.query["days"]);
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 365) : 30;

  const rows = await db
    .select()
    .from(hermesStatusHistoryTable)
    .orderBy(desc(hermesStatusHistoryTable.date))
    .limit(days);

  return res.json({
    history: rows.reverse().map((r) => ({
      date: r.date,
      cpuPercent: r.cpuPercent,
      memPercent: r.memPercent,
      worstDiskPercent: r.worstDiskPercent,
      containersHealthy: r.containersHealthy,
      containersTotal: r.containersTotal,
      tasksFailed: r.tasksFailed,
      tasksTotal: r.tasksTotal,
    })),
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
  const authorized = isAuthorized(req.headers["x-admin-password"]);
  if (!authorized) {
    return res.status(403).json({ message: "需要管理員權限" });
  }

  const body = req.body as Record<string, unknown>;
  const events = Array.isArray(body["events"]) ? (body["events"] as HermesGraphEvent[]) : [];
  const personRelations = Array.isArray(body["personRelations"])
    ? (body["personRelations"] as HermesGraphPersonRelation[])
    : [];
  const cases = Array.isArray(body["cases"]) ? (body["cases"] as HermesGraphCaseMeta[]) : [];
  const hubNarratives = Array.isArray(body["hubNarratives"])
    ? (body["hubNarratives"] as HermesGraphHubNarrative[])
    : [];

  await db
    .insert(hermesGraphSnapshotTable)
    .values({ id: "latest", events, personRelations, cases, hubNarratives })
    .onConflictDoUpdate({
      target: hermesGraphSnapshotTable.id,
      set: { events, personRelations, cases, hubNarratives, computedAt: new Date() },
    });

  return res.json({ success: true });
});

router.get("/hermes-graph", async (req: Request, res: Response) => {
  const unlocked = isAuthorized(req.headers["x-admin-password"]);
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
  const hubNarratives = row.hubNarratives ?? [];
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
      hubNarratives,
    },
  });
});

router.get("/hermes-activity", async (req: Request, res: Response) => {
  const unlocked = isAuthorized(req.headers["x-admin-password"]);
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

// ── HERMES 戰情室：L1~L5 日記→知識萃取管線即時監控 ─────────────────────
// 資料來自 HERMES 自己在 NAS 上跑的 l{N}-agent-wrapper.py（N=1..5），每次
// 跑完寫一份 heartbeat 到本機 F:/SynologyDrive/AI/state/heartbeat.json；
// collect.ps1 跟上面 hermes-status 那段一樣跑在同一台部署主機上，直接讀
// 這個檔案、逐層 passthrough 過來，這裡不重算任何欄位，只在讀取時依
// lastRunTs + 各層預期班距換算成紅綠燈——跟 hermes-graph 那邊「Events
// frontmatter 是唯一真相來源，衍生指標一律在讀取時反推」同一個原則，不
// 是另外存一份算好的健康狀態。
//
// 預期班距（2026-09-21 更新）：L1 三班 10:30/16:30/20:30（班距約 6 小時）、
// L2 兩班 12:00/21:15（約 9 小時）、L3/L5 每日一班（24 小時）、L4 兩班
// 11:35/17:15（日間約 5.7 小時、夜間 17:35→翌日 11:35 約 18 小時）——超過
// 班距的 2 倍才算 stale，不是超過班距本身就算（每一班不保證剛好準點觸發，
// 2 倍給排程抖動留餘裕；L4 取 10 小時使閾值 20 小時涵蓋夜間 18 小時間隔，
// 漏一班約 24 小時仍會確實轉紅）。
const PIPELINE_CADENCE_HOURS: Record<"l1" | "l2" | "l3" | "l4" | "l5", number> = {
  l1: 6,
  l2: 9,
  l3: 24,
  l4: 10,
  l5: 24,
};

const EMPTY_PIPELINE_LAYER: HermesPipelineLayerStatus = {
  status: null,
  lastRun: null,
  lastRunTs: null,
  processed: null,
  committed: null,
  failed: null,
  backlog: null,
  errorSummary: null,
  durationSeconds: null,
};

type PipelineHealth = "ok" | "crit" | "unknown";

// HERMES 特別提醒過：heartbeat 是 wrapper 自己寫的，曾經發生過「job 照跑
// ok 但心跳檔凍結」的斷鏈，所以不能只信 status 欄位——lastRunTs 早於預期
// 班距 2 倍的一律算 crit，不管 status 寫什麼。processed===0 不算異常
// （當班沒有新內容是正常狀態），這裡完全不看 processed/committed/backlog。
function computePipelineHealth(layer: HermesPipelineLayerStatus | null, cadenceHours: number): PipelineHealth {
  if (!layer || layer.lastRunTs === null) return "unknown";
  const hasError = (layer.failed ?? 0) > 0 || (layer.errorSummary ?? "").trim().length > 0;
  const isStale = Date.now() - layer.lastRunTs > cadenceHours * 2 * 60 * 60 * 1000;
  return hasError || isStale ? "crit" : "ok";
}

function pipelineLayerWithHealth(layer: HermesPipelineLayerStatus | null, cadenceHours: number) {
  return { ...(layer ?? EMPTY_PIPELINE_LAYER), health: computePipelineHealth(layer, cadenceHours) };
}

router.post("/admin/hermes-pipeline", async (req: Request, res: Response) => {
  const authorized = isAuthorized(req.headers["x-admin-password"]);
  if (!authorized) {
    return res.status(403).json({ message: "需要管理員權限" });
  }

  const body = req.body as Record<string, unknown>;
  const layer = (key: string): HermesPipelineLayerStatus | null => {
    const v = body[key];
    return v && typeof v === "object" ? (v as HermesPipelineLayerStatus) : null;
  };

  const row = {
    id: "latest",
    l1: layer("l1"),
    l2: layer("l2"),
    l3: layer("l3"),
    l4: layer("l4"),
    l5: layer("l5"),
  };

  await db
    .insert(hermesPipelineSnapshotTable)
    .values(row)
    .onConflictDoUpdate({
      target: hermesPipelineSnapshotTable.id,
      set: { ...row, computedAt: new Date() },
    });

  // 每日一筆的趨勢紀錄，存的是「這次 push 當下」算出來的健康狀態，不是原始
  // heartbeat 欄位——見 hermesPipelineHistory.ts 的說明，為什麼不能留到讀取
  // 歷史時才重算。
  const historyRow = {
    date: taipeiDateString(new Date()),
    l1Health: computePipelineHealth(row.l1, PIPELINE_CADENCE_HOURS.l1),
    l2Health: computePipelineHealth(row.l2, PIPELINE_CADENCE_HOURS.l2),
    l3Health: computePipelineHealth(row.l3, PIPELINE_CADENCE_HOURS.l3),
    l4Health: computePipelineHealth(row.l4, PIPELINE_CADENCE_HOURS.l4),
    l5Health: computePipelineHealth(row.l5, PIPELINE_CADENCE_HOURS.l5),
  };
  await db
    .insert(hermesPipelineHistoryTable)
    .values(historyRow)
    .onConflictDoUpdate({
      target: hermesPipelineHistoryTable.date,
      set: { ...historyRow, computedAt: new Date() },
    });

  // 狀態改變才推播，每層獨立追蹤——見 notify.ts 的說明。
  (["l1", "l2", "l3", "l4", "l5"] as const).forEach((key) => {
    const label = key.toUpperCase();
    const health = historyRow[`${key}Health` as `${typeof key}Health`];
    notifyOnAlertTransition(
      `hermes-pipeline-${label}`,
      health === "crit",
      `Aiportal: HERMES pipeline ${label}`,
      `知識萃取管線 ${label} 異常：超過預期班距未成功執行，或有錯誤`,
      `${label} 已恢復正常`,
    );
  });

  return res.json({ success: true });
});

router.get("/hermes-pipeline", async (req: Request, res: Response) => {
  const unlocked = isAuthorized(req.headers["x-admin-password"]);
  if (!unlocked) {
    return res.status(403).json({ message: "需要解鎖私領域才能查看" });
  }

  const [row] = await db
    .select()
    .from(hermesPipelineSnapshotTable)
    .where(eq(hermesPipelineSnapshotTable.id, "latest"))
    .limit(1);

  if (!row) {
    return res.json({ available: false });
  }

  return res.json({
    available: true,
    computedAt: row.computedAt.toISOString(),
    layers: {
      L1: pipelineLayerWithHealth(row.l1, PIPELINE_CADENCE_HOURS.l1),
      L2: pipelineLayerWithHealth(row.l2, PIPELINE_CADENCE_HOURS.l2),
      L3: pipelineLayerWithHealth(row.l3, PIPELINE_CADENCE_HOURS.l3),
      L4: pipelineLayerWithHealth(row.l4, PIPELINE_CADENCE_HOURS.l4),
      L5: pipelineLayerWithHealth(row.l5, PIPELINE_CADENCE_HOURS.l5),
    },
  });
});

// 每日趨勢——每層存的是 ok/crit/unknown 字串（見 hermesPipelineHistory.ts
// 為什麼不能讀取時重算），前端拿這個畫「近 N 天每天健康狀態」的色條，不是
// 折線圖（health 是類別值不是連續數字）。
router.get("/hermes-pipeline/history", async (req: Request, res: Response) => {
  const unlocked = isAuthorized(req.headers["x-admin-password"]);
  if (!unlocked) {
    return res.status(403).json({ message: "需要解鎖私領域才能查看" });
  }

  const daysParam = Number(req.query["days"]);
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 365) : 30;

  const rows = await db
    .select()
    .from(hermesPipelineHistoryTable)
    .orderBy(desc(hermesPipelineHistoryTable.date))
    .limit(days);

  return res.json({
    history: rows.reverse().map((r) => ({
      date: r.date,
      L1: r.l1Health,
      L2: r.l2Health,
      L3: r.l3Health,
      L4: r.l4Health,
      L5: r.l5Health,
    })),
  });
});

export default router;
