// /api/dashboard 的先回快取（stale-while-revalidate）：
//   新鮮（< freshMs）          → 直接回快取
//   過期但還能用（< maxStaleMs） → 先回舊的，背景重抓一次（同時間只抓一次）
//   沒有快取或太舊             → 等這次抓完再回（同時間的請求共用同一次抓取）
// 重抓失敗就保留舊的，不把壞結果蓋上去。快取只存在記憶體，重啟後第一個請求照舊等抓取。
// 快取內是未遮罩的完整資料；私領域遮罩仍由路由依每次請求的解鎖狀態處理。
export interface DashboardCacheOptions {
  freshMs: number;
  maxStaleMs: number;
  now?: () => number;
}

export interface CachedResult<T> {
  value: T;
  /** 這份資料多久前抓的（秒） */
  ageSec: number;
  /** 回的是舊資料、背景正在更新 */
  stale: boolean;
}

export function createStaleWhileRevalidate<T>(loader: () => Promise<T>, opts: DashboardCacheOptions) {
  const now = opts.now ?? Date.now;
  let entry: { value: T; at: number } | null = null;
  let inflight: Promise<T> | null = null;

  const load = (): Promise<T> => {
    if (!inflight) {
      inflight = loader()
        .then((value) => {
          entry = { value, at: now() };
          return value;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  };

  return {
    async get(): Promise<CachedResult<T>> {
      const age = entry ? now() - entry.at : Infinity;
      if (entry && age < opts.freshMs) {
        return { value: entry.value, ageSec: Math.round(age / 1000), stale: false };
      }
      if (entry && age < opts.maxStaleMs) {
        load().catch(() => { /* 背景更新失敗：保留舊資料，下一次請求再試 */ });
        return { value: entry.value, ageSec: Math.round(age / 1000), stale: true };
      }
      const value = await load();
      return { value, ageSec: 0, stale: false };
    },
    /** 測試與手動清除用 */
    clear() {
      entry = null;
    },
  };
}
