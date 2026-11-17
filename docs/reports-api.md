# 報告庫 API

入口網首頁右欄「報告庫」用。報告放在家中 NAS 的 `Vault/報告/`（唯讀），由使用者本機腳本產生
`index.html`、`reports.json` 與年度資料夾；api-server 只讀不寫。

## 設定

| env | 說明 |
|---|---|
| `REPORTS_ROOT` | 報告庫根目錄。未設時＝`HERMES_RAW_NAS_ROOT`（預設 `/data/raw-nas`）的上一層加上 `報告`。 |
| `RAW_NAS_TIMEOUT_MS` | NAS 讀取逾時，預設 8000 毫秒。 |
| `RAW_NAS_COOLDOWN_MS`／`RAW_NAS_MAX_INFLIGHT` | 與 `hermesRaw` 共用同一個 `nasGuard` 斷路器：冷卻中直接 504、同時讀取達上限 429。 |

權限與其他私領域 API 相同：請求需帶 `x-admin-password`（或通過登入閘），否則 403。

## `GET /api/reports/catalog`

讀根目錄的 `reports.json`。

- 成功：`{ "available": true, "count": 7, "generatedAt": "...", "latest": [...] }`
  `latest` 最多 5 筆，每筆只含 `path`、`title`、`date`、`project`、`tags`、`status`、`summary`（不回 `source`、`bytes`）。
- 根目錄或 `reports.json` 不存在：`{ "available": false, "reason": "報告庫尚未建立" }`
- JSON 壞掉或格式不對：`{ "available": false, "reason": "報告庫目錄格式不正確" }`（不回應 500）
- NAS 逾時／連線錯誤：504 `{ "message": "家中 NAS 暫時連不到（VPN 可能斷線）" }`；忙碌：429。

## `GET /api/reports/file/*path`

串流輸出報告 HTML，例如 `/api/reports/file/2026/2026-11-17_專案_標題.html`。

- 只接受 `.html`／`.htm`，其他副檔名 415。
- 路徑段不可為空、`.`、`..`、以 `.` 開頭，不可含 `\` 或 NUL，總長 ≤ 400，否則 400；realpath 後必須在根目錄內（擋 symlink 逃逸），否則 400；不存在 404；超過 20 MB 413。
- 回應標頭：`Content-Type: text/html; charset=utf-8`、`X-Content-Type-Options: nosniff`、`Cache-Control: private, no-cache`、`Referrer-Policy: no-referrer`。

### 為什麼用沙箱 CSP

報告是使用者自己產生的 HTML（可能含腳本），但會用入口網的登入 cookie 開在新分頁，所以回應加上：

```
Content-Security-Policy: sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-forms
```

沙箱且**沒有** `allow-same-origin`：報告內的腳本拿不到入口網的 cookie、不能以使用者身分呼叫 API。
`allow-popups` 讓報告內的連結仍可開新分頁。
