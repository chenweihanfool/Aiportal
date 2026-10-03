# Claude session 注意事項

## 部署與 HERMES 控制頻道
這個 repo 由 HERMES（VPS 上的代理）合併與部署。Claude 不合併、不部署，只透過控制頻道 [chenweihanfool/hermes-control-channel PR #1](https://github.com/chenweihanfool/hermes-control-channel/pull/1) 留言請 HERMES 執行。

完整規則見 [hermes-control-channel 的 CLAUDE.md](https://github.com/chenweihanfool/hermes-control-channel/blob/main/CLAUDE.md)。最少要做到：

1. **標頭帶代號**：留言第一行寫 `[CLAUDE:<session id 末 8 碼>]`，回覆時接 `re:<comment id>`。不要只寫 `[CLAUDE]`。
2. **誰發誰接**：發出請求後，立刻訂閱 PR #1 的動態（`subscribe_pr_activity`，owner `chenweihanfool`、repo `hermes-control-channel`、pullNumber `1`），保持訂閱直到 HERMES 交出最終回報。否則收不到 HERMES 的回覆。
3. **只處理自己的**：`re:` 指向的不是自己的留言就略過，不向使用者回報。
4. **授權要逐字引用使用者原話並寫死範圍**：PR 與 head sha、只重建的服務（`--no-deps`）、不在授權內的項目、失敗時停下並回滾。
