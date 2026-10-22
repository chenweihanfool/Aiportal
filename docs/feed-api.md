# 泛用 feed（P1-7）

新資料不再各開一張表＋一支端點＋一套前端型別：先走這條。既有的專用 feed（`hermes-places`、`hermes-trips`、`hermes-ideas` 等）不搬。

## 新增一種資料的步驟
1. 在 `artifacts/api-server/src/feeds/registry.ts` 的 `FEED_REGISTRY` 加一筆：名稱（`^[a-z][a-z0-9-]{1,39}$`）、`version`、`description`、`maxBytes`（選填，預設 1 MiB）、JSON Schema。
2. `UPDATE_SCHEMAS=1 pnpm --filter @workspace/api-server test` 重新輸出 `schemas/feeds/<名稱>.v<版本>.schema.json`（給推送端用；測試保證它與登記表一致，不漂移）。
3. 推送端：`kbcore.portal_push.push_feed(名稱, 版本, payload)`。
4. 前端讀 `GET /api/feed/<名稱>`。

不需要新資料表、新路由、新 migration。

## POST /api/admin/feed/:name
標頭 `x-admin-password`（管理員權限，同其他 admin 端點）。整份覆寫，每種 feed 只留最新一份。

```json
{ "schemaVersion": 1, "generatedAt": "2026-10-16", "payload": { "items": [ { "label": "a", "value": 1.5 } ] } }
```
| 狀況 | 回應 |
|---|---|
| 成功 | 200 `{"success":true,"name":"example","version":1}` |
| 名稱不合法、本文不是物件、缺 `payload`、`generatedAt` 不是真的日期（`YYYY-MM-DD`／null／省略）、payload 不符 schema | 400（`message` 說明哪一欄） |
| 沒登記的名稱 | 404 |
| `schemaVersion` 與伺服器登記的不同 | 409（升版時推送端要跟著改，避免舊格式寫進來） |
| payload 超過 `maxBytes` | 413 |
| 沒有管理員權限 | 403 |

## GET /api/feed/:name
標頭 `x-admin-password`（解鎖權杖）。還沒推送過：`{"available":false,"name":…,"schemaVersion":…,"payload":null,…}`；有資料：`{"available":true,"name","schemaVersion","payload","generatedAt","receivedAt"}`。沒登記的名稱回 404。

## 改 schema 的規則
- 欄位只增不改、不刪；不相容的改動升 `version`（舊版本推送會被 409 擋下，直到推送端跟上）。
- 資料表 `feed_snapshot(name pk, version, payload jsonb, generated_at, received_at)`，migration `0024`；部署要先跑 `docker compose --profile migrate run --build --rm db-migrate`，再重建 api-server。

## 目前登記的 feed
| 名稱 | 版本 | 用途 |
|---|---|---|
| `example` | 1 | 範例（示範格式，沒有畫面使用；第一個真的新 feed 進來時可以刪） |
| `kb-arch-stats` | 1 | 知識庫架構頁各節點的處理數字（kb-pipeline `arch-stats-pusher.py`） |
| `kb-report-stats` | 1 | 週／月報的視覺化統計：最近 8 週＋6 個月的想法・美食・旅遊數字與逐日資料（kb-pipeline `report-stats-pusher.py`，約每小時；**2.55.0 起畫面不再使用**（圖表改由入口網依既有 feed 現算，整合進時間軸報告；推送端與此登記待清理 PR 移除）；設計見 kb-pipeline `docs/report-visual-design.md`） |
