// 事件的「日期」與「時間」解析（圖譜時間軸用）。純函式，不碰資料庫與網路。
//
// 起因（2026-10-16 使用者截圖：關係宇宙時間軸一堆 `null`）：L1 規則 5 允許原文的相對日期換算不出來時 `event_date: null`，
// Events 檔頭因此是 `date: null`，pusher 把它當字串 "null" 推上來。畫面直接印出 "null"，而且伺服端用字串比較的統計也被它污染
// （"null" > "2026-10-09"：本週新增事件被多算、人物／案件的最後日期變成 "null"）。
//
// 遊記是怎麼做到時間正確的：它的日期與時間來自日記檔名與條目行首時戳。圖譜事件同樣帶著兩個時間來源（pusher 已經一併推上來）：
//   writtenAt＝寫進日記那一行的時間（日記行首時戳）、createdAt＝首次被萃取的時刻。這裡照日報「當日事件」的優先序用它們補洞。
//
// 日期優先序：frontmatter 的合法日期 → writtenAt 那天 → createdAt 那天 → 都沒有就是空字串（畫面顯示「—」，不拿假日期冒充）。
// 補出來的日期是「寫進日記／被萃取的那天」，不是事件真正發生的那天（原文本來就說不清），所以 dateSource 會標明來源，畫面加「~」。
const TAIPEI = "Asia/Taipei";
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})/;

export type DateSource = "frontmatter" | "diary" | "extracted" | "none";
export type TimeSource = "diary" | "extracted";

export interface ResolvedEventDate {
  /** YYYY-MM-DD；全部來源都沒有時是空字串 */
  date: string;
  dateSource: DateSource;
  /** HH:mm（台北時間），只在時間來源與 date 同一天時才給，不然會誤導；沒有就是 null */
  time: string | null;
  timeSource: TimeSource | null;
}

/** 字串開頭是不是真實存在的日期（2026-02-31 不算）；是就回 YYYY-MM-DD。 */
export function validDay(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = DAY_RE.exec(v.trim());
  if (!m) return null;
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== day) return null;
  return day;
}

function taipeiParts(iso: unknown): { date: string; hm: string } | null {
  if (typeof iso !== "string" || !iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TAIPEI, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p["year"]}-${p["month"]}-${p["day"]}`, hm: `${p["hour"]}:${p["minute"]}` };
}

export function resolveEventDate(ev: { date?: unknown; createdAt?: string | null; writtenAt?: string | null }): ResolvedEventDate {
  const written = taipeiParts(ev.writtenAt);
  const created = taipeiParts(ev.createdAt);
  const fm = validDay(ev.date);

  let date = "";
  let dateSource: DateSource = "none";
  if (fm) { date = fm; dateSource = "frontmatter"; }
  else if (written) { date = written.date; dateSource = "diary"; }
  else if (created) { date = created.date; dateSource = "extracted"; }

  let time: string | null = null;
  let timeSource: TimeSource | null = null;
  if (written && written.date === date) { time = written.hm; timeSource = "diary"; }
  else if (created && created.date === date) { time = created.hm; timeSource = "extracted"; }
  return { date, dateSource, time, timeSource };
}
