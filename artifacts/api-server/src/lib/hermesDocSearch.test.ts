import { describe, expect, it } from "vitest";
import { escapeLike, makeSnippet, validateSearchParams } from "./hermesDocSearch";

describe("validateSearchParams", () => {
  it("accepts q 1～50 字 after trimming, default limit 30", () => {
    expect(validateSearchParams("  招標 ", undefined)).toEqual({ ok: true, q: "招標", limit: 30 });
    expect(validateSearchParams("x".repeat(50), "50")).toEqual({ ok: true, q: "x".repeat(50), limit: 50 });
    expect(validateSearchParams("a", "1")).toEqual({ ok: true, q: "a", limit: 1 });
  });

  it.each([
    ["missing q", undefined, undefined],
    ["array q", ["a", "b"], undefined],
    ["blank q", "   ", undefined],
    ["q over 50", "x".repeat(51), undefined],
    ["limit zero", "a", "0"],
    ["limit over 50", "a", "51"],
    ["limit not integer", "a", "1.5"],
    ["limit negative", "a", "-3"],
    ["limit text", "a", "abc"],
  ])("rejects %s", (_name, q, limit) => {
    expect(validateSearchParams(q, limit).ok).toBe(false);
  });
});

describe("escapeLike", () => {
  it("escapes backslash, percent and underscore", () => {
    expect(escapeLike("100%_\\x")).toBe("100\\%\\_\\\\x");
    expect(escapeLike("普通字")).toBe("普通字");
  });
});

describe("makeSnippet", () => {
  it("takes 60 chars on each side of the first body hit, case-insensitively", () => {
    const body = "前" .repeat(70) + "Hello" + "後".repeat(70);
    const r = makeSnippet(body, "hello");
    expect(r.hitAt).toBe(70);
    expect(r.snippet).toBe("…" + "前".repeat(60) + "Hello" + "後".repeat(60) + "…");
  });

  it("does not add ellipses when the hit is near both ends", () => {
    const r = makeSnippet("開標日期是 3/5", "開標");
    expect(r.snippet).toBe("開標日期是 3/5");
    expect(r.hitAt).toBe(0);
  });

  it("uses the first 120 chars of body when only the title matched", () => {
    const body = "甲".repeat(200);
    const r = makeSnippet(body, "不存在");
    expect(r.hitAt).toBeNull();
    expect(r.snippet).toBe("甲".repeat(120) + "…");
    expect(makeSnippet("短", "不存在")).toEqual({ snippet: "短", hitAt: null });
    expect(makeSnippet("", "x")).toEqual({ snippet: "", hitAt: null });
  });
});
