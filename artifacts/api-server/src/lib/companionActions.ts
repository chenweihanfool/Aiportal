// 首頁「陪伴」人物提醒動作的驗證（純函式，路由與測試共用）。
export const PERSON_NAME_MAX = 60;
export const PERSON_ACTIONS = ["contacted", "snooze", "never"] as const;
export type PersonActionKind = (typeof PERSON_ACTIONS)[number];

export interface ParsedActionBody {
  action: PersonActionKind;
  until: string | null;
  reason: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 今天的台北日期 YYYY-MM-DD */
export function taipeiToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function validDate(s: string): boolean {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 名字：非空、≤60 字（前後空白去掉）；不合法回 null */
export function parsePersonName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  return name.length >= 1 && name.length <= PERSON_NAME_MAX ? name : null;
}

/**
 * PUT body 驗證：snooze 必須帶合法 until 且 ≥ 今天（台北）；contacted／never 忽略 until；reason 只在 never 保留（≤60 字，可空）。
 * 回字串＝錯誤訊息（400）。
 */
export function parseActionBody(body: unknown, today: string = taipeiToday()): ParsedActionBody | string {
  if (!body || typeof body !== "object") return "body 必須是物件";
  const b = body as Record<string, unknown>;
  const action = b["action"];
  if (typeof action !== "string" || !(PERSON_ACTIONS as readonly string[]).includes(action)) return "action 必須是 contacted、snooze 或 never";
  if (action === "snooze") {
    const until = b["until"];
    if (typeof until !== "string" || !validDate(until)) return "snooze 需要 until（YYYY-MM-DD）";
    if (until < today) return "until 不可早於今天";
    return { action, until, reason: null };
  }
  if (action === "never") {
    const reason = b["reason"];
    if (reason !== undefined && reason !== null && typeof reason !== "string") return "reason 必須是字串";
    const text = typeof reason === "string" ? reason.trim() : "";
    if (text.length > PERSON_NAME_MAX) return `reason 不可超過 ${PERSON_NAME_MAX} 字`;
    return { action, until: null, reason: text === "" ? null : text };
  }
  return { action: "contacted", until: null, reason: null };
}
