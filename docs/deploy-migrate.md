# 部署與資料庫遷移（換一台主機也能一次成功）

遷移一律走版本化 SQL（`lib/db/migrations/`）：

```bash
docker compose --profile migrate run --build --rm db-migrate   # 先遷移
docker compose up -d --build                                    # 再重建服務
```

不要用 `drizzle-kit push`（見 `docker-compose.yml` 內 `db-migrate` 的註解）。

## 首次在新主機部署前的兩個前提

### 1. 網路：`db-migrate` 必須連得到資料庫

若 Postgres 是同一台 Docker 主機上、另一個網路裡的容器，`api-server` 與 `db-migrate` **都**要加入該網路，否則遷移會在 DNS 解析階段失敗（`getaddrinfo EAI_AGAIN pg13`，資料庫完全不會被動到）。

```bash
cp docker-compose.override.example.yml docker-compose.override.yml   # 改成實際的外部網路名稱
docker compose --profile migrate config | grep -B2 -A6 'db-migrate:\|api-server:'   # 兩者都應列出該網路
```

`docker-compose.override.yml` 是主機專屬檔（已加入 `.gitignore`），不必改動受版控的 `docker-compose.yml`，也就不會在 `git merge` 時與主機端修改衝突。

### 2. 權限：App 角色必須能寫遷移帳本

`DATABASE_URL` 的角色（例：`aiportal_user`）需要能建立／寫入 `drizzle.__drizzle_migrations`。

- **全新資料庫**：App 角色是 DB owner 時什麼都不用做，migrate 會自己建立 `drizzle` schema 與帳本。
- **帳本已存在、但 owner 是別的角色**（例：早年由 `postgres` 建立）：會看到 `permission denied for schema drizzle`，補完 CREATE 後再看到 `permission denied for sequence __drizzle_migrations_id_seq`。用超級使用者跑一次：

  ```bash
  psql -U postgres -d <資料庫名> -v app_role=<DATABASE_URL 的角色> -f lib/db/scripts/grant-drizzle-ledger.sql
  ```

  內容僅三行加權（`USAGE, CREATE ON SCHEMA drizzle`、帳本表的 DML、序列的 `USAGE, SELECT`）；可重複執行，可用 `REVOKE` 回退。

> **不要改用超級使用者跑遷移**：新表的 owner 會變成 `postgres`，App 角色之後對它 `permission denied for table`。讓 App 角色自己建表，owner 才會與其他資料表一致。

## 驗證（新主機照文件做完後）

```bash
docker compose --profile migrate run --build --rm db-migrate   # 預期最後一行：Migrations applied successfully
psql "$DATABASE_URL" -c "select count(*) from drizzle.__drizzle_migrations"          # 全新資料庫：筆數 = lib/db/migrations/meta/_journal.json 的 entries 數（歷史較久的主機可能因舊紀錄而多出幾列，只要新遷移已入帳即可）
psql "$DATABASE_URL" -c "select tablename, tableowner from pg_tables where schemaname='public' order by 1"  # owner 應全是 App 角色
docker compose --profile migrate run --rm db-migrate           # 再跑一次應為 no-op（仍成功）
```

失敗時 `migrate.mjs` 會依錯誤型態印出指向本文件的提示（連線解析失敗＝網路；`permission denied`＝權限）。
