import { randomBytes } from "node:crypto";
import { ADMIN_PASSWORD } from "./adminPassword";

// 解鎖用的憑證不再是「使用者輸入的密碼原文」，是伺服器發的一次性隨機
// token，存活期有限——瀏覽器端（localStorage、React state）現在只會看到
// 這個 token，看不到真正的密碼；即使 token 外洩，過期後自動失效，比原本
// 明碼存 localStorage、永不過期的曝險窗口小很多。
// 存記憶體（Map）就夠：這是單一 Node process、單一使用者的服務，伺服器
// 重啟時所有 token 自然失效，逼著重新輸入一次密碼——這是可接受、甚至算
// 加分的行為，不需要為此多開一張 DB 表或引入 Redis。
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天
const sessions = new Map<string, number>(); // token -> expiresAt（epoch ms）

export function createSession(): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, expiresAt);
  return { token, expiresAt };
}

function isValidSessionToken(token: string): boolean {
  const expiresAt = sessions.get(token);
  if (expiresAt === undefined) return false;
  if (Date.now() > expiresAt) {
    sessions.delete(token); // 順手清掉，Map 不會無限長大
    return false;
  }
  return true;
}

// 每個私領域路由原本都是 `req.headers["x-admin-password"] === ADMIN_PASSWORD`
// 直接比對明碼；現在同一個 header 位置接受兩種憑證：原始密碼本身（給
// collect.ps1 這類伺服器對伺服器的呼叫——本來就是從自己的 .env 讀，不經過
// 瀏覽器 localStorage，沒有這次要解決的曝險問題，維持原樣即可），或是
// createSession() 發的 session token（給瀏覽器）。
export function isAuthorized(headerValue: string | string[] | undefined): boolean {
  if (typeof headerValue !== "string" || headerValue.length === 0) return false;
  if (headerValue === ADMIN_PASSWORD) return true;
  return isValidSessionToken(headerValue);
}
