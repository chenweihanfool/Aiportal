# Claude session 注意事項

## 部署與 HERMES 控制頻道
這個 repo 由 HERMES（VPS 上的代理）部署與測試；Claude 在使用者明確放行後自己合併（規則見控制頻道的 CLAUDE.md §6），不部署，部署只透過控制頻道 [chenweihanfool/hermes-control-channel PR #1](https://github.com/chenweihanfool/hermes-control-channel/pull/1) 留言請 HERMES 部署與測試。

完整規則見 [hermes-control-channel 的 CLAUDE.md](https://github.com/chenweihanfool/hermes-control-channel/blob/main/CLAUDE.md)。最少要做到：

1. **標頭帶代號**：留言第一行寫 `[CLAUDE:<session id 末 8 碼>]`，回覆時接 `re:<comment id>`。不要只寫 `[CLAUDE]`。
2. **誰發誰接**：發出請求後，立刻訂閱 PR #1 的動態（`subscribe_pr_activity`，owner `chenweihanfool`、repo `hermes-control-channel`、pullNumber `1`），保持訂閱直到 HERMES 交出最終回報。否則收不到 HERMES 的回覆。
3. **只處理自己的**：`re:` 指向的不是自己的留言就略過，不向使用者回報。
4. **授權與交接要逐字引用使用者原話並寫死範圍**：PR 與 head sha（合併後的交接留言另附 merge commit，見完整規則 §6）、只重建的服務（`--no-deps`）、不在授權內的項目、失敗時停下並回滾。

## 進度回報（2026-10-16 起）
使用者 2026-10-16：「每做完一個任務 就顯示目前工作在總體計畫中的位置進度」。

- 每做完一個任務（合併、回報一件完成的事、或開完一個 PR），回覆最後附一段「總體計畫進度」：照 `docs/portal-audit-2026-10.md` §5.0 的進度總表，寫出剛完成的項目、目前合計（✅／◐／⬜／🔶 各幾項）、下一個候選與原因。
- 做完順手更新 §5.0 的狀態與「目前位置」，跟該任務同一個 PR；沒有 PR 的任務就另開一個只改文件的 PR。
- 這張表是總體計畫的唯一來源。表裡沒有的事（使用者臨時交辦的）做完也要補一行到「路線圖以外」。

## 程式碼地圖（2026-10-23 起；開新對話時先讀這段，少繞路）
pnpm workspace（Node 22、TypeScript 5.9）。細節以程式碼為準；這段只講「東西放哪、怎麼加」。

### 目錄
| 路徑 | 是什麼 |
|---|---|
| `artifacts/gis-portal/` | 前端：Vite＋React。`src/App.tsx` 是路由與抽屜外殼；首頁是 `HomeBoard.tsx`（舊版 `DesktopBoard.tsx` 仍被抽屜元件共用）。測試與 e2e 在 `src/*.test.ts`、`e2e/*.e2e.mjs`。`nginx.conf` 把 `/api/` 轉給 api-server。 |
| `artifacts/api-server/` | 後端：Express 5。`src/app.ts` 組裝、`src/routes/index.ts` 掛所有路由、`src/lib/` 是業務邏輯（指數計算、驗證、預測）、`src/jobs/` 是定時工作、`src/feeds/registry.ts` 是泛用 feed 登記表。 |
| `lib/db/` | Drizzle schema（`src/schema/*.ts`）與 migration（`migrations/`，用 `pnpm --filter @workspace/db` 的腳本產生與套用）。 |
| `lib/api-spec/`、`lib/api-zod/`、`lib/api-client-react/` | OpenAPI → Orval 產生的 Zod 與 React Query hook。`generated/` 底下不要手改。 |
| `services/busyness-index/` | Python：從 Vikunja 算忙碌指數與任務數字，寫進 Postgres（VPS 排程）。 |
| `services/hermes-status/` | 主機狀態收集腳本（PowerShell）。 |
| `schemas/feeds/` | 泛用 feed 的 JSON Schema，給推送端（kb-pipeline）用；由 api-server 測試保證與登記表一致。 |
| `artifacts/mockup-sandbox/` | 設計原型沙盒，不是正式 app，CI 的 build 也不含它。 |
| `docs/` | 設計與 API 文件；`portal-audit-2026-10.md` 的 §5.0 是總體計畫進度表。 |

### 資料怎麼進來（最常改動的地方）
- 資料多半由 HERMES 端（kb-pipeline 的 pusher）推送進來：`POST /api/admin/*` 寫入 → Postgres → 前端讀 `GET /api/*`。入口網不反向寫回 HERMES。
- **新增一種資料，先走泛用 feed**，不要再開專用表與路由：在 `feeds/registry.ts` 的 `FEED_REGISTRY` 加一筆，跑 `UPDATE_SCHEMAS=1 pnpm --filter @workspace/api-server test` 重新輸出 `schemas/feeds/*.json`，推送端用 `push_feed`，前端讀 `GET /api/feed/<名稱>`。步驟與回應碼見 `docs/feed-api.md`。既有的專用 feed（ideas、places、trips、timeline 等）不搬。
- 改 schema 欄位只增不改；不相容就升 `version`，舊版推送會被 409 擋下，所以**推送端要跟著上線**（部署順序：先 api-server，再 kb-pipeline 腳本）。

### 前端擴充點
- 首頁區塊：在 `homeNav.ts` 的 `HOME_SECTIONS` 加一筆，再用 `<HomeCard id="…">` 包內容；導覽與標題自動帶上。
- 六個生活面向：註冊表是 `dimensions.ts`（頁面 `DimensionPage.tsx`）。
- 色彩與主題 token：`portal.css` 的 `:root` 與 `theme.ts` 的 `CSS_TOKENS` 必須一致，有測試比對。
- 版本歷程在 `versionHistory.ts`；每個使用者看得到的變更都要升版號並補一筆。

### 指令（在 repo 根目錄）
- `pnpm install --frozen-lockfile`、`pnpm run typecheck`、`pnpm run test`（vitest）。這三個就是 CI（`.github/workflows/ci.yml`）跑的檢查，另外會 build gis-portal 與 api-server。
- 前端 e2e（`artifacts/gis-portal/e2e/*.e2e.mjs`）需要瀏覽器與起好的服務，雲端 session 不一定跑得起來；跑不了要在 PR 說明寫明沒跑。
- 沒有 `DATABASE_URL` 與 `ADMIN_PASSWORD` 時 api-server 載入會失敗；CI 用假值，測試不會真的連資料庫。

### 容易踩的地方
- 主要分支是 `master`（不是 main）。
- `package.json` 的 `preinstall` 會刪 `package-lock.json`／`yarn.lock`，只用 pnpm；`pnpm-workspace.yaml` 的 minimum release age 不要關。
- 會動到資料表或 feed 契約的 PR，合併後要請 HERMES 依序重建（見上面部署順序），交接寫法照控制頻道 §6。
