# 入口網搜尋 API（omni-search，2026-11-13）

首頁「一個框搜全部」的後端。五個端點都要 `x-admin-password`（`isAuthorized`），沒有或不對回 **403** `{"message":"需要解鎖私領域才能查看"}`。程式：`artifacts/api-server/src/routes/search.ts`，純邏輯在 `src/lib/search.ts`（搜尋、驗證、stats、快取）與 `src/lib/searchPreview.ts`（預覽）。

## S1 `GET /api/search?q=&kind=&limit=&month=&before=`
- `q`：去頭尾空白後 1～50 字（否則 400）。以空白（含全形）切詞，最多 5 詞，每個詞都要命中（不分大小寫子字串，標題或內文）。
- `kind`：選填，`topic|case|person|object|event|concept|method|source|diary|idea|place|trip|tool`，其他 400。`limit`：每組最多幾筆，1～20，預設 5。
- `month`／`before`：選填，格式 `YYYY-MM`（月 01～12，否則 400），兩者同時給 400。`month=2026-03` 只留日期在該月的命中；`before=2024-12` 只留日期早於該月（前 7 碼字串比較）的命中；沒有日期的命中在有 `month`／`before` 時一律排除。`groups[].count`、`total`、`best`、`items` 都是篩選後的結果。
- 回應：`{ q, total, tookMs, groups: [{ kind, count, items: [{kind,id,title,snippet,date}] }], best, facets: { months: [{ ym, n }] } }`。
- `facets.months`：命中按月的數量，`ym` 為 `YYYY-MM`、`n` 為筆數，依 `ym` 由舊到新，只列 `n>0`。統計範圍與 `groups` 相同的 `q`／`kind` 條件，但**不套** `month`／`before`（直方圖點下去不會跟著縮）。`hermes_doc` 部分另以同條件 `count(*)` 按 `meta.date` 前 7 碼分組、不受 200 筆上限影響，查詢失敗只記 log、該部分當 0；其他 kind 由記憶體候選計數（只計非 `hermes_doc` 的 kind，避免重複）。沒有 `month`／`before` 時 `sum(n)`＝所有有日期命中數；給 `month=X` 時 `total`＝該月在 `facets.months` 的 `n`。
- `groups` 順序固定：case、topic、person、object、event、concept、method、source、diary、idea、place、trip、tool；沒命中的組不出現；`count` 為該組命中總數。
- 組內排序級別：標題與整串查詢完全相同 → 標題以第一個詞開頭 → 標題含第一個詞 → 只有內文含；同級依 `date` 新到舊（null 最後），再依 title。`best`＝全部命中中級別最高者（同級依 kind 順序），沒命中為 null。
- `snippet`：第一個詞在內文第一次命中處前後各 40 字（截斷處加「…」）；只命中標題時取內文前 80 字；沒內文為空字串；最長 200 字。case／person／object 固定為最近一件事件的「日期 標題」。

### 資料來源
| kind | 來源 | 搜尋欄位 | date |
|---|---|---|---|
| topic | `feed_snapshot` name=`topics` 的 `payload.topics[]` | name、why、body | updated |
| case | `hermes_graph_snapshot` cases[].name ∪ events[].case | 名稱、hubNarratives.text | 最近事件日期 |
| person／object | events[].participants[].person／objects[].object | 名稱、hubNarratives.text | 最近事件日期 |
| event／concept／method／source | `hermes_doc` 同 kind（SQL ILIKE，萬用字元跳脫） | title、body_md | meta.date |
| diary | `hermes_doc` kind=diary（一整天的日記全文） | title、body_md | key（日期，`YYYY-MM-DD`；不靠 meta.date） |
| idea | `hermes_ideas_snapshot.ideas[]` | title、why、category | lastMentioned 日期 |
| place | `hermes_places_snapshot.places[]` | name、area、cuisine、why、tags、mustTry | visitedAt ?? addedAt |
| trip | `hermes_trips_snapshot.trips[]` | name、area、summary | start |
| tool | `portal_sites` | name、subtitle | null |

### 行為與限制
- jsonb 快照在程序內快取 30 秒（`clearSearchCache()` 可清）；`hermes_doc` 走 SQL、不快取，五個 kind 一次查詢，每個詞 `title ILIKE OR body_md ILIKE`、詞與詞 AND，SQL 上限為每 kind 200 筆（只為 items 取列；count 另以同條件 `count(*)` 查詢，不受 200 限制）。
- 查詢一律參數綁定；任何來源表為空、查詢失敗或格式不如預期，該 kind 當 0 筆，不會 500。jsonb 內欄位型別不對的那一筆略過。

## S2 `GET /api/search/preview?kind=&id=`
200：`{ kind, id, title, one, points[], related[{kind,id,title}], source, bodyMd }`；找不到 404；kind／id 不合法 400。
- `one`（≤200 字）、`points`（≤5 條、每條 ≤120 字）、`related`（≤8）、`source`（≤120 字）的推導規則見 `searchPreview.ts` 與 omni-search 規格 S2。
- `bodyMd`：topic／event／concept／method／source／diary 給正文（最多 20000 字），其他 kind 為 null。diary 的 `source` 顯示「日記 YYYY-MM-DD」（日期取 id）。不回傳 `sourcePath`。

## S3 `POST /api/search/log`
body：`{ q(1～50), kind|null, total(整數>=0), clickedKind|null, clickedId|null(≤200) }`，多餘欄位或不合法 400；成功 201 `{id}`。寫入新表 `search_log`（只新增）。

## S4 `GET /api/search/stats?days=`
`days` 1～90，預設 7。回應 `{ days, searches, zero, zeroRate, clicked, clickRate, topZero:[{q,count}] }`；rate 為 0～1、四捨五入到小數 3 位，searches 為 0 時 rate 為 0；topZero 最多 10 筆。

## S5 `GET /api/search/recent?limit=`
最近搜尋的詞（首頁右欄 STATUS 的「最近」小盒）。`limit` 選填，1～20 的整數，預設 5；`0`、`21`、`abc`、`1.5`、空字串 → 400 `{"message":"limit 必須是 1～20 的整數"}`。
- 回應：`{ "recent": ["詞1", "詞2", ...] }`。只回詞（字串陣列），不回 id、時間、筆數。
- 依 `q` 去重（完全相同字串才算重複），每個詞用它**最後一次**出現的 `created_at` 排序，新到舊，最多 `limit` 個（SQL `group by q order by max(created_at) desc, q limit n`）。
- 表是空的 → `{ "recent": [] }`。

## 部署
新增資料表 `search_log`（migration `0029_*`），**部署要先跑 db-migrate**，再重建 api-server，最後才是 gis-portal。kb-pipeline 不用動。
