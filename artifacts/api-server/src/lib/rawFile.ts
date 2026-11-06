// 原檔下載（GET /api/hermes-raw）的路徑驗證與型別對照——純函式，不碰檔案系統（檔案系統那段在 routes/hermesRaw.ts）。
// 威脅模型：呼叫端（已通過 admin 閘）可以送任意字串當路徑；只准讀根目錄（HERMES_RAW_ROOT，預設 /data/raw）
// 裡、白名單副檔名的檔案。型別分兩種：inline（瀏覽器內預覽）與 attachment（強制下載，Office 等不在瀏覽器執行的格式）。

export const RAW_PREFIX = "人類/";
export const MAX_RAW_BYTES = 50 * 1024 * 1024;

export type RawDisposition = "inline" | "attachment";

const INLINE: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
};

const ATTACHMENT: Record<string, string> = {
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  tif: "image/tiff",
  tiff: "image/tiff",
};

export type RawCheck =
  | { ok: true; rel: string; ext: string; contentType: string; disposition: RawDisposition }
  | { ok: false; status: 400 | 415; message: string };

/** 驗證前端送來的原檔路徑（`人類/` 之下的相對路徑，開頭的 `人類/` 可省略）。回傳去掉前綴後的 rel。 */
export function checkRawPath(raw: unknown): RawCheck {
  const bad = { ok: false as const, status: 400 as const, message: "path 不合法" };
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 400) return bad;
  if (raw.includes("\0") || raw.includes("\\")) return bad;
  if (raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) return bad; // 絕對路徑（POSIX 或 Windows 磁碟）
  const rel = raw.startsWith(RAW_PREFIX) ? raw.slice(RAW_PREFIX.length) : raw;
  if (rel.length === 0) return bad;
  const parts = rel.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return bad;
  if (parts.some((p) => p.startsWith("."))) return bad; // 隱藏檔（.stfolder、.stignore…）一律不給
  const name = parts[parts.length - 1]!;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (ext in INLINE) return { ok: true, rel, ext, contentType: INLINE[ext]!, disposition: "inline" };
  if (ext in ATTACHMENT) return { ok: true, rel, ext, contentType: ATTACHMENT[ext]!, disposition: "attachment" };
  return { ok: false, status: 415, message: "這種檔案類型不提供下載" };
}

/** Content-Disposition（RFC 5987 filename*），非 ASCII 檔名不讓 header 出錯。 */
export function rawContentDisposition(name: string, disposition: RawDisposition): string {
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${disposition}; filename*=UTF-8''${encoded}`;
}

/** 路徑是否落在根目錄之內（兩者都須是 realpath 結果）。 */
export function isInsideRoot(root: string, abs: string, sep: string): boolean {
  return abs === root || abs.startsWith(root.endsWith(sep) ? root : root + sep);
}
