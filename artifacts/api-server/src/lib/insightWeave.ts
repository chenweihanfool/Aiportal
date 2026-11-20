// 心得編織層（insight-weave）使用者判斷的驗證（純函式，路由與測試共用）。
// 只新增：確認（ok）／否決（no）／撤回（undo）都是一筆新紀錄，不修改、不刪除既有資料。
// after 的規則與知識頁更正 API 相同，直接沿用（缺省 0、只接受非負整數字串、上限 int4）。
export { parseAfter } from "./knowledgeCorrections";

export const WEAVE_VERDICTS = ["ok", "no", "undo"] as const;
export type WeaveVerdict = (typeof WEAVE_VERDICTS)[number];

export interface ParsedVerdictBody {
  itemId: string;
  verdict: WeaveVerdict;
}

/** 編織層項目 id：L（燈塔）／B（橋）／T（張力）／K（知識庫交織）加 8 位小寫十六進位。 */
const ITEM_ID = /^[LBTK]-[0-9a-f]{8}$/;
const ALLOWED_KEYS = ["itemId", "verdict"] as const;

/**
 * POST body 驗證：回正規化物件，或回錯誤訊息字串（400）。
 * 本文只接受 itemId、verdict 兩個鍵；出現其他鍵整筆擋下。
 */
export function parseVerdictBody(body: unknown): ParsedVerdictBody | string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "body 必須是物件";
  const b = body as Record<string, unknown>;
  const extra = Object.keys(b).find((k) => !(ALLOWED_KEYS as readonly string[]).includes(k));
  if (extra !== undefined) return `不接受的欄位：${extra}`;

  const itemId = b["itemId"];
  if (typeof itemId !== "string" || !ITEM_ID.test(itemId)) return "itemId 必須符合 L-、B-、T- 或 K- 加 8 位小寫十六進位的格式";

  const verdict = b["verdict"];
  if (typeof verdict !== "string" || !(WEAVE_VERDICTS as readonly string[]).includes(verdict)) return "verdict 必須是 ok、no 或 undo";

  return { itemId, verdict: verdict as WeaveVerdict };
}
