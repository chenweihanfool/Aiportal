// 知識頁更正的驗證（純函式，路由與測試共用）。
export const CORRECTION_KINDS = ["wrong", "fix", "add", "undo"] as const;
export type CorrectionKind = (typeof CORRECTION_KINDS)[number];

export const CORRECTION_TEXT_MAX = 500;
export const CORRECTION_SECTION_MAX = 40;

export interface ParsedCorrectionBody {
  topicId: string;
  claimId: string | null;
  kind: CorrectionKind;
  section: string | null;
  text: string | null;
}

const TOPIC_ID = /^T[0-9]{8}-[0-9]{2,4}$/;
const CLAIM_ID = /^c[0-9]{3,5}$/;
const ALLOWED_KEYS = ["topicId", "claimId", "kind", "section", "text"] as const;

/** 只接受這五個鍵；出現其他鍵就整筆擋下。 */
function checkKeys(b: Record<string, unknown>): string | null {
  const extra = Object.keys(b).find((k) => !(ALLOWED_KEYS as readonly string[]).includes(k));
  return extra === undefined ? null : `不接受的欄位：${extra}`;
}

/**
 * POST body 驗證：回正規化物件，或回錯誤訊息字串（400）。
 * wrong／undo 不帶 text；fix／add 必帶 text；section 只有 add 可帶。
 */
export function parseCorrectionBody(body: unknown): ParsedCorrectionBody | string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "body 必須是物件";
  const b = body as Record<string, unknown>;
  const extra = checkKeys(b);
  if (extra) return extra;

  const topicId = b["topicId"];
  if (typeof topicId !== "string" || !TOPIC_ID.test(topicId)) return "topicId 必須符合 T12345678-01 的格式";

  const kind = b["kind"];
  if (typeof kind !== "string" || !(CORRECTION_KINDS as readonly string[]).includes(kind)) return "kind 必須是 wrong、fix、add 或 undo";

  const rawClaimId = b["claimId"];
  let claimId: string | null = null;
  if (rawClaimId !== undefined && rawClaimId !== null) {
    if (typeof rawClaimId !== "string" || !CLAIM_ID.test(rawClaimId)) return "claimId 必須符合 c123 的格式";
    claimId = rawClaimId;
  }
  if (kind !== "add" && claimId === null) return `${kind} 需要 claimId`;

  const rawText = b["text"];
  let text: string | null = null;
  if (rawText !== undefined && rawText !== null) {
    if (typeof rawText !== "string") return "text 必須是字串";
    const trimmed = rawText.trim();
    if (trimmed !== "") text = trimmed;
  }
  if (kind === "fix" || kind === "add") {
    if (text === null) return `${kind} 需要 text`;
    if (text.length > CORRECTION_TEXT_MAX) return `text 不可超過 ${CORRECTION_TEXT_MAX} 字`;
    if (/[\r\n]/.test(text)) return "text 不可含換行";
  } else if (text !== null) {
    return `${kind} 不可帶 text`;
  }

  const rawSection = b["section"];
  let section: string | null = null;
  if (rawSection !== undefined && rawSection !== null) {
    if (kind !== "add") return `${kind} 不可帶 section`;
    if (typeof rawSection !== "string") return "section 必須是字串";
    const trimmed = rawSection.trim();
    if (trimmed.length < 1 || trimmed.length > CORRECTION_SECTION_MAX) return `section 必須是 1–${CORRECTION_SECTION_MAX} 字`;
    section = trimmed;
  }

  return { topicId, claimId, kind: kind as CorrectionKind, section, text };
}

/**
 * GET 的 after 參數：缺省為 0；只接受非負整數字串，其餘回錯誤訊息字串（400）。
 */
export function parseAfter(value: unknown): number | string {
  if (value === undefined) return 0;
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) return "after 必須是非負整數";
  const after = Number(value);
  // id 是 serial（int4）；超過上限交給資料庫比較會報 out of range，在這裡先擋成 400。
  if (!Number.isSafeInteger(after) || after > 2147483647) return "after 必須是非負整數";
  return after;
}
