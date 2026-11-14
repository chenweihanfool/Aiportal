import { describe, expect, it } from "vitest";
import { buildInsightDetail, buildInsightList, parseInsightRow } from "./insights";

const row = (over: Record<string, unknown> = {}, metaOver: Record<string, unknown> = {}) => ({
  docKey: "INS-2026-10-18-1a2b3c4d",
  title: "心得一句話",
  bodyMd: "日記逐字原文",
  meta: {
    date: "2026-10-18",
    time: "20:28",
    provenance: "quote",
    cluster: { id: "K03", name: "時間管理" },
    thread: "TH-1a2b3c4d",
    relation: "new",
    parent: null,
    source: "日記/2026-10-18.md",
    ...metaOver,
  },
  ...over,
});

const NOW = new Date("2026-11-14T00:00:00Z");

describe("buildInsightList", () => {
  it("依 date、time（null 視為 00:00）、id 由舊到新", () => {
    const rows = [
      row({ docKey: "INS-2026-10-18-cccccccc" }, { time: "08:00" }),
      row({ docKey: "INS-2026-10-18-bbbbbbbb" }, { time: null }),
      row({ docKey: "INS-2026-10-17-dddddddd" }, { time: "23:00", date: "2026-10-17" }),
      row({ docKey: "INS-2026-10-18-aaaaaaaa" }, { time: null }),
    ];
    expect(buildInsightList(rows, NOW).insights.map((i) => i.id)).toEqual([
      "INS-2026-10-17-dddddddd",
      "INS-2026-10-18-aaaaaaaa",
      "INS-2026-10-18-bbbbbbbb",
      "INS-2026-10-18-cccccccc",
    ]);
  });

  it("clusters 依 count 多到少、同數依 id；name 取該群最新一則", () => {
    const rows = [
      row({ docKey: "INS-2026-10-01-00000002" }, { date: "2026-10-01", cluster: { id: "K02", name: "舊群名" } }),
      row({ docKey: "INS-2026-10-05-00000002" }, { date: "2026-10-05", cluster: { id: "K02", name: "新群名" } }),
      row({ docKey: "INS-2026-10-03-00000003" }, { date: "2026-10-03", cluster: { id: "K03", name: "作息" } }),
      row({ docKey: "INS-2026-10-04-00000001" }, { date: "2026-10-04", cluster: { id: "K01", name: "工作" } }),
    ];
    const r = buildInsightList(rows, NOW);
    expect(r.total).toBe(4);
    expect(r.clusters).toEqual([
      { id: "K02", name: "新群名", count: 2 },
      { id: "K01", name: "工作", count: 1 },
      { id: "K03", name: "作息", count: 1 },
    ]);
    expect(r.insights.map((i) => i.cluster)).toEqual(["K02", "K03", "K01", "K02"]);
  });

  it("thisMonth 只算台北時間當月", () => {
    const rows = [
      row({ docKey: "INS-2026-11-01-00000001" }, { date: "2026-11-01" }),
      row({ docKey: "INS-2026-11-30-00000002" }, { date: "2026-11-30" }),
      row({ docKey: "INS-2026-10-31-00000003" }, { date: "2026-10-31" }),
    ];
    expect(buildInsightList(rows, NOW).thisMonth).toBe(2);
    // UTC 2026-10-31 16:30 已是台北 11-01。
    expect(buildInsightList(rows, new Date("2026-10-31T16:30:00Z")).thisMonth).toBe(2);
  });

  it("髒 meta 那一筆略過，不讓整包失敗", () => {
    const rows = [
      row({ docKey: "INS-2026-10-18-aaaaaaaa" }, { date: 20261018 }),
      row({ docKey: "INS-2026-10-18-bbbbbbbb" }, { cluster: { id: "X03", name: "群" } }),
      row({ docKey: "INS-2026-10-18-cccccccc" }, { thread: "TH-1234" }),
      row({ docKey: "INS-2026-10-18-dddddddd" }, { relation: "merge" }),
      row({ docKey: "INS-2026-10-18-eeeeeeee" }, { relation: "refine", parent: null }),
      row({ docKey: "INS-2026-10-18-ffffffff" }, { time: "8:00" }),
      row({ docKey: "EV-1" }),
      row({ docKey: "INS-2026-10-18-11111111", title: "  " }),
      { docKey: "INS-2026-10-18-22222222", title: "心得", meta: "壞掉" },
      row({ docKey: "INS-2026-10-19-33333333" }, { date: "2026-10-19" }),
    ];
    const r = buildInsightList(rows, NOW);
    expect(r.total).toBe(1);
    expect(r.insights.map((i) => i.id)).toEqual(["INS-2026-10-19-33333333"]);
  });

  it("空資料回空結果", () => {
    expect(buildInsightList([], NOW)).toEqual({ total: 0, thisMonth: 0, clusters: [], insights: [] });
  });

  it("parseInsightRow 帶出完整欄位（time 缺席為 null、parent 依 relation）", () => {
    const a = parseInsightRow(row({}, { time: undefined }));
    expect(a).toMatchObject({ id: "INS-2026-10-18-1a2b3c4d", time: null, cluster: "K03", parent: null, evidence: "日記逐字原文", source: "日記/2026-10-18.md" });
    const b = parseInsightRow(row({}, { relation: "refine", parent: "INS-2026-09-01-deadbeef" }));
    expect(b).toMatchObject({ relation: "refine", parent: "INS-2026-09-01-deadbeef" });
  });
});

describe("buildInsightDetail", () => {
  const rows = [
    row({ docKey: "INS-2026-10-18-aaaaaaaa" }, { date: "2026-10-18", thread: "TH-aaaaaaaa", relation: "refine", parent: "INS-2026-10-01-bbbbbbbb" }),
    row({ docKey: "INS-2026-10-01-bbbbbbbb" }, { date: "2026-10-01", thread: "TH-aaaaaaaa", relation: "new", parent: null }),
    row({ docKey: "INS-2026-10-10-cccccccc" }, { date: "2026-10-10", thread: "TH-cccccccc", relation: "new", parent: null }),
  ];

  it("回單筆＋同 thread 全部（含自己）由舊到新，cluster 是物件、evidence 是 body_md", () => {
    const d = buildInsightDetail(rows, "INS-2026-10-18-aaaaaaaa")!;
    expect(d).toMatchObject({
      id: "INS-2026-10-18-aaaaaaaa",
      text: "心得一句話",
      evidence: "日記逐字原文",
      provenance: "quote",
      cluster: { id: "K03", name: "時間管理" },
      thread: "TH-aaaaaaaa",
      relation: "refine",
      parent: "INS-2026-10-01-bbbbbbbb",
      source: "日記/2026-10-18.md",
    });
    expect(d.threadItems.map((i) => i.id)).toEqual(["INS-2026-10-01-bbbbbbbb", "INS-2026-10-18-aaaaaaaa"]);
    expect(Object.keys(d.threadItems[0]!)).not.toContain("clusterName");
  });

  it("找不到或 meta 壞掉回 null", () => {
    expect(buildInsightDetail(rows, "INS-2026-10-18-99999999")).toBeNull();
    expect(buildInsightDetail([row({}, { thread: "壞" })], "INS-2026-10-18-1a2b3c4d")).toBeNull();
  });
});
