# Google 登入（個人使用、不公開）

入口網站定位是個人使用。登入改走 Google，只有白名單 email 進得來（做法對齊 pf：Google OIDC＋自己的白名單）。

## 運作方式

- `GET /api/auth/login` → Google（PKCE）→ `GET /api/auth/callback` → 比對白名單 → 簽章 cookie（HttpOnly、SameSite=Lax、https 時 Secure、30 天）。
- Session 是 HMAC 簽章 cookie，**不存資料庫**（無 migration、重啟不掉登入）。每次請求都重新比對白名單：把 email 從 `ALLOWED_GOOGLE_EMAILS` 拿掉＝立即失效；換 `SESSION_SECRET` 或 `ADMIN_PASSWORD`＝全部登入失效。
- 白名單在環境變數 `ALLOWED_GOOGLE_EMAILS`（逗號分隔）。要加人改 `.env` 後重啟 api-server。
- 伺服器對伺服器的推送（HERMES pushers、collect.ps1）仍用 `x-admin-password: <ADMIN_PASSWORD>`，不受登入影響。
- 其他私領域路由不必改：登入者會被轉成內部憑證（`lib/loginGate.ts` 的 `googleSessionBridge`），既有的 `isAuthorized()` 照常放行。

## 設定（一次性）

1. Google Cloud Console → 沿用 pf 的 OAuth 用戶端 → 「已授權的重新導向 URI」新增：
   `${PUBLIC_BASE_URL}/api/auth/callback`（例：`https://cwh2023.synology.me/aiportal/api/auth/callback`）。
   OAuth 同意畫面若在「測試中」，測試使用者清單要包含白名單帳號。
2. 主機 `.env` 加入：`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`（同 pf）、`PUBLIC_BASE_URL`、`ALLOWED_GOOGLE_EMAILS`。
3. `docker compose up -d --build api-server gis-portal`（無 DB 變更，不需 db-migrate）。

## 切換流程（兩步，避免把自己鎖在門外）

1. **只加登入、不強制**（`REQUIRE_GOOGLE_LOGIN` 未設）：網站行為不變；到入口網站點「Google 登入」確認能進、右上顯示 email、私領域內容可看。
2. **強制**：`.env` 加 `REQUIRE_GOOGLE_LOGIN=1`，`docker compose up -d api-server`。未登入者只看到登入頁，所有 `/api` 都需登入。
   回滾：拿掉這一行重啟即可。
   - 強制模式下若設定不全（沒白名單／用戶端），**失敗即關閉**：只剩原始 `ADMIN_PASSWORD` 的伺服器推送能通過。
3. 之後（下一個 PR）才移除前端的密碼解鎖與 `/api/auth/verify`。

## 驗證

- 未登入：`curl -i https://…/aiportal/api/dashboard` → 強制模式 401 `{"loginRequired":true}`。
- 伺服器推送：帶 `x-admin-password: <ADMIN_PASSWORD>` 的 `POST /api/admin/hermes-status` 仍 200。
- 非白名單帳號登入 → 導回首頁並顯示「這個 Google 帳號不在白名單」。
