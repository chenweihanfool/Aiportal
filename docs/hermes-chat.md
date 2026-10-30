# 入口網內建 HERMES 對話與重啟 Gateway

使用者 2026-10-30：「是否可以在入口網內建類似telegram的HERMES交互介面?」「有自動1小時new session的功能嗎? 我怕一個SESSION一直養 吃TOKEN」「還有restart gateway功能 也是比較常用」「開工」。

## 架構
瀏覽器 → api-server（`routes/hermesChat.ts`）→ HERMES API（`http://hermes:8642`，pgnet）。金鑰 `HERMES_API_KEY` 只在伺服器。

- **走 `/v1/runs`，不走 `/api/sessions/{id}/chat/stream`**：session 串流沒有核准回呼，HERMES 的 `unattended_mode=approve` 會直接放行危險指令；`/v1/runs` 才有 `approval.request`。核准卡只給「允許一次」「拒絕」，60 秒沒回應 HERMES 會自動拒絕。
- **閒置換 session**：`hermes_chat_state` 記目前 session 與最後訊息時間，閒置滿 `HERMES_CHAT_IDLE_MINUTES`（預設 60）分鐘後，下一則訊息開新 session。HERMES 核心沒有閒置重置，只會自動壓縮。實測一句「ok」約 1.6 萬 input tokens（系統提示與記憶），長對話成本更高。
- **事件流只能讀一次**：HERMES 在訂閱者斷線時就丟掉佇列，再讀回 404。瀏覽器斷線時 api-server 繼續讀完上游，前端改查 `GET /hermes-chat/runs/:id`。
- **API 沒有 clarify**：HERMES 要反問時會直接回文字，下一則再回答。
- **和 Telegram 是兩串**：session key 含平台，長期記憶共用。

- **浮動視窗，不是抽屜**（使用者：「想法庫會蓋掉HERMES對話框」）：開著抽屜也能用；關掉只是隱藏，回覆不中斷。想法的狀態按鈕直接把句子帶進對話框。

## 重啟 Gateway
對話 API 跑在 Gateway 裡，卡住時叫不動，所以重啟不經過它：入口網寫一列 `hermes_restart_request`，VPS 主機的 `hermes-restart-watcher`（kb-pipeline `deploy/hermes-restart/`，systemd timer 每 15 秒）認領並執行寫死的指令。api-server 碰不到 Docker。

| 方式 | 指令 | 行為 |
|---|---|---|
| 優雅重啟 | 容器內對 gateway 送 SIGUSR1（等同 `/restart`） | 等進行中的工作收尾，上限約 30 分鐘；watcher 等 180 秒，沒恢復就標 timeout |
| 強制重啟 | `docker restart hermes` | 立刻重啟，中斷進行中的工作 |

不會自動升級成強制：強制會砍工作，要由人決定。成功後 5 分鐘內不能再按。

## 部署（需使用者放行）
1. Aiportal：db-migrate（0026）→ `.env` 設 `HERMES_API_KEY`（與 HERMES 的 `API_SERVER_KEY` 同一把）→ `docker-compose.override.yml` 讓 api-server 加入 pgnet（已在就略過）→ 重建 api-server、gis-portal。
2. HERMES：`.env` 加 `API_SERVER_HOST=0.0.0.0` 並重啟 gateway。沒有 PortBindings、Caddy 也沒有 8642 路由，不會對外；同 docker network 的容器要 Bearer 金鑰才打得進去。
3. 主機：照 kb-pipeline `deploy/hermes-restart/README.md` 安裝 timer。
