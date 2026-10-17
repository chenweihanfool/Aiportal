// 付費服務用量：只有 DeepSeek（/user/balance）與 Tavily（/usage）有能用 API 金鑰直接讀的額度端點。
// Ollama（手動輸入餘額，見 hermesUsage）、Claude Pro、JEV 沒有，前端只放連結。
// 金鑰只放在 api-server 環境變數，不進 repo、不送前端；沒設金鑰＝回 "no-key"，前端顯示「未設定金鑰」。

export type UsageResult<T> =
  | { status: "ok"; data: T }
  | { status: "no-key" }
  | { status: "error"; message: string };

export interface DeepSeekBalance {
  available: boolean;
  balances: Array<{ currency: string; total: number; granted: number; toppedUp: number }>;
}

export interface TavilyUsage {
  plan: string | null;
  used: number;
  limit: number | null;
  /** 帳號合計用量（有些方案 key 與帳號分開計） */
  accountUsed: number | null;
  accountLimit: number | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

export function parseDeepSeekBalance(body: unknown): DeepSeekBalance | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const infos = b["balance_infos"];
  if (!Array.isArray(infos)) return null;
  const balances = infos.flatMap((i) => {
    if (!i || typeof i !== "object") return [];
    const r = i as Record<string, unknown>;
    const total = num(r["total_balance"]);
    if (typeof r["currency"] !== "string" || total === null) return [];
    return [{ currency: r["currency"], total, granted: num(r["granted_balance"]) ?? 0, toppedUp: num(r["topped_up_balance"]) ?? 0 }];
  });
  return { available: b["is_available"] === true, balances };
}

export function parseTavilyUsage(body: unknown): TavilyUsage | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const key = (b["key"] ?? {}) as Record<string, unknown>;
  const account = (b["account"] ?? {}) as Record<string, unknown>;
  const used = num(key["usage"]) ?? num(account["plan_usage"]);
  if (used === null) return null;
  return {
    plan: typeof account["current_plan"] === "string" ? account["current_plan"] : null,
    used,
    limit: num(key["limit"]) ?? num(account["plan_limit"]),
    accountUsed: num(account["plan_usage"]),
    accountLimit: num(account["plan_limit"]),
  };
}

type Fetcher = typeof fetch;

async function getJson<T>(url: string, key: string, parse: (b: unknown) => T | null, doFetch: Fetcher): Promise<UsageResult<T>> {
  try {
    const r = await doFetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { status: "error", message: `HTTP ${r.status}` };
    const data = parse(await r.json());
    return data ? { status: "ok", data } : { status: "error", message: "回應格式不符" };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "連線失敗" };
  }
}

export function fetchDeepSeek(key: string | undefined, doFetch: Fetcher = fetch): Promise<UsageResult<DeepSeekBalance>> {
  if (!key) return Promise.resolve({ status: "no-key" });
  return getJson("https://api.deepseek.com/user/balance", key, parseDeepSeekBalance, doFetch);
}

export function fetchTavily(key: string | undefined, doFetch: Fetcher = fetch): Promise<UsageResult<TavilyUsage>> {
  if (!key) return Promise.resolve({ status: "no-key" });
  return getJson("https://api.tavily.com/usage", key, parseTavilyUsage, doFetch);
}
