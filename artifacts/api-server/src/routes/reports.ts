import { Router, type Request, type Response } from "express";
import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { isAuthorized } from "../lib/adminSession";
import { isInsideRoot } from "../lib/rawFile";
import { nasGuard } from "./hermesRaw";

// 報告庫：家中 NAS 的 Vault/報告/（唯讀），由使用者本機腳本產生 index.html、reports.json 與年度資料夾。
// 入口網只讀不寫。目錄常數沿用 hermesRaw 的 NAS 根目錄推導：REPORTS_ROOT，沒設時是 HERMES_RAW_NAS_ROOT 的上一層 + 報告。
// 權限同其他私領域 API：x-admin-password。
const router = Router();

const NAS_OFFLINE_MESSAGE = "家中 NAS 暫時連不到（VPN 可能斷線）";
const NOT_CREATED_MESSAGE = "報告庫尚未建立";
const BAD_CATALOG_MESSAGE = "報告庫目錄格式不正確";
const MAX_REPORT_BYTES = 20 * 1024 * 1024;
const LATEST_LIMIT = 5;

type EnvLike = { readonly [key: string]: string | undefined };

/** 報告庫根目錄：REPORTS_ROOT 優先；否則 HERMES_RAW_NAS_ROOT（預設 /data/raw-nas）的上一層再加「報告」。 */
export function reportsRoot(env: EnvLike = process.env): string {
  const override = env["REPORTS_ROOT"];
  if (override) return override;
  const nasRoot = env["HERMES_RAW_NAS_ROOT"] || "/data/raw-nas";
  return path.join(path.dirname(nasRoot), "報告");
}

function timeoutMs(): number {
  const n = Number(process.env["RAW_NAS_TIMEOUT_MS"]);
  return Number.isFinite(n) && n > 0 ? n : 8000;
}

class NasTimeoutError extends Error {}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
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

const isMissing = (err: unknown): boolean => {
  const code = fsErrorCode(err);
  return code === "ENOENT" || code === "ENOTDIR";
};

/** 在原始 promise 的 finally 遞減 in-flight（卡住的呼叫仍算在內），外層包逾時。 */
async function guardedTimeout<T>(fn: () => Promise<T>): Promise<T> {
  nasGuard.begin();
  const p = fn().finally(() => nasGuard.end());
  return withTimeout(p, timeoutMs());
}

/** 斷路器冷卻中／忙碌：不碰 NAS 直接回；回傳 true 表示已回應。 */
function blockedResponse(res: Response): boolean {
  const blocked = nasGuard.blockReason();
  if (blocked === "busy") {
    res.status(429).json({ message: "家中 NAS 忙碌中，請幾秒後再試" });
    return true;
  }
  if (blocked) {
    res.status(504).json({ message: NAS_OFFLINE_MESSAGE });
    return true;
  }
  return false;
}

/** 逾時或連線類錯誤：開斷路器並回 504。 */
function nasDown(res: Response): void {
  nasGuard.markDown();
  res.status(504).json({ message: NAS_OFFLINE_MESSAGE });
}

interface CatalogItem {
  path: string;
  title: string;
  date: string;
  project: string;
  tags: string[];
  status: string;
  summary: string;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function toItem(raw: unknown): CatalogItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["path"] !== "string" || typeof r["title"] !== "string") return null;
  const tags = Array.isArray(r["tags"]) ? r["tags"].filter((t): t is string => typeof t === "string") : [];
  return {
    path: r["path"], title: r["title"], date: str(r["date"]), project: str(r["project"]),
    tags, status: str(r["status"]), summary: str(r["summary"]),
  };
}

router.get("/reports/catalog", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) {
    return res.status(403).json({ message: "需要解鎖私領域才能查看" });
  }
  if (blockedResponse(res)) return;

  let root: string;
  try {
    const base = reportsRoot();
    root = await guardedTimeout(() => realpath(base));
  } catch (err) {
    if (isMissing(err)) return res.json({ available: false, reason: NOT_CREATED_MESSAGE });
    return nasDown(res);
  }

  let text: string;
  try {
    const file = path.join(root, "reports.json");
    text = await guardedTimeout(() => readFile(file, "utf8"));
  } catch (err) {
    if (isMissing(err)) return res.json({ available: false, reason: NOT_CREATED_MESSAGE });
    return nasDown(res);
  }

  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^﻿/, "")); // Windows 工具常寫出帶 BOM 的 UTF-8
  } catch {
    return res.json({ available: false, reason: BAD_CATALOG_MESSAGE });
  }
  if (!json || typeof json !== "object" || Array.isArray(json) || !Array.isArray((json as { reports?: unknown }).reports)) {
    return res.json({ available: false, reason: BAD_CATALOG_MESSAGE });
  }
  const reports = (json as { reports: unknown[]; generatedAt?: unknown });
  const latest = reports.reports.map(toItem).filter((x): x is CatalogItem => x !== null).slice(0, LATEST_LIMIT);
  return res.json({
    available: true,
    count: reports.reports.length,
    generatedAt: typeof reports.generatedAt === "string" ? reports.generatedAt : "",
    latest,
  });
});

/** 路徑段驗證：不可為空、`.`、`..`、以 `.` 開頭，不可含 `\` 或 NUL，總長 ≤400。 */
function pathSegments(raw: unknown): { ok: true; segs: string[] } | { ok: false } {
  const segs = Array.isArray(raw)
    ? raw.map((s) => String(s))
    : typeof raw === "string" ? raw.split("/") : [];
  if (segs.length === 0) return { ok: false };
  if (segs.join("/").length > 400) return { ok: false };
  for (const s of segs) {
    if (s === "" || s === "." || s === ".." || s.startsWith(".") || s.includes("\\") || s.includes("\0")) return { ok: false };
  }
  return { ok: true, segs };
}

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function sendReport(res: Response, abs: string, size: number): void {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Length", String(size));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-cache");
  res.setHeader("Referrer-Policy", "no-referrer");
  // 沙箱、不能有 allow-same-origin：報告內的腳本拿不到入口網的 cookie、不能以使用者身分呼叫 API。
  res.setHeader(
    "Content-Security-Policy",
    "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-forms",
  );
  const stream = createReadStream(abs);
  stream.on("error", () => { if (!res.headersSent) res.status(500).end(); else res.destroy(); });
  stream.pipe(res);
}

router.get("/reports/file/*path", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) {
    return res.status(403).json({ message: "需要解鎖私領域才能查看" });
  }
  const check = pathSegments((req.params as Record<string, unknown>)["path"]);
  if (!check.ok) return res.status(400).json({ message: "path 不合法" });
  const { segs } = check;
  const ext = extOf(segs[segs.length - 1]!);
  if (ext !== "html" && ext !== "htm") return res.status(415).json({ message: "只提供 HTML 報告" });
  if (blockedResponse(res)) return;

  let root: string;
  try {
    root = await guardedTimeout(() => realpath(reportsRoot()));
  } catch (err) {
    if (isMissing(err)) return res.status(404).json({ message: "找不到這份報告" });
    return nasDown(res);
  }

  let abs: string;
  try {
    abs = await guardedTimeout(() => realpath(path.join(root, ...segs)));
  } catch (err) {
    if (isMissing(err)) return res.status(404).json({ message: "找不到這份報告" });
    return nasDown(res);
  }
  if (!isInsideRoot(root, abs, path.sep)) return res.status(400).json({ message: "path 不合法" });

  let size: number;
  try {
    const st = await guardedTimeout(() => stat(abs));
    if (!st.isFile()) return res.status(404).json({ message: "找不到這份報告" });
    if (st.size > MAX_REPORT_BYTES) {
      return res.status(413).json({ message: `報告過大（${Math.round(st.size / 1048576)} MB），上限 20 MB` });
    }
    size = st.size;
  } catch (err) {
    if (isMissing(err)) return res.status(404).json({ message: "找不到這份報告" });
    return nasDown(res);
  }

  return sendReport(res, abs, size);
});

export default router;
