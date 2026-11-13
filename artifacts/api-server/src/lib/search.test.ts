import { describe, expect, it } from "vitest";
import {
  buildStats, createTtlCache, docRowToCandidate, graphToCandidates, ideasToCandidates, makeSnippet, parseSearchLogBody,
  parseRecentLimit, parseStatsDays, placesToCandidates, rankOf, runSearch, sitesToCandidates, splitTerms, topicsToCandidates,
  tripsToCandidates, validateSearchParams, SEARCH_KINDS, type Candidate,
} from "./search";

const cand = (over: Partial<Candidate> & { title: string }): Candidate => ({
  kind: "case", id: over.title, text: "", date: null, ...over,
});

describe("validateSearchParams", () => {
  it("q 必填、去空白後 1～50 字", () => {
    expect(validateSearchParams(undefined, undefined, undefined).ok).toBe(false);
    expect(validateSearchParams(["a"], undefined, undefined).ok).toBe(false);
    expect(validateSearchParams(42, undefined, undefined).ok).toBe(false);
    expect(validateSearchParams("   ", undefined, undefined).ok).toBe(false);
    expect(validateSearchParams("a".repeat(51), undefined, undefined).ok).toBe(false);
    const ok = validateSearchParams("  " + "a".repeat(50) + " ", undefined, undefined);
    expect(ok.ok).toBe(true);
  });
  it("kind 只接受 12 種；limit 1～20 整數、預設 5", () => {
    expect(validateSearchParams("x", "nope", undefined).ok).toBe(false);
    for (const k of SEARCH_KINDS) expect(validateSearchParams("x", k, undefined).ok).toBe(true);
    expect(validateSearchParams("x", undefined, "0").ok).toBe(false);
    expect(validateSearchParams("x", undefined, "21").ok).toBe(false);
    expect(validateSearchParams("x", undefined, "1.5").ok).toBe(false);
    const d = validateSearchParams("x", undefined, undefined);
    expect(d.ok && d.limit).toBe(5);
    const l = validateSearchParams("x", "case", "20");
    expect(l.ok && l.limit).toBe(20);
    expect(l.ok && l.kind).toBe("case");
  });
  it("以空白（含全形）切詞，最多 5 詞、轉小寫", () => {
    expect(splitTerms("王　先生 Abc  鑑界")).toEqual(["王", "先生", "abc", "鑑界"]);
    expect(splitTerms("a b c d e f g")).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("runSearch：多詞 AND 與排序", () => {
  it("每個詞都要命中（不分大小寫，標題或內文）", () => {
    const list = [
      cand({ title: "王先生鑑界案", text: "Boundary 糾紛" }),
      cand({ title: "李小姐案", text: "鑑界" }),
    ];
    const r = runSearch({ case: list }, splitTerms("鑑界 boundary"), 5);
    expect(r.total).toBe(1);
    expect(r.groups[0]!.items[0]!.title).toBe("王先生鑑界案");
  });
  it("四個排序級別，同級依日期新到舊（null 最後）再依標題", () => {
    expect(rankOf("鑑界", ["鑑界"])).toBe(0);
    expect(rankOf("鑑界作業", ["鑑界"])).toBe(1);
    expect(rankOf("王鑑界", ["鑑界"])).toBe(2);
    expect(rankOf("王案", ["鑑界"])).toBe(3);
    const list = [
      cand({ title: "只內文", text: "鑑界", date: "2026-11-01" }),
      cand({ title: "含鑑界", date: "2026-01-01" }),
      cand({ title: "鑑界開頭B", date: "2026-02-01" }),
      cand({ title: "鑑界開頭A", date: "2026-02-01" }),
      cand({ title: "鑑界開頭無日期" }),
      cand({ title: "鑑界開頭新", date: "2026-09-01" }),
      cand({ title: "鑑界", date: "2020-01-01" }),
    ];
    const r = runSearch({ case: list }, ["鑑界"], 20);
    expect(r.groups[0]!.items.map((i) => i.title)).toEqual([
      "鑑界", "鑑界開頭新", "鑑界開頭A", "鑑界開頭B", "鑑界開頭無日期", "含鑑界", "只內文",
    ]);
  });
  it("count 可大於 items 長度；total 為各組加總；groups 固定順序、無命中不出現", () => {
    const mk = (kind: Candidate["kind"], n: number) =>
      Array.from({ length: n }, (_, i) => cand({ kind, id: `${kind}${i}`, title: `鑑界${i}` }));
    const r = runSearch({ tool: mk("tool", 1), topic: mk("topic", 4), case: mk("case", 2), idea: [cand({ kind: "idea", title: "無關" })] }, ["鑑界"], 3);
    expect(r.groups.map((g) => g.kind)).toEqual(["case", "topic", "tool"]);
    expect(r.groups[1]!.count).toBe(4);
    expect(r.groups[1]!.items).toHaveLength(3);
    expect(r.total).toBe(7);
  });
  it("best：級別最高者；同級依 kind 順序；沒命中為 null", () => {
    const r = runSearch({
      topic: [cand({ kind: "topic", title: "鑑界" })],
      case: [cand({ kind: "case", title: "鑑界" })],
      person: [cand({ kind: "person", title: "鑑界王", })],
    }, ["鑑界"], 5);
    expect(r.best!.kind).toBe("case");
    const r2 = runSearch({ case: [cand({ title: "鑑界案" })], person: [cand({ kind: "person", title: "鑑界" })] }, ["鑑界"], 5);
    expect(r2.best!.kind).toBe("person");
    expect(runSearch({ case: [cand({ title: "x" })] }, ["鑑界"], 5).best).toBeNull();
  });
});

describe("makeSnippet", () => {
  it("命中處前後各 40 字，頭尾截斷加「…」", () => {
    const text = "甲".repeat(100) + "鑑界" + "乙".repeat(100);
    const s = makeSnippet(text, "鑑界");
    expect(s).toBe("…" + "甲".repeat(40) + "鑑界" + "乙".repeat(40) + "…");
  });
  it("只命中標題時取內文前 80 字；沒有內文為空字串", () => {
    expect(makeSnippet("丙".repeat(100), "鑑界")).toBe("丙".repeat(80) + "…");
    expect(makeSnippet("短內文", "鑑界")).toBe("短內文");
    expect(makeSnippet("", "鑑界")).toBe("");
  });
  it("最長 200 字", () => {
    expect(makeSnippet("a".repeat(500) + "x".repeat(300), "x".repeat(300)).length).toBeLessThanOrEqual(200);
  });
});

describe("各 kind 轉換", () => {
  it("topic", () => {
    const [t] = topicsToCandidates({ topics: [{ id: "T1", name: "鑑界", why: "為什麼", body: "內文", updated: "2026-11-01" }] });
    expect(t).toMatchObject({ kind: "topic", id: "T1", title: "鑑界", date: "2026-11-01" });
    expect(t!.text).toContain("為什麼");
    expect(t!.text).toContain("內文");
  });
  it("case／person／object：名稱、敘事文字、最近事件日期與 snippet", () => {
    const list = graphToCandidates({
      cases: [{ name: "只在案件表" }],
      events: [
        { id: "e1", date: "2026-10-01", title: "舊事件", case: "王案", participants: [{ person: "小明", role: "x" }], objects: [{ object: "A地號", objectType: null }] },
        { id: "e2", date: "2026-10-05", title: "新事件", case: "王案", participants: [{ person: "小明", role: "x" }], objects: [] },
      ],
      hubNarratives: [{ hub: "王案", kind: "case", date: "2026-10-06", type: "weave", text: "敘事內容" }],
    });
    const c = list.find((x) => x.kind === "case" && x.id === "王案")!;
    expect(c).toMatchObject({ date: "2026-10-05", snippet: "2026-10-05 新事件" });
    expect(c.text).toBe("敘事內容");
    expect(list.find((x) => x.kind === "person" && x.id === "小明")).toMatchObject({ date: "2026-10-05" });
    expect(list.find((x) => x.kind === "object" && x.id === "A地號")).toMatchObject({ date: "2026-10-01", snippet: "2026-10-01 舊事件" });
    expect(list.find((x) => x.id === "只在案件表")).toMatchObject({ date: null, snippet: "" });
  });
  it("event／concept／method／source（hermes_doc 列）", () => {
    expect(docRowToCandidate({ kind: "concept", docKey: "K", title: "概念", bodyMd: "內文", meta: { date: "2026-03-04" } }))
      .toEqual({ kind: "concept", id: "K", title: "概念", text: "內文", date: "2026-03-04" });
    expect(docRowToCandidate({ kind: "topic", docKey: "K", title: "t", bodyMd: "", meta: {} })).toBeNull();
  });
  it("idea、place、trip、tool", () => {
    expect(ideasToCandidates([{ id: "IDEA-1", title: "想", why: "因", category: "旅遊", lastMentioned: "2026-10-09T10:00:00+08:00" }])[0])
      .toMatchObject({ kind: "idea", id: "IDEA-1", date: "2026-10-09" });
    const p = placesToCandidates([{ id: "FOOD-1", name: "麵店", area: "台中", cuisine: "麵", why: "好吃", tags: ["宵夜"], mustTry: ["乾麵"], visitedAt: null, addedAt: "2026-10-01" }])[0]!;
    expect(p).toMatchObject({ kind: "place", date: "2026-10-01" });
    expect(p.text).toContain("乾麵");
    expect(p.text).toContain("宵夜");
    expect(tripsToCandidates([{ id: "t1", name: "日本", area: "東京", summary: "摘要", start: "2026-05-01" }])[0])
      .toMatchObject({ kind: "trip", id: "t1", date: "2026-05-01" });
    expect(sitesToCandidates([{ id: 7, name: "工具", subtitle: "副標" }])[0])
      .toEqual({ kind: "tool", id: "7", title: "工具", text: "副標", date: null });
  });
  it("壞資料被略過、整包不是預期格式當 0 筆", () => {
    expect(topicsToCandidates(null)).toEqual([]);
    expect(topicsToCandidates({ topics: [null, 5, { id: 1, name: "x" }, { id: "ok", name: "好" }] })).toHaveLength(1);
    expect(ideasToCandidates("x")).toEqual([]);
    expect(placesToCandidates([{ id: "a" }, "z"])).toEqual([]);
    expect(tripsToCandidates({})).toEqual([]);
    expect(sitesToCandidates([{ id: {}, name: "x" }])).toEqual([]);
    expect(graphToCandidates({ events: "x", cases: 3, hubNarratives: {} })).toEqual([]);
    expect(graphToCandidates({ events: [{ id: "e", date: "bad", title: "t", case: "A" }] })).toEqual([]);
  });
});

describe("parseSearchLogBody", () => {
  const good = { q: "鑑界", kind: null, total: 3, clickedKind: "case", clickedId: "王案" };
  it("合法回物件", () => {
    expect(parseSearchLogBody(good)).toEqual(good);
    expect(parseSearchLogBody({ q: "x", kind: "topic", total: 0, clickedKind: null, clickedId: null })).toMatchObject({ total: 0 });
  });
  it("不合法回字串", () => {
    for (const bad of [null, [], { ...good, q: "" }, { ...good, q: "a".repeat(51) }, { ...good, kind: "zzz" }, { ...good, total: -1 },
      { ...good, total: 1.5 }, { ...good, total: "3" }, { ...good, clickedKind: "zzz" }, { ...good, clickedId: 5 }, { ...good, extra: 1 }]) {
      expect(typeof parseSearchLogBody(bad)).toBe("string");
    }
  });
});

describe("stats", () => {
  it("days 驗證", () => {
    expect(parseStatsDays(undefined)).toBe(7);
    expect(parseStatsDays("90")).toBe(90);
    expect(parseStatsDays("0")).toBeNull();
    expect(parseStatsDays("91")).toBeNull();
    expect(parseStatsDays("abc")).toBeNull();
  });
  it("rate 四捨五入到小數 3 位；topZero 依次數排序最多 10 筆", () => {
    const zq = Array.from({ length: 12 }, (_, i) => ({ q: `q${String(i).padStart(2, "0")}`, count: i === 5 ? 9 : 1 }));
    const s = buildStats(7, 3, 1, 2, zq);
    expect(s).toMatchObject({ days: 7, searches: 3, zero: 1, zeroRate: 0.333, clicked: 2, clickRate: 0.667 });
    expect(s.topZero).toHaveLength(10);
    expect(s.topZero[0]).toEqual({ q: "q05", count: 9 });
    expect(s.topZero[1]!.q).toBe("q00");
  });
  it("searches=0 時 rate 為 0", () => {
    expect(buildStats(30, 0, 0, 0, [])).toEqual({ days: 30, searches: 0, zero: 0, zeroRate: 0, clicked: 0, clickRate: 0, topZero: [] });
  });
});

describe("recent", () => {
  it("limit 驗證（未給＝5；數字型別不合法）", () => {
    expect(parseRecentLimit(undefined)).toBe(5);
    expect(parseRecentLimit("1")).toBe(1);
    expect(parseRecentLimit("20")).toBe(20);
    for (const bad of ["0", "21", "abc", "1.5", "", 5]) expect(parseRecentLimit(bad), JSON.stringify(bad)).toBeNull();
  });
});

describe("createTtlCache", () => {
  it("30 秒內不重載、過期重載、clear 立即失效、失敗不快取", async () => {
    let t = 0, calls = 0;
    const cache = createTtlCache(30_000, () => t);
    const load = async () => ++calls;
    expect(await cache.get("k", load)).toBe(1);
    t = 29_999;
    expect(await cache.get("k", load)).toBe(1);
    t = 30_000;
    expect(await cache.get("k", load)).toBe(2);
    cache.clear();
    expect(await cache.get("k", load)).toBe(3);
    await expect(cache.get("bad", async () => { throw new Error("x"); })).rejects.toThrow();
    expect(await cache.get("bad", async () => 9)).toBe(9);
  });
});
