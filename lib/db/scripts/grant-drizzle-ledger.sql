-- 讓 App 角色（DATABASE_URL 用的那個，例：aiportal_user）能寫遷移帳本。
--
-- 什麼時候需要：`drizzle` schema 與 `drizzle.__drizzle_migrations` 已經存在、但 owner 不是 App 角色
-- （例如早年由 postgres 超級使用者建立）。症狀：
--   permission denied for schema drizzle
--   permission denied for sequence __drizzle_migrations_id_seq
-- 全新資料庫不需要：App 角色是 DB owner 時，migrate 會自己建立 drizzle schema 與帳本。
--
-- 用法（用 postgres 超級使用者或帳本 owner 執行；:app_role 換成 DATABASE_URL 裡的角色）：
--   psql -U postgres -d aiportal -v app_role=aiportal_user -f lib/db/scripts/grant-drizzle-ledger.sql
--
-- 只做「加權」，可回退（REVOKE 同樣的項目）；可重複執行。
-- 不要改用超級使用者跑遷移：新表的 owner 會變成 postgres，App 角色之後會 permission denied for table。
GRANT USAGE, CREATE ON SCHEMA drizzle TO :"app_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA drizzle TO :"app_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA drizzle TO :"app_role";
