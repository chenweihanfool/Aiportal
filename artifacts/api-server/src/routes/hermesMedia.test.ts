// 遊記相片 API：掛上真實路由、用 tmp 資料夾當媒體根（不需資料庫）。
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PWD = "media-test-pwd";
const TID = "TRIP-20261015-台南旅遊";
const WEBP = Buffer.from("RIFF\x04\x00\x00\x00WEBPVP8 ", "binary");

describe("GET /api/media/trips/:tripId/:file", () => {
  let server: Server;
  let base = "";
  let dir = "";
  let outside = "";

  const get = (tid: string, file: string, headers: Record<string, string> = { "x-admin-password": PWD }) =>
    fetch(`${base}/api/media/trips/${encodeURIComponent(tid)}/${encodeURIComponent(file)}`, { headers });

  beforeAll(async () => {
    process.env["ADMIN_PASSWORD"] = PWD;
    dir = mkdtempSync(path.join(tmpdir(), "media-root-"));
    outside = mkdtempSync(path.join(tmpdir(), "media-outside-"));
    process.env["HERMES_MEDIA_ROOT"] = dir;
    mkdirSync(path.join(dir, "trips", TID), { recursive: true });
    writeFileSync(path.join(dir, "trips", TID, "IMG_1.webp"), WEBP);
    writeFileSync(path.join(dir, "trips", TID, "IMG_1-t.webp"), WEBP);
    writeFileSync(path.join(dir, "trips", TID, "big.webp"), Buffer.alloc(9 * 1024 * 1024));
    writeFileSync(path.join(dir, "trips", TID, "note.txt"), "x");
    writeFileSync(path.join(outside, "secret.webp"), "不該被讀到");
    symlinkSync(path.join(outside, "secret.webp"), path.join(dir, "trips", TID, "link.webp"));
    symlinkSync(outside, path.join(dir, "trips", "escape"));
    mkdirSync(path.join(dir, "trips", "dir.webp"));
    const express = (await import("express")).default;
    const router = (await import("./hermesMedia")).default;
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
    expect((await get(TID, "IMG_1.webp", {})).status).toBe(403);
    expect((await get(TID, "IMG_1.webp", { "x-admin-password": "wrong" })).status).toBe(403);
  });

  it("serves a webp with fixed type, nosniff, private cache and an etag; 304 on revalidation", async () => {
    const r = await get(TID, "IMG_1.webp");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/webp");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(r.headers.get("content-security-policy")).toContain("sandbox");
    expect(Buffer.from(await r.arrayBuffer())).toEqual(WEBP);
    const etag = r.headers.get("etag")!;
    expect(etag).toBeTruthy();
    const r2 = await get(TID, "IMG_1.webp", { "x-admin-password": PWD, "if-none-match": etag });
    expect(r2.status).toBe(304);
    expect((await get(TID, "IMG_1-t.webp")).status).toBe(200);
  });

  it("404 for a missing file or folder, 400 for bad names, 413 for oversize", async () => {
    expect((await get(TID, "nope.webp")).status).toBe(404);
    expect((await get("沒有這趟", "IMG_1.webp")).status).toBe(404);
    expect((await get(TID, "note.txt")).status).toBe(400);
    expect((await get(TID, "..%2Fx.webp")).status).toBe(400);
    expect((await get(TID, "big.webp")).status).toBe(413);
    expect((await get("", "x.webp")).status).toBe(404); // 路由不匹配
  });

  it("refuses symlinks that point outside the mounted root", async () => {
    expect((await get(TID, "link.webp")).status).toBe(400);
    expect((await get("escape", "secret.webp")).status).toBe(400);
  });

  it("a directory named like a webp is not served", async () => {
    expect((await get("dir.webp", "x.webp")).status).toBe(404);
  });

  it("503 when the media folder is not mounted", async () => {
    const keep = process.env["HERMES_MEDIA_ROOT"];
    process.env["HERMES_MEDIA_ROOT"] = path.join(dir, "不存在");
    try {
      expect((await get(TID, "IMG_1.webp")).status).toBe(503);
    } finally {
      process.env["HERMES_MEDIA_ROOT"] = keep;
    }
  });
});
