import { Router, type Request, type Response } from "express";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { isAuthorized } from "../lib/adminSession";
import { nameCandidates } from "../lib/attachmentFile";
import {
  checkRawPath,
  createNasGuard,
  isInsideRoot,
  MAX_RAW_BYTES,
  rawContentDisposition,
  stripPullPrefix,
} from "../lib/rawFile";

const router = Router();

// 原檔：知識頁來源的原始檔（PDF、圖片可預覽，Office 檔下載）。
// 檔案來源＝vault 的「人類/」資料夾，以唯讀掛載進容器（HERMES_RAW_ROOT，預設 /data/raw）。
// 找不到時再到家中 NAS（HERMES_RAW_NAS_ROOT，預設 /data/raw-nas；主機以 cifs 唯讀掛載、經 VPN）。
// 權限同其他私領域 API：x-admin-password。只讀白名單副檔名、檔案必須真的在掛載根之內（realpath 擋 symlink 逃逸）。
function rawRoot(): string {
  return process.env["HERMES_RAW_ROOT"] || "/data/raw";
}

function rawNasRoot(): string {
  return process.env["HERMES_RAW_NAS_ROOT"] || "/data/raw-nas";
}

// VPN 斷線時 NAS 的 realpath／stat 可能卡住好幾秒，整段包一層逾時，避免請求一直掛著。
function rawNasTimeoutMs(): number {
  return positiveNumber(process.env["RAW_NAS_TIMEOUT_MS"], 8000);
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const NAS_OFFLINE_MESSAGE = "家中 NAS 暫時連不到（VPN 可能斷線）";

// 斷路器：NAS 一旦逾時或回連線類錯誤，冷卻期內直接回 504、不碰 NAS（見 createNasGuard）。
export const nasGuard = createNasGuard({
  cooldownMs: () => positiveNumber(process.env["RAW_NAS_COOLDOWN_MS"], 60_000),
  maxInflight: () => positiveNumber(process.env["RAW_NAS_MAX_INFLIGHT"], 2),
});

class NasTimeoutError extends Error {}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // 一定要 await，讓 finally 在 race 有結果之後才執行，否則 timer 會馬上被清掉。
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new NasTimeoutError("nas timeout")), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function fsErrorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

type NasLookup =
  | { ok: true; abs: string; size: number; name: string }
  | { ok: false; kind: "missing" | "escape" }
  | { ok: false; kind: "too-large"; size: number };

/** 在 NAS 根目錄找檔：同一份檔在 NAS 上是去掉 `_pulled-from-home/`、`_staging-from-home/` 之後的相對路徑。 */
async function lookupNas(rel: string): Promise<NasLookup> {
  const root = await realpath(rawNasRoot());
  const nasRel = stripPullPrefix(rel);
  if (nasRel.length === 0) return { ok: false, kind: "missing" };
  for (const cand of nameCandidates(nasRel)) {
    let abs: string;
    try {
      abs = await realpath(path.join(root, cand));
    } catch (err) {
      const code = fsErrorCode(err);
      if (code === "ENOENT" || code === "ENOTDIR") continue; // 這個正規化形式不存在，試下一個
      throw err; // EIO、EHOSTDOWN… 交給呼叫端回 504
    }
    if (!isInsideRoot(root, abs, path.sep)) return { ok: false, kind: "escape" }; // junction／symlink 指到 NAS 根之外
    const st = await stat(abs);
    if (!st.isFile()) continue;
    if (st.size > MAX_RAW_BYTES) return { ok: false, kind: "too-large", size: st.size };
    return { ok: true, abs, size: st.size, name: path.basename(cand) };
  }
  return { ok: false, kind: "missing" };
}

function sendRaw(res: Response, abs: string, size: number, name: string, contentType: string, disposition: "inline" | "attachment") {
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", String(size));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Content-Disposition", rawContentDisposition(name, disposition));
  const stream = createReadStream(abs);
  stream.on("error", () => { if (!res.headersSent) res.status(500).end(); else res.destroy(); });
  return stream.pipe(res);
}

router.get("/hermes-raw", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) {
    return res.status(403).json({ message: "需要解鎖私領域才能查看" });
  }
  const check = checkRawPath(req.query["path"]);
  if (!check.ok) return res.status(check.status).json({ message: check.message });

  let root: string;
  try {
    root = await realpath(rawRoot());
  } catch {
    return res.status(503).json({ message: "原檔資料夾尚未掛載" });
  }

  for (const cand of nameCandidates(check.rel)) {
    let abs: string;
    try {
      abs = await realpath(path.join(root, cand));
    } catch {
      continue; // 這個正規化形式不存在，試下一個
    }
    if (!isInsideRoot(root, abs, path.sep)) {
      return res.status(400).json({ message: "path 不合法" }); // symlink 指到掛載根之外
    }
    const st = await stat(abs);
    if (!st.isFile()) continue;
    if (st.size > MAX_RAW_BYTES) {
      return res.status(413).json({ message: `檔案過大（${Math.round(st.size / 1048576)} MB），上限 50 MB` });
    }
    return sendRaw(res, abs, st.size, path.basename(cand), check.contentType, check.disposition);
  }

  // VPS 上沒有 → 找家中 NAS。NAS 根目錄不存在（沒掛）時與以前完全相同：回 404。
  // 斷路器冷卻中，或已有上限數量的底層 NAS 呼叫還沒真正結束：不碰 NAS，直接回 504。
  const blocked = nasGuard.blockReason();
  if (blocked === "busy") {
    // NAS 不一定斷線，只是同時進行的讀取已達上限：回 429，不要用「VPN 斷線」誤導（PM 修正）
    return res.status(429).json({ message: "家中 NAS 忙碌中，請幾秒後再試" });
  }
  if (blocked) {
    return res.status(504).json({ message: NAS_OFFLINE_MESSAGE });
  }

  let nas: NasLookup;
  try {
    nasGuard.begin();
    // 在原始 promise 的 finally 遞減（不是逾時 race 的 finally）：卡住的呼叫仍算在 in-flight。
    const lookup = lookupNas(check.rel).finally(() => nasGuard.end());
    nas = await withTimeout(lookup, rawNasTimeoutMs());
  } catch (err) {
    if (err instanceof NasTimeoutError) {
      nasGuard.markDown();
      return res.status(504).json({ message: NAS_OFFLINE_MESSAGE });
    }
    const code = fsErrorCode(err);
    if (code === "ENOENT" || code === "ENOTDIR") {
      nas = { ok: false, kind: "missing" }; // NAS 根目錄沒掛：照舊找不到
    } else {
      nasGuard.markDown(); // EIO、EHOSTDOWN…：進入冷卻，後續請求不再碰 NAS
      return res.status(504).json({ message: NAS_OFFLINE_MESSAGE });
    }
  }

  if (nas.ok) return sendRaw(res, nas.abs, nas.size, nas.name, check.contentType, check.disposition);
  if (nas.kind === "escape") return res.status(400).json({ message: "path 不合法" });
  if (nas.kind === "too-large") {
    return res.status(413).json({ message: `檔案過大（${Math.round(nas.size / 1048576)} MB），上限 50 MB` });
  }
  return res.status(404).json({ message: "找不到這個原檔" });
});

export default router;
