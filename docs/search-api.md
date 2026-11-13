# 入口網搜尋 API（omni-search，2026-11-13）

首頁「一個框搜全部」的後端。四個端點都要 `x-admin-password`（`isAuthorized`），沒有或不對回 **403** `{"message":"需要解鎖私領域才能查看"}`。程式：`artifacts/api-server/src/routes/search.ts`，純邏輯在 `src/lib/search.ts`（搜尋、驗證、stats、快取）與 `src/lib/searchPreview.ts`（預覽）。

## S1 `GET /api/search?q=&kind=&limit=`
- `q`：去頭尾空白後 1～50 字（否則 400）。以空白（含全形）切詞，最多 5 詞，每個詞都要命中（不分大小寫子字串，標題或內文）。
- `kind`：選填，`topic|case|person|object|event|concept|method|source|idea|place|trip|tool`，其他 400。`limit`：每組最多幾筆，1～20，預設 5。
- 回應：`{ q, total, tookMs, groups: [{ kind, count, items: [{kind,id,title,snippet,date}] }], best }`。
- `groups` 順序固定：case、topic、person、object、event、concept、method、source、idea、place、trip、tool；沒命中的組不出現；`count` 為該組命中總數。
- 組內排序級別：標題與整串查詢完全相同 → 標題以第一個詞開頭 → 標題含第一個詞 → 只有內文含；同級依 `date` 新到舊（null 最後），再依 title。`best`＝全部命中中級別最高者（同級依 kind 順序），沒命中為 null。
- `snippet`：第一個詞在內文第一次命中處前後各 40 字（截斷處加「…」）；只命中標題時取內文前 80 字；沒內文為空字串；最長 200 字。case／person／object 固定為最近一件事件的「日期 標題」。

### 資料來源
| kind | 來源 | 搜尋欄位 | date |
|---|---|---|---|
| topic | `feed_snapshot` name=`topics` 的 `payload.topics[]` | name、why、body | updated |
| case | `hermes_graph_snapshot` cases[].name ∪ events[].case | 名稱、hubNarratives.text | 最近事件日期 |
| person／object | events[].participants[].person／objects[].object | 名稱、hubNarratives.text | 最近事件日期 |
| event／concept／method／source | `hermes_doc` 同 kind（SQL ILIKE，萬用字元跳脫） | title、body_md | meta.date |
| idea | `hermes_ideas_snapshot.ideas[]` | title、why、category | lastMentioned 日期 |
| place | `hermes_places_snapshot.places[]` | name、area、cuisine、why、tags、mustTry | visitedAt ?? addedAt |
| trip | `hermes_trips_snapshot.trips[]` | name、area、summary | start |
| tool | `portal_sites` | name、subtitle | null |

### 行為與限制
- jsonb 快照在程序內快取 30 秒（`clearSearchCache()` 可清）；`hermes_doc` 走 SQL、不快取，四個 kind 一次查詢，每個詞 `title ILIKE OR body_md ILIKE`、詞與詞 AND，SQL 上限為每 kind 200 筆（為了算 count；超過 200 的 count 會被截在 200）。
- 查詢一律參數綁定；任何來源表為空、查詢失敗或格式不如預期，該 kind 當 0 筆，不會 500。jsonb 內欄位型別不對的那一筆略過。

## S2 `GET /api/search/preview?kind=&id=`
200：`{ kind, id, title, one, points[], related[{kind,id,title}], source, bodyMd }`；找不到 404；kind／id 不合法 400。
- `one`（≤200 字）、`points`（≤5 條、每條 ≤120 字）、`related`（≤8）、`source`（≤120 字）的推導規則見 `searchPreview.ts` 與 omni-search 規格 S2。
- `bodyMd`：topic／event／concept／method／source 給正文（最多 20000 字），其他 kind 為 null。不回傳 `sourcePath`。

## S3 `POST /api/search/log`
body：`{ q(1～50), kind|null, total(整數>=0), clickedKind|null, clickedId|null(≤200) }`，多餘欄位或不合法 400；成功 201 `{id}`。寫入新表 `search_log`（只新增）。

## S4 `GET /api/search/stats?days=`
`days` 1～90，預設 7。回應 `{ days, searches, zero, zeroRate, clicked, clickRate, topZero:[{q,count}] }`；rate 為 0～1、四捨五入到小數 3 位，searches 為 0 時 rate 為 0；topZero 最多 10 筆。

## 部署
新增資料表 `search_log`（migration `0029_*`），**部署要先跑 db-migrate**，再重建 api-server，最後才是 gis-portal。kb-pipeline 不用動。
