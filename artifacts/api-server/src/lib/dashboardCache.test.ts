import { describe, expect, it } from "vitest";
import { createStaleWhileRevalidate } from "./dashboardCache";

function setup(loader: () => Promise<number>) {
  let t = 0;
  const cache = createStaleWhileRevalidate(loader, { freshMs: 60_000, maxStaleMs: 600_000, now: () => t });
  return { cache, advance: (ms: number) => { t += ms; } };
}

describe("createStaleWhileRevalidate", () => {
  it("新鮮期內直接回快取，不重抓", async () => {
    let n = 0;
    const { cache, advance } = setup(async () => ++n);
    expect((await cache.get()).value).toBe(1);
    advance(30_000);
    const r = await cache.get();
    expect(r).toMatchObject({ value: 1, ageSec: 30, stale: false });
    expect(n).toBe(1);
  });

  it("過期但可用：先回舊的並背景更新，下一次拿到新的", async () => {
    let n = 0;
    const { cache, advance } = setup(async () => ++n);
    await cache.get();
    advance(120_000);
    const r = await cache.get();
    expect(r).toMatchObject({ value: 1, stale: true });
    await Promise.resolve(); await Promise.resolve();
    expect((await cache.get()).value).toBe(2);
  });

  it("太舊就等重抓；同時的請求共用同一次抓取", async () => {
    let n = 0;
    const { cache, advance } = setup(async () => { await Promise.resolve(); return ++n; });
    await cache.get();
    advance(700_000);
    const [a, b] = await Promise.all([cache.get(), cache.get()]);
    expect(a.value).toBe(2);
    expect(b.value).toBe(2);
    expect(n).toBe(2);
  });

  it("背景更新失敗保留舊資料；沒有快取時失敗會丟出去", async () => {
    let fail = false;
    const { cache, advance } = setup(async () => { if (fail) throw new Error("boom"); return 1; });
    await cache.get();
    fail = true;
    advance(120_000);
    expect((await cache.get()).value).toBe(1);
    await Promise.resolve(); await Promise.resolve();
    expect((await cache.get()).value).toBe(1);
    cache.clear();
    await expect(cache.get()).rejects.toThrow("boom");
  });
});
