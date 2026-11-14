import { randomBytes } from "node:crypto";
import { ADMIN_PASSWORD } from "./adminPassword";

// Google 登入（見 lib/googleAuth.ts）通過後，googleSessionBridge 會把「這個請求已是白名單登入者」
// 轉成這個只存在於本 process 記憶體的隨機值，放進 x-admin-password，讓既有每個私領域路由
// 的 isAuthorized(header) 不必逐一改寫就認得登入者。它不會離開伺服器，瀏覽器猜不到。
export const GOOGLE_BRIDGE_TOKEN = randomBytes(32).toString("hex");

// 每個私領域路由都是把 `x-admin-password` 標頭交給這裡判斷。2026-11-14 起瀏覽器的
// 密碼解鎖與「密碼換 session token」都拿掉了，只剩兩種憑證：
//  1. 原始 ADMIN_PASSWORD：伺服器對伺服器的推送（collect.ps1、HERMES）從自己的 .env
//     讀取，不經過瀏覽器；
//  2. GOOGLE_BRIDGE_TOKEN：白名單登入者在伺服器內部被轉成的憑證（見 lib/loginGate.ts）。
// 不再有瀏覽器 session token，所以也不用維護存活期或清理 Map。
export function isAuthorized(headerValue: string | string[] | undefined): boolean {
  if (typeof headerValue !== "string" || headerValue.length === 0) return false;
  return headerValue === ADMIN_PASSWORD || headerValue === GOOGLE_BRIDGE_TOKEN;
}
