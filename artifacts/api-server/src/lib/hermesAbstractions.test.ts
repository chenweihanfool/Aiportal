import { describe, expect, it } from "vitest";
import { deriveAbstractions, normalizeRefs, PROMOTE_THRESHOLD } from "./hermesAbstractions";

describe("normalizeRefs", () => {
  it("returns [] for missing or non-array input", () => {
    expect(normalizeRefs(undefined)).toEqual([]);
    expect(normalizeRefs(null)).toEqual([]);
    expect(normalizeRefs("概念")).toEqual([]);
    expect(normalizeRefs({ name: "x" })).toEqual([]);
  });

  it("accepts objects and bare strings, trims, drops blanks and duplicates", () => {
    expect(
      normalizeRefs([
        { name: " 單一事實來源 ", relation: " 體現 " },
        "漸進式部署",
        { name: "單一事實來源" },
        { name: "   " },
        { relation: "體現" },
        42,
        null,
      ]),
    ).toEqual([
      { name: "單一事實來源", relation: "體現" },
      { name: "漸進式部署", relation: null },
    ]);
  });
});

describe("deriveAbstractions", () => {
  const events = [
    { id: "e1", concepts: [{ name: "A", relation: "體現" }, { name: "B" }], methods: [{ name: "M1" }] },
    { id: "e2", concepts: [{ name: "A" }] },
    { id: "e3" }, // 舊事件：沒有任何欄位
    { id: "e4", concepts: "壞資料", methods: [{ name: "M1" }, { name: "M1" }] },
  ];

  it("counts events per name and promotes at the threshold", () => {
    expect(PROMOTE_THRESHOLD).toBe(2);
    const d = deriveAbstractions(events);
    expect(d.concepts).toEqual([
      { name: "A", eventCount: 2, promoted: true },
      { name: "B", eventCount: 1, promoted: false },
    ]);
    // 同一事件內重複出現只算一次
    expect(d.methods).toEqual([{ name: "M1", eventCount: 2, promoted: true }]);
  });

  it("emits one edge per (event, name) with relation or null", () => {
    const d = deriveAbstractions(events);
    expect(d.conceptEdges).toEqual([
      { eventId: "e1", concept: "A", relation: "體現" },
      { eventId: "e1", concept: "B", relation: null },
      { eventId: "e2", concept: "A", relation: null },
    ]);
    expect(d.methodEdges).toEqual([
      { eventId: "e1", method: "M1", relation: null },
      { eventId: "e4", method: "M1", relation: null },
    ]);
  });

  it("handles events with no abstractions at all", () => {
    expect(deriveAbstractions([{ id: "x" }])).toEqual({
      concepts: [], methods: [], conceptEdges: [], methodEdges: [],
    });
  });
});
