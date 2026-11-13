// 首頁「現在用得上」卡片回饋（POST/GET /api/push/feedback、GET /api/push/stats）的純邏輯：
// body／days 驗證、台北日期換算、晚點截止時間、統計與回饋清單組裝。不碰 DB；
// routes/pushFeedback.ts 只負責查詢與回應。契約見 docs/push-feedback-api.md。
import { isObj } from "./search";

export const CARD_KINDS = ["topic", "resume", "recall", "quiet", "brief"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export const PUSH_ACTIONS = ["shown", "opened", "useful", "useless", "later"] as const;
export type PushAction = (typeof PUSH_ACTIONS)[number];

export const CARD_KEY_MAX = 200;
export const PUSH_MAX_DAYS = 90;
export const PUSH_FEEDBACK_DEFAULT_DAYS = 30;
export const PUSH_STATS_DEFAULT_DAYS = 14;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TPE_OFFSET_MS = 8 * 3_600_000;

export function isCardKind(v: unknown): v is CardKind {
  return typeof v === "string" && (CARD_KINDS as readonly string[]).includes(v);
}
export function isPushAction(v: unknown): v is PushAction {
  return typeof v === "string" && (PUSH_ACTIONS as readonly string[]).includes(v);
}

/** YYYY-MM-DD 且是真實日曆日（擋 2026-02-30、2026-13-01 這種）。 */
export function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  if (m < 1 || m > 12) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const lastDay = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
  const d = Number(s.slice(8, 10));
  return d >= 1 && d <= lastDay;
}

// ── body 驗證 ──────────────────────────────────────────────────────────────
export interface PushFeedbackInput {
  cardKey: string;
  cardKind: CardKind;
  action: PushAction;
  forDate: string;
}
const BODY_KEYS = ["cardKey", "cardKind", "action", "forDate"];

/** 合法回物件，不合法回錯誤訊息字串（路由回 400）。cardKey 去頭尾空白後 1～200 字。 */
export function parsePushFeedbackBody(body: unknown): PushFeedbackInput | string {
  if (!isObj(body)) return "body 必須是物件";
  for (const k of Object.keys(body)) if (!BODY_KEYS.includes(k)) return `不認得的欄位：${k}`;
  const keyRaw = body["cardKey"];
  if (typeof keyRaw !== "string") return "cardKey 必填";
  const cardKey = keyRaw.trim();
  if (cardKey.length < 1 || cardKey.length > CARD_KEY_MAX) return `cardKey 必須是 1～${CARD_KEY_MAX} 字`;
  const cardKind = body["cardKind"];
  if (!isCardKind(cardKind)) return "cardKind 不合法";
  const action = body["action"];
  if (!isPushAction(action)) return "action 不合法";
  const forDate = body["forDate"];
  if (typeof forDate !== "string" || !isRealDate(forDate)) return "forDate 不合法";
  return { cardKey, cardKind, action, forDate };
}

/** days：1～90 的整數；未給回 fallback；不合法回 null（路由回 400）。 */
export function parsePushDays(raw: unknown, fallback: number): number | null {
  if (raw === undefined) return fallback;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= PUSH_MAX_DAYS ? n : null;
}

// ── 台北日期 ───────────────────────────────────────────────────────────────
/** 台北（UTC+8，無夏令時間）的今天日期 YYYY-MM-DD；UTC 16:00 起換日。 */
export function todayTpe(now: Date): string {
  const d = new Date(now.getTime() + TPE_OFFSET_MS);
  return fmtUtcDate(d);
}

/** 台北日期往前往後推 n 天（n 可為負）；格式 YYYY-MM-DD。 */
export function addDaysTpe(date: string, n: number): string {
  const d = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) + n * 86_400_000);
  return fmtUtcDate(d);
}

function fmtUtcDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 「晚點」的截止時間：台北當天 20:00，固定寫成 YYYY-MM-DDT20:00:00+08:00。 */
export function laterUntil(today: string): string {
  return `${today}T20:00:00+08:00`;
}

// ── GET /api/push/feedback 回應 ────────────────────────────────────────────
export interface PushFeedbackView {
  suppressed: string[];
  later: Array<{ cardKey: string; until: string }>;
}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** suppressed 去重後依 cardKey 字串排序；later 去重、排除已 suppressed、排序後帶上 until。 */
export function buildPushFeedback(suppressedKeys: string[], laterKeys: string[], today: string): PushFeedbackView {
  const suppressed = [...new Set(suppressedKeys)].sort(cmpStr);
  const isSuppressed = new Set(suppressed);
  const until = laterUntil(today);
  const later = [...new Set(laterKeys)]
    .filter((k) => !isSuppressed.has(k))
    .sort(cmpStr)
    .map((cardKey) => ({ cardKey, until }));
  return { suppressed, later };
}

// ── GET /api/push/stats 回應 ───────────────────────────────────────────────
export interface PushStats {
  days: number;
  shown: number;
  opened: number;
  openRate: number;
  useful: number;
  useless: number;
  uselessRate: number;
  byKind: Array<{ kind: CardKind; shown: number; opened: number; useless: number }>;
  daysWithCards: number;
}

/** 0～1、四捨五入到小數 3 位、超過 1 截為 1；分母 0 時為 0。 */
function rate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.min(1, Math.round((numerator / denominator) * 1000) / 1000);
}

/**
 * 由 SQL 彙總出的次數算成回應：actionRows＝範圍內各 action 的筆數，kindRows＝範圍內各
 * (kind, action) 的筆數，daysWithCards＝範圍內有 shown 的不同 for_date 數。
 * byKind 五種 kind 固定順序全列（0 也列）；不認得的 kind／action 忽略。
 */
export function buildPushStats(
  days: number,
  actionRows: Array<{ action: string; n: number }>,
  kindRows: Array<{ kind: string; action: string; n: number }>,
  daysWithCards: number,
): PushStats {
  const actionTotal = (action: PushAction) =>
    actionRows.filter((r) => r.action === action).reduce((sum, r) => sum + r.n, 0);
  const shown = actionTotal("shown");
  const opened = actionTotal("opened");
  const useful = actionTotal("useful");
  const useless = actionTotal("useless");
  const kindCount = (kind: CardKind, action: PushAction) =>
    kindRows.filter((r) => r.kind === kind && r.action === action).reduce((sum, r) => sum + r.n, 0);
  const byKind = CARD_KINDS.map((kind) => ({
    kind,
    shown: kindCount(kind, "shown"),
    opened: kindCount(kind, "opened"),
    useless: kindCount(kind, "useless"),
  }));
  return {
    days,
    shown,
    opened,
    openRate: rate(opened, shown),
    useful,
    useless,
    uselessRate: rate(useless, shown),
    byKind,
    daysWithCards,
  };
}
