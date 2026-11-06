// 原文全文搜尋（GET /api/hermes-doc-search）的純邏輯：參數驗證、LIKE 跳脫、摘錄切法。
// 不碰 DB；routes/hermesDoc.ts 只負責撈資料與套 SQL（參數一律綁定）。

export const SEARCH_MAX_Q = 50;
export const SEARCH_DEFAULT_LIMIT = 30;
export const SEARCH_MAX_LIMIT = 50;
const CONTEXT_CHARS = 60;
const TITLE_ONLY_HEAD_CHARS = 120;

export type SearchParams = { ok: true; q: string; limit: number } | { ok: false; message: string };

/** q：去頭尾空白後 1～50 字；limit：整數 1～50，未給＝30。不合法回 ok=false（路由回 400）。 */
export function validateSearchParams(qRaw: unknown, limitRaw: unknown): SearchParams {
  if (typeof qRaw !== "string") return { ok: false, message: "q 必填" };
  const q = qRaw.trim();
  if (q.length === 0) return { ok: false, message: "q 不可為空白" };
  if (q.length > SEARCH_MAX_Q) return { ok: false, message: `q 最多 ${SEARCH_MAX_Q} 字` };
  let limit = SEARCH_DEFAULT_LIMIT;
  if (limitRaw !== undefined) {
    if (typeof limitRaw !== "string" || !/^\d+$/.test(limitRaw)) return { ok: false, message: "limit 必須是整數" };
    limit = Number(limitRaw);
    if (limit < 1 || limit > SEARCH_MAX_LIMIT) return { ok: false, message: `limit 必須在 1～${SEARCH_MAX_LIMIT} 之間` };
  }
  return { ok: true, q, limit };
}

/** ILIKE 的萬用字元跳脫：\ % _ 前面加反斜線（PostgreSQL LIKE 預設逃逸字元就是反斜線）。 */
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface SnippetResult {
  snippet: string;
  /** 命中在 bodyMd 裡的字元位置；只有標題命中時為 null。 */
  hitAt: number | null;
}

/** 摘錄：bodyMd 第一個命中處（不分大小寫）前後各 60 字；只有標題命中時取 bodyMd 前 120 字。 */
export function makeSnippet(bodyMd: string, q: string): SnippetResult {
  const needle = q.toLowerCase();
  const idx = needle.length > 0 ? bodyMd.toLowerCase().indexOf(needle) : -1;
  if (idx < 0) {
    const head = bodyMd.slice(0, TITLE_ONLY_HEAD_CHARS);
    return { snippet: head + (bodyMd.length > TITLE_ONLY_HEAD_CHARS ? "…" : ""), hitAt: null };
  }
  const start = Math.max(0, idx - CONTEXT_CHARS);
  const end = Math.min(bodyMd.length, idx + needle.length + CONTEXT_CHARS);
  const body = bodyMd.slice(start, end);
  return {
    snippet: (start > 0 ? "…" : "") + body + (end < bodyMd.length ? "…" : ""),
    hitAt: idx,
  };
}
