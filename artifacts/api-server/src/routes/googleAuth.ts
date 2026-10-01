import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import {
  OAUTH_COOKIE, OAUTH_TTL_SEC, SESSION_COOKIE, SESSION_TTL_SEC,
  buildAuthUrl, checkClaims, clearCookie, exchangeCode, newPkce, newRandom, readCookie, serializeCookie, sessionEmail, signToken, verifyToken,
} from "../lib/googleAuth";
import { currentGoogleAuthConfig } from "../lib/loginGate";

// Google 登入流程（見 lib/googleAuth.ts 的設計說明）：
//   GET  /api/auth/login     → 導向 Google（PKCE＋state＋nonce，暫存於簽章 cookie）
//   GET  /api/auth/callback  → 換 code、驗 claims、比對白名單，通過就發 session cookie 並導回首頁
//   GET  /api/auth/me        → 目前登入者；未登入 401（附 loginRequired，前端據此決定要不要擋整站）
//   POST /api/auth/logout    → 清 cookie
export function createGoogleAuthRouter(fetchImpl: typeof fetch = fetch): Router {
  const router = Router();

  router.get("/auth/login", (_req: Request, res: Response) => {
    const cfg = currentGoogleAuthConfig();
    if (!cfg.configured) return res.status(503).json({ message: "Google 登入尚未設定" });
    const { verifier, challenge } = newPkce();
    const state = newRandom();
    const nonce = newRandom();
    const tmp = signToken({ s: state, v: verifier, n: nonce, exp: Math.floor(Date.now() / 1000) + OAUTH_TTL_SEC }, cfg.secret);
    res.setHeader("Set-Cookie", serializeCookie(OAUTH_COOKIE, tmp, cfg, OAUTH_TTL_SEC));
    return res.redirect(buildAuthUrl(cfg, { state, nonce, challenge }));
  });

  router.get("/auth/callback", async (req: Request, res: Response) => {
    const cfg = currentGoogleAuthConfig();
    const fail = (code: string) => {
      res.setHeader("Set-Cookie", clearCookie(OAUTH_COOKIE, cfg));
      return res.redirect(`${cfg.baseUrl}/?login_error=${code}`);
    };
    if (!cfg.configured) return res.status(503).json({ message: "Google 登入尚未設定" });
    const tmp = verifyToken(readCookie(req.headers.cookie, OAUTH_COOKIE), cfg.secret);
    const code = typeof req.query["code"] === "string" ? req.query["code"] : "";
    const state = typeof req.query["state"] === "string" ? req.query["state"] : "";
    if (!tmp || !code || typeof tmp["s"] !== "string" || tmp["s"] !== state || typeof tmp["v"] !== "string" || typeof tmp["n"] !== "string") {
      return fail("invalid_state");
    }
    let claims;
    try {
      claims = await exchangeCode(cfg, code, tmp["v"], fetchImpl);
    } catch (err) {
      logger.error({ err }, "[auth] google token exchange failed");
      return fail("auth_failed");
    }
    const check = checkClaims(claims, cfg, tmp["n"]);
    if (!check.ok) {
      if (check.reason === "denied") logger.warn({ email: check.email }, "[auth] google login rejected: not in ALLOWED_GOOGLE_EMAILS");
      return fail(check.reason === "denied" ? "denied" : check.reason === "unverified" ? "unverified" : "auth_failed");
    }
    const session = signToken({ e: check.email, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC }, cfg.secret);
    res.setHeader("Set-Cookie", [serializeCookie(SESSION_COOKIE, session, cfg, SESSION_TTL_SEC), clearCookie(OAUTH_COOKIE, cfg)]);
    return res.redirect(`${cfg.baseUrl}/`);
  });

  router.get("/auth/me", (req: Request, res: Response) => {
    const cfg = currentGoogleAuthConfig();
    const email = sessionEmail(req.headers.cookie, cfg);
    if (!email) return res.status(401).json({ message: "未登入", loginRequired: cfg.required, configured: cfg.configured });
    return res.json({ email, loginRequired: cfg.required });
  });

  router.post("/auth/logout", (_req: Request, res: Response) => {
    const cfg = currentGoogleAuthConfig();
    res.setHeader("Set-Cookie", clearCookie(SESSION_COOKIE, cfg));
    res.json({ ok: true });
  });

  return router;
}

export default createGoogleAuthRouter();
