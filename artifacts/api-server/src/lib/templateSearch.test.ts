import { describe, expect, it } from "vitest";
import {
  bigramDice, findTemplate, normalizeTemplateQuery, parseTemplateSearchParams, parseTemplates, scoreTemplate,
  searchTemplates, templateVersions, type TemplateRecord,
} from "./templateSearch";

// 假 feed：一個含兩版的「退費文」家族、別名含「鑑界退費」的撤回退費範本、類別「鑑界相關」的再鑑界通知。
export const FIXTURE = {
  computedAt: "2026-11-18T09:00:00+08:00",
  total: 4,
  problems: 0,
  templates: [
    {
      id: "tpl_aaaaaaaaaa", name: "退費文_1120503.docx", family: "退費文", category: "3.退費",
      docType: "函", subject: "退費申請", version: "2023-05-03", latest: false, aliases: ["退費文"],
      root: "official", rel: "3.退費/退費文_1120503.docx", ext: "docx", size: 1000, copies: 1,
    },
    {
      id: "tpl_bbbbbbbbbb", name: "退費文_1130719.docx", family: "退費文", category: "3.退費",
      docType: "函", subject: "退費申請", version: "2024-07-19", latest: true, aliases: ["退費文"],
      root: "official", rel: "3.退費/退費文_1130719.docx", ext: "docx", size: 1200, copies: 1,
    },
    {
      id: "tpl_cccccccccc", name: "撤回退費範本.docx", family: "撤回退費", category: "3.退費",
      docType: "函", subject: "撤回退費", version: "2024-01-02", latest: true, aliases: ["鑑界退費"],
      root: "official", rel: "3.退費/撤回退費範本.docx", ext: "docx", size: 900, copies: 1,
    },
    {
      id: "tpl_dddddddddd", name: "再鑑界通知.pdf", family: "再鑑界通知", category: "鑑界相關",
      docType: "函", subject: null, version: "2023-12-01", latest: true, aliases: ["再鑑界檢測通知"],
      root: "office-pc", rel: "鑑界/再鑑界通知.pdf", ext: "pdf", size: 800, copies: 2,
    },
  ],
};

describe("normalizeTemplateQuery", () => {
  it("去掉空白與口語字樣", () => {
    expect(normalizeTemplateQuery("給我鑑界退費公文範本")).toBe("鑑界退費");
    expect(normalizeTemplateQuery(" 幫我 找一下 樣板 檔案 ")).toBe("");
    expect(normalizeTemplateQuery("JSON")).toBe("");
    expect(normalizeTemplateQuery("的")).toBe("");
  });
});

describe("bigramDice", () => {
  it("相同字串為 1、無交集為 0、單字以是否相同計", () => {
    expect(bigramDice("鑑界退費", "鑑界退費")).toBe(1);
    expect(bigramDice("退費", "鑑界")).toBe(0);
    expect(bigramDice("函", "函")).toBe(1);
    expect(bigramDice("函", "簽")).toBe(0);
    expect(bigramDice("退費文", "退費")).toBeCloseTo(2 / 3, 5);
  });
});

describe("scoreTemplate", () => {
  const rec = FIXTURE.templates[2] as unknown as TemplateRecord;
  it("欄位包含查詢、或查詢包含欄位（≥2 字）都算 1.0；否則取 Dice", () => {
    expect(scoreTemplate("撤回退費", rec)).toBe(1);
    expect(scoreTemplate("鑑界退費", rec)).toBe(1); // aliases
    expect(scoreTemplate("撤回", rec)).toBe(1); // 查詢包含欄位的前提是欄位 ≥2 字；name 含「撤回」
    expect(scoreTemplate("退費", rec)).toBeGreaterThan(0);
    expect(scoreTemplate("完全不相關", rec)).toBe(0);
    expect(scoreTemplate("", rec)).toBe(0);
  });
});

describe("parseTemplates", () => {
  it("型別不對的那筆略過", () => {
    const bad = {
      ...FIXTURE,
      templates: [
        FIXTURE.templates[0],
        { ...FIXTURE.templates[1], id: "bad-id" },
        { ...FIXTURE.templates[1], aliases: "不是陣列" },
        { ...FIXTURE.templates[1], latest: "yes" },
        { ...FIXTURE.templates[1], docType: "不存在" },
        null,
      ],
    };
    const rows = parseTemplates(bad);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("tpl_aaaaaaaaaa");
    expect(parseTemplates(null)).toEqual([]);
    expect(parseTemplates({ templates: "x" })).toEqual([]);
  });
});

describe("searchTemplates", () => {
  it("口語查詢：給我鑑界退費公文範本 → 第 1 名是撤回退費範本", () => {
    const r = searchTemplates(FIXTURE, "給我鑑界退費公文範本", 5);
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items[0]!.id).toBe("tpl_cccccccccc");
    expect(r.items[0]!.score).toBe(1);
  });

  it("再鑑界檢測通知函 → 第 1 名是再鑑界通知，且 clearWinner=true", () => {
    const r = searchTemplates(FIXTURE, "再鑑界檢測通知函", 5);
    expect(r.items[0]!.id).toBe("tpl_dddddddddd");
    expect(r.clearWinner).toBe(true);
  });

  it("只出 latest；olderVersions 是同 family 非 latest 的筆數", () => {
    const r = searchTemplates(FIXTURE, "退費", 5);
    const ids = r.items.map((x) => x.id);
    expect(ids).not.toContain("tpl_aaaaaaaaaa"); // 舊版不出現在搜尋結果
    const fee = r.items.find((x) => x.id === "tpl_bbbbbbbbbb");
    expect(fee?.olderVersions).toBe(1);
    const other = r.items.find((x) => x.id === "tpl_cccccccccc");
    expect(other?.olderVersions).toBe(0);
  });

  it("正規化後為空、limit 截斷、低分不命中", () => {
    expect(searchTemplates(FIXTURE, "給我範本", 5)).toEqual({ items: [], clearWinner: false });
    expect(searchTemplates(FIXTURE, "退費", 1).items).toHaveLength(1);
    expect(searchTemplates(FIXTURE, "完全無關的詞", 5).items).toEqual([]);
  });

  it("同分時版本新的在前", () => {
    const base = { ...FIXTURE.templates[0], aliases: [], category: "3.退費", subject: null, latest: true };
    const payload = {
      ...FIXTURE,
      templates: [
        { ...base, id: "tpl_1111111111", name: "鑑界退費甲.docx", family: "甲", version: "2023-01-01" },
        { ...base, id: "tpl_2222222222", name: "鑑界退費乙.docx", family: "乙", version: "2024-01-01" },
      ],
    };
    const r = searchTemplates(payload, "鑑界退費", 5);
    expect(r.items.map((x) => x.id)).toEqual(["tpl_2222222222", "tpl_1111111111"]);
    expect(r.clearWinner).toBe(false); // 1 對 1，未達 1.5 倍
  });
});

describe("templateVersions／findTemplate", () => {
  it("同 family 全部版本，新到舊", () => {
    const v = templateVersions(FIXTURE, "tpl_aaaaaaaaaa");
    expect(v?.map((x) => x.id)).toEqual(["tpl_bbbbbbbbbb", "tpl_aaaaaaaaaa"]);
    expect(v?.[0]!.olderVersions).toBe(1);
    expect(templateVersions(FIXTURE, "tpl_ffffffffff")).toBeNull();
    expect(findTemplate(FIXTURE, "tpl_cccccccccc")?.name).toBe("撤回退費範本.docx");
    expect(findTemplate(FIXTURE, "tpl_ffffffffff")).toBeNull();
  });
});

describe("parseTemplateSearchParams", () => {
  it("q 1～50 字、limit 1～20 預設 5", () => {
    expect(parseTemplateSearchParams(" a ", undefined)).toEqual({ q: "a", limit: 5 });
    expect(parseTemplateSearchParams("a", "20")).toEqual({ q: "a", limit: 20 });
    expect(parseTemplateSearchParams("", undefined)).toBeNull();
    expect(parseTemplateSearchParams("a".repeat(51), undefined)).toBeNull();
    expect(parseTemplateSearchParams("a", "0")).toBeNull();
    expect(parseTemplateSearchParams("a", "21")).toBeNull();
    expect(parseTemplateSearchParams("a", "1.5")).toBeNull();
    expect(parseTemplateSearchParams(undefined, undefined)).toBeNull();
  });
});
