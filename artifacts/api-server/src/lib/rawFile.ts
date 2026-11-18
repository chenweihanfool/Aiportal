// 原檔下載（GET /api/hermes-raw、GET /api/templates/:id/file）的共用保護：
// 路徑驗證與型別對照是純函式；NAS 逾時、斷路器與送出檔案是兩條路由共用的實作。
// 威脅模型：呼叫端（已通過 admin 閘）可以送任意字串當路徑；只准讀指定根目錄裡、白名單副檔名的檔案。
// 型別分兩種：inline（瀏覽器內預覽）與 attachment（強制下載，Office 等不在瀏覽器執行的格式）。
import { createReadStream } from "node:fs";
import type { Response } from "express";

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

// 家中 NAS 的掛載點對應的是「去掉這兩個前綴之後」的相對路徑；VPS 的 人類/ 底下可能多包一層。
const PULL_PREFIXES = ["_pulled-from-home/", "_staging-from-home/"];

/** 反覆去掉開頭的 `_pulled-from-home/`、`_staging-from-home/`，得到 NAS 上的相對路徑。 */
export function stripPullPrefix(rel: string): string {
  let out = rel;
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const prefix of PULL_PREFIXES) {
      if (out.startsWith(prefix)) {
        out = out.slice(prefix.length);
        stripped = true;
      }
    }
  }
  return out;
}

/**
 * 家中 NAS 的斷路器與同時上限（狀態由 routes/hermesRaw.ts 建立單例；這裡只放可測試的邏輯）。
 * VPN 斷線時 realpath／stat 會卡住並佔用 libuv 的 fs threadpool，拖垮整個 api-server；
 * 所以一段時間內不再嘗試（冷卻），而且同時未真正結束的底層呼叫數有上限。
 */
export type NasBlockReason = "cooldown" | "busy";

export interface NasGuard {
  /** 現在能不能查 NAS；不行時回原因（冷卻中優先於忙碌）。 */
  blockReason(nowMs?: number): NasBlockReason | null;
  /** 底層 NAS fs 呼叫開始。 */
  begin(): void;
  /** 底層 NAS fs 呼叫真正結束（要掛在原始 promise 的 finally，不是逾時 race 的 finally）。 */
  end(): void;
  /** 逾時或連線類錯誤：冷卻到 now + cooldownMs。 */
  markDown(nowMs?: number): void;
  /** 清空狀態（測試用）。 */
  reset(): void;
}

export interface NasGuardOptions {
  /** 時鐘（測試可注入）；預設每次呼叫 Date.now()。 */
  now?: () => number;
  cooldownMs?: () => number;
  maxInflight?: () => number;
}

export const NAS_OFFLINE_MESSAGE = "家中 NAS 暫時連不到（VPN 可能斷線）";

export function positiveNumber(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** NAS 的 realpath／stat 逾時（RAW_NAS_TIMEOUT_MS，預設 8000 毫秒）。 */
export function rawNasTimeoutMs(): number {
  return positiveNumber(process.env["RAW_NAS_TIMEOUT_MS"], 8000);
}

export class NasTimeoutError extends Error {}

/** 整段包一層逾時，避免 VPN 斷線時請求一直掛著。 */
export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
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

export function fsErrorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * 家中 NAS 的斷路器單例（hermes-raw 與範本下載共用同一個 NAS）：
 * 一旦逾時或回連線類錯誤，冷卻期內直接回 504、不碰 NAS。
 */
export const nasGuard = createNasGuard({
  cooldownMs: () => positiveNumber(process.env["RAW_NAS_COOLDOWN_MS"], 60_000),
  maxInflight: () => positiveNumber(process.env["RAW_NAS_MAX_INFLIGHT"], 2),
});

/** 送出檔案（stream）：最常見的 header 組合，原檔與範本下載共用。 */
export function sendRaw(
  res: Response, abs: string, size: number, name: string, contentType: string, disposition: RawDisposition,
): Response {
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

export function createNasGuard(opts: NasGuardOptions = {}): NasGuard {
  const now = opts.now ?? (() => Date.now());
  const cooldownMs = opts.cooldownMs ?? (() => 60_000);
  const maxInflight = opts.maxInflight ?? (() => 2);
  let downUntil = 0;
  let inflight = 0;
  return {
    blockReason(nowMs = now()) {
      if (nowMs < downUntil) return "cooldown";
      if (inflight >= maxInflight()) return "busy";
      return null;
    },
    begin() {
      inflight += 1;
    },
    end() {
      if (inflight > 0) inflight -= 1;
    },
    markDown(nowMs = now()) {
      downUntil = nowMs + cooldownMs();
    },
    reset() {
      downUntil = 0;
      inflight = 0;
    },
  };
}
