# 美食及旅遊地圖：地點 API

入口網「🍜🧭 美食及旅遊地圖」（`#food`）的資料來源。比照想法庫（`/api/hermes-ideas`）：**整份覆寫、只存一列 `latest`**，入口網只讀，權威資料在 HERMES（kb-pipeline）。

- 寫入：`POST /api/admin/hermes-places`，由 HERMES 管線推上來。
- 讀取：`GET /api/hermes-places`，入口網解鎖後呼叫；沒解鎖、沒有資料時前端退回示範資料。
- 資料表：`hermes_places_snapshot`（`lib/db/src/schema/hermesPlaces.ts`，遷移 `lib/db/migrations/0022_wooden_steve_rogers.sql`）。
- 驗證：`artifacts/api-server/src/lib/hermesPlaces.ts`（`sanitizePlacesPayload`）。欄位與前端 `artifacts/gis-portal/src/foodMap.ts` 的 `FoodPlace` 相同。

## POST /api/admin/hermes-places

標頭：`x-admin-password: <管理員密碼>`，`Content-Type: application/json`。整包大小上限 2 MB（`express.json`）。

```json
{
  "generatedAt": "2026-10-15",
  "places": [
    {
      "id": "FOOD-0001",
      "name": "巷口牛肉麵",
      "kind": "food",
      "status": "want",
      "area": "台北 大安",
      "address": "台北市大安區……",
      "lat": 25.0330,
      "lng": 121.5434,
      "cuisine": "牛肉麵",
      "tags": ["宵夜", "一個人"],
      "priceLevel": 2,
      "why": "同事說湯頭是近年喝過最清的",
      "source": "同事",
      "mustTry": ["清燉牛肉麵"],
      "rating": null,
      "addedAt": "2026-06-02",
      "visitedAt": null,
      "days": ["2026-06-02"],
      "mapUrl": "https://www.google.com/maps/place/?q=25.0330,121.5434",
      "photos": [
        { "url": "/media/food/0001-a.webp", "thumb": "/media/food/0001-a-t.webp", "w": 1600, "h": 1200, "takenAt": "2026-06-02", "caption": "招牌" }
      ]
    }
  ]
}
```

```bash
curl -sS -X POST "https://<入口網網域>/api/admin/hermes-places" \
  -H "Content-Type: application/json" \
  -H "x-admin-password: $ADMIN_PASSWORD" \
  --data @places.json
# 200 {"success":true,"places":1,"skipped":0}
```

### 欄位

| 欄位 | 型別 | 規則 |
|---|---|---|
| `id` | string | 必填，最長 40 字，例如 `FOOD-0001`；重複時只留第一筆 |
| `name` | string | 必填，修剪後最長 200 字 |
| `kind` | string | `food`／`sight`／`stay`／`other`；不合法退回 `food` |
| `status` | string | 必填：`want`／`visited`／`favorite`／`skip`；不合法整筆略過 |
| `lat`、`lng` | number | **必填且合法**：lat -90..90、lng -180..180，皆為有限數字 |
| `addedAt` | string | 必填，`YYYY-MM-DD` |
| `area`、`address`、`cuisine`、`why`、`source`、`mapUrl` | string／null | 修剪後最長 500 字，空字串當 null |
| `tags`、`mustTry`、`days` | string[] | 各最多 50 項；`days` 只留 `YYYY-MM-DD` |
| `priceLevel` | number／null | 1–4，超出為 null |
| `rating` | number／null | 1–5，超出為 null |
| `visitedAt` | string／null | `YYYY-MM-DD`，不合法為 null |
| `photos` | array | 最多 24 張，見下 |
| `generatedAt`（整包） | string／null | `YYYY-MM-DD`，不合法為 null |

**相片**（`photos[]`）：

- `url`：只接受 `https://…`，或站內絕對路徑 `/…`（不含 `//`）；不得含空白；其餘（`javascript:`、`data:`、`http:` 等）整張丟掉。
- `thumb`：同上規則，不合法時為 null（不丟整張）。
- `w`、`h`：正數才收，否則 null。`takenAt`：`YYYY-MM-DD`，否則 null。`caption`：修剪後最長 500 字。

### 座標與略過規則

**沒有合法座標的地點整筆略過，不報錯，計入 `skipped`**（使用者 2026-10-15：「找不到地點就略過」）。

- 有 `lat`／`lng` 且合法 → 用它。
- 缺一或不合法，但 `mapUrl` 含座標（`/@lat,lng`、`?q=lat,lng`、`?ll=`、`!3d…!4d…`）→ 從連結取座標。
- 短網址（`maps.app.goo.gl` 等）取不到座標 → 略過。
- 缺 `id`／`name`／合法 `status`／`addedAt` → 略過。
- 重複 `id` 的後續筆 → 略過。

### 上限與錯誤

- `places` 最多 2000 筆；超過回 400。
- 回應的 `places` 是**收下的筆數**，`skipped` 是**略過的筆數**（含上面所有原因）。

## GET /api/hermes-places

標頭：`x-admin-password: <解鎖權杖>`（與其他私領域 API 相同）。

```bash
curl -sS "https://<入口網網域>/api/hermes-places" -H "x-admin-password: $UNLOCK_TOKEN"
```

有資料：

```json
{ "available": true, "places": [ /* 同 POST 的 places，已驗證、依 id 排序 */ ], "generatedAt": "2026-10-15", "receivedAt": "2026-10-15T11:05:00.000Z" }
```

還沒有任何推送過來：

```json
{ "available": false, "places": [], "generatedAt": null, "receivedAt": null }
```

## 錯誤碼

| 狀態 | 情況 | 回應 `message` |
|---|---|---|
| 403 | POST 沒有或密碼錯 `x-admin-password` | `需要管理員權限` |
| 403 | GET 沒有解鎖權杖 | `需要解鎖私領域才能查看` |
| 400 | body 不是物件 | `body 不是物件` |
| 400 | `places` 不是陣列 | `places 不是陣列` |
| 400 | `places` 超過 2000 筆 | `places 超過 2000 筆` |

## 前端行為（參考）

- 解鎖後呼叫 GET；`available` 為 true 且至少 1 筆 → 顯示真資料，標題旁顯示「資料：MM/DD HH:mm」（台北時間）。
- `available` 為 false、0 筆、或讀取失敗 → 退回示範資料並標「示範資料・尚未接知識庫」；讀取失敗時多一行「讀取失敗，顯示示範資料」。
- 沒有解鎖 → 示範資料，多一行「解鎖私領域後會顯示你的真實地點」。
- 讀取中只顯示「載入中…」，不先閃示範資料。
