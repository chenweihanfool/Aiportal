# Busyness index

Standalone Python module. Computes a 0–100 "how busy is this Vikunja
instance's owner right now" score from four independent sub-scores. Lower is
better (0 = very relaxed, 100 = overloaded) — the inverse of the other two
composite indices in the dashboard (人生自由指數 / 運動習慣指數), which are
higher-is-better.

## Files

| File | Purpose |
|---|---|
| `busyness_index.py` | The four sub-score calculators + weighted aggregation |
| `config.py` | Weights and thresholds, `get_config_version()` (see the change-log warning at the top) |
| `vikunja_client.py` | Minimal read-only Vikunja REST API client |
| `db.py` | SQLite storage for the monthly overdue-pressure baseline |
| `history_db.py` | Postgres storage for the daily `busyness_index_history` table (shared Aiportal DB) |
| `snapshot.py` | Standalone cron entry point — writes only today's overdue-pressure snapshot to SQLite |
| `compute_daily.py` | Full daily cron entry point — computes the score, writes to Postgres + SQLite, fails loudly |
| `integration_check.py` | Manual, human-run script against the REAL Vikunja + Postgres — not part of pytest |
| `test_busyness_index.py` | pytest suite, hand-verified against the spec's acceptance scenarios |

## Setup

```bash
pip install -r requirements.txt
export VIKUNJA_URL=https://your-vikunja-instance
export VIKUNJA_TOKEN=<read-only API token>
export DATABASE_URL=<Aiportal's shared Postgres connection string>
```

## Running tests

```bash
python -m pytest -v
```

The suite never touches a real Vikunja instance or a real Postgres/SQLite
database — `history_db.py`'s SQL-building is a pure function
(`build_upsert`) tested by asserting on the SQL string and params, not by
executing it. Use `integration_check.py` to verify against the real thing.

## Cron

```
# daily at 23:50 Asia/Taipei
50 23 * * * cd /path/to/busyness-index && python compute_daily.py --sqlite-path /path/to/busyness_snapshots.db
```

`compute_daily.py` computes everything in memory first and only writes at
the very end — Vikunja API failures or any computation error abort before
any write happens, get logged to `logs/busyness_error.log`, and exit 1 so
cron failure is visible. Note it is *not* a true atomic transaction across
the two databases (SQLite for the overdue-pressure baseline, Postgres for
the daily history row) — see its module docstring for what that means in
practice (both writes are idempotent, so re-running for the same `--date`
repairs any partial state).

Use `--date YYYY-MM-DD` to backfill or test a specific day instead of
"today".

`get_monthly_baseline()` in `db.py` takes the *latest* SQLite snapshot
within each calendar month as that month's representative value, so a
missed cron run doesn't break the baseline — only a month with zero
successful runs at all is skipped.

## Using the module directly

```python
from datetime import date
from vikunja_client import VikunjaClient
from db import get_connection, get_monthly_baseline
from busyness_index import compute_busyness_report

client = VikunjaClient()
tasks = client.list_all_tasks()

conn = get_connection("busyness_snapshots.db")
today = date.today()
baseline = get_monthly_baseline(conn, today)

report = compute_busyness_report(tasks, today, baseline)
print(report.busy_index, report.null_components, report.approximated_count)
```

`BusynessReport` carries every intermediate value (overdue task list, load
ratio, stagnant task IDs, decayed completion rate, approximated_count) for a
"why this score" breakdown, not just the final number.

## `busyness_index_history` (Postgres)

```sql
CREATE TABLE IF NOT EXISTS busyness_index_history (
    date                DATE PRIMARY KEY,
    score               SMALLINT NOT NULL,
    overdue_score       SMALLINT,
    load_score          SMALLINT,
    stagnation_score    SMALLINT,
    completion_score    SMALLINT,
    approximated_count  SMALLINT NOT NULL DEFAULT 0,
    null_components     TEXT[]  NOT NULL DEFAULT '{}',
    config_version      TEXT    NOT NULL,
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`compute_daily.py` / `integration_check.py` create this automatically
(`history_db.ensure_schema()`) if it doesn't exist yet.

`config_version` ties each row to the exact scoring parameters that
produced it (`config.get_config_version()` — sha256 of every weight and
threshold). Changing any parameter changes this hash, which shows up as a
visible discontinuity in the historical time series — expected, not a bug.
Record the change date and reason in Obsidian / the changelog when that
happens, not just in `config.py`'s `WEIGHT_CHANGE_LOG`.

## Not yet done

Standalone, not wired into the live Aiportal dashboard (which currently
computes a simpler busyness index inline in
`artifacts/api-server/src/lib/vikunjaClient.ts`, TypeScript, no history).
See the accompanying chat summary for integration options before connecting
the two.
