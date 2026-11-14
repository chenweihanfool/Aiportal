// 「📌 需要時提醒我」的純邏輯：body／due 驗證。不碰 DB；
// routes/pushPins.ts 只負責查詢與回應。契約見 docs/push-feedback-api.md。
import { isObj } from "./search";
import { addDaysTpe, isRealDate, todayTpe } from "./pushFeedback";

export const PIN_TARGET_KINDS = [
  "case", "person", "object", "topic", "event", "concept", "method", "source", "idea", "place", "trip",
] as const;
export type PinTargetKind = (typeof PIN_TARGET_KINDS)[number];

export const PIN_TARGET_ID_MAX = 200;
export const PIN_TITLE_MAX = 200;
export const PIN_HREF_MAX = 300;
export const PIN_DUE_MAX_DAYS = 366;

export function isPinTargetKind(v: unknown): v is PinTargetKind {
  return typeof v === "string" && (PIN_TARGET_KINDS as readonly string[]).includes(v);
}

// ── body 驗證 ──────────────────────────────────────────────────────────────
export interface PushPinInput {
  targetKind: PinTargetKind;
  targetId: string;
  title: string;
  href: string;
  dueDate: string;
}
const BODY_KEYS = ["targetKind", "targetId", "title", "href", "dueDate"];

/**
 * 合法回物件，不合法回錯誤訊息字串（路由回 400）。
 * targetId／title 去頭尾空白後 1～200 字；href 以 # 開頭、1～300 字；
 * dueDate 是真實日曆日，且在台北今天～今天＋366 天之間。
 */
export function parsePinBody(body: unknown): PushPinInput | string {
  if (!isObj(body)) return "body 必須是物件";
  for (const k of Object.keys(body)) if (!BODY_KEYS.includes(k)) return `不認得的欄位：${k}`;
  const targetKind = body["targetKind"];
  if (!isPinTargetKind(targetKind)) return "targetKind 不合法";
  const targetIdRaw = body["targetId"];
  if (typeof targetIdRaw !== "string") return "targetId 必填";
  const targetId = targetIdRaw.trim();
  if (targetId.length < 1 || targetId.length > PIN_TARGET_ID_MAX) return `targetId 必須是 1～${PIN_TARGET_ID_MAX} 字`;
  const titleRaw = body["title"];
  if (typeof titleRaw !== "string") return "title 必填";
  const title = titleRaw.trim();
  if (title.length < 1 || title.length > PIN_TITLE_MAX) return `title 必須是 1～${PIN_TITLE_MAX} 字`;
  const href = body["href"];
  if (typeof href !== "string" || !href.startsWith("#") || href.length < 1 || href.length > PIN_HREF_MAX) {
    return `href 必須以 # 開頭且為 1～${PIN_HREF_MAX} 字`;
  }
  const dueDate = body["dueDate"];
  if (typeof dueDate !== "string" || !isRealDate(dueDate)) return "dueDate 不合法";
  const today = todayTpe(new Date());
  const maxDate = addDaysTpe(today, PIN_DUE_MAX_DAYS);
  if (dueDate < today || dueDate > maxDate) return `dueDate 必須在 ${today}～${maxDate} 之間`;
  return { targetKind, targetId, title, href, dueDate };
}

/** due：undefined → 'all'；'today' → 'today'；其他回 null（路由回 400）。 */
export function parseDue(raw: unknown): "all" | "today" | null {
  if (raw === undefined) return "all";
  if (raw === "today") return "today";
  return null;
}
