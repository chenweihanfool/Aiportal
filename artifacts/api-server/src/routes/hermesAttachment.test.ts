// 附件預覽 API：掛上真實路由、用 tmp 資料夾當掛載根（不需資料庫）。
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PWD = "attachment-test-pwd";

describe("GET /api/hermes-attachment", () => {
  let server: Server;
  let base = "";
  let dir = "";
  let outside = "";

  const get = (p: string, pwd: string | null = PWD) =>
    fetch(`${base}/api/hermes-attachment?path=${encodeURIComponent(p)}`, { headers: pwd ? { "x-admin-password": pwd } : {} });

  beforeAll(async () => {
    process.env["ADMIN_PASSWORD"] = PWD;
    dir = mkdtempSync(path.join(tmpdir(), "att-root-"));
    outside = mkdtempSync(path.join(tmpdir(), "att-outside-"));
    process.env["HERMES_ATTACHMENT_ROOT"] = dir;
    mkdirSync(path.join(dir, "ailand測試"));
    writeFileSync(path.join(dir, "截圖1.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(path.join(dir, "ailand測試", "紀錄.txt"), "會勘紀錄 第一行\n第二行");
    writeFileSync(path.join(dir, "公文.pdf"), "%PDF-1.4 fake");
    writeFileSync(path.join(dir, "a.html"), "<script>alert(1)</script>");
    writeFileSync(path.join(dir, ".stignore"), "secret");
    writeFileSync(path.join(outside, "secret.txt"), "不該被讀到");
    symlinkSync(path.join(outside, "secret.txt"), path.join(dir, "link.txt"));
    writeFileSync(path.join(dir, "big.png"), Buffer.alloc(26 * 1024 * 1024));
    const express = (await import("express")).default;
    const router = (await import("./hermesAttachment")).default;
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

  it("requires the admin session like the other private APIs", async () => {
    expect((await get("附件/截圖1.png", null)).status).toBe(403);
    expect((await get("附件/截圖1.png", "wrong")).status).toBe(403);
  });

  it("serves an image with a fixed content type, nosniff and an encoded filename", async () => {
    const r = await get("附件/截圖1.png");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("content-disposition")).toContain("filename*=UTF-8''%E6%88%AA%E5%9C%961.png");
    expect(r.headers.get("content-security-policy")).toContain("sandbox");
    expect(Buffer.from(await r.arrayBuffer())).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it("serves text from a sub-folder as utf-8 plain text, and a pdf as application/pdf", async () => {
    const t = await get("附件/ailand測試/紀錄.txt");
    expect(t.status).toBe(200);
    expect(t.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await t.text()).toContain("會勘紀錄");
    const p = await get("附件/公文.pdf");
    expect(p.headers.get("content-type")).toBe("application/pdf");
  });

  it("rejects traversal, non-attachment paths, hidden files and non-whitelisted types", async () => {
    expect((await get("附件/../secret.txt")).status).toBe(400);
    expect((await get("日記/a.md")).status).toBe(400);
    expect((await get("附件/.stignore")).status).toBe(400);
    expect((await get("附件/a.html")).status).toBe(415);
  });

  it("does not follow a symlink that escapes the mounted folder", async () => {
    const r = await get("附件/link.txt");
    expect(r.status).toBe(400);
    expect(await r.text()).not.toContain("不該被讀到");
  });

  it("404s a missing file, 413s an oversized one, 503s when the folder is not mounted", async () => {
    expect((await get("附件/不存在.png")).status).toBe(404);
    expect((await get("附件/big.png")).status).toBe(413);
    const saved = process.env["HERMES_ATTACHMENT_ROOT"];
    process.env["HERMES_ATTACHMENT_ROOT"] = path.join(dir, "no-such-dir");
    expect((await get("附件/截圖1.png")).status).toBe(503);
    process.env["HERMES_ATTACHMENT_ROOT"] = saved;
  });
});
