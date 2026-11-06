// 原檔 API：掛上真實路由、用 tmp 資料夾當 HERMES_RAW_ROOT／HERMES_RAW_NAS_ROOT（不需資料庫）。
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const PWD = "raw-test-pwd";
const dir = mkdtempSync(path.join(tmpdir(), "raw-root-"));
const outside = mkdtempSync(path.join(tmpdir(), "raw-outside-"));
const nasDir = mkdtempSync(path.join(tmpdir(), "raw-nas-"));
const nasOutside = mkdtempSync(path.join(tmpdir(), "raw-nas-outside-"));
// 這兩個路徑故意不存在；fs/promises 的 mock 只對它們模擬「卡住」與 EIO。
const nasHang = path.join(tmpdir(), "raw-nas-hang-");
const nasEio = path.join(tmpdir(), "raw-nas-eio-");

// NAS 逾時／EIO 用 mock 模擬：只攔這兩條前綴，其他路徑照真實檔案系統走。
const fsCtl = vi.hoisted(() => ({ hangPrefix: "", eioPrefix: "" }));
fsCtl.hangPrefix = nasHang;
fsCtl.eioPrefix = nasEio;

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const wrap = (fn: (...args: unknown[]) => Promise<unknown>) => async (...args: unknown[]) => {
    const p = args[0];
    const hits = (prefix: string) => prefix !== "" && typeof p === "string" && p.startsWith(prefix);
    if (hits(fsCtl.hangPrefix)) return new Promise<never>(() => {}); // 永不 settle，模擬 VPN 斷線時卡住
    if (hits(fsCtl.eioPrefix)) throw Object.assign(new Error("EIO"), { code: "EIO" });
    return fn(...args);
  };
  return {
    ...actual,
    realpath: wrap(actual.realpath as (...args: unknown[]) => Promise<unknown>),
    stat: wrap(actual.stat as (...args: unknown[]) => Promise<unknown>),
  };
});

// symlink 在 Windows 上可能沒權限：建不出來就跳過 symlink 那一題（不算失敗）。
let symlinkOk = false;
try {
  writeFileSync(path.join(outside, "secret.pdf"), "不該被讀到");
  symlinkSync(path.join(outside, "secret.pdf"), path.join(dir, "link.pdf"));
  symlinkOk = true;
} catch {
  symlinkOk = false;
}

let nasSymlinkOk = false;
try {
  writeFileSync(path.join(nasOutside, "secret.pdf"), "NAS 不該被讀到");
  symlinkSync(path.join(nasOutside, "secret.pdf"), path.join(nasDir, "nas-link.pdf"));
  nasSymlinkOk = true;
} catch {
  nasSymlinkOk = false;
}

describe("GET /api/hermes-raw", () => {
  let server: Server;
  let base = "";

  const get = (p: string, pwd: string | null = PWD) =>
    fetch(`${base}/api/hermes-raw?path=${encodeURIComponent(p)}`, { headers: pwd ? { "x-admin-password": pwd } : {} });

  beforeAll(async () => {
    process.env["ADMIN_PASSWORD"] = PWD;
    process.env["HERMES_RAW_ROOT"] = dir;
    process.env["HERMES_RAW_NAS_ROOT"] = nasDir;
    process.env["RAW_NAS_TIMEOUT_MS"] = "100";
    mkdirSync(path.join(dir, "案件A"));
    mkdirSync(path.join(dir, "案A"));
    mkdirSync(path.join(nasDir, "案件A"), { recursive: true });
    mkdirSync(path.join(nasDir, "案A"), { recursive: true });
    // VPS 有：用來證明兩邊都有時先讀 VPS。
    writeFileSync(path.join(dir, "案件A", "公文.pdf"), "%PDF-1.4 fake");
    writeFileSync(path.join(nasDir, "案件A", "公文.pdf"), "%PDF-1.4 nas");
    writeFileSync(path.join(dir, "案件A", "契約.docx"), "PK fake docx");
    writeFileSync(path.join(dir, "照片.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(path.join(dir, "a.exe"), "MZ");
    writeFileSync(path.join(dir, ".stignore"), "secret");
    writeFileSync(path.join(dir, "big.pdf"), Buffer.alloc(50 * 1024 * 1024 + 1));
    // NAS 有、VPS 沒有；VPS 上的相對路徑多包一層 `_staging-from-home/`。
    writeFileSync(path.join(nasDir, "案A", "y.pdf"), "%PDF-1.4 from nas");
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
    rmSync(nasDir, { recursive: true, force: true });
    rmSync(nasOutside, { recursive: true, force: true });
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

  it("prefers the VPS copy when both the VPS and the NAS have it", async () => {
    const r = await get("人類/案件A/公文.pdf");
    expect(r.status).toBe(200);
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

  it("falls back to the NAS, stripping the _staging-from-home/ prefix", async () => {
    const r = await get("人類/_staging-from-home/案A/y.pdf");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(await r.text()).toBe("%PDF-1.4 from nas");
  });

  it("falls back to the NAS, stripping the _pulled-from-home/ prefix", async () => {
    const r = await get("人類/_pulled-from-home/案A/y.pdf");
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("%PDF-1.4 from nas");
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

  it("404s when neither the VPS nor the NAS has the file", async () => {
    expect((await get("人類/不存在.pdf")).status).toBe(404);
  });

  it("404s when the NAS root is not mounted (behaviour unchanged)", async () => {
    const saved = process.env["HERMES_RAW_NAS_ROOT"];
    process.env["HERMES_RAW_NAS_ROOT"] = path.join(nasDir, "no-such-dir");
    try {
      const r = await get("人類/_staging-from-home/案A/y.pdf");
      expect(r.status).toBe(404);
    } finally {
      process.env["HERMES_RAW_NAS_ROOT"] = saved;
    }
  });

  it("504s with a clear message when the NAS lookup times out", async () => {
    const saved = process.env["HERMES_RAW_NAS_ROOT"];
    process.env["HERMES_RAW_NAS_ROOT"] = nasHang;
    try {
      const r = await get("人類/不存在.pdf");
      expect(r.status).toBe(504);
      expect(await r.json()).toEqual({ message: "家中 NAS 暫時連不到（VPN 可能斷線）" });
    } finally {
      process.env["HERMES_RAW_NAS_ROOT"] = saved;
    }
  });

  it("504s when the NAS returns EIO", async () => {
    const saved = process.env["HERMES_RAW_NAS_ROOT"];
    process.env["HERMES_RAW_NAS_ROOT"] = nasEio;
    try {
      const r = await get("人類/不存在.pdf");
      expect(r.status).toBe(504);
      expect(await r.json()).toEqual({ message: "家中 NAS 暫時連不到（VPN 可能斷線）" });
    } finally {
      process.env["HERMES_RAW_NAS_ROOT"] = saved;
    }
  });

  it("413s a file over 50 MB", async () => {
    expect((await get("big.pdf")).status).toBe(413);
  });

  it.skipIf(!symlinkOk)("does not follow a symlink that escapes the root", async () => {
    const r = await get("link.pdf");
    expect(r.status).toBe(400);
    expect(await r.text()).not.toContain("不該被讀到");
  });

  it.skipIf(!nasSymlinkOk)("does not follow a NAS symlink that escapes the NAS root", async () => {
    const r = await get("人類/nas-link.pdf");
    expect(r.status).toBe(400);
    expect(await r.text()).not.toContain("NAS 不該被讀到");
  });

  it("503s when the VPS root is not mounted, even if the NAS has the file (unchanged)", async () => {
    const saved = process.env["HERMES_RAW_ROOT"];
    process.env["HERMES_RAW_ROOT"] = path.join(dir, "no-such-dir");
    try {
      const r = await get("人類/_staging-from-home/案A/y.pdf");
      expect(r.status).toBe(503);
      expect(await r.json()).toEqual({ message: "原檔資料夾尚未掛載" });
    } finally {
      process.env["HERMES_RAW_ROOT"] = saved;
    }
  });
});
