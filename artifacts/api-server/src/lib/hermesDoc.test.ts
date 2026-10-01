import { describe, expect, it } from "vitest";
import { buildContexts, isDocKind, makeExcerpt, validateDocs, MAX_DOCS_PER_POST } from "./hermesDoc";

const doc = (over: Record<string, unknown> = {}) => ({
  kind: "event", key: "EV-1", title: "標題", bodyMd: "## 摘要\n內文", truncated: false,
  meta: { date: "2026-10-01", sources: [] }, sourcePath: "Events/a.md", contentHash: "abcdef0123456789", ...over,
});

describe("validateDocs", () => {
  it("accepts a well-formed batch and fills defaults", () => {
    const r = validateDocs({ docs: [doc(), doc({ key: "EV-2", bodyMd: undefined, truncated: undefined, meta: undefined, sourcePath: undefined })] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.docs[1]).toMatchObject({ bodyMd: "", truncated: false, meta: {}, sourcePath: null });
    }
  });

  it.each([
    ["empty array", { docs: [] }],
    ["not an array", { docs: "x" }],
    ["missing body", null],
    ["bad kind", { docs: [doc({ kind: "person" })] }],
    ["blank key", { docs: [doc({ key: "" })] }],
    ["long title", { docs: [doc({ title: "x".repeat(301) })] }],
    ["non-string body", { docs: [doc({ bodyMd: 5 })] }],
    ["huge body", { docs: [doc({ bodyMd: "x".repeat(100_001) })] }],
    ["array meta", { docs: [doc({ meta: [] })] }],
    ["huge meta", { docs: [doc({ meta: { x: "y".repeat(300_001) } })] }],
    ["short hash", { docs: [doc({ contentHash: "abc" })] }],
    ["duplicate in batch", { docs: [doc(), doc()] }],
    ["too many", { docs: Array.from({ length: MAX_DOCS_PER_POST + 1 }, (_, i) => doc({ key: `K${i}` })) }],
  ])("rejects %s", (_name, body) => {
    expect(validateDocs(body).ok).toBe(false);
  });

  it("allows the same key under different kinds", () => {
    expect(validateDocs({ docs: [doc({ kind: "concept", key: "X" }), doc({ kind: "method", key: "X" })] }).ok).toBe(true);
  });

  it("isDocKind only accepts the three kinds", () => {
    expect(["event", "concept", "method"].every(isDocKind)).toBe(true);
    expect(isDocKind("person")).toBe(false);
    expect(isDocKind(undefined)).toBe(false);
  });
});

describe("makeExcerpt", () => {
  it("skips headings, blanks, rules and table separators; strips markdown", () => {
    const body = "# 標題\n\n## 摘要\n\n**重點**：把 `cron` 排程改成 [[日記/2026-09-04.md]]。\n---\n| a | b |\n|---|---|\n- 第二行 [連結](http://x)\n";
    expect(makeExcerpt(body)).toBe("重點：把 cron 排程改成 2026-09-04。 | a | b | 第二行 連結");
  });

  it("truncates with an ellipsis and returns empty for headings-only bodies", () => {
    expect(makeExcerpt("字".repeat(500), 20)).toBe(`${"字".repeat(20)}…`);
    expect(makeExcerpt("## 只有標題\n\n")).toBe("");
    expect(makeExcerpt("")).toBe("");
  });

  it("skips navigation sections (人物／物件／See Also／來源) but keeps narrative text and 更新紀錄", () => {
    const body = "這是事件的敘述。\n\n## 相關人物\n- [[陳韋翰]]\n\n## See Also\n- [[另一事件]]\n\n## 來源\n- [[日記/2026-09-04.md]]\n\n## 更新紀錄\n- 2026-09-05 補充細節";
    expect(makeExcerpt(body)).toBe("這是事件的敘述。 2026-09-05 補充細節");
    expect(makeExcerpt("## 相關人物\n- [[陳韋翰]]\n\n## 來源\n- x")).toBe("");
    expect(makeExcerpt("### 來源\n只是三級標題底下的字")).toBe("只是三級標題底下的字");
  });

  it("uses a wikilink alias and the file base name", () => {
    expect(makeExcerpt("見 [[附件/報告.pdf|年度報告]] 與 ![[附件/圖.png]]")).toBe("見 年度報告 與 圖.png");
  });
});

describe("buildContexts", () => {
  const events = new Map([
    ["EV-A", { title: "甲事件", date: "2026-09-01" }],
    ["EV-B", { title: "乙事件", date: "2026-09-05" }],
  ]);
  const heads = new Map([["EV-A", "## 摘要\n甲的內文"], ["EV-B", "乙的內文"]]);

  it("joins refs with event title and excerpt, newest first", () => {
    const ctx = buildContexts(
      [
        { eventId: "EV-A", date: "2026-09-01", relation: "體現" },
        { eventId: "EV-B", date: "2026-09-05", as: "唯一資料來源", evidence: "逐字引文" },
      ],
      events, heads,
    );
    expect(ctx.map((c) => c.eventId)).toEqual(["EV-B", "EV-A"]);
    expect(ctx[0]).toMatchObject({ title: "乙事件", as: "唯一資料來源", evidence: "逐字引文", relation: null, excerpt: "乙的內文" });
    expect(ctx[1]).toMatchObject({ title: "甲事件", relation: "體現", as: null, evidence: null, excerpt: "甲的內文" });
  });

  it("tolerates junk, unknown events and missing bodies", () => {
    expect(buildContexts("壞資料", events, heads)).toEqual([]);
    const ctx = buildContexts([null, 3, {}, { eventId: "EV-GHOST" }, { eventId: "EV-A", date: 5 }], events, new Map());
    expect(ctx.map((c) => [c.eventId, c.title, c.date, c.excerpt])).toEqual([
      ["EV-A", "甲事件", "2026-09-01", ""],
      ["EV-GHOST", "EV-GHOST", "", ""],
    ]);
  });
});
