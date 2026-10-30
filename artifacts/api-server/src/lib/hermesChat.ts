// 入口網內建 HERMES 對話的純邏輯（不碰資料庫與網路，方便單元測試）。
// 使用者 2026-10-30：「是否可以在入口網內建類似telegram的HERMES交互介面?」「有自動1小時new session的功能嗎? 我怕一個SESSION一直養 吃TOKEN」
// 「還有restart gateway功能 也是比較常用」「開工」。

/** 閒置超過這麼多分鐘，下一則訊息自動開新 session */
export const DEFAULT_IDLE_MINUTES = 60;
/** 兩次重啟至少間隔幾分鐘（力道最強的動作，防手滑連按） */
export const RESTART_COOLDOWN_MINUTES = 5;
export const RESTART_MODES = ["graceful", "force"] as const;
export type RestartMode = (typeof RESTART_MODES)[number];
/** 訊息長度上限（字元） */
export const MAX_MESSAGE_CHARS = 8000;

/** HERMES_CHAT_IDLE_MINUTES 不是正整數就用預設值 */
export function idleMinutesOf(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_IDLE_MINUTES;
}

/** 沒有目前的 session，或最後一則訊息已超過閒置門檻，就開新的 */
export function needsNewSession(lastMessageAt: Date | null, now: Date, idleMinutes: number): boolean {
  return lastMessageAt === null || now.getTime() - lastMessageAt.getTime() >= idleMinutes * 60_000;
}

export function isRestartMode(v: unknown): v is RestartMode {
  return typeof v === "string" && (RESTART_MODES as readonly string[]).includes(v);
}

/** 不能重啟的原因；可以就回 null。進行中或冷卻期間都擋，force 可以蓋過卡住的 graceful */
export function restartBlockReason(last: { mode: string; status: string; requestedAt: Date } | null, mode: RestartMode, now: Date): string | null {
  if (!last) return null;
  const active = last.status === "pending" || last.status === "running";
  if (active && !(mode === "force" && last.mode === "graceful")) return "上一次重啟還在進行";
  if (!active && last.status === "done" && now.getTime() - last.requestedAt.getTime() < RESTART_COOLDOWN_MINUTES * 60_000) return `${RESTART_COOLDOWN_MINUTES} 分鐘內已重啟過`;
  return null;
}

/** 使用者訊息：trim 後非空且不過長；不合法回 null */
export function cleanMessage(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 && s.length <= MAX_MESSAGE_CHARS ? s : null;
}

/** run id／session id 會放進上游網址，只收安全字元 */
export function isSafeId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(v);
}

export interface ChatMessage { id: number; role: "user" | "assistant"; content: string; at: number }

/** GET /api/sessions/{id}/messages → 只留使用者與助手有文字的訊息，由舊到新（上游預設新到舊） */
export function transcriptOf(raw: unknown): ChatMessage[] {
  const data = (raw as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const out: ChatMessage[] = [];
  for (const m of data as Array<Record<string, unknown>>) {
    if ((m["role"] === "user" || m["role"] === "assistant") && typeof m["content"] === "string" && m["content"].trim() && !m["tool_name"]) {
      out.push({ id: Number(m["id"]), role: m["role"], content: m["content"], at: Number(m["timestamp"]) });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}
