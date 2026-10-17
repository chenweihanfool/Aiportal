# Ollama 餘額自動推送（2026-10-17）

ollama.com 有官方餘額端點，HERMES 的推送器（VPS 端，金鑰留在 VPS）定期讀它，推到入口網。

## 讀取
```
GET https://ollama.com/api/balance
Authorization: Bearer $OLLAMA_API_KEY
→ { "included": { "balance_usd", "allowance_usd", "period": { "from", "until" } },
    "purchased": { "balance_usd" } }
```

## 推送
`POST /api/admin/ollama-balance`（header `x-admin-password`），body：

| 欄位 | 來源 |
|---|---|
| `balanceUsd` | `included.balance_usd + purchased.balance_usd` |
| `capUsd` | `included.allowance_usd` |
| `refillAt` | `included.period.until` 取 `YYYY-MM-DD`（台北日） |
| `monthUsedUsd` | `included.allowance_usd − included.balance_usd` |
| `note` | 固定 `"auto"` |

- 建議每 10 分鐘一次，可併入既有的推送總管。
- 伺服器對 `note: "auto"` 去重：餘額／補點日／本月已用都沒變且最新一筆不到 1 小時，回 `{ success: true, skipped: true }` 不寫入（`shouldSkipAutoBalance`）。
- 讀取失敗就不推（不要推 0）；入口網的手動輸入表單保留當備援。
- 另有 `GET /api/usage?range=7d&group_by=model`（整個帳號的用量），目前不接；圖表仍只有 HERMES 這台的請求數。
