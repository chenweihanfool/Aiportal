import { Router, type Request, type Response } from "express";
import {
  db,
  hermesStatusSnapshotTable,
  hermesActivityLogTable,
  hermesGraphSnapshotTable,
  type HermesStatusSnapshotRow,
  type HermesGraphEvent,
} from "@workspace/db";
import { desc, eq } from "drizzle-orm";

const router = Router();

const ADMIN_PASSWORD = process.env["ADMIN_PASSWORD"] ?? "85097110";

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

// HERMES's "事人雙實體" (event-person dual-entity) knowledge structure —
// collect.ps1 re-scans every Events/*.md file's frontmatter each run and
// POSTs the full current set (not a diff, same "whole payload overwrite"
// shape as hermes-status above). People/*.md is a script-maintained
// backlink cache on HERMES's own side, not a separate source of truth, so
// only `events` is ever posted or stored — every person node, edge, and
// derived metric below is computed from `events` at read time.
router.post("/admin/hermes-graph", async (req: Request, res: Response) => {
  const authorized = req.headers["x-admin-password"] === ADMIN_PASSWORD;
  if (!authorized) {
    return res.status(403).json({ message: "需要管理員權限" });
  }

  const body = req.body as Record<string, unknown>;
  const events = Array.isArray(body["events"]) ? (body["events"] as HermesGraphEvent[]) : [];

  await db
    .insert(hermesGraphSnapshotTable)
    .values({ id: "latest", events })
    .onConflictDoUpdate({
      target: hermesGraphSnapshotTable.id,
      set: { events, computedAt: new Date() },
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

  // 人物節點 + degree（連結數）從 events.participants 反推——People/*.md
  // 只是 HERMES 自己維護的反查快取，不是另一份要另外信任的來源。同一個
  // person 名稱視為同一個節點（沒有跨事件的 id，用顯示名稱本身當 key，跟
  // frontmatter 的 `[[人名]]` wikilink 語意一致）。
  const peopleByName = new Map<string, { name: string; eventCount: number; firstDate: string }>();
  const edges: Array<{ person: string; eventId: string; role: string }> = [];
  let totalParticipantLinks = 0;
  let orphanEventCount = 0;

  for (const ev of events) {
    const participants = ev.participants ?? [];
    if (participants.length === 0) orphanEventCount++;
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
  }

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const newEventsThisWeek = events.filter((ev) => ev.date >= weekAgo).length;
  const newPeopleThisWeek = Array.from(peopleByName.values()).filter((p) => p.firstDate >= weekAgo).length;

  const people = Array.from(peopleByName.values()).sort((a, b) => b.eventCount - a.eventCount);
  const mostActivePerson = people.length > 0 ? { name: people[0].name, eventCount: people[0].eventCount } : null;

  return res.json({
    available: true,
    computedAt: row.computedAt.toISOString(),
    metrics: {
      peopleCount: people.length,
      eventsCount: events.length,
      avgParticipantsPerEvent: events.length > 0 ? Math.round((totalParticipantLinks / events.length) * 10) / 10 : 0,
      orphanEventRatioPct: events.length > 0 ? Math.round((orphanEventCount / events.length) * 100) : 0,
      newEventsThisWeek,
      newPeopleThisWeek,
      mostActivePerson,
    },
    graph: {
      people: people.map((p) => ({ name: p.name, eventCount: p.eventCount })),
      events: events.map((ev) => ({
        id: ev.id,
        date: ev.date,
        title: ev.title,
        status: ev.status,
        tags: ev.tags ?? [],
      })),
      edges,
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
