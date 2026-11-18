import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiFetchTemplateFile, apiFetchTemplateVersions, parseContentDispositionFilename, templateFileError,
} from "./templateApi";

const PWD = "pw";
const ID = "tpl_cccccccccc";

afterEach(() => { vi.unstubAllGlobals(); });

describe("templateFileError", () => {
  it("依狀態碼回中文訊息", () => {
    expect(templateFileError(503)).toBe("範本資料夾尚未掛載");
    expect(templateFileError(504)).toBe("家中 NAS 暫時連不到");
    expect(templateFileError(404)).toBe("找不到這個範本檔");
    expect(templateFileError(403)).toContain("解鎖");
    expect(templateFileError(500)).toBe("暫時無法取得範本，稍後再試。");
  });
});

describe("parseContentDispositionFilename", () => {
  it("RFC 5987 的 filename* 優先，其次一般 filename", () => {
    expect(parseContentDispositionFilename("attachment; filename*=UTF-8''%E6%92%A4%E5%9B%9E.docx")).toBe("撤回.docx");
    expect(parseContentDispositionFilename('attachment; filename="a.docx"')).toBe("a.docx");
    expect(parseContentDispositionFilename(null)).toBeNull();
    expect(parseContentDispositionFilename("attachment")).toBeNull();
  });
});

describe("apiFetchTemplateFile", () => {
  it("成功：回 Blob 與檔名", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("hello", {
      status: 200, headers: { "content-disposition": "attachment; filename*=UTF-8''%E7%AF%84%E6%9C%AC.docx" },
    })));
    const r = await apiFetchTemplateFile(PWD, ID);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(await r.blob.text()).toBe("hello");
      expect(r.filename).toBe("範本.docx");
    }
  });

  it("503／504／404 回對應中文訊息", async () => {
    for (const [status, message] of [[503, "範本資料夾尚未掛載"], [504, "家中 NAS 暫時連不到"], [404, "找不到這個範本檔"]] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status })));
      const r = await apiFetchTemplateFile(PWD, ID);
      expect(r.ok).toBe(false);
      if (!r.ok) { expect(r.status).toBe(status); expect(r.message).toBe(message); }
    }
  });

  it("網路錯誤不丟例外", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const r = await apiFetchTemplateFile(PWD, ID);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("網路錯誤");
  });
});

describe("apiFetchTemplateVersions", () => {
  it("合法項目回清單、壞項目略過", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [
      { id: ID, name: "撤回.docx", family: "撤回", category: "3.退費", docType: "函", subject: null, version: "2024-01-02", score: 1, olderVersions: 1 },
      { id: "bad", name: "壞的.docx" },
    ] }), { status: 200 })));
    const v = await apiFetchTemplateVersions(PWD, ID);
    expect(v).toHaveLength(1);
    expect(v?.[0]!.id).toBe(ID);
  });

  it("404 回 null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    expect(await apiFetchTemplateVersions(PWD, ID)).toBeNull();
  });

  it("其他失敗丟例外", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    await expect(apiFetchTemplateVersions(PWD, ID)).rejects.toThrow();
  });
});
