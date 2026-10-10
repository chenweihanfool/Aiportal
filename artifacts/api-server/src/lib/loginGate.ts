// 登入閘：兩支 middleware，掛在 routes/index.ts 最前面。
//  1. googleSessionBridge：請求帶著有效的 Google 登入 cookie → 轉成內部憑證，既有私領域路由照常放行。
//  2. requireLoginGate：REQUIRE_GOOGLE_LOGIN=1 時整個 /api 都要登入，只放行登入流程與健康檢查；
//     伺服器對伺服器的推送（HERMES、collect.ps1）帶原始 ADMIN_PASSWORD，不受影響。
import type { NextFunction, Request, Response } from "express";
import { ADMIN_PASSWORD } from "./adminPassword";
import { GOOGLE_BRIDGE_TOKEN } from "./adminSession";
import { loadGoogleAuthConfig, sessionEmail } from "./googleAuth";

export const currentGoogleAuthConfig = () => loadGoogleAuthConfig(process.env, ADMIN_PASSWORD);

const OPEN_PATHS = new Set(["/healthz", "/auth/login", "/auth/callback", "/auth/me", "/auth/logout"]);

// 有有效的 Google 登入就一律換成 bridge token——即使標頭裡已經是 isAuthorized 認得的憑證。
// 管理後台的寫入（新增／編輯／刪除網站）帶的是 /auth/verify 換來的 session token：isAuthorized 認得它，
// 但強制登入時的閘只認原始密碼與 bridge token；以前這裡遇到「已授權的標頭」就不轉換，寫入因此一律 401。
export function googleSessionBridge(req: Request, _res: Response, next: NextFunction): void {
  const cfg = currentGoogleAuthConfig();
  if (cfg.configured && sessionEmail(req.headers.cookie, cfg)) {
    req.headers["x-admin-password"] = GOOGLE_BRIDGE_TOKEN;
  }
  next();
}

export function requireLoginGate(req: Request, res: Response, next: NextFunction): void {
  const cfg = currentGoogleAuthConfig();
  if (!cfg.required || OPEN_PATHS.has(req.path)) return next();
  const h = req.headers["x-admin-password"];
  // 強制登入時：只認原始密碼（伺服器對伺服器）與 Google 登入；舊的「密碼解鎖 token」不再通過這道閘。
  if (h === ADMIN_PASSWORD || h === GOOGLE_BRIDGE_TOKEN) return next();
  res.status(401).json({ message: "需要登入", loginRequired: true });
}
