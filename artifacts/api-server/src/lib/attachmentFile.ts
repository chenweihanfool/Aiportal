// 附件預覽的路徑驗證與型別對照——純函式，不碰檔案系統（檔案系統那段在 routes/hermesAttachment.ts）。
// 威脅模型：呼叫端（已通過 admin 閘）可以送任意字串當路徑；只准讀「附件/」資料夾裡、白名單副檔名的檔案。

export const ATTACHMENT_PREFIX = "附件/";
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

// 副檔名 → Content-Type。只收使用者要的基本類型（TXT／PDF／JPG／PNG）加幾個同類（gif／webp／md 當純文字）。
// 不收 html／svg／js：這些會在瀏覽器裡執行，不屬於「預覽附件」。
const TYPES: Record<string, { type: string; kind: "image" | "pdf" | "text" }> = {
  png: { type: "image/png", kind: "image" },
  jpg: { type: "image/jpeg", kind: "image" },
  jpeg: { type: "image/jpeg", kind: "image" },
  gif: { type: "image/gif", kind: "image" },
  webp: { type: "image/webp", kind: "image" },
  pdf: { type: "application/pdf", kind: "pdf" },
  txt: { type: "text/plain; charset=utf-8", kind: "text" },
  md: { type: "text/plain; charset=utf-8", kind: "text" },
};

export type AttachmentCheck =
  | { ok: true; inner: string; ext: string; contentType: string; kind: "image" | "pdf" | "text" }
  | { ok: false; status: 400 | 415; message: string };

/** 驗證前端送來的附件路徑（形如 `附件/子資料夾/檔名.png`）。回傳去掉「附件/」前綴後的相對路徑 inner。 */
export function checkAttachmentPath(raw: unknown): AttachmentCheck {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 400) return { ok: false, status: 400, message: "path 不合法" };
  if (raw.includes("\0") || raw.includes("\\")) return { ok: false, status: 400, message: "path 不合法" };
  if (!raw.startsWith(ATTACHMENT_PREFIX)) return { ok: false, status: 400, message: "只能讀取附件資料夾" };
  const inner = raw.slice(ATTACHMENT_PREFIX.length);
  const parts = inner.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return { ok: false, status: 400, message: "path 不合法" };
  if (parts.some((p) => p.startsWith("."))) return { ok: false, status: 400, message: "path 不合法" }; // 隱藏檔（.stfolder、.stignore…）一律不給
  const name = parts[parts.length - 1]!;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  const t = TYPES[ext];
  if (!t) return { ok: false, status: 415, message: "這種檔案類型不提供預覽" };
  return { ok: true, inner, ext, contentType: t.type, kind: t.kind };
}

/** Content-Disposition 用的 filename*（RFC 5987），避免非 ASCII 檔名讓 header 出錯。 */
export function contentDisposition(name: string): string {
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `inline; filename*=UTF-8''${encoded}`;
}

/** 檔名可能被不同系統存成 NFC 或 NFD——依序嘗試的候選（去重）。 */
export function nameCandidates(inner: string): string[] {
  return Array.from(new Set([inner, inner.normalize("NFC"), inner.normalize("NFD")]));
}
