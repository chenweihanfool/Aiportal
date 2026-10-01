// Google 登入（OIDC authorization-code + PKCE）：純函式與設定，不碰 Express／資料庫。
//
// 定位：入口網站是個人使用、不公開——登入走 Google，只有白名單 email 進得來（做法對齊 pf.weihanc.cloud：
// Google OIDC + 自己的白名單；差別在這裡的白名單只有一個人，放環境變數就夠，不需要資料表與 migration）。
//
// Session 是「簽章 cookie」（HMAC-SHA256），不存伺服器端：
//  - 不新增資料表、重啟不掉登入、無額外儲存成本（目標 3）；
//  - 每次請求都會重新比對白名單，所以把 email 從 ALLOWED_GOOGLE_EMAILS 拿掉＝立即失效；
//  - 換掉 SESSION_SECRET（或 ADMIN_PASSWORD，未設 SESSION_SECRET 時由它導出）＝全部登入立即失效。
//
// ID token 不驗簽：它是伺服器端直接向 Google token endpoint（HTTPS）用 code＋client_secret 換來的，
// OIDC Core §3.1.3.7 明定這種情況可省略簽章驗證；仍嚴格檢查 iss／aud／exp／nonce／email_verified。
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "aip_session";
export const OAUTH_COOKIE = "aip_oauth";
export const SESSION_TTL_SEC = 30 * 24 * 60 * 60;
export const OAUTH_TTL_SEC = 10 * 60;

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export interface GoogleAuthConfig {
  /** 四項必要設定（用戶端、對外網址、白名單）都齊了才算 configured。 */
  configured: boolean;
  /** REQUIRE_GOOGLE_LOGIN=1：整站強制登入。未設時只是「可以登入」，行為不變（供先驗證再切換）。 */
  required: boolean;
  clientId: string;
  clientSecret: string;
  /** 對外完整網址（含路徑前綴，不含結尾斜線），例：https://cwh2023.synology.me/aiportal */
  baseUrl: string;
  allowedEmails: string[];
  secret: string;
  secure: boolean;
  cookiePath: string;
}

export function parseAllowedEmails(raw: string | undefined): string[] {
  return Array.from(new Set((raw ?? "").split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.includes("@"))));
}

export function isAllowedEmail(email: string | undefined | null, allowed: string[]): boolean {
  return typeof email === "string" && allowed.includes(email.trim().toLowerCase());
}

export function loadGoogleAuthConfig(env: NodeJS.ProcessEnv, adminPassword: string): GoogleAuthConfig {
  const clientId = (env["GOOGLE_CLIENT_ID"] ?? "").trim();
  const clientSecret = (env["GOOGLE_CLIENT_SECRET"] ?? "").trim();
  const baseUrl = (env["PUBLIC_BASE_URL"] ?? "").trim().replace(/\/+$/, "");
  const allowedEmails = parseAllowedEmails(env["ALLOWED_GOOGLE_EMAILS"]);
  let pathname = "";
  let secure = false;
  let urlOk = false;
  try {
    const u = new URL(baseUrl);
    pathname = u.pathname.replace(/\/+$/, "");
    secure = u.protocol === "https:";
    urlOk = u.protocol === "https:" || u.protocol === "http:";
  } catch {
    /* baseUrl 空白或不合法 → 視為未設定 */
  }
  const secret = (env["SESSION_SECRET"] ?? "").trim() || createHmac("sha256", adminPassword).update("aiportal-google-session-v1").digest("hex");
  return {
    configured: !!(clientId && clientSecret && urlOk && allowedEmails.length > 0),
    required: env["REQUIRE_GOOGLE_LOGIN"] === "1",
    clientId, clientSecret, baseUrl, allowedEmails, secret, secure,
    cookiePath: pathname || "/",
  };
}

// ── 簽章 token（session／oauth 暫存 cookie 共用）────────────────────────────

const b64u = (b: Buffer | string): string => Buffer.from(b).toString("base64url");

export function signToken(payload: Record<string, unknown>, secret: string): string {
  const body = b64u(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** 簽章正確且未過期才回傳 payload（exp 為 epoch 秒）；否則 null。 */
export function verifyToken(token: string | undefined, secret: string, nowSec = Math.floor(Date.now() / 1000)): Record<string, unknown> | null {
  if (!token) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  let given: Buffer;
  try { given = Buffer.from(sig, "base64url"); } catch { return null; }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof p["exp"] !== "number" || p["exp"] <= nowSec) return null;
    return p;
  } catch {
    return null;
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

export function serializeCookie(name: string, value: string, cfg: Pick<GoogleAuthConfig, "secure" | "cookiePath">, maxAgeSec: number): string {
  return `${name}=${value}; Path=${cfg.cookiePath}; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax${cfg.secure ? "; Secure" : ""}`;
}

export function clearCookie(name: string, cfg: Pick<GoogleAuthConfig, "secure" | "cookiePath">): string {
  return serializeCookie(name, "", cfg, 0);
}

/** 目前請求若帶著有效的登入 cookie 且 email 仍在白名單內，回傳 email。 */
export function sessionEmail(cookieHeader: string | undefined, cfg: GoogleAuthConfig, nowSec?: number): string | null {
  if (!cfg.configured) return null;
  const p = verifyToken(readCookie(cookieHeader, SESSION_COOKIE), cfg.secret, nowSec);
  const email = typeof p?.["e"] === "string" ? p["e"] : null;
  return email && isAllowedEmail(email, cfg.allowedEmails) ? email : null;
}

// ── OIDC ──────────────────────────────────────────────────────────────────

export function newPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export const newRandom = (): string => randomBytes(16).toString("base64url");

export function callbackUrl(cfg: Pick<GoogleAuthConfig, "baseUrl">): string {
  return `${cfg.baseUrl}/api/auth/callback`;
}

export function buildAuthUrl(cfg: GoogleAuthConfig, a: { state: string; nonce: string; challenge: string }): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: callbackUrl(cfg),
    response_type: "code",
    scope: "openid email",
    state: a.state,
    nonce: a.nonce,
    code_challenge: a.challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${AUTH_ENDPOINT}?${q.toString()}`;
}

export interface IdClaims { iss?: string; aud?: string; exp?: number; nonce?: string; email?: string; email_verified?: boolean; sub?: string }

export function decodeIdToken(jwt: unknown): IdClaims | null {
  if (typeof jwt !== "string") return null;
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as IdClaims;
  } catch {
    return null;
  }
}

export type ClaimsCheck = { ok: true; email: string } | { ok: false; reason: "invalid" | "unverified" | "denied"; email?: string };

export function checkClaims(c: IdClaims | null, cfg: GoogleAuthConfig, nonce: string, nowSec = Math.floor(Date.now() / 1000)): ClaimsCheck {
  if (!c) return { ok: false, reason: "invalid" };
  if (c.iss !== "https://accounts.google.com" && c.iss !== "accounts.google.com") return { ok: false, reason: "invalid" };
  if (c.aud !== cfg.clientId) return { ok: false, reason: "invalid" };
  if (typeof c.exp !== "number" || c.exp <= nowSec) return { ok: false, reason: "invalid" };
  if (c.nonce !== nonce) return { ok: false, reason: "invalid" };
  if (typeof c.email !== "string" || !c.email) return { ok: false, reason: "invalid" };
  if (c.email_verified !== true) return { ok: false, reason: "unverified", email: c.email };
  if (!isAllowedEmail(c.email, cfg.allowedEmails)) return { ok: false, reason: "denied", email: c.email };
  return { ok: true, email: c.email.toLowerCase() };
}

export async function exchangeCode(cfg: GoogleAuthConfig, code: string, verifier: string, fetchImpl: typeof fetch = fetch): Promise<IdClaims | null> {
  const r = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl(cfg),
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code_verifier: verifier,
    }).toString(),
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { id_token?: unknown };
  return decodeIdToken(j.id_token);
}
