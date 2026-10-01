import { Router, type Request, type Response } from "express";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { isAuthorized } from "../lib/adminSession";
import { checkAttachmentPath, contentDisposition, MAX_ATTACHMENT_BYTES, nameCandidates } from "../lib/attachmentFile";

const router = Router();

// 附件預覽：事件內容裡的 `附件/xxx.png`（日記附帶的截圖等）按需取回。
// 檔案來源＝vault 的「附件/」資料夾，以唯讀掛載進容器（HERMES_ATTACHMENT_ROOT，預設 /data/attachments）。
// 權限同其他私領域 API：x-admin-password。只讀白名單副檔名、檔案必須真的在掛載根之內（realpath 擋 symlink 逃逸）。
function attachmentRoot(): string {
  return process.env["HERMES_ATTACHMENT_ROOT"] || "/data/attachments";
}

router.get("/hermes-attachment", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) {
    return res.status(403).json({ message: "需要解鎖私領域才能查看" });
  }
  const check = checkAttachmentPath(req.query["path"]);
  if (!check.ok) return res.status(check.status).json({ message: check.message });

  let root: string;
  try {
    root = await realpath(attachmentRoot());
  } catch {
    return res.status(503).json({ message: "附件資料夾尚未掛載" });
  }

  for (const cand of nameCandidates(check.inner)) {
    let abs: string;
    try {
      abs = await realpath(path.join(root, cand));
    } catch {
      continue; // 這個正規化形式不存在，試下一個
    }
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      return res.status(400).json({ message: "path 不合法" }); // symlink 指到掛載根之外
    }
    const st = await stat(abs);
    if (!st.isFile()) continue;
    if (st.size > MAX_ATTACHMENT_BYTES) {
      return res.status(413).json({ message: `檔案過大（${Math.round(st.size / 1048576)} MB），不提供預覽` });
    }
    res.setHeader("Content-Type", check.contentType);
    res.setHeader("Content-Length", String(st.size));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Content-Disposition", contentDisposition(path.basename(cand)));
    const stream = createReadStream(abs);
    stream.on("error", () => { if (!res.headersSent) res.status(500).end(); else res.destroy(); });
    return stream.pipe(res);
  }
  return res.status(404).json({ message: "找不到這個附件" });
});

export default router;
