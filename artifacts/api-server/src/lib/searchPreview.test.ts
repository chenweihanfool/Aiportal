import { describe, expect, it } from "vitest";
import { fetchRepos } from "./githubRepos";
import { reposToCandidates } from "./search";
import {
  cleanPoint, firstBodyLine, previewDoc, previewGraphEntity, previewIdea, previewPlace, previewRepo, previewTool,
  previewTopic, previewTrip, topicPoints, validatePreviewParams,
} from "./searchPreview";

const graph = {
  cases: [{ name: "王案" }],
  events: [
    { id: "e1", date: "2026-10-01", title: "第一件", case: "王案", participants: [{ person: "小明", role: "x" }], objects: [{ object: "A地號", objectType: null }], concepts: [{ name: "鑑界" }], methods: [{ name: "複丈" }] },
    { id: "e2", date: "2026-10-05", title: "第二件", case: "王案", participants: [{ person: "小明", role: "x" }, { person: "小華", role: "y" }], objects: [] },
    { id: "e3", date: "2026-10-07", title: "別案事件", case: "李案", participants: [{ person: "小華", role: "y" }], objects: [] },
  ],
  hubNarratives: [
    { hub: "王案", kind: "case", date: "2026-10-06", type: "alert", text: "警報文字" },
    { hub: "王案", kind: "case", date: "2026-10-02", type: "weave", text: "編織敘事" },
  ],
};

describe("validatePreviewParams", () => {
  it("kind 與 id 驗證", () => {
    expect(validatePreviewParams("zzz", "a").ok).toBe(false);
    expect(validatePreviewParams("case", "").ok).toBe(false);
    expect(validatePreviewParams("case", undefined).ok).toBe(false);
    expect(validatePreviewParams("case", "王案").ok).toBe(true);
  });
});

describe("文字清理", () => {
  it("cleanPoint 去掉 ^cNNN、[[ ]]、⟦n⟧", () => {
    expect(cleanPoint("先看[[界址]]⟦3⟧再說 ^c012")).toBe("先看界址再說");
    expect(cleanPoint("a".repeat(200)).length).toBe(120);
  });
  it("firstBodyLine 略過空行與標題", () => {
    expect(firstBodyLine("\n# 標題\n\n## 小節\n第一句\n第二句")).toBe("第一句");
    expect(firstBodyLine("# 只有標題")).toBe("");
  });
  it("topicPoints：優先「要注意什麼」，其次「怎麼做」「步驟」，最多 5 條", () => {
    const body = "## 怎麼做\n- 做A\n## 要注意什麼\n- 一 ^c001\n- 二\n- 三\n- 四\n- 五\n- 六\n## 其他\n- 不要";
    expect(topicPoints(body)).toEqual(["一", "二", "三", "四", "五"]);
    expect(topicPoints("## 步驟\n- 甲\n- 乙")).toEqual(["甲", "乙"]);
    expect(topicPoints("## 怎麼做\n- 做A")).toEqual(["做A"]);
    expect(topicPoints("沒有小節")).toEqual([]);
  });
});

describe("previewTopic", () => {
  const payload = { topics: [{
    id: "T1", name: "鑑界", why: "為了確認界址", body: "## 要注意什麼\n- 帶[[界標]] ^c001\n", updated: "2026-11-01",
    related: [{ id: "T2", name: "複丈" }],
    sources: [{ id: "s1", title: "a", date: "2026-11-10", case: "王案" }, { id: "s2", title: "b", date: "2026-10-01", case: "王案" }, { id: "s3", title: "c" }],
  }] };
  it("one／points／related／source／bodyMd", () => {
    const p = previewTopic(payload, "T1")!;
    expect(p.one).toBe("為了確認界址");
    expect(p.points).toEqual(["帶界標"]);
    expect(p.related).toEqual([{ kind: "topic", id: "T2", title: "複丈" }, { kind: "case", id: "王案", title: "王案" }]);
    expect(p.source).toBe("3 份來源・最近 2026-11-10");
    expect(p.bodyMd).toContain("要注意什麼");
    expect(Object.keys(p)).not.toContain("sourcePath");
  });
  it("沒有 why 時 one 取 body 第一個非標題行；找不到回 null；正文截到 20000 字", () => {
    expect(previewTopic({ topics: [{ id: "T9", name: "x", body: "# h\n內文行" }] }, "T9")!.one).toBe("內文行");
    expect(previewTopic(payload, "nope")).toBeNull();
    expect(previewTopic(null, "T1")).toBeNull();
    expect(previewTopic({ topics: [{ id: "B", name: "x", body: "a".repeat(30000) }] }, "B")!.bodyMd!.length).toBe(20000);
  });
});

describe("previewGraphEntity", () => {
  it("case：one 取 weave 優先；points 為最近事件；related 依共同事件數", () => {
    const p = previewGraphEntity(graph, "case", "王案")!;
    expect(p.one).toBe("編織敘事");
    expect(p.points).toEqual(["2026-10-05 第二件", "2026-10-01 第一件"]);
    expect(p.related[0]).toEqual({ kind: "person", id: "小明", title: "小明" });
    expect(p.related.map((r) => r.id)).toEqual(["小明", "小華", "A地號"]);
    expect(p.source).toBe("2 件事件");
    expect(p.bodyMd).toBeNull();
  });
  it("person 沒有敘事：one 為「共 N 件事件，最近 日期」；找不到回 null", () => {
    const p = previewGraphEntity(graph, "person", "小華")!;
    expect(p.one).toBe("共 2 件事件，最近 2026-10-07");
    expect(p.related.map((r) => `${r.kind}:${r.id}`)).toEqual(["case:李案", "case:王案", "person:小明"]);
    expect(previewGraphEntity(graph, "object", "不存在")).toBeNull();
  });
});

describe("previewDoc", () => {
  it("event：related 為案件／人／物／概念／方法；source 為日記日期", () => {
    const p = previewDoc({ kind: "event", docKey: "e1", title: "第一件", bodyMd: "## 摘要\n發生了事", meta: { date: "2026-10-01", sources: [{ type: "diary" }] } }, graph)!;
    expect(p.one).toBe("發生了事");
    expect(p.related.map((r) => `${r.kind}:${r.id}`)).toEqual(["case:王案", "person:小明", "object:A地號", "concept:鑑界", "method:複丈"]);
    expect(p.source).toBe("日記 2026-10-01");
    expect(p.bodyMd).toBe("## 摘要\n發生了事");
  });
  it("concept：related 為 meta.refs 指到的事件（標題取事件標題）", () => {
    const p = previewDoc({ kind: "concept", docKey: "鑑界", title: "鑑界", bodyMd: "概念內文", meta: { refs: [{ eventId: "e2" }, { eventId: "zz" }, { nope: 1 }] } }, graph)!;
    expect(p.related).toEqual([{ kind: "event", id: "e2", title: "第二件" }, { kind: "event", id: "zz", title: "zz" }]);
    expect(p.source).toBe("2 件事件");
  });
  it("diary：source 為「日記 YYYY-MM-DD」、bodyMd 給全文", () => {
    const p = previewDoc({ kind: "diary", docKey: "2026-11-14", title: "今天", bodyMd: "# 今天\n日記內容", meta: {} }, graph)!;
    expect(p).toMatchObject({ kind: "diary", id: "2026-11-14", one: "日記內容", source: "日記 2026-11-14", related: [], points: [] });
    expect(p.bodyMd).toBe("# 今天\n日記內容");
  });
  it("source：related 空、source 為原文日期；壞資料回 null", () => {
    const p = previewDoc({ kind: "source", docKey: "s", title: "原文", bodyMd: "內文", meta: { date: "2026-11-09" } }, graph)!;
    expect(p.related).toEqual([]);
    expect(p.source).toBe("原文 2026-11-09");
    expect(previewDoc({ kind: "topic", docKey: "s", title: "x", bodyMd: "", meta: {} }, graph)).toBeNull();
  });
});

describe("previewRepo", () => {
  const repo = (over: Record<string, unknown> = {}) => ({
    name: "kc2", fullName: "chenweihanfool/kc2", description: "土地鑑界工具",
    url: "https://github.com/chenweihanfool/kc2", language: "TypeScript", topics: ["gis", "鑑界"],
    pushedAt: "2026-11-10T08:00:00Z", private: false, fork: false, archived: false, defaultBranch: "main", ...over,
  });
  it("找到：one／points／source／url", () => {
    expect(previewRepo([repo()], "kc2")).toEqual({
      kind: "repo", id: "kc2", title: "kc2", one: "土地鑑界工具",
      points: ["語言：TypeScript", "主題：gis、鑑界", "最後推送：2026-11-10", "公開", "預設分支：main"],
      related: [], source: "GitHub chenweihanfool/kc2", bodyMd: null, url: "https://github.com/chenweihanfool/kc2",
    });
  });
  it("找不到、不是陣列、壞資料都回 null", () => {
    expect(previewRepo([repo()], "nope")).toBeNull();
    expect(previewRepo(null, "kc2")).toBeNull();
    expect(previewRepo([{ name: "kc2" }], "kc2")).toBeNull(); // 沒有 url
  });
  it("points 略過 null／空值；description 為 null 時 one 為空字串", () => {
    const p = previewRepo([repo({ description: null, language: null, topics: [], pushedAt: null, defaultBranch: null })], "kc2")!;
    expect(p.one).toBe("");
    expect(p.points).toEqual(["公開"]);
  });
  it("私有＋封存（＋fork）的字樣", () => {
    expect(previewRepo([repo({ private: true })], "kc2")!.points).toContain("🔒 私有");
    expect(previewRepo([repo({ private: true, archived: true, fork: true })], "kc2")!.points).toContain("🔒 私有・已封存・fork");
    expect(previewRepo([repo()], "kc2")!.points).toContain("公開");
  });
});

describe("repo 資料契約（fetchRepos → reposToCandidates／previewRepo）", () => {
  const raw = (name: string, extra: Record<string, unknown> = {}) => ({
    name, full_name: `chenweihanfool/${name}`, html_url: `https://github.com/chenweihanfool/${name}`,
    description: "土地鑑界工具", language: "TypeScript", topics: ["gis"], pushed_at: "2026-11-10T08:00:00Z",
    default_branch: "main", private: false, archived: false, fork: false, ...extra,
  });
  it("GitHub 原始格式經 fetchRepos 後的 repos 可直接轉候選與預覽", async () => {
    const fakeFetch = (async () => new Response(JSON.stringify([
      raw("kc2"), raw("secret", { private: true, archived: true, description: null }),
    ]))) as unknown as typeof fetch;
    const r = await fetchRepos({ token: "t", owner: "chenweihanfool" }, fakeFetch);
    expect(r.status).toBe("ok");
    const repos = r.status === "ok" ? r.repos : [];
    expect(reposToCandidates(repos)[0]).toMatchObject({
      kind: "repo", id: "kc2", title: "kc2", date: "2026-11-10", text: "土地鑑界工具\nTypeScript\ngis",
      meta: { language: "TypeScript", private: false, archived: false, url: "https://github.com/chenweihanfool/kc2" },
    });
    expect(reposToCandidates(repos)).toHaveLength(2);
    expect(previewRepo(repos, "secret")).toMatchObject({
      kind: "repo", id: "secret", title: "secret", one: "",
      points: ["語言：TypeScript", "主題：gis", "最後推送：2026-11-10", "🔒 私有・已封存", "預設分支：main"],
      source: "GitHub chenweihanfool/secret", url: "https://github.com/chenweihanfool/secret",
    });
  });
});

describe("idea／place／trip／tool", () => {
  it("idea", () => {
    expect(previewIdea([{ id: "IDEA-1", title: "想", why: "因為" }], "IDEA-1")).toMatchObject({ one: "因為", source: "想法庫", points: [], related: [], bodyMd: null });
    expect(previewIdea([], "x")).toBeNull();
  });
  it("place：why 優先，否則「area・cuisine」", () => {
    expect(previewPlace([{ id: "F1", name: "麵店", area: "台中", cuisine: "麵", why: null }], "F1")).toMatchObject({ one: "台中・麵", source: "美食地圖" });
    expect(previewPlace([{ id: "F1", name: "麵店", why: "好吃" }], "F1")!.one).toBe("好吃");
  });
  it("trip", () => {
    expect(previewTrip([{ id: "t1", name: "日本", summary: "五天" }], "t1")).toMatchObject({ one: "五天", source: "遊記" });
  });
  it("tool", () => {
    expect(previewTool([{ id: 3, name: "工具", subtitle: "副標" }], "3")).toMatchObject({ id: "3", title: "工具", one: "副標", source: "" });
    expect(previewTool([{ id: 3, name: "工具" }], "4")).toBeNull();
  });
});
