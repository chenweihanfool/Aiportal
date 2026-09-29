// 執行：pnpm --filter @workspace/db run test（純邏輯，不連資料庫；目前不在根目錄 CI 的 test 範圍內）
import test from "node:test";
import assert from "node:assert/strict";
import { migrationHint } from "./migrate-hint.mjs";

test("DNS／連線類錯誤 → 指向網路設定", () => {
  for (const code of ["EAI_AGAIN", "ENOTFOUND", "ECONNREFUSED"]) {
    const hint = migrationHint(Object.assign(new Error("boom"), { code }));
    assert.match(hint, /docker-compose\.override\.example\.yml/);
  }
});

test("drizzle 把 pg 錯誤包在 cause 裡時也認得", () => {
  const err = new Error("Failed query");
  err.cause = Object.assign(new Error("getaddrinfo EAI_AGAIN pg13"), { code: "EAI_AGAIN" });
  assert.match(migrationHint(err), /同一網路/);
});

test("權限不足（SQLSTATE 42501 或訊息）→ 指向授權 SQL，且警告不要改用超級使用者", () => {
  const byCode = migrationHint(Object.assign(new Error("x"), { code: "42501" }));
  const byMsg = migrationHint(new Error("permission denied for schema drizzle"));
  for (const hint of [byCode, byMsg]) {
    assert.match(hint, /grant-drizzle-ledger\.sql/);
    assert.match(hint, /不要改用超級使用者/);
  }
});

test("其他錯誤（例如遷移 SQL 本身有誤）不加提示，避免誤導", () => {
  assert.equal(migrationHint(Object.assign(new Error('relation "x" already exists'), { code: "42P07" })), null);
  assert.equal(migrationHint(undefined), null);
});
