// 範本路由：用 createTemplatesRouter 注入假 feed，TEMPLATE_ROOTS 指向 tmp 資料夾（不需資料庫、不需真的 NAS）。
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const PWD = "templates-route-test-pwd";
const official = mkdtempSync(path.join(tmpdir(), "tpl-official-"));
const office = mkdtempSync(path.join(tmpdir(), "tpl-office-"));
const vault = mkdtempSync(path.join(tmpdir(), "tpl-vault-"));
const outside = mkdtempSync(path.join(tmpdir(), "tpl-outside-"));

const FILE_IDS = {
  docx: "tpl_cccccccccc",
  pdf: "tpl_dddddddddd",
  traversal: "tpl_eeeeeeeeee",
  symlink: "tpl_ffffffffff",
  missingRoot: "tpl_1111111111",
  missingFile: "tpl_2222222222",
};

const FIXTURE = {
  computedAt: "2026-11-18T09:00:00+08:00",
  total: 6,
  problems: 0,
  templates: [
    {
      id: FILE_IDS.docx, name: "撤回退費範本.docx", family: "撤回退費", category: "3.退費",
      docType: "函", subject: "撤回退費", version: "2024-01-02", latest: true, aliases: ["鑑界退費"],
      root: "official", rel: "3.退費/撤回退費範本.docx", ext: "docx", size: 11, copies: 1,
    },
    {
      id: FILE_IDS.pdf, name: "退費文_1130719.pdf", family: "退費文", category: "3.退費",
      docType: "函", subject: "退費申請", version: "2024-07-19", latest: true, aliases: ["退費文"],
      root: "office-pc", rel: "退費/退費文_1130719.pdf", ext: "pdf", size: 10, copies: 1,
    },
    {
      id: FILE_IDS.traversal, name: "逃逸.docx", family: "逃逸", category: "測試",
      docType: "其他", subject: null, version: null, latest: true, aliases: [],
      root: "official", rel: "../outside.docx", ext: "docx", size: 1, copies: 1,
    },
    {
      id: FILE_IDS.symlink, name: "捷徑.docx", family: "捷徑", category: "測試",
      docType: "其他", subject: null, version: null, latest: true, aliases: [],
      root: "official", rel: "link.docx", ext: "docx", size: 1, copies: 1,
    },
    {
      id: FILE_IDS.missingRoot, name: "未掛載.docx", family: "未掛載", category: "測試",
      docType: "其他", subject: null, version: null, latest: true, aliases: [],
      root: "nope", rel: "x.docx", ext: "docx", size: 1, copies: 1,
    },
    {
      id: FILE_IDS.missingFile, name: "不存在.docx", family: "不存在", category: "測試",
      docType: "其他", subject: null, version: null, latest: true, aliases: [],
      root: "official", rel: "不存在.docx", ext: "docx", size: 1, copies: 1,
    },
  ],
};

let symlinkOk = false;
try {
  writeFileSync(path.join(outside, "secret.docx"), "不該被讀到");
  symlinkSync(path.join(outside, "secret.docx"), path.join(official, "link.docx"));
  symlinkOk = true;
} catch {
  symlinkOk = false;
}

describe("範本路由", () => {
  let server: Server;
  let base = "";
  let payload: unknown | null = FIXTURE;
  let nasGuard: import("../lib/rawFile").NasGuard;

  const get = (p: string, pwd: string | null = PWD) =>
    fetch(`${base}${p}`, { headers: pwd ? { "x-admin-password": pwd } : {} });

  beforeAll(async () => {
    process.env["DATABASE_URL"] ??= "postgres://u:p@127.0.0.1:1/none_test";
    process.env["ADMIN_PASSWORD"] = PWD;
    process.env["TEMPLATE_ROOTS"] = `official=${official};office-pc=${office};vault-attach=${vault}`;
    mkdirSync(path.join(official, "3.退費"), { recursive: true });
    mkdirSync(path.join(office, "退費"), { recursive: true });
    writeFileSync(path.join(official, "3.退費", "撤回退費範本.docx"), "docx-bytes!");
    writeFileSync(path.join(office, "退費", "退費文_1130719.pdf"), "%PDF-1.4!");
    const express = (await import("express")).default;
    const mod = await import("./templates");
    nasGuard = (await import("../lib/rawFile")).nasGuard;
    const app = express();
    app.use("/api", mod.createTemplatesRouter({ loadPayload: async () => payload }));
    await new Promise<void>((r) => { server = app.listen(0, "127.0.0.1", () => r()); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  });
  afterEach(() => {
    nasGuard?.reset();
    payload = FIXTURE;
  });
  afterAll(async () => {
    await new Promise((r) => server?.close(r));
    for (const d of [official, office, vault, outside]) rmSync(d, { recursive: true, force: true });
  });

  it("三個端點沒有密碼一律 403", async () => {
    for (const p of ["/templates/search?q=x", `/templates/${FILE_IDS.docx}/versions`, `/templates/${FILE_IDS.docx}/file`]) {
      const r = await get(p, null);
      expect(r.status, p).toBe(403);
      expect(((await r.json()) as { message: string }).message).toBe("需要解鎖私領域才能查看");
    }
  });

  it("搜尋：參數不合法回 400；沒有快照回 ready=false", async () => {
    for (const qs of ["", "q=", `q=${"a".repeat(51)}`, "q=x&limit=0", "q=x&limit=21", "q=x&limit=abc"]) {
      expect((await get(`/templates/search?${qs}`)).status, qs).toBe(400);
    }
    payload = null;
    const r = await get("/templates/search?q=退費");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ items: [], clearWinner: false, ready: false });
  });

  it("搜尋：口語查詢命中範本並回 ready=true", async () => {
    const r = await get("/templates/search?q=" + encodeURIComponent("給我鑑界退費公文範本"));
    expect(r.status).toBe(200);
    const body = (await r.json()) as { items: Array<{ id: string; olderVersions: number }>; clearWinner: boolean; ready: boolean };
    expect(body.ready).toBe(true);
    expect(body.items[0]!.id).toBe(FILE_IDS.docx);
    expect(body.items[0]!.olderVersions).toBe(0);
  });

  it("版本：回同 family 所有版本、id 格式錯 400、找不到 404", async () => {
    const r = await get(`/templates/${FILE_IDS.docx}/versions`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { items: Array<{ id: string }> };
    expect(body.items.map((x) => x.id)).toEqual([FILE_IDS.docx]);
    expect((await get("/templates/bad-id/versions")).status).toBe(400);
    expect((await get("/templates/tpl_9999999999/versions")).status).toBe(404);
  });

  it("下載：正常回 attachment 與 RFC 5987 檔名", async () => {
    const r = await get(`/templates/${FILE_IDS.docx}/file`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(r.headers.get("content-disposition")).toMatch(/^attachment; filename\*=UTF-8''/);
    expect(decodeURIComponent(r.headers.get("content-disposition")!.split("''")[1]!)).toBe("撤回退費範本.docx");
    expect(await r.text()).toBe("docx-bytes!");
  });

  it("下載：pdf 用 application/pdf", async () => {
    const r = await get(`/templates/${FILE_IDS.pdf}/file`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
  });

  it("下載：含 .. 的路徑回 400", async () => {
    expect((await get(`/templates/${FILE_IDS.traversal}/file`)).status).toBe(400);
  });

  it.skipIf(!symlinkOk)("下載：symlink 指到根外回 400、不外洩內容", async () => {
    const r = await get(`/templates/${FILE_IDS.symlink}/file`);
    expect(r.status).toBe(400);
    expect(await r.text()).not.toContain("不該被讀到");
  });

  it("下載：代號不在對照表、或根路徑不存在回 503", async () => {
    const r = await get(`/templates/${FILE_IDS.missingRoot}/file`);
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ message: "範本資料夾尚未掛載" });

    const saved = process.env["TEMPLATE_ROOTS"];
    process.env["TEMPLATE_ROOTS"] = `official=${path.join(official, "no-such-dir")};office-pc=${office}`;
    try {
      const r2 = await get(`/templates/${FILE_IDS.docx}/file`);
      expect(r2.status).toBe(503);
      expect(await r2.json()).toEqual({ message: "範本資料夾尚未掛載" });
    } finally {
      process.env["TEMPLATE_ROOTS"] = saved;
    }
  });

  it("下載：id 格式錯 400、feed 沒有該 id 404、檔案不存在 404", async () => {
    expect((await get("/templates/not-an-id/file")).status).toBe(400);
    expect((await get("/templates/tpl_9999999999/file")).status).toBe(404);
    expect((await get(`/templates/${FILE_IDS.missingFile}/file`)).status).toBe(404);
  });
});
