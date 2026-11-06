// 原檔 API：掛上真實路由、用 tmp 資料夾當 HERMES_RAW_ROOT（不需資料庫）。
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PWD = "raw-test-pwd";
const dir = mkdtempSync(path.join(tmpdir(), "raw-root-"));
const outside = mkdtempSync(path.join(tmpdir(), "raw-outside-"));

// symlink 在 Windows 上可能沒權限：建不出來就跳過 symlink 那一題（不算失敗）。
let symlinkOk = false;
try {
  writeFileSync(path.join(outside, "secret.pdf"), "不該被讀到");
  symlinkSync(path.join(outside, "secret.pdf"), path.join(dir, "link.pdf"));
  symlinkOk = true;
} catch {
  symlinkOk = false;
}

describe("GET /api/hermes-raw", () => {
  let server: Server;
  let base = "";

  const get = (p: string, pwd: string | null = PWD) =>
    fetch(`${base}/api/hermes-raw?path=${encodeURIComponent(p)}`, { headers: pwd ? { "x-admin-password": pwd } : {} });

  beforeAll(async () => {
    process.env["ADMIN_PASSWORD"] = PWD;
    process.env["HERMES_RAW_ROOT"] = dir;
    mkdirSync(path.join(dir, "案件A"));
    writeFileSync(path.join(dir, "案件A", "公文.pdf"), "%PDF-1.4 fake");
    writeFileSync(path.join(dir, "案件A", "契約.docx"), "PK fake docx");
    writeFileSync(path.join(dir, "照片.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(path.join(dir, "a.exe"), "MZ");
    writeFileSync(path.join(dir, ".stignore"), "secret");
    writeFileSync(path.join(dir, "big.pdf"), Buffer.alloc(50 * 1024 * 1024 + 1));
    const express = (await import("express")).default;
    const router = (await import("./hermesRaw")).default;
    const app = express();
    app.use("/api", router);
    await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    await new Promise((r) => server?.close(r));
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("requires the admin session (403 without or with a wrong password)", async () => {
    expect((await get("案件A/公文.pdf", null)).status).toBe(403);
    expect((await get("案件A/公文.pdf", "wrong")).status).toBe(403);
  });

  it("serves a pdf inline with nosniff and the sandbox CSP", async () => {
    const r = await get("人類/案件A/公文.pdf");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.headers.get("content-disposition")).toMatch(/^inline; filename\*=UTF-8''/);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("content-security-policy")).toContain("sandbox");
    expect(await r.text()).toBe("%PDF-1.4 fake");
  });

  it("accepts the path without the 人類/ prefix too", async () => {
    expect((await get("照片.png")).headers.get("content-type")).toBe("image/png");
  });

  it("serves a docx as an attachment download", async () => {
    const r = await get("人類/案件A/契約.docx");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(r.headers.get("content-disposition")).toMatch(/^attachment; filename\*=UTF-8''/);
  });

  it("rejects traversal, absolute, backslash and hidden paths with 400", async () => {
    expect((await get("人類/../a.pdf")).status).toBe(400);
    expect((await get("/etc/passwd")).status).toBe(400);
    expect((await get("人類\\案件A\\公文.pdf")).status).toBe(400);
    expect((await get("人類/.stignore")).status).toBe(400);
    expect((await get("")).status).toBe(400);
  });

  it("rejects unsupported extensions with 415", async () => {
    expect((await get("a.exe")).status).toBe(415);
  });

  it("404s a missing file", async () => {
    expect((await get("人類/不存在.pdf")).status).toBe(404);
  });

  it("413s a file over 50 MB", async () => {
    expect((await get("big.pdf")).status).toBe(413);
  });

  it.skipIf(!symlinkOk)("does not follow a symlink that escapes the root", async () => {
    const r = await get("link.pdf");
    expect(r.status).toBe(400);
    expect(await r.text()).not.toContain("不該被讀到");
  });

  it("503s when the root folder is not mounted", async () => {
    const saved = process.env["HERMES_RAW_ROOT"];
    process.env["HERMES_RAW_ROOT"] = path.join(dir, "no-such-dir");
    try {
      const r = await get("案件A/公文.pdf");
      expect(r.status).toBe(503);
      expect(await r.json()).toEqual({ message: "原檔資料夾尚未掛載" });
    } finally {
      process.env["HERMES_RAW_ROOT"] = saved;
    }
  });
});
