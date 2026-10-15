# 遊記：趟次 API

入口網「📖 遊記」（`#trips` 列表、`#trips/<id>` 單趟）的資料來源。比照地點（`/api/hermes-places`）：**整份覆寫、只存一列 `latest`**，入口網只讀，權威資料在 HERMES（kb-pipeline）。

- 寫入：`POST /api/admin/hermes-trips`，由 HERMES 管線推上來（推送端在 kb-pipeline，不在本 repo）。
- 讀取：`GET /api/hermes-trips`，入口網解鎖後呼叫；沒解鎖、沒資料時前端退回示範趟次（標「示範資料」）。
- 資料表：`hermes_trips_snapshot`（`lib/db/src/schema/hermesTrips.ts`，遷移 `lib/db/migrations/0023_tranquil_bullseye.sql`）。
- 驗證：`artifacts/api-server/src/lib/hermesTrips.ts`（`sanitizeTripsPayload`）；前端對應 `artifacts/gis-portal/src/tripsApi.ts`（`parseTrip`）。

## POST /api/admin/hermes-trips

標頭：`x-admin-password: <管理員密碼>`，`Content-Type: application/json`。整包上限 2 MB。

```json
{
  "generatedAt": "2026-10-15",
  "trips": [
    {
      "id": "TRIP-20260919-north",
      "name": "北部週末小旅行",
      "start": "2026-09-19",
      "end": "2026-09-21",
      "status": "done",
      "area": "台北・新竹",
      "summary": "河岸早午餐、山城步道、海邊燈塔",
      "cover": "/media/trips/north-cover.webp",
      "placeIds": ["FOOD-0002", "FOOD-0011"],
      "days": [
        {
          "date": "2026-09-19",
          "title": "出發・河岸早午餐",
          "placeIds": ["FOOD-0002"],
          "entries": [
            {
              "time": "08:40",
              "text": "從大稻埕搭車到河岸，先找窗邊的位子。\n今天人不多。",
              "photos": [{ "url": "/media/trips/0919-1.webp", "thumb": "/media/trips/0919-1-t.webp", "w": 1600, "h": 1200, "takenAt": "2026-09-19", "caption": "河岸早餐" }],
              "photosPending": 0
            },
            { "time": "12:30", "text": "午後沿河走一段。", "photos": [], "photosPending": 1 }
          ]
        }
      ]
    }
  ]
}
```

```bash
curl -sS -X POST "https://<入口網網域>/api/admin/hermes-trips" \
  -H "Content-Type: application/json" \
  -H "x-admin-password: $ADMIN_PASSWORD" \
  --data @trips.json
# 200 {"success":true,"trips":1,"skipped":0}
```

### 趟次（Trip）

| 欄位 | 規則 |
|---|---|
| `id` | 必填，最長 60 字；重複時只留第一筆 |
| `name` | 必填，最長 200 字 |
| `start`、`end` | 必填，`YYYY-MM-DD` 且是真實存在的日期；`end ≥ start`，否則整筆略過 |
| `status` | `planned`／`ongoing`／`done`。不合法就依台北時間今天推：`end` 已過＝`done`，`start` 還沒到＝`planned`，其餘＝`ongoing` |
| `area`（最長 200）、`summary`（最長 2000） | 字串，空白當 null |
| `cover` | 相片網址，只收 `https://…` 或站內 `/…`（不含 `//`、不含空白、≤ 2048），否則 null |
| `placeIds` | 字串陣列，去重，最多 200 筆，每筆最長 40 字；對應 `hermes-places` 的 id，找不到就不畫在地圖上 |
| `days` | 見下 |

缺 `id`、`name`、合法日期，或 `end < start` 的趟次整筆略過，計入 `skipped`。

### 每日（Day）

- `date` 必須落在趟次的 `[start, end]` 內，否則略過該日。
- 同一天重複的 `date` 合併：條目併在一起、`title` 取第一個非空值、`placeIds` 合併去重。
- 每趟最多 **60 天**，超過的日子略過。
- 每天條目依 `time` 排序（同時間保留輸入順序），最多 **200 筆**。

### 條目（Entry）

| 欄位 | 規則 |
|---|---|
| `time` | 必填，`HH:MM`（00:00–23:59）；不合法整筆略過 |
| `text` | 純文字（日記原文，**不濃縮**），修剪後最長 **4000** 字，超過截斷；`\r\n` 統一成 `\n`。前端以純文字顯示，不渲染 HTML |
| `photos` | 同地點的相片規則，每個條目最多 **24** 張；每趟相片總數最多 **600** 張，超過的丟掉、不報錯 |
| `photosPending` | 整數 ≥ 0，不合法當 0。日記引用了、但還沒有可用網址的相片張數 |

`text` 為空、沒有相片、`photosPending` 為 0 的條目略過。

### 相片（photos[]）

欄位與規則同 `docs/places-api.md`：`url` 只收 `https://…` 或站內絕對路徑；`thumb` 同規則，不合法為 null；`w`、`h` 正數才收；`takenAt` 為 `YYYY-MM-DD`；`caption` 最長 500 字。

**相片檔案的儲存與提供目前沒做**，現在 `url` 只能指向既有的 https 或站內路徑。

### 上限與錯誤

- `trips` 最多 **50** 筆；超過回 400。
- 回應的 `trips` 是收下的筆數，`skipped` 是略過的趟次數（缺欄位、日期不合法、`end < start`、重複 id）。

## GET /api/hermes-trips

標頭：`x-admin-password: <解鎖權杖>`。

有資料：

```json
{ "available": true, "trips": [ /* 同 POST，已驗證；新的趟次在前（start 由新到舊，同日依 id） */ ], "generatedAt": "2026-10-15", "receivedAt": "2026-10-15T11:05:00.000Z" }
```

還沒有任何推送：

```json
{ "available": false, "trips": [], "generatedAt": null, "receivedAt": null }
```

## 錯誤碼

| 狀態 | 情況 | `message` |
|---|---|---|
| 403 | POST 沒有或密碼錯 `x-admin-password` | `需要管理員權限` |
| 403 | GET 沒有解鎖權杖 | `需要解鎖私領域才能查看` |
| 400 | body 不是物件 | `body 不是物件` |
| 400 | `trips` 不是陣列 | `trips 不是陣列` |
| 400 | `trips` 超過 50 筆 | `trips 超過 50 筆` |

## 前端行為（參考）

- 解鎖後同時讀 `/api/hermes-trips` 與 `/api/hermes-places`（地點只用來畫這趟的小地圖與每天的路線文字）。
- `available` 為 true 且至少 1 趟 → 顯示真資料；`available` 為 false、0 趟、或讀取失敗 → 退回示範趟次，標「示範資料」，讀取失敗時多一行「讀取失敗，顯示示範資料」。
- 沒解鎖 → 示範資料，多一行「解鎖私領域後會顯示你的真實遊記」。
- 讀取中只顯示「載入中…」，不先閃示範資料。
- 「n 天」是趟次的日期跨度（含頭尾），不是有紀錄的天數。
