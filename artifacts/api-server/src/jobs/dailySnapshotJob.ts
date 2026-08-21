import { logger } from "../lib/logger";
import { computeAndPersistDailySnapshot } from "../lib/summarySources";

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000; // 固定 UTC+8，台灣沒有 DST
const DAY_MS = 24 * 60 * 60 * 1000;
const TARGET_HOUR = 23;
const TARGET_MINUTE = 55;

// 算出距離下一個台北時間 23:55 還有幾毫秒——把 now 平移 +8 小時後用 UTC
// getter 當作台北本地時間讀，跳過 Intl/時區資料庫往返。這個做法之所以安全，
// 是因為台北沒有 DST 需要處理；換了會有 DST 的時區就不能這樣簡化。
export function msUntilNextTaipei2355(now: Date = new Date()): number {
  const nowTaipeiMs = now.getTime() + TAIPEI_OFFSET_MS;
  const t = new Date(nowTaipeiMs);
  let targetTaipeiMs = Date.UTC(
    t.getUTCFullYear(),
    t.getUTCMonth(),
    t.getUTCDate(),
    TARGET_HOUR,
    TARGET_MINUTE,
    0,
    0
  );
  if (targetTaipeiMs <= nowTaipeiMs) targetTaipeiMs += DAY_MS;
  return targetTaipeiMs - TAIPEI_OFFSET_MS - now.getTime();
}

// 幸福指數每日快照——api-server 容器內常駐計時器，不是 Windows 排程腳本，
// 因為這個計算完全不碰 NAS（只需要外部 HTTPS API + 讀資料庫，跟 dashboard
// 即時計算用的資料來源一樣），沒有 UNC 掛載限制需要繞過 host 執行。
//
// 用會自我重新排程的 setTimeout，不是 setInterval——setInterval 的固定週期
// 會因為每次執行（DB 寫入 + 好幾個外部 HTTPS 呼叫）耗時而累積漂移，永遠不會
// 自我修正。這裡每次都是等上一次真正跑完後，才從當下的實際時鐘重新算一次
// 距離下個目標時間還有多久，所以即使某次執行特別慢或丟出例外，也不會累積
// 跨天的時間漂移。
export function startDailySnapshotJob(): void {
  const fire = async () => {
    try {
      await computeAndPersistDailySnapshot();
      logger.info({}, "Happiness daily snapshot persisted");
    } catch (err) {
      logger.error({ err }, "Happiness daily snapshot failed");
    } finally {
      setTimeout(fire, msUntilNextTaipei2355());
    }
  };
  setTimeout(fire, msUntilNextTaipei2355());
}
