import { Router, type Request, type Response } from "express";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { db, feedSnapshotTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isAuthorized } from "../lib/adminSession";
import { logger } from "../lib/logger";
import {
  fsErrorCode, isInsideRoot, NAS_OFFLINE_MESSAGE, nasGuard, rawNasTimeoutMs, sendRaw, withTimeout,
} from "../lib/rawFile";
import {
  findTemplate, parseTemplateSearchParams, searchTemplates, templateVersions, TEMPLATE_ID_RE, type TemplateRecord,
} from "../lib/templateSearch";

// 公文範本（3.9.0）：搜尋、版本、下載。索引來自 templates feed 快照；檔案在家中 NAS 的唯讀掛載，
// 由 TEMPLATE_ROOTS 把代號對應到容器內路徑。保護（realpath 擋 symlink 逃逸、NAS 逾時與斷路器）
// 與 /api/hermes-raw 共用 lib/rawFile.ts。

const FORBIDDEN = { message: "需要解鎖私領域才能查看" };

const DEFAULT_ROOTS: Readonly<Record<string, string>> = {
  official: "/data/raw-nas/home-nas/cwh/SynologyDrive/通霄資料/參考資料/公文範本整合",
  "office-pc": "/data/raw-nas/home-nas/cwh/SynologyDrive/OneDrive/OfficePC/公文範本",
  "vault-attach": "/data/attachments",
};

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  json: "application/json",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  odt: "application/vnd.oasis.opendocument.text",
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** TEMPLATE_ROOTS＝`official=/a;office-pc=/b`；沒設定（或解析後為空）就用實機預設值。 */
export function parseTemplateRoots(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof raw === "string") {
    for (const part of raw.split(";")) {
      const s = part.trim();
      if (!s) continue;
      const i = s.indexOf("=");
      if (i <= 0) continue;
      const key = s.slice(0, i).trim();
      const value = s.slice(i + 1).trim();
      if (key && value) out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : { ...DEFAULT_ROOTS };
}

const NOT_MOUNTED = { message: "範本資料夾尚未掛載" };

/** rel 檢查：不能有反斜線／NUL、不能是絕對路徑、不能有 `.`／`..` 段。 */
function safeRel(rel: string): boolean {
  if (rel.length === 0 || rel.includes("\0") || rel.includes("\\")) return false;
  if (rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) return false;
  return rel.split("/").every((p) => p.length > 0 && p !== "." && p !== "..");
}

type Lookup =
  | { ok: true; abs: string; size: number }
  | { ok: false; kind: "no-root" | "missing" | "escape" };

async function lookup(rootDir: string, rel: string): Promise<Lookup> {
  let root: string;
  try {
    root = await realpath(rootDir);
  } catch (err) {
    const code = fsErrorCode(err);
    if (code === "ENOENT" || code === "ENOTDIR") return { ok: false, kind: "no-root" };
    throw err;
  }
  let abs: string;
  try {
    abs = await realpath(path.join(root, rel));
  } catch (err) {
    const code = fsErrorCode(err);
    if (code === "ENOENT" || code === "ENOTDIR") return { ok: false, kind: "missing" };
    throw err;
  }
  if (!isInsideRoot(root, abs, path.sep)) return { ok: false, kind: "escape" };
  const st = await stat(abs);
  if (!st.isFile()) return { ok: false, kind: "missing" };
  return { ok: true, abs, size: st.size };
}

async function loadFeedPayload(): Promise<unknown | null> {
  const [row] = await db
    .select({ payload: feedSnapshotTable.payload })
    .from(feedSnapshotTable)
    .where(eq(feedSnapshotTable.name, "templates"))
    .limit(1);
  return row?.payload ?? null;
}

export interface TemplatesRouterOptions {
  /** 讀 feed 快照；測試可注入假資料。預設讀 DB 的 feed_snapshot。 */
  loadPayload?: () => Promise<unknown | null>;
}

export function createTemplatesRouter(opts: TemplatesRouterOptions = {}): Router {
  const router = Router();
  const load = opts.loadPayload ?? loadFeedPayload;

  router.get("/templates/search", async (req: Request, res: Response) => {
    if (!isAuthorized(req.headers["x-admin-password"])) return res.status(403).json(FORBIDDEN);
    const qRaw = req.query["q"];
    if (typeof qRaw !== "string" || qRaw.trim().length < 1 || qRaw.trim().length > 50) {
      return res.status(400).json({ message: "q 必須是 1～50 字" });
    }
    const limitRaw = req.query["limit"];
    if (limitRaw !== undefined && (typeof limitRaw !== "string" || !/^\d+$/.test(limitRaw))) {
      return res.status(400).json({ message: "limit 必須是 1～20 的整數" });
    }
    const parsed = parseTemplateSearchParams(qRaw, limitRaw);
    if (!parsed) return res.status(400).json({ message: "limit 必須是 1～20 的整數" });
    let payload: unknown | null;
    try {
      payload = await load();
    } catch (err) {
      logger.error({ err }, "templates feed load failed");
      payload = null;
    }
    if (payload === null || payload === undefined) return res.json({ items: [], clearWinner: false, ready: false });
    const r = searchTemplates(payload, parsed.q, parsed.limit);
    return res.json({ ...r, ready: true });
  });

  router.get("/templates/:id/versions", async (req: Request, res: Response) => {
    if (!isAuthorized(req.headers["x-admin-password"])) return res.status(403).json(FORBIDDEN);
    const id = req.params["id"];
    if (typeof id !== "string" || !TEMPLATE_ID_RE.test(id)) return res.status(400).json({ message: "範本 id 格式不正確" });
    let payload: unknown | null;
    try {
      payload = await load();
    } catch (err) {
      logger.error({ err }, "templates feed load failed");
      payload = null;
    }
    if (payload === null || payload === undefined) return res.status(404).json({ message: "找不到這個範本" });
    const versions = templateVersions(payload, id);
    if (versions === null) return res.status(404).json({ message: "找不到這個範本" });
    return res.json({ items: versions });
  });

  router.get("/templates/:id/file", async (req: Request, res: Response) => {
    if (!isAuthorized(req.headers["x-admin-password"])) return res.status(403).json(FORBIDDEN);
    const id = req.params["id"];
    if (typeof id !== "string" || !TEMPLATE_ID_RE.test(id)) return res.status(400).json({ message: "範本 id 格式不正確" });

    let payload: unknown | null;
    try {
      payload = await load();
    } catch (err) {
      logger.error({ err }, "templates feed load failed");
      payload = null;
    }
    if (payload === null || payload === undefined) return res.status(404).json({ message: "找不到這個範本檔" });
    const rec: TemplateRecord | null = findTemplate(payload, id);
    if (!rec) return res.status(404).json({ message: "找不到這個範本檔" });

    if (!safeRel(rec.rel)) return res.status(400).json({ message: "範本路徑不合法" });
    const name = path.posix.basename(rec.rel);
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
    const contentType = CONTENT_TYPES[ext];
    if (!contentType) return res.status(415).json({ message: "這種檔案類型不提供下載" });

    const roots = parseTemplateRoots(process.env["TEMPLATE_ROOTS"]);
    const rootDir = roots[rec.root];
    if (!rootDir) return res.status(503).json(NOT_MOUNTED);

    // 同一套 NAS 斷路器：冷卻中或同時呼叫已達上限時不碰 NAS（忙碌回 429，不是斷線）。
    const blocked = nasGuard.blockReason();
    if (blocked === "busy") return res.status(429).json({ message: "家中 NAS 忙碌中，請幾秒後再試" });
    if (blocked) return res.status(504).json({ message: NAS_OFFLINE_MESSAGE });

    let found: Lookup;
    try {
      nasGuard.begin();
      found = await withTimeout(lookup(rootDir, rec.rel).finally(() => nasGuard.end()), rawNasTimeoutMs());
    } catch {
      // 逾時與 EIO、EHOSTDOWN… 等連線錯誤：進入冷卻，後續請求不再碰 NAS。
      nasGuard.markDown();
      return res.status(504).json({ message: NAS_OFFLINE_MESSAGE });
    }

    if (!found.ok) {
      if (found.kind === "no-root") return res.status(503).json(NOT_MOUNTED);
      if (found.kind === "escape") return res.status(400).json({ message: "範本路徑不合法" });
      return res.status(404).json({ message: "找不到這個範本檔" });
    }
    return sendRaw(res, found.abs, found.size, name, contentType, "attachment");
  });

  return router;
}

export default createTemplatesRouter();
