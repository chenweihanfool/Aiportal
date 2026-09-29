// migrate.mjs 失敗時，對已知的兩類「環境問題」補一行指向 docs/deploy-migrate.md 的提示。
// 獨立成檔是為了能不連資料庫就單元測試；不影響遷移本身的行為（錯誤照原樣重新拋出）。

export function migrationHint(err) {
  const code = err?.code ?? err?.cause?.code;
  const msg = String(err?.message ?? "");
  if (["EAI_AGAIN", "ENOTFOUND", "ECONNREFUSED"].includes(code)) {
    return "無法連到資料庫。若 Postgres 在另一個 Docker 網路，db-migrate 必須加入同一網路（見 docker-compose.override.example.yml、docs/deploy-migrate.md）。";
  }
  if (code === "42501" || /permission denied/i.test(msg)) {
    return "資料庫角色權限不足。若 drizzle schema／帳本的 owner 不是 DATABASE_URL 的角色，請照 docs/deploy-migrate.md 執行 lib/db/scripts/grant-drizzle-ledger.sql（不要改用超級使用者跑遷移）。";
  }
  return null;
}
