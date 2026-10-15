import { describe, expect, it } from "vitest";
import { checkTripMedia } from "./mediaFile";

describe("checkTripMedia", () => {
  it("accepts a trip id with CJK and a webp name (incl. thumb suffix)", () => {
    expect(checkTripMedia("TRIP-20261015-台南旅遊", "IMG_1.webp")).toEqual({ ok: true, rel: "trips/TRIP-20261015-台南旅遊/IMG_1.webp" });
    expect(checkTripMedia("t", "IMG_1-t.WEBP")).toEqual({ ok: true, rel: "trips/t/IMG_1-t.WEBP" });
    expect(checkTripMedia("t", "照片 (1).webp").ok).toBe(true);
  });
  it("rejects traversal, separators, hidden names, NUL and non-webp", () => {
    for (const [t, f] of [["..", "a.webp"], ["t", ".."], ["t", "../a.webp"], ["t/x", "a.webp"], ["t", "a/b.webp"], ["t", "a\\b.webp"],
      [".hidden", "a.webp"], ["t", ".a.webp"], ["t", "a.webp\0.png"], ["t", "a.jpg"], ["t", "a.html"], ["t", "a"], ["", "a.webp"], ["t", ""]]) {
      expect(checkTripMedia(t, f).ok, `${t} | ${f}`).toBe(false);
    }
    expect(checkTripMedia(undefined, "a.webp").ok).toBe(false);
    expect(checkTripMedia("t", ["a.webp"]).ok).toBe(false);
    expect(checkTripMedia("t", "x".repeat(250) + ".webp").ok).toBe(false);
  });
});
