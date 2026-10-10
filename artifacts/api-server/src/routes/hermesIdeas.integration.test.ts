// 想法庫 API 與心智分數來源整合測試（🧮 合成版心智分數：0.8×想法＋0.2×日報）：掛上真實路由、對真實 Postgres 驗證。
// 預設跳過。執行方式（只准對「拋棄式」資料庫）：
//   TEST_DATABASE_URL=postgres://.../aiportal_test pnpm exec vitest run src/routes/hermesIdeas.integration.test.ts
// 安全閘：資料庫名必須以 `_test` 結尾，否則整組測試拒絕執行（測試會清空並寫入相關資料表）。
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DB = process.env["TEST_DATABASE_URL"];
const dbName = TEST_DB ? new URL(TEST_DB).pathname.replace(/^\//, "") : "";
const enabled = Boolean(TEST_DB) && dbName.endsWith("_test");
if (TEST_DB && !enabled) throw new Error(`拒絕執行：資料庫名「${dbName}」不是以 _test 結尾`);

const PWD = "integration-test-pwd";

describe.skipIf(!enabled)("hermes-ideas API／loadCombinedMind（真實 Postgres）", () => {
  let server: Server;
  let base = "";
  let db: typeof import("@workspace/db");
  const get = () => fetch(`${base}/api/hermes-ideas`, { headers: { "x-admin-password": PWD } });
  const hhiRow = (date: string, ideas: number | null, diary: number | null) => ({
    date, finalScore: 60, displayedScore: 60, baseScore: 60, weakestScore: 40, weakestComponent: "fitness",
    availableComponents: ["fitness"], configVersion: "test", mindIdeasRaw: ideas, mindRaw: diary,
  });
  const scored = (d: string) => `🌙 每日精煉洞察 ${d}\n\n📊 今日評分：65\n- 推進 3：甲\n- 決策 2：乙\n- 卡點 3：丙\n- 覺察 2：丁\n- 能量 3：戊\n`;
  const day = (d: string, bodyMd: string) => ({
    level: "day", periodKey: d, startDate: d, endDate: d, title: d, summary: "s", bodyMd, generation: 3,
    rangeInferred: false, periodNote: null, sourcePath: `x/${d}.md`, contentHash: `hash-${d}`,
  });

  beforeAll(async () => {
    process.env["DATABASE_URL"] = TEST_DB;
    process.env["ADMIN_PASSWORD"] = PWD;
    db = await import("@workspace/db");
    const express = (await import("express")).default;
    const router = (await import("./hermesIdeas")).default;
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    app.use("/api", router);
    await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { await new Promise((r) => server?.close(r)); });
  beforeEach(async () => {
    await db.db.delete(db.hermesTimelineEntryTable);
    await db.db.delete(db.happinessIndexHistoryTable);
    await db.db.delete(db.hermesIdeasSnapshotTable);
    await db.db.insert(db.hermesIdeasSnapshotTable).values({ id: "latest", ideas: [], weeks: [], generatedAt: "2026-10-10" });
  });

  const idea = (n: number, bornAt: string) => ({
    id: `IDEA-${String(n).padStart(4, "0")}`, title: "x", category: null, dimension: null, source: null, why: null,
    value: 3, effort: 3, status: "new", bornAt, lastMentioned: bornAt, mentions: 1, backfill: false, days: [], baseScore: 9, baseWhy: [],
    history: [{ status: "new", at: bornAt }],
  });

  it("mindShadow: stored combined only from 2026-10-10 (before that mind_raw was the diary-count version), plus that day's report", async () => {
    await db.db.insert(db.happinessIndexHistoryTable).values([hhiRow("2026-10-09", 100, 92), hhiRow("2026-10-10", 90, 85.2)]);
    await db.db.insert(db.hermesTimelineEntryTable).values([day("2026-10-09", "# 舊日報，沒有評分段"), day("2026-10-10", scored("2026-10-10"))]);
    const body = await (await get()).json() as { mindShadow: Array<Record<string, unknown>>; mindCombined: unknown };
    expect(body.mindShadow).toEqual([
      { date: "2026-10-09", ideas: 100, report: null, combined: null },   // 日記篇數版的 mind_raw 不當合成版
      { date: "2026-10-10", ideas: 90, report: 65, combined: 85.2 },
    ]);
    expect(body).toHaveProperty("mindCombined");
    expect(body).not.toHaveProperty("mindReport");
  });

  it("loadCombinedMind: today's report first, else yesterday's; 0.8 ideas + 0.2 report; ideas-only without a report", async () => {
    const { loadCombinedMind } = await import("../lib/mindCombinedSource");
    const { computeIdeasMind } = await import("../lib/ideasMind");
    const ideas = [idea(1, "2026-10-09T10:00:00+08:00"), idea(2, "2026-10-08T10:00:00+08:00")];
    await db.db.update(db.hermesIdeasSnapshotTable).set({ ideas: ideas as never });
    const ideasScore = computeIdeasMind(ideas as never, "2026-10-10").score;

    expect(await loadCombinedMind("2026-10-10")).toEqual({ score: Math.round(ideasScore * 10) / 10, ideas: ideasScore, report: null });

    await db.db.insert(db.hermesTimelineEntryTable).values([day("2026-10-09", scored("2026-10-09")), day("2026-10-08", scored("2026-10-08").replace("推進 3", "推進 0"))]);
    const y = await loadCombinedMind("2026-10-10");                       // 今天還沒推上來 → 用昨天的
    expect(y.report).toMatchObject({ date: "2026-10-09", total: 65 });
    expect(y.score).toBe(Math.round((0.8 * ideasScore + 0.2 * 65) * 10) / 10);

    await db.db.insert(db.hermesTimelineEntryTable).values(day("2026-10-10", scored("2026-10-10").replace("能量 3", "能量 4")));
    expect((await loadCombinedMind("2026-10-10")).report).toMatchObject({ date: "2026-10-10", total: 70 });
    expect((await loadCombinedMind("2026-10-12")).report).toBeNull();     // 只看今天與昨天，不拿兩天前的
  });

  it("GET returns absorbed ideas with mergedInto / absorbed and never ranks them", async () => {
    const a = { ...idea(39, "2026-09-01T10:00:00+08:00"), status: "absorbed", mergedInto: "IDEA-0022", baseScore: null };
    const b = { ...idea(22, "2026-09-01T10:00:00+08:00"), absorbed: ["IDEA-0039"] };
    await db.db.update(db.hermesIdeasSnapshotTable).set({ ideas: [a, b] as never });
    const body = await (await get()).json() as { ideas: Array<{ id: string; status: string; mergedInto?: string | null; absorbed?: string[]; score: number | null }>; top: string[] };
    const by = Object.fromEntries(body.ideas.map((i) => [i.id, i]));
    expect(by["IDEA-0039"]).toMatchObject({ status: "absorbed", mergedInto: "IDEA-0022", score: null });
    expect(by["IDEA-0022"]).toMatchObject({ absorbed: ["IDEA-0039"] });
    expect(body.top).not.toContain("IDEA-0039");
  });

  it("loadCombinedMind is null-scored without any ideas", async () => {
    const { loadCombinedMind } = await import("../lib/mindCombinedSource");
    await db.db.insert(db.hermesTimelineEntryTable).values(day("2026-10-10", scored("2026-10-10")));
    expect(await loadCombinedMind("2026-10-10")).toMatchObject({ score: null, ideas: null, report: { total: 65 } });
  });
});
