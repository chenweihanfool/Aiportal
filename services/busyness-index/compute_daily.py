#!/usr/bin/env python3
"""Daily cron entry point (Taiwan time, e.g. scheduled ~23:50).

1. Fetch all Vikunja tasks.
2. Compute today's busyness report (busyness_index.py).
3. Upsert the result into busyness_index_history (Postgres, DATABASE_URL).
4. Also record today's overdue-pressure snapshot into overdue_snapshots
   (SQLite) — same daily-write, latest-per-month-wins design as snapshot.py.
   NOT gated to "only on month-end": db.py's get_monthly_baseline() already
   picks the latest snapshot within each month as that month's value, so a
   plain daily write is more resilient than a month-end-only write — a
   single missed run on the last day of the month would otherwise lose that
   month's baseline entirely, whereas daily writes only need one successful
   run anywhere in the month. Flagging this since it differs from a literal
   "write only at month-end" reading of the spec.
5. On ANY failure (Vikunja fetch, computation, either DB write): write
   nothing, log to logs/busyness_error.log, exit 1 so cron failure is
   visible. Never leaves a half-computed row — everything is computed in
   memory first, writes happen last.
6. --date YYYY-MM-DD overrides reference_date, for backfill/testing.

Requires VIKUNJA_URL / VIKUNJA_TOKEN / DATABASE_URL environment variables,
loaded from a .env file next to this script if present (see .env.example).
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from busyness_index import compute_busyness_report, raw_overdue_pressure  # noqa: E402
from config import CONFIG, get_config_version  # noqa: E402
from db import get_connection as get_sqlite_connection  # noqa: E402
from db import get_monthly_baseline, insert_snapshot  # noqa: E402
from history_db import ensure_schema, get_postgres_connection, upsert_report  # noqa: E402
from vikunja_client import VikunjaClient  # noqa: E402

TAIPEI = ZoneInfo(CONFIG.timezone)
LOG_DIR = Path(__file__).parent / "logs"
LOG_FILE = LOG_DIR / "busyness_error.log"


def _setup_error_logger() -> logging.Logger:
    """Rebuilds handlers on every call rather than reusing whatever's already
    attached to the "compute_daily" logger singleton. A real cron invocation
    only ever calls this once, so it makes no practical difference there —
    but the test suite calls main() multiple times in-process with LOG_FILE
    monkeypatched to a different tmp path each time, and a stale handler
    pointing at the previous path would silently swallow the next test's
    assertions about log content."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("compute_daily")
    logger.setLevel(logging.ERROR)
    logger.handlers.clear()
    handler = logging.FileHandler(LOG_FILE, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger.addHandler(handler)
    return logger


def run(reference_date: date, sqlite_path: str) -> None:
    """Does the actual work; raises on any failure so main() can catch,
    log, and set the exit code uniformly. Every DB write happens after
    everything else has succeeded, to avoid a partially-written day."""
    client = VikunjaClient()
    tasks = client.list_all_tasks()

    sqlite_conn = get_sqlite_connection(sqlite_path)
    try:
        baseline = get_monthly_baseline(sqlite_conn, reference_date, CONFIG.baseline_trailing_months)
        report = compute_busyness_report(tasks, reference_date, baseline)

        if report.busy_index is None:
            raise RuntimeError(
                f"busy_index is None for {reference_date.isoformat()} (all four "
                "sub-scores unavailable) — refusing to write a row, since the "
                "history table's score column is NOT NULL."
            )

        config_version = get_config_version()
        total_pressure, overdue_details = raw_overdue_pressure(tasks, reference_date)

        # Everything above is pure computation. Writes below are not a true
        # atomic cross-database transaction (SQLite + Postgres can't share
        # one) — if the Postgres write succeeds and the SQLite write then
        # fails (or vice versa), the two stores can briefly disagree. Both
        # writes are idempotent (ON CONFLICT / re-inserting the same date),
        # so re-running compute_daily.py --date <same date> repairs it.
        pg_conn = get_postgres_connection()
        try:
            ensure_schema(pg_conn)
            upsert_report(pg_conn, reference_date, report, config_version)
        finally:
            pg_conn.close()

        insert_snapshot(sqlite_conn, reference_date, total_pressure, len(overdue_details), datetime.now(TAIPEI))

        print(
            f"[{reference_date.isoformat()}] busy_index={report.busy_index} "
            f"null_components={report.null_components} approximated_count={report.approximated_count} "
            f"config_version={config_version}"
        )
    finally:
        sqlite_conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--date", type=str, default=None, help="Override reference date (YYYY-MM-DD), for backfill/testing.")
    parser.add_argument("--sqlite-path", default="busyness_snapshots.db")
    args = parser.parse_args()

    logger = _setup_error_logger()

    try:
        reference_date = date.fromisoformat(args.date) if args.date else datetime.now(TAIPEI).date()
        run(reference_date, args.sqlite_path)
        return 0
    except Exception as exc:  # noqa: BLE001 — deliberately broad: any failure must be caught, logged, and must not leave a partial write
        logger.error("compute_daily.py failed: %s", exc, exc_info=True)
        print(f"ERROR: {exc} (see {LOG_FILE})", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
