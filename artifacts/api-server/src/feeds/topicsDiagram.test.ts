import { describe, expect, it } from "vitest";
import { FEED_REGISTRY } from "./registry";
import { validateFeedRequest } from "../lib/feedValidate";

// topics 的選用欄位 diagram（2026-11-08 起，任務單 kb-diagram-schema）：
// 合法／非法樣本，以及 64 題各帶一張上限圖時 payload 仍在上限內。
const base = { computedAt: "2026-11-08T10:00:00+08:00", total: 1, published: 1 };
function topic(diagram?: unknown) {
  return {
    id: "t1",
    name: "測試題",
    kind: "concept",
    why: "",
    firstSeen: "2026-01-01",
    revision: 0,
    docs: 1,
    newDocs: 0,
    monthsSpan: 1,
    body: "正文",
    growth: [],
    sources: [],
    related: [],
    ...(diagram === undefined ? {} : { diagram }),
  };
}
const body = (diagram?: unknown) => ({ schemaVersion: 1, generatedAt: "2026-11-08", payload: { ...base, topics: [topic(diagram)] } });
const check = (diagram: unknown) => validateFeedRequest("topics", body(diagram));

const flow = {
  type: "flow",
  version: 1,
  lanes: ["送件", "審查"],
  phases: ["開始", "結束"],
  nodes: [
    { id: "a", label: "送件", src: [1], lane: 0, phase: 0, shape: "step" },
    { id: "b", label: "補正", src: [2], lane: 1, phase: 1, shape: "decision", pitfall: true },
    { id: "c", label: "核發", src: [1, 2], lane: 0, phase: 1, shape: "step", sub: "選填", note: "備註", ai: true, unknown: false },
  ],
  edges: [
    { from: "a", to: "b", label: "缺件" },
    { from: "b", to: "c", back: true },
  ],
};
const timeline = {
  type: "timeline",
  version: 1,
  tracks: [{ id: "t1", label: "觀察" }],
  items: [{ track: "t1", date: "2026-01-01", end: "2026-01-02", label: "觀察甲", src: [1], sub: "x", note: "y", ai: false, unknown: true }],
  metrics: [{ label: "件數", unit: "件", points: [{ date: "2026-01-01", value: 1, src: [1] }, { date: "2026-01-02", value: 2.5, src: [2] }] }],
};
const map = {
  type: "map",
  version: 1,
  core: "核心概念",
  observations: [{ id: "o1", label: "觀察甲", src: [1] }],
  frameworks: [{ id: "f1", label: "架構甲", src: [2] }],
  judgments: [{ id: "j1", label: "判斷甲", src: [1, 2] }],
  links: [{ from: "o1", to: "f1" }],
};

// 欄位全部用到上限的樣本（字串用 ASCII 填滿；src 一律 6 個）。
const SRC6 = [1, 1, 1, 1, 1, 1];
function maxTimeline() {
  return {
    type: "timeline",
    version: 1,
    tracks: Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, label: "x".repeat(8) })),
    items: Array.from({ length: 80 }, (_, i) => ({
      track: `t${i % 6}`,
      date: "2026-01-01",
      end: "2026-01-02",
      label: "x".repeat(14),
      src: SRC6,
      sub: "x".repeat(24),
      note: "x".repeat(120),
      ai: true,
      unknown: true,
    })),
    metrics: Array.from({ length: 2 }, () => ({
      label: "x".repeat(10),
      unit: "x".repeat(6),
      points: Array.from({ length: 40 }, () => ({ date: "2026-01-01", value: 1.5, src: SRC6 })),
    })),
  };
}
function maxFlow() {
  return {
    type: "flow",
    version: 1,
    lanes: Array.from({ length: 6 }, () => "x".repeat(8)),
    phases: Array.from({ length: 8 }, () => "x".repeat(8)),
    nodes: Array.from({ length: 20 }, (_, i) => ({
      id: `n${i}`,
      label: "x".repeat(14),
      sub: "x".repeat(24),
      src: SRC6,
      unknown: true,
      ai: true,
      note: "x".repeat(120),
      lane: 0,
      phase: 0,
      shape: "decision",
      pitfall: true,
    })),
    edges: Array.from({ length: 30 }, (_, i) => ({ from: `n${i % 20}`, to: `n${(i + 1) % 20}`, label: "x".repeat(10), back: true })),
  };
}
function maxMap() {
  const node = (prefix: string, i: number) => ({
    id: `${prefix}${i}`,
    label: "x".repeat(14),
    sub: "x".repeat(24),
    src: SRC6,
    unknown: true,
    ai: true,
    note: "x".repeat(120),
  });
  return {
    type: "map",
    version: 1,
    core: "x".repeat(24),
    observations: Array.from({ length: 10 }, (_, i) => node("o", i)),
    frameworks: Array.from({ length: 6 }, (_, i) => node("f", i)),
    judgments: Array.from({ length: 10 }, (_, i) => node("j", i)),
    links: Array.from({ length: 60 }, (_, i) => ({ from: `o${i % 10}`, to: `f${i % 6}` })),
  };
}

describe("topics diagram", () => {
  it("舊 payload 沒有 diagram 照樣通過；diagram: null 也合法", () => {
    expect(validateFeedRequest("topics", body()).ok).toBe(true);
    expect(check(null).ok).toBe(true);
  });

  it("flow／timeline／map 各一個合法樣本通過", () => {
    for (const d of [flow, timeline, map]) {
      const r = check(d);
      expect(r.ok, r.ok ? "" : r.message).toBe(true);
    }
  });

  it("違反契約的 diagram 整包被擋（400）", () => {
    const cases: Record<string, unknown> = {
      "flow 節點 21 個": { ...flow, nodes: Array.from({ length: 21 }, (_, i) => ({ id: `x${i}`, label: "乙", src: [1], lane: 0, phase: 0, shape: "step" })) },
      "flow 某節點 src 空陣列": { ...flow, nodes: [{ ...flow.nodes[0], src: [] }, ...flow.nodes.slice(1)] },
      "未知 type tree": { type: "tree", version: 1 },
      "timeline 日期格式錯": { ...timeline, items: [{ ...timeline.items[0], date: "2026/01/01" }] },
      "map core 超過 24 字": { ...map, core: "核".repeat(25) },
    };
    for (const [name, d] of Object.entries(cases)) {
      expect(validateFeedRequest("topics", body(d)), name).toMatchObject({ ok: false, status: 400 });
    }
  });

  it("maxBytes 4 MiB：上限圖 × 64 ＋ 既有 1.5 MiB 預算容得下，64 題帶滿圖不回 413", () => {
    const diagrams = [maxTimeline(), maxFlow(), maxMap()];
    for (const d of diagrams) {
      const r = check(d);
      expect(r.ok, r.ok ? "" : r.message).toBe(true);
    }
    const sizeOf = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");
    const biggestDiagram = diagrams.reduce((a, b) => (sizeOf(b) > sizeOf(a) ? b : a));
    const biggest = sizeOf(biggestDiagram);
    const estimate = biggest * 64 + 1536 * 1024;
    const def = FEED_REGISTRY["topics"]!;
    expect(def.maxBytes).toBe(4 * 1024 * 1024);
    expect(estimate).toBeLessThanOrEqual(def.maxBytes!);

    const payload = {
      computedAt: base.computedAt,
      total: 64,
      published: 64,
      topics: Array.from({ length: 64 }, () => topic(biggestDiagram)),
    };
    const r = validateFeedRequest("topics", { schemaVersion: 1, generatedAt: "2026-11-08", payload });
    expect(r.ok, r.ok ? "" : r.message).toBe(true);
  });
});
