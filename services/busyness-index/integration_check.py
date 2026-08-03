#!/usr/bin/env python3
"""Manual, human-run check against the REAL Vikunja instance and REAL
Postgres database — not part of the pytest suite (which never touches a
real DB or a real Vikunja instance; see test_busyness_index.py's docstring
on why history_db.py's SQL-building is tested via build_upsert() instead).

Run this yourself after setting VIKUNJA_URL / VIKUNJA_TOKEN / DATABASE_URL
(directly or via a .env file next to this script), to confirm the whole
pipeline actually works end-to-end before trusting the cron job with it.
Does NOT write anything by default — pass --write to actually upsert into
busyness_index_history.

Usage:
    python integration_check.py             # dry run, prints the report only
    python integration_check.py --write      # also writes to Postgres + SQLite
    python integration_check.py --date 2026-07-15
"""

from __future__ import annotations

import argparse
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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--date", type=str, default=None)
    parser.add_argument("--sqlite-path", default="busyness_snapshots.db")
    parser.add_argument("--write", action="store_true", help="Actually write to Postgres + SQLite (default: dry run).")
    args = parser.parse_args()

    reference_date = date.fromisoformat(args.date) if args.date else datetime.now(TAIPEI).date()

    print(f"Fetching tasks from {CONFIG.timezone} reference date {reference_date.isoformat()}...")
    client = VikunjaClient()
    tasks = client.list_all_tasks()
    print(f"  {len(tasks)} tasks fetched across all projects.")

    sqlite_conn = get_sqlite_connection(args.sqlite_path)
    baseline = get_monthly_baseline(sqlite_conn, reference_date, CONFIG.baseline_trailing_months)
    print(f"  historical overdue-pressure baseline: {baseline}")

    report = compute_busyness_report(tasks, reference_date, baseline)

    print("\n=== BusynessReport ===")
    print(f"  busy_index            = {report.busy_index}")
    print(f"  overdue_pressure_score = {report.overdue_pressure_score}")
    print(f"  recent_load_score      = {report.recent_load_score}  (acute={report.acute_load}, chronic={report.chronic_load}, ratio={report.load_ratio})")
    print(f"  stagnation_score       = {report.stagnation_score}  ({len(report.stagnant_task_ids)} stagnant task IDs: {report.stagnant_task_ids})")
    print(f"  recent_completion_score = {report.recent_completion_score}  (rate={report.recent_completion_rate}, approximated_count={report.approximated_count})")
    print(f"  null_components        = {report.null_components}")
    print(f"  {len(report.overdue_tasks)} overdue tasks:")
    for t in report.overdue_tasks:
        print(f"    - #{t.id} {t.title!r}: {t.days_overdue}d overdue, priority_coef={t.priority_coefficient}, pressure={t.pressure:.4f}")

    config_version = get_config_version()
    print(f"\n  config_version = {config_version}")

    if not args.write:
        print("\nDry run only — pass --write to actually upsert into Postgres + SQLite.")
        sqlite_conn.close()
        return

    if report.busy_index is None:
        print("\nbusy_index is None — refusing to write (score column is NOT NULL). Nothing written.")
        sqlite_conn.close()
        return

    total_pressure, overdue_details = raw_overdue_pressure(tasks, reference_date)

    pg_conn = get_postgres_connection()
    ensure_schema(pg_conn)
    upsert_report(pg_conn, reference_date, report, config_version)
    pg_conn.close()
    print(f"\nWrote busyness_index_history row for {reference_date.isoformat()}.")

    insert_snapshot(sqlite_conn, reference_date, total_pressure, len(overdue_details), datetime.now(TAIPEI))
    sqlite_conn.close()
    print(f"Wrote overdue_snapshots row for {reference_date.isoformat()}.")


if __name__ == "__main__":
    main()
