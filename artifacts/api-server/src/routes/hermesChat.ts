import { Router, type Request, type Response } from "express";
import { Readable } from "node:stream";
import { db, hermesChatStateTable, hermesRestartRequestTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { isAuthorized } from "../lib/adminSession";
import { logger } from "../lib/logger";
import { cleanMessage, idleMinutesOf, isRestartMode, isSafeId, needsNewSession, restartBlockReason, sessionTitle, transcriptOf, upstreamMessage } from "../lib/hermesChat";

const router = Router();

// 入口網內建 HERMES 對話：瀏覽器 → 這裡 → HERMES API（金鑰只在伺服器）。
// 這個 API 有完整工具權限（終端機、檔案），所以每個路由都要已解鎖；重啟不經過這個 API，見 POST /hermes-chat/restart。
// 不會有核准：HERMES 把 api_server 列為無人值守平台，approvals.unattended_mode=approve 時在檢查前就放行，
// 不會發 approval.request（2026-10-30 實機查證）。使用者裁定「維持並加提醒」；核准路由與前端核准卡留著，HERMES 日後支援時可直接用。
const API_BASE = (process.env["HERMES_API_BASE"] || "http://hermes:8642").replace(/\/+$/, "");
const API_KEY = process.env["HERMES_API_KEY"] || "";
const IDLE_MINUTES = idleMinutesOf(process.env["HERMES_CHAT_IDLE_MINUTES"]);
const STATE_ID = "current";

class UpstreamError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function hermes(path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<globalThis.Response> {
  try {
    return await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
    });
  } catch {
    throw new UpstreamError(502, "連不上 HERMES");
  }
}

async function hermesJson(path: string, init: RequestInit = {}): Promise<unknown> {
  const r = await hermes(path, init);
  if (!r.ok) throw new UpstreamError(r.status === 429 ? 429 : 502, upstreamMessage(r.status, await r.text()));
  return r.json();
}

function guard(req: Request, res: Response): boolean {
  if (!isAuthorized(req.headers["x-admin-password"])) {
    res.status(403).json({ message: "需要解鎖私領域才能使用" });
    return false;
  }
  if (!API_KEY) {
    res.status(503).json({ message: "HERMES 對話尚未設定（HERMES_API_KEY）" });
    return false;
  }
  return true;
}

const fail = (res: Response, e: unknown) => {
  if (e instanceof UpstreamError) return res.status(e.status).json({ message: e.message });
  logger.error({ err: e }, "hermes chat failed");
  return res.status(500).json({ message: "處理失敗" });
};

const readState = async () => {
  const [row] = await db.select().from(hermesChatStateTable).where(eq(hermesChatStateTable.id, STATE_ID)).limit(1);
  return row ?? null;
};

const saveState = (sessionId: string, at: Date) =>
  db.insert(hermesChatStateTable).values({ id: STATE_ID, sessionId, lastMessageAt: at })
    .onConflictDoUpdate({ target: hermesChatStateTable.id, set: { sessionId, lastMessageAt: at } });

async function newSession(): Promise<string> {
  const d = await hermesJson("/api/sessions", { method: "POST", body: JSON.stringify({ title: sessionTitle(new Date()) }) }) as { session?: { id?: unknown } };
  if (!isSafeId(d.session?.id)) throw new UpstreamError(502, "HERMES 沒有回 session");
  return d.session.id;
}

const startRun = (input: string, sessionId: string) =>
  hermes("/v1/runs", { method: "POST", body: JSON.stringify({ input, session_id: sessionId }) });

const latestRestart = async () => {
  const [row] = await db.select().from(hermesRestartRequestTable).orderBy(desc(hermesRestartRequestTable.id)).limit(1);
  return row ?? null;
};

router.get("/hermes-chat/status", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) return res.status(403).json({ message: "需要解鎖私領域才能使用" });
  try {
    const gateway = API_KEY ? await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok).catch(() => false) : false;
    const [state, restart] = await Promise.all([readState(), latestRestart()]);
    return res.json({ configured: Boolean(API_KEY), gateway, sessionId: state?.sessionId ?? null, lastMessageAt: state?.lastMessageAt ?? null, idleMinutes: IDLE_MINUTES, restart });
  } catch (e) {
    return fail(res, e);
  }
});

// 目前這串對話的內容；閒置超過門檻就回空（下一則會開新 session，舊的留在 HERMES）
router.get("/hermes-chat/messages", async (req: Request, res: Response) => {
  if (!guard(req, res)) return;
  try {
    const state = await readState();
    if (!state || needsNewSession(state.lastMessageAt, new Date(), IDLE_MINUTES)) return res.json({ messages: [] });
    const d = await hermesJson(`/api/sessions/${state.sessionId}/messages?limit=200`);
    return res.json({ messages: transcriptOf(d) });
  } catch (e) {
    return fail(res, e);
  }
});

router.post("/hermes-chat/messages", async (req: Request, res: Response) => {
  if (!guard(req, res)) return;
  const input = cleanMessage((req.body as { message?: unknown } | undefined)?.message);
  if (!input) return res.status(400).json({ message: "訊息是空的或太長" });
  try {
    const now = new Date();
    const state = await readState();
    let isNew = !state || needsNewSession(state.lastMessageAt, now, IDLE_MINUTES);
    let sessionId = isNew ? await newSession() : state!.sessionId;
    let r = await startRun(input, sessionId);
    if (r.status === 404 && !isNew) { // session 在 HERMES 端被刪了
      isNew = true;
      sessionId = await newSession();
      r = await startRun(input, sessionId);
    }
    if (!r.ok) throw new UpstreamError(r.status === 429 ? 429 : 502, r.status === 429 ? "HERMES 忙碌中，稍後再試" : upstreamMessage(r.status, await r.text()));
    const d = await r.json() as { run_id?: unknown };
    if (!isSafeId(d.run_id)) throw new UpstreamError(502, "HERMES 沒有回 run");
    await saveState(sessionId, now);
    logger.info({ runId: d.run_id, sessionId, isNew }, "hermes chat run started");
    return res.json({ runId: d.run_id, sessionId, isNew });
  } catch (e) {
    return fail(res, e);
  }
});

// 事件流只能讀一次：HERMES 在訂閱者斷線時就丟掉佇列，再讀回 404。所以瀏覽器斷線時這裡繼續把上游讀完，
// 不中斷 run；前端改用 GET /hermes-chat/runs/:id 查狀態（含待核准）。
router.get("/hermes-chat/runs/:id/events", async (req: Request, res: Response) => {
  if (!guard(req, res)) return;
  const id = req.params["id"];
  if (!isSafeId(id)) return res.status(400).json({ message: "run id 不合法" });
  try {
    const up = await hermes(`/v1/runs/${id}/events`, {}, 0);
    if (!up.ok || !up.body) return res.status(up.status === 404 ? 404 : 502).json({ message: `HERMES 回 ${up.status}` });
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    for await (const chunk of Readable.fromWeb(up.body as never)) {
      if (!res.writableEnded && !res.destroyed) res.write(chunk);
    }
    return res.end();
  } catch (e) {
    if (res.headersSent) return res.end();
    return fail(res, e);
  }
});

router.get("/hermes-chat/runs/:id", async (req: Request, res: Response) => {
  if (!guard(req, res)) return;
  const id = req.params["id"];
  if (!isSafeId(id)) return res.status(400).json({ message: "run id 不合法" });
  try {
    return res.json(await hermesJson(`/v1/runs/${id}`));
  } catch (e) {
    return fail(res, e);
  }
});

// 只開放「允許一次」與「拒絕」：永久允許要改 HERMES 設定，不從網頁給
router.post("/hermes-chat/runs/:id/approval", async (req: Request, res: Response) => {
  if (!guard(req, res)) return;
  const id = req.params["id"];
  const body = (req.body ?? {}) as { choice?: unknown; requestId?: unknown; executionGeneration?: unknown };
  const { choice, requestId, executionGeneration } = body;
  if (!isSafeId(id) || (choice !== "once" && choice !== "deny")) return res.status(400).json({ message: "參數不合法" });
  try {
    const upstream = {
      choice,
      ...(isSafeId(requestId) ? { request_id: requestId } : {}),
      ...(Number.isInteger(executionGeneration) ? { execution_generation: executionGeneration } : {}),
    };
    const r = await hermes(`/v1/runs/${id}/approval`, { method: "POST", body: JSON.stringify(upstream) });
    logger.warn({ runId: id, choice, status: r.status }, "hermes chat approval");
    return r.ok ? res.json({ success: true }) : res.status(r.status === 409 ? 409 : 502).json({ message: r.status === 409 ? "這個核准已經失效" : `HERMES 回 ${r.status}` });
  } catch (e) {
    return fail(res, e);
  }
});

router.post("/hermes-chat/runs/:id/stop", async (req: Request, res: Response) => {
  if (!guard(req, res)) return;
  const id = req.params["id"];
  if (!isSafeId(id)) return res.status(400).json({ message: "run id 不合法" });
  try {
    const r = await hermes(`/v1/runs/${id}/stop`, { method: "POST" });
    return res.status(r.ok || r.status === 409 ? 200 : 502).json({ success: r.ok });
  } catch (e) {
    return fail(res, e);
  }
});

router.post("/hermes-chat/new", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) return res.status(403).json({ message: "需要解鎖私領域才能使用" });
  await db.delete(hermesChatStateTable).where(eq(hermesChatStateTable.id, STATE_ID));
  return res.json({ success: true });
});

// 重啟只寫一列請求，由 VPS 主機上的 hermes-restart-watcher 執行（kb-pipeline deploy/hermes-restart/）。
// 這條路不經過 HERMES API：Gateway 卡住時也要能用。沒設金鑰也能重啟。
router.post("/hermes-chat/restart", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) return res.status(403).json({ message: "需要解鎖私領域才能使用" });
  const mode = (req.body as { mode?: unknown } | undefined)?.mode;
  if (!isRestartMode(mode)) return res.status(400).json({ message: "重啟方式不合法" });
  const last = await latestRestart();
  const blocked = restartBlockReason(last, mode, new Date());
  if (blocked) return res.status(409).json({ message: blocked });
  const [row] = await db.insert(hermesRestartRequestTable).values({ mode }).returning();
  logger.warn({ id: row?.id, mode }, "hermes gateway restart requested");
  return res.json({ restart: row });
});

export default router;
