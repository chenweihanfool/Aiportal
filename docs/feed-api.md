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
| `vikunja-gantt` | 1 | 從容面板的任務甘特圖（kb-pipeline `vikunja-gantt-pusher.py`，每 10 分鐘唯讀 Vikunja） |
| `hermes-reports` | 1 | 原本只發 Telegram 的報告，目前是明日報告（kb-pipeline `report-publish.py`） |
| `companion` | 1 | 首頁陪伴區塊：歷年今天、很久沒聯絡的人、每天的家人朋友互動（kb-pipeline `companion-pusher.py`，每 10 分鐘只讀） |
| `topics` | 1 | 知識頁（#knowledge）：知識庫長出來的主題、頁面內容、成長紀錄與相關題目（kb-pipeline 每週推送）。2.75.0 起含知識樹 |
| `topic-nudges` | 1 | 首頁主動推播主題知識：「今天」卡、明日報告區塊、陪伴區塊的「一年前的這時候」（kb-pipeline `vikunja-gantt-pusher.py`，每 10 分鐘） |

## topics 的 sources 選填欄位（v1 只加選填，舊 payload 照常通過）
`sources[]` 每筆除了 `id`、`title`、`month`，還可帶：
- `type`：`pdf|word|excel|image|text|diary|note|event|other`（L4 事件看原檔副檔名；日記事件 `diary`；`AI/…` 筆記 `note`；找不到原檔的事件 `event`）
- `case`：`string|null`，≤60 字（事件 frontmatter 的 case，去掉 `[[ ]]`）
- `date`：`YYYY-MM-DD|null`（事件 frontmatter 的 date；筆記是 null）

## hermes-doc 的新 kind（內容層，`POST /api/admin/hermes-doc`，標頭 `x-admin-password`）
- `source`：一個主題來源一筆。`key` 是來源 id（可能含 `/`，例如 `AI/工作/x`），`bodyMd` 是原文全文（UTF-8 截到 64 KiB），`sourcePath` 是 vault 相對路徑。`meta`＝`{type, case, date, originName, rawPath, textFrom, evidence, topics}`，`textFrom` 為 `original|diary|note|event|none`。
- `topic`：一個已發布主題一筆。`key` 是主題 id，`bodyMd` 為空字串，`meta = {quotes: [{k, ref, text, fromOriginal, weak}]}`（`k` 是 feed `body` 裡第 k 個 `⟦n⟧` 標記）。
- 單筆查詢：`GET /api/hermes-doc/source/<encodeURIComponent(key)>`、`GET /api/hermes-doc/topic/<key>`，回 `{kind,key,title,bodyMd,truncated,updatedAt,meta,sourcePath}`；查無回 404。key 含 `/` 時前端一定要 `encodeURIComponent`。

## GET /api/hermes-doc-search（原文全文搜尋，標頭 `x-admin-password`）
- 參數：`q`（去頭尾空白後 1～50 字，空白或過長回 400）、`limit`（整數 1～50，預設 30，不合法回 400）。
- 只搜 `kind=source` 的 title 與 bodyMd，不分大小寫子字串，`% _ \` 已跳脫。
- 回 `{results: [{key, title, meta, snippet, hitAt}]}`，依 `meta.date` 新到舊，null 排最後。`snippet` 是 bodyMd 第一個命中處前後各 60 字；只有標題命中時是 bodyMd 前 120 字。`hitAt` 是 bodyMd 命中的字元位置（只有標題命中時為 null）。

## GET /api/hermes-raw?path=（原檔，標頭 `x-admin-password`）
- `path` 是 vault「人類/」之下的相對路徑（開頭的 `人類/` 可省略）。拒絕 `..`、絕對路徑、反斜線、空字串、隱藏檔（回 400）。
- 根目錄由環境變數 `HERMES_RAW_ROOT` 指定（預設 `/data/raw`，compose 以唯讀掛載 `RAW_DIR`）；根目錄不存在回 503「原檔資料夾尚未掛載」。realpath 必須仍在根目錄之內，symlink 逃逸回 400。
- 後備：`HERMES_RAW_ROOT` 找不到時，再到 `HERMES_RAW_NAS_ROOT`（預設 `/data/raw-nas`，compose 以唯讀掛載 `RAW_NAS_DIR`；主機端由 HERMES 以 cifs 唯讀掛載家中 NAS、經 VPN）找。NAS 上的相對路徑是去掉開頭 `_pulled-from-home/`、`_staging-from-home/` 之後的 `rel`（可重複去掉）。兩邊都有同名檔案時，以 VPS 的為準。
- NAS 根目錄不存在（沒掛）時行為與沒有這項功能相同：找不到回 404。NAS 的 realpath／stat 整段有逾時（`RAW_NAS_TIMEOUT_MS`，預設 8000 毫秒）；逾時或 NAS 回 EIO、EHOSTDOWN、ETIMEDOUT、ENOTCONN 等連線錯誤時回 **504** `{"message":"家中 NAS 暫時連不到（VPN 可能斷線）"}`。NAS 內的 junction／symlink 逃逸同樣回 400。
- 斷路器：NAS 逾時或回上述連線錯誤後，`RAW_NAS_COOLDOWN_MS`（預設 60000 毫秒）內不再碰 NAS、直接回 504；同時未真正結束的 NAS fs 呼叫達 `RAW_NAS_MAX_INFLIGHT`（預設 2）時回 429「家中 NAS 忙碌中，請幾秒後再試」（忙碌不等於斷線）。VPS 有檔時一律照常回，不受斷路器影響。
- inline：pdf、png、jpg、jpeg、gif、webp、txt、csv。attachment（強制下載）：doc、docx、xls、xlsx、ppt、pptx、tif、tiff。其他副檔名回 415；超過 50 MB 回 413。
