# 知識頁更正 API

使用者對知識頁某一條的更正：不對（`wrong`）、改寫（`fix`）、補一句（`add`）、撤回（`undo`）。
入口網只收下與保存，不主動寫回知識庫；知識庫管線帶管理密碼來 GET，自己套用後再推送更新後的 `topics` feed。

## 為什麼只新增、不修改、不刪除
更正是原始資料，不是可覆寫的狀態：保留每一筆可回溯「誰在什麼時候改了什麼」，也讓管線可以用 `after` 增量拉取、重跑時得到相同結果。撤回不是刪除原更正，而是再新增一筆 `undo`（`claimId` 指向被撤回的那一條）；因此資料表沒有 PUT／PATCH／DELETE。

資料表 `knowledge_corrections`（migration `0028`）：`id` serial 主鍵、`topic_id`、`claim_id`（可空）、`kind`、`section`（可空）、`text`（可空）、`created_at`（timestamptz，預設 now）。

## 驗證
兩個端點都看標頭 `x-admin-password`（同其他私領域端點）；沒帶或不對回 **401**。

## GET /api/knowledge/corrections?after=&lt;id&gt;
- `after` 省略時為 0；只接受非負整數字串，其他（負數、小數、空白、空字串、重複參數）回 **400** `{"message":…}`。
- 只回 `id > after` 的更正，依 `id` 遞增，最多 500 筆。
- 200：`{"corrections":[{"id","topicId","claimId","kind","section","text","createdAt"}]}`，`createdAt` 為 ISO 8601 字串。

## POST /api/knowledge/corrections
本文必須是物件，只接受下列五個鍵；出現其他鍵整筆回 **400**：

| 欄位 | 規則 |
|---|---|
| `topicId` | 必填，符合 `^T[0-9]{8}-[0-9]{2,4}$` |
| `kind` | 必填，`wrong`／`fix`／`add`／`undo` |
| `claimId` | `wrong`／`fix`／`undo` 必填，`add` 可省略或 null；有值要符合 `^c[0-9]{3,5}$` |
| `text` | `fix`／`add` 必填，去頭尾空白後 1–500 字、不得含換行；`wrong`／`undo` 不得帶非空 `text` |
| `section` | 只有 `add` 可帶，去頭尾空白後 1–40 字；其他 kind 帶了回 400 |

- 驗證不過回 **400** `{"message":…}`（繁體中文）。
- 成功回 **201** 與新增的那一筆，形狀同 GET 的單筆。

## 回應碼一覽
| 狀況 | 回應 |
|---|---|
| 成功讀取 | 200 |
| 成功新增 | 201 |
| 沒有管理員權限 | 401 |
| `after` 不合法、本文不符規則 | 400 |
