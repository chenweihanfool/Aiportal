# 首頁「現在用得上」卡片回饋 API（push-feedback，2026-11-13）

首頁卡片被看到／點開／標有用、晚點、沒用的後端。三個端點都要 `x-admin-password`（`isAuthorized`），沒有或不對回 **403** `{"message":"需要解鎖私領域才能查看"}`。程式：`artifacts/api-server/src/routes/pushFeedback.ts`，純邏輯（驗證、台北日期、統計、回應組裝）在 `src/lib/pushFeedback.ts`。

前端用這份資料把被標 `useless` 的卡片**永久**濾掉，把被標 `later` 的卡片收到**當天台北 20:00** 再顯示。

## P1 `POST /api/push/feedback`
body：`{ cardKey, cardKind, action, forDate }`，必須是物件、不認得的欄位回 400。

| 欄位 | 規則 |
|---|---|
| `cardKey` | 字串，trim 後 1～200 字 |
| `cardKind` | `topic｜resume｜recall｜quiet｜brief｜onthisday` |
| `action` | `shown｜opened｜useful｜useless｜later` |
| `forDate` | `^\d{4}-\d{2}-\d{2}$` 且是真實日曆日（擋 `2026-02-30`） |

任何一項不合法 → **400** `{message}`。

- `action="shown"`：同一 `(cardKey, forDate)` 已有 shown → **200** `{id: 既有那筆 id}`，不新增；否則新增 → **201** `{id}`。
- 其他 action 一律新增 → **201** `{id}`。

## P2 `GET /api/push/feedback?days=<1～90，預設 30>`
`days` 不合法 → **400**。回應：

```json
{
  "suppressed": ["recall:T1"],
  "later": [{ "cardKey": "topic:T1:case:王案", "until": "2026-11-13T20:00:00+08:00" }]
}
```

- `suppressed`：**曾經**被標 `useless` 的 cardKey（不受 days 限制，永久），去重後依 cardKey 字串排序。
- `later`：`for_date`＝今天（台北日期）且 `action="later"` 的 cardKey，去重、排序（依 cardKey）；`until`＝今天台北 20:00，固定寫成 `YYYY-MM-DDT20:00:00+08:00`。已在 `suppressed` 的鍵不再列進 `later`。
- `days` 目前只驗證範圍，先不影響查詢；保留給未來縮小查詢範圍用。

## P3 `GET /api/push/stats?days=<1～90，預設 14>`
`days` 不合法 → **400**。範圍＝`for_date` ≥ 今天（台北）−(days−1)。回應：

```json
{
  "days": 14, "shown": 10, "opened": 5, "openRate": 0.5,
  "useful": 3, "useless": 1, "uselessRate": 0.1,
  "byKind": [{ "kind": "topic", "shown": 4, "opened": 2, "useless": 0 }],
  "daysWithCards": 7
}
```

- `shown`／`opened`／`useful`／`useless`＝範圍內各 action 筆數（shown 本來就同一 `(cardKey, forDate)` 只一筆）。
- `openRate`＝opened÷shown、`uselessRate`＝useless÷shown：0～1、四捨五入到小數 3 位；分母 0 時為 0；大於 1 截為 1。
- `byKind`：六種 kind 固定順序 `topic, resume, recall, quiet, brief, onthisday` 全列（0 也列）。
- `daysWithCards`：範圍內有 shown 的不同 `for_date` 數。

## cardKey 組法
雜湊由前端計算；目的是鍵裡不放任務標題與人名原文。`matchedBy`／`caseName` 對應 feed `topic-nudges` 的選填欄位。

| cardKind | 格式 |
|---|---|
| topic | `topic:<topicId>:<matchedBy>:<caseName 或第一個觸發標題的雜湊>` |
| resume | `resume:<caseName>` |
| recall | `recall:<topicId>` |
| quiet | `quiet:<人名雜湊>` |
| brief | `brief:<日期>` |
| onthisday | `onthisday:<來源事件 id>` |

`cardKind` 必須是上表六種；`cardKey` 前綴與 `cardKind` 是否一致不在此端點驗證（前端自行遵守）。

## 表 `push_feedback`（只新增）
| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | serial pk | |
| `card_key` | text not null | 見上表 |
| `card_kind` | text not null | 六種 kind |
| `action` | text not null | 五種 action |
| `for_date` | text not null | 卡片代表的日期 `YYYY-MM-DD` |
| `created_at` | timestamptz not null default now() | |

索引 `(card_key, for_date)`。migration `0030_*`，只有 CREATE TABLE／CREATE INDEX。

## 時區規則
- 台北時區＝UTC+8，沒有夏令時間。
- 「今天」以台北日期為準：UTC 16:00（台北 00:00）換日；`for_date` 一律是台北日期字串。
- 「晚點」截止＝台北當天 20:00，回應字串固定 `YYYY-MM-DDT20:00:00+08:00`。

## 部署
新增資料表 `push_feedback`（migration `0030_*`），部署要先跑 db-migrate，再重建 api-server。feed `topic-nudges` 只是新增選填欄位、v1 不升版；推送端（kb-pipeline）送新欄位前要先上 api-server。
