// 想法庫 API 整合測試（只測 🧮 合成心智分數的並行欄位）：掛上真實路由、對真實 Postgres 驗證。
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

describe.skipIf(!enabled)("hermes-ideas API 合成心智分數（真實 Postgres）", () => {
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

  it("adds report and combined (0.8 ideas + 0.2 report) per day, falling back to ideas when there is no report", async () => {
    await db.db.insert(db.happinessIndexHistoryTable).values([hhiRow("2026-10-08", 90, 80), hhiRow("2026-10-09", 100, 92), hhiRow("2026-10-10", null, 70)]);
    await db.db.insert(db.hermesTimelineEntryTable).values([
      day("2026-10-08", "# 舊日報，沒有評分段"),
      day("2026-10-09", scored("2026-10-09")),
      day("2026-10-10", scored("2026-10-10")),
    ]);
    const body = await (await get()).json() as {
      mindShadow: Array<{ date: string; ideas: number | null; report: number | null; combined: number | null }>;
      mindReport: { date: string; total: number; parts: Array<{ label: string; value: number }> } | null;
    };
    expect(body.mindShadow.map((d) => [d.date, d.ideas, d.report, d.combined])).toEqual([
      ["2026-10-08", 90, null, 90],          // 沒有 📊 段 → 只用想法分數
      ["2026-10-09", 100, 65, 93],           // 0.8×100 + 0.2×65
      ["2026-10-10", null, 65, null],        // 沒有想法分數 → 不算
    ]);
    expect(body.mindReport).toMatchObject({ date: "2026-10-10", total: 65 });
    expect(body.mindReport?.parts.map((p) => p.value)).toEqual([3, 2, 3, 2, 3]);
  });

  it("mindReport is null when no day report has a score", async () => {
    await db.db.insert(db.happinessIndexHistoryTable).values(hhiRow("2026-10-09", 100, 92));
    const body = await (await get()).json() as { mindReport: unknown; mindShadow: Array<{ combined: number | null }> };
    expect(body.mindReport).toBeNull();
    expect(body.mindShadow[0]?.combined).toBe(100);
  });
});
