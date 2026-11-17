// 報告庫 API：掛上真實路由、用 tmp 資料夾當 REPORTS_ROOT（不需資料庫）。
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import type { IncomingHttpHeaders, Server } from "node:http";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

// adminPassword 在模組載入時就檢查 ADMIN_PASSWORD，所以先設好 env 再動態載入路由。
let reportsRoot!: typeof import("./reports").reportsRoot;
beforeAll(async () => {
  process.env["ADMIN_PASSWORD"] = PWD;
  reportsRoot = (await import("./reports")).reportsRoot;
});

const PWD = "reports-test-pwd";
const dir = mkdtempSync(path.join(tmpdir(), "reports-root-"));
const emptyDir = mkdtempSync(path.join(tmpdir(), "reports-empty-"));
const badDir = mkdtempSync(path.join(tmpdir(), "reports-bad-"));
const outside = mkdtempSync(path.join(tmpdir(), "reports-outside-"));

function catalog(reports: unknown[]): string {
  return JSON.stringify({ version: 1, generatedAt: "2026-11-17T21:00:00+08:00", count: reports.length, reports });
}

function report(n: number) {
  return {
    path: `2026/2026-11-${String(10 + n).padStart(2, "0")}_專案${n}_報告${n}.html`,
    title: `報告${n}`, date: `2026-11-${String(10 + n).padStart(2, "0")}`, project: `專案${n}`,
    tags: ["x"], status: "定稿", summary: `摘要${n}`, source: `D:\\來源\\${n}`, bytes: 1234,
  };
}

// symlink 在 Windows 上可能沒權限：建不出來就跳過那一題。
let symlinkOk = false;

describe("報告庫 API", () => {
  let server: Server;
  let port = 0;
  let base = "";
  let savedRoot: string | undefined;

  const useRoot = (root: string) => { process.env["REPORTS_ROOT"] = root; };

  const get = (p: string, pwd: string | null = PWD) =>
    fetch(`${base}/api/reports${p}`, { headers: pwd ? { "x-admin-password": pwd } : {} });

  /** 原樣送出請求路徑（fetch／URL 會把 `..`、`%2e%2e` 正規化掉，測不到逃逸）。 */
  const getRaw = (p: string, pwd: string | null = PWD) =>
    new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const req = httpRequest(
        { host: "127.0.0.1", port, path: p, headers: pwd ? { "x-admin-password": pwd } : {} },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
        },
      );
      req.on("error", reject);
      req.end();
    });

  beforeAll(async () => {
    process.env["ADMIN_PASSWORD"] = PWD;
    savedRoot = process.env["REPORTS_ROOT"];
    process.env["REPORTS_ROOT"] = dir;

    mkdirSync(path.join(dir, "2026"), { recursive: true });
    writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>索引</title>索引頁");
    writeFileSync(path.join(dir, "2026", "2026-11-17_測試_報告A.html"), "<html><body>報告A</body></html>");
    writeFileSync(path.join(dir, "2026", "note.txt"), "not a report");
    writeFileSync(path.join(dir, "reports.json"), catalog(Array.from({ length: 7 }, (_, i) => report(i + 1))));
    writeFileSync(path.join(badDir, "reports.json"), "{ not json");
    try {
      writeFileSync(path.join(outside, "secret.html"), "<html>不該被讀到</html>");
      symlinkSync(path.join(outside, "secret.html"), path.join(dir, "2026", "link.html"));
      symlinkOk = true;
    } catch {
      symlinkOk = false;
    }

    const express = (await import("express")).default;
    const mod = await import("./reports");
    const app = express();
    app.use("/api", mod.default);
    await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
    port = (server.address() as { port: number }).port;
    base = `http://127.0.0.1:${port}`;
  });
  afterEach(() => { process.env["REPORTS_ROOT"] = dir; });
  afterAll(async () => {
    await new Promise((r) => server?.close(r));
    if (savedRoot === undefined) delete process.env["REPORTS_ROOT"];
    else process.env["REPORTS_ROOT"] = savedRoot;
    for (const d of [dir, emptyDir, badDir, outside]) rmSync(d, { recursive: true, force: true });
  });

  it("requires the admin session (403 without or with a wrong password)", async () => {
    expect((await get("/catalog", null)).status).toBe(403);
    expect((await get("/catalog", "wrong")).status).toBe(403);
    expect((await get("/file/index.html", null)).status).toBe(403);
    expect((await get("/file/index.html", "wrong")).status).toBe(403);
  });

  it("returns the catalog with at most 5 latest reports and no source/bytes", async () => {
    const r = await get("/catalog");
    expect(r.status).toBe(200);
    const body = await r.json() as {
      available: boolean; count: number; generatedAt: string; latest: Array<Record<string, unknown>>
    };
    expect(body.available).toBe(true);
    expect(body.count).toBe(7);
    expect(body.generatedAt).toBe("2026-11-17T21:00:00+08:00");
    expect(body.latest).toHaveLength(5);
    expect(body.latest[0]).toEqual({
      path: "2026/2026-11-11_專案1_報告1.html", title: "報告1", date: "2026-11-11", project: "專案1",
      tags: ["x"], status: "定稿", summary: "摘要1",
    });
    for (const item of body.latest) {
      expect("source" in item).toBe(false);
      expect("bytes" in item).toBe(false);
    }
  });

  it("reports available:false when the root or reports.json does not exist", async () => {
    useRoot(path.join(dir, "no-such-dir"));
    let body = await (await get("/catalog")).json() as { available: boolean; reason: string };
    expect(body).toEqual({ available: false, reason: "報告庫尚未建立" });

    useRoot(emptyDir); // 根目錄在，但沒有 reports.json
    body = await (await get("/catalog")).json() as { available: boolean; reason: string };
    expect(body).toEqual({ available: false, reason: "報告庫尚未建立" });
  });

  it("reports available:false (not 500) when reports.json is broken or the wrong shape", async () => {
    useRoot(badDir);
    const r = await get("/catalog");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ available: false, reason: "報告庫目錄格式不正確" });

    writeFileSync(path.join(badDir, "reports.json"), JSON.stringify({ reports: "nope" }));
    expect(await (await get("/catalog")).json()).toEqual({ available: false, reason: "報告庫目錄格式不正確" });
  });

  it("serves a report as sandboxed HTML without allow-same-origin", async () => {
    const r = await get("/file/2026/2026-11-17_測試_報告A.html");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("cache-control")).toBe("private, no-cache");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    const csp = r.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("sandbox");
    expect(csp).not.toContain("allow-same-origin");
    expect(await r.text()).toBe("<html><body>報告A</body></html>");
  });

  it("rejects `..` and `%2e%2e` escapes with 400", async () => {
    expect((await getRaw("/api/reports/file/../secret.html")).status).toBe(400);
    expect((await getRaw("/api/reports/file/%2e%2e/secret.html")).status).toBe(400);
    expect((await getRaw("/api/reports/file/2026/%2e%2e/%2e%2e/secret.html")).status).toBe(400);
  });

  it("rejects dotfiles and empty paths with 400", async () => {
    expect((await getRaw("/api/reports/file/.hidden.html")).status).toBe(400);
    expect((await getRaw("/api/reports/file/2026//note.html")).status).toBe(400);
  });

  it("rejects non-html files with 415", async () => {
    expect((await get("/file/2026/note.txt")).status).toBe(415);
    expect((await get("/file/a.exe")).status).toBe(415);
  });

  it("404s for a missing report or an unmounted root", async () => {
    expect((await get("/file/2026/nope.html")).status).toBe(404);
    useRoot(path.join(dir, "no-such-dir"));
    expect((await get("/file/index.html")).status).toBe(404);
  });

  it.skipIf(!symlinkOk)("does not follow a symlink that escapes the root", async () => {
    const r = await get("/file/2026/link.html");
    expect(r.status).toBe(400);
    expect(await r.text()).not.toContain("不該被讀到");
  });
});

describe("reportsRoot", () => {
  it("prefers REPORTS_ROOT", () => {
    expect(reportsRoot({ REPORTS_ROOT: "/mnt/reports" })).toBe("/mnt/reports");
  });

  it("derives 報告 next to the NAS root's parent by default", () => {
    expect(reportsRoot({ HERMES_RAW_NAS_ROOT: "/mnt/vault/人類" })).toBe(path.join("/mnt/vault", "報告"));
    expect(reportsRoot({})).toBe(path.join(path.dirname("/data/raw-nas"), "報告"));
  });
});
