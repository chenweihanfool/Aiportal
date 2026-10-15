import { describe, expect, it } from "vitest";
import { validateFeedRequest } from "./feedValidate";
import type { FeedDef } from "../feeds/registry";

const registry: Record<string, FeedDef> = {
  demo: {
    version: 2, description: "d", maxBytes: 200,
    schema: { type: "object", additionalProperties: false, required: ["n"], properties: { n: { type: "number" }, s: { type: "string", maxLength: 5 } } },
  },
};
const ok = { schemaVersion: 2, generatedAt: "2026-10-16", payload: { n: 1 } };

describe("validateFeedRequest", () => {
  it("合法請求通過，generatedAt 可省略或 null", () => {
    expect(validateFeedRequest("demo", ok, registry)).toEqual({ ok: true, version: 2, generatedAt: "2026-10-16", payload: { n: 1 } });
    expect(validateFeedRequest("demo", { schemaVersion: 2, payload: { n: 1 } }, registry)).toMatchObject({ ok: true, generatedAt: null });
    expect(validateFeedRequest("demo", { schemaVersion: 2, generatedAt: null, payload: { n: 1 } }, registry)).toMatchObject({ ok: true, generatedAt: null });
  });
  it("名稱不合法 400、沒登記 404（含 __proto__ 這類名字）", () => {
    for (const n of ["Bad", "a", "x/y", "", "-a", undefined, 5]) expect(validateFeedRequest(n, ok, registry)).toMatchObject({ ok: false, status: 400 });
    expect(validateFeedRequest("other", ok, registry)).toMatchObject({ ok: false, status: 404 });
    expect(validateFeedRequest("constructor", ok, registry)).toMatchObject({ ok: false, status: 404 });
  });
  it("schemaVersion 不符 409；本文不是物件、缺 payload、generatedAt 壞掉 400", () => {
    expect(validateFeedRequest("demo", { ...ok, schemaVersion: 1 }, registry)).toMatchObject({ ok: false, status: 409 });
    expect(validateFeedRequest("demo", { ...ok, schemaVersion: "2" }, registry)).toMatchObject({ ok: false, status: 409 });
    for (const body of [null, [], "x", 3]) expect(validateFeedRequest("demo", body, registry)).toMatchObject({ ok: false, status: 400 });
    expect(validateFeedRequest("demo", { schemaVersion: 2 }, registry)).toMatchObject({ ok: false, status: 400 });
    expect(validateFeedRequest("demo", { ...ok, generatedAt: "2026-02-31" }, registry)).toMatchObject({ ok: false, status: 400 });
    expect(validateFeedRequest("demo", { ...ok, generatedAt: "10/16" }, registry)).toMatchObject({ ok: false, status: 400 });
  });
  it("payload 不符 schema 400（缺必填、多餘欄位、型別錯、超長）；太大 413", () => {
    for (const payload of [{}, { n: 1, extra: 1 }, { n: "x" }, { n: 1, s: "toolong" }, null, []]) {
      expect(validateFeedRequest("demo", { ...ok, payload }, registry), JSON.stringify(payload)).toMatchObject({ ok: false, status: 400 });
    }
    expect(validateFeedRequest("demo", { ...ok, payload: { n: 1, s: "x" } }, { demo: { ...registry["demo"]!, maxBytes: 5 } })).toMatchObject({ ok: false, status: 413 });
  });
  it("內建的 example feed 吃得下範例資料、擋掉壞資料", () => {
    const body = { schemaVersion: 1, generatedAt: "2026-10-16", payload: { items: [{ label: "a", value: 1.5, note: null }] } };
    expect(validateFeedRequest("example", body)).toMatchObject({ ok: true });
    expect(validateFeedRequest("example", { ...body, payload: { items: [{ label: "", value: 1 }] } })).toMatchObject({ ok: false, status: 400 });
    expect(validateFeedRequest("example", { ...body, payload: { items: [{ label: "a" }] } })).toMatchObject({ ok: false, status: 400 });
  });
});
