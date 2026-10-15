import { Router, type Request, type Response } from "express";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { isAuthorized } from "../lib/adminSession";
import { checkPlaceMedia, checkTripMedia, MAX_MEDIA_BYTES, type MediaCheck } from "../lib/mediaFile";

const router = Router();

// 遊記相片：HERMES 產生的縮圖／檢視圖（WebP），掛成唯讀資料夾（HERMES_MEDIA_ROOT，預設 /data/media；主機 .env 的 MEDIA_DIR）。
// 權限同其他私領域 API：x-admin-password（Google 登入者由 googleSessionBridge 換成同一個憑證）；相片是私人資料，沒有公開網址。
// 只讀 <根>/trips/<趟次 id>/<檔名>.webp；檔案必須真的在掛載根之內（realpath 擋 symlink 逃逸）。api-server 不寫、不轉檔。
function mediaRoot(): string {
  return process.env["HERMES_MEDIA_ROOT"] || "/data/media";
}

async function serveMedia(req: Request, res: Response, check: MediaCheck) {
  if (!isAuthorized(req.headers["x-admin-password"])) {
    return res.status(403).json({ message: "需要解鎖私領域才能查看" });
  }
  if (!check.ok) return res.status(400).json({ message: check.message });

  let root: string;
  try {
    root = await realpath(mediaRoot());
  } catch {
    return res.status(503).json({ message: "相片資料夾尚未掛載" });
  }
  let abs: string;
  try {
    abs = await realpath(path.join(root, check.rel));
  } catch {
    return res.status(404).json({ message: "找不到這張相片" });
  }
  if (!abs.startsWith(root + path.sep)) return res.status(400).json({ message: "path 不合法" }); // symlink 指到掛載根之外
  const st = await stat(abs);
  if (!st.isFile()) return res.status(404).json({ message: "找不到這張相片" });
  if (st.size > MAX_MEDIA_BYTES) return res.status(413).json({ message: "檔案過大" });

  // 衍生檔只在原檔變動時重寫；ETag 讓瀏覽器重驗證時不必重傳
  const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.headers["if-none-match"] === etag) return res.status(304).end();
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("Content-Length", String(st.size));
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  const stream = createReadStream(abs);
  stream.on("error", () => { if (!res.headersSent) res.status(500).end(); else res.destroy(); });
  return stream.pipe(res);
}

router.get("/media/trips/:tripId/:file", (req: Request, res: Response) =>
  serveMedia(req, res, checkTripMedia(req.params["tripId"], req.params["file"])));

// 地點相片（方案 1）：<根>/places/<地點 id>/<檔名>.webp，權限與規則同遊記相片
router.get("/media/places/:placeId/:file", (req: Request, res: Response) =>
  serveMedia(req, res, checkPlaceMedia(req.params["placeId"], req.params["file"])));

export default router;
