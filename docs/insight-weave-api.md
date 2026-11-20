# 心得編織層（insight-weave）API

心得編織層是 kb-pipeline 每週產生、推送進入口網的資料：燈塔（L）、橋（B）、張力（T）、知識庫交織（K）。
內容本身走泛用 feed `insight-weave`（v1，schema 見 `schemas/feeds/insight-weave.v1.schema.json`，契約與 `docs/feed-api.md` 相同）；
使用者對每一條的確認／否決（`ok`／`no`／`undo`）走下面兩個端點。

## 為什麼只新增、不修改、不刪除
使用者判斷是原始資料，不是可覆寫的狀態：保留每一筆可以回溯「誰在什麼時候對哪一條做了什麼」，
也讓管線可以用 `after` 增量拉取、重跑時得到相同結果。撤回不是刪除原判斷，而是再新增一筆 `undo`；
因此資料表沒有 PUT／PATCH／DELETE。

資料表 `insight_weave_verdicts`（migration `0033`）：`id` serial 主鍵、`item_id`、`verdict`、`created_at`（timestamptz，預設 now）。

## 驗證
兩個端點都看標頭 `x-admin-password`（同其他私領域端點）；沒帶或不對回 **401**。

## GET /api/insights/weave/verdicts?after=&lt;id&gt;
- `after` 省略時為 0；只接受非負整數字串，其他（負數、小數、空白、空字串、重複參數）回 **400** `{"message":…}`。
- 只回 `id > after` 的判斷，依 `id` 遞增，最多 500 筆。
- 200：`{"verdicts":[{"id","itemId","verdict","createdAt"}]}`，`createdAt` 為 ISO 8601 字串。

## POST /api/insights/weave/verdicts
本文必須是物件，只接受下列兩個鍵；出現其他鍵整筆回 **400**：

| 欄位 | 規則 |
|---|---|
| `itemId` | 必填，符合 `^[LBTK]-[0-9a-f]{8}$`（L 燈塔、B 橋、T 張力、K 知識庫交織） |
| `verdict` | 必填，`ok`（確認）／`no`（否決）／`undo`（撤回先前某一筆判斷） |

- 驗證不過回 **400** `{"message":…}`（繁體中文）。
- 成功回 **201** 與新增的那一筆，形狀同 GET 的單筆。

## 回應碼一覽
| 狀況 | 回應 |
|---|---|
| 成功讀取 | 200 |
| 成功新增 | 201 |
| 沒有管理員權限 | 401 |
| `after` 不合法、本文不符規則 | 400 |

## 路由位置
`GET`／`POST /api/insights/weave/verdicts` 是兩段路徑，不會與 `GET /api/insights/:id`（單段心得 id）衝突；
掛載順序上仍先掛編織層路由（`routes/index.ts`）。`GET /api/insights/INS-…` 照舊由心得路由處理。

## 管線怎麼拉
1. `GET /api/feed/insight-weave`（標頭 `x-admin-password`）取最新一份編織層 payload。
2. 記住上次套用到哪一筆判斷，下一次用 `GET /api/insights/weave/verdicts?after=<上次的 id>` 增量拉取。
3. 依 `itemId` 對回 L／B／T／K 條目套用 `ok`／`no`／`undo`，重跑時結果相同；入口網不反向寫回知識庫。
4. 套用後重新產生 payload，用 `POST /api/admin/feed/insight-weave`（`schemaVersion` 1）推送更新後的版本。
