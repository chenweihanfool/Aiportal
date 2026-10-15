// 遊記相片（衍生檔）的路徑驗證——純函式，不碰檔案系統（檔案系統那段在 routes/hermesMedia.ts）。
// 衍生檔由 HERMES（kb-pipeline 的 trips-pusher）產生在 <media>/trips/<trip id>/<檔名>.webp，以唯讀掛載進容器。
// 威脅模型：呼叫端（已通過 admin 閘）可以送任意字串；只准讀 trips/<單層資料夾>/<單一檔名>.webp。

export const MEDIA_TRIPS_DIR = "trips";
export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const MAX_SEGMENT = 200;

export type MediaCheck = { ok: true; rel: string } | { ok: false; message: string };

function safeSegment(s: unknown): s is string {
  if (typeof s !== "string" || s.length === 0 || s.length > MAX_SEGMENT) return false;
  if (s.includes("\0") || s.includes("/") || s.includes("\\")) return false;
  if (s.startsWith(".")) return false; // 隱藏檔、「.」「..」
  return true;
}

/** 驗證 /api/media/trips/:tripId/:file。回傳相對於媒體根的路徑 `trips/<tripId>/<file>`。 */
export function checkTripMedia(tripId: unknown, file: unknown): MediaCheck {
  if (!safeSegment(tripId) || !safeSegment(file)) return { ok: false, message: "path 不合法" };
  if (!file.toLowerCase().endsWith(".webp")) return { ok: false, message: "path 不合法" };
  return { ok: true, rel: `${MEDIA_TRIPS_DIR}/${tripId}/${file}` };
}
