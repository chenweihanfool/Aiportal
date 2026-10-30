# 幸福指數：每日歷史 API（含每面向）

新首頁 ② 六張面向小卡的 30 天迷你線資料來源。完整背景與限制見 `docs/portal-audit-2026-10.md` §4.14。

- 讀取：`GET /api/happiness/history?days=N`（`artifacts/api-server/src/routes/dashboard.ts`），需 `x-admin-password`，沒解鎖回 403。
- 資料表：`happiness_index_history`（`lib/db/src/schema/happinessIndexHistory.ts`）；沒有新增欄位或遷移。
- 計算：`artifacts/api-server/src/lib/happinessDimensionHistory.ts`（純函式）；與 `/api/dashboard` 共用同一套規則。2026-10-30 起面向分數就是公式分，不再排百分位。
- 前端對應：`artifacts/gis-portal/src/boardApi.ts` 的 `HhiHistoryPoint.components?`、`parseHhiHistory`。

`days`：預設 30，上限 365，非數字或 ≤ 0 退回 30（與之前相同）。排序舊 → 新。

```json
{
  "history": [
    {
      "date": "2026-10-14",
      "finalScore": 62,
      "displayedScore": 61,
      "weakestComponent": "生活從容",
      "dayScore": 72,
      "dayAdjust": 3,
      "components": {
        "lifeFreedom": 71,
        "fitness": 55,
        "calm": null,
        "mind": 40,
        "social": 83,
        "travel": 100
      }
    }
  ]
}
```

- `components` 的 key ＝ `/api/dashboard` 的 hhi 各面向 id（`lifeFreedom／fitness／calm／mind／social／travel`，也是前端 `homeDimensions.ts` 的 key），六個 key 一定都在。
- 值＝該天的面向分數（公式分，0–100 整數）。那天那個面向沒有資料＝`null`（不是 0）；不同一把尺的舊列也是 `null`：心智 2026-10-31 前、社交 2026-10-27 前。
- `dayScore`／`dayAdjust`＝當天 23:55 存下的每日評分與幸福指數修正；2026-10-30 之前的列是 `null`。
