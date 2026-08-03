#!/usr/bin/env python3
"""Daily cron job: fetch current Vikunja tasks, compute today's Σ單一任務壓力
(overdue pressure, no baseline comparison), and store it in the SQLite
snapshot table that get_monthly_baseline() reads from.

Doesn't need to run exactly on the last day of the month — db.py's
get_monthly_baseline() takes the latest snapshot within each calendar month
as that month's representative value, so a missed day or two doesn't break
the monthly baseline as long as at least one snapshot lands each month.

Usage:
    python snapshot.py [--db-path PATH]

Requires VIKUNJA_URL / VIKUNJA_TOKEN environment variables (see vikunja_client.py),
loaded from a .env file next to this script if present (see .env.example).

Superseded by compute_daily.py for the actual cron schedule (it does this
same snapshot write plus the full daily score + Postgres history row) — this
script is kept standalone for cases where you only want the SQLite snapshot
without touching Postgres at all.
"""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from busyness_index import raw_overdue_pressure  # noqa: E402
from config import CONFIG  # noqa: E402
from db import get_connection, insert_snapshot  # noqa: E402
from vikunja_client import VikunjaClient

TAIPEI = ZoneInfo(CONFIG.timezone)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db-path", default="busyness_snapshots.db")
    args = parser.parse_args()

    now = datetime.now(TAIPEI)
    today = now.date()

    client = VikunjaClient()
    tasks = client.list_all_tasks()

    total_pressure, details = raw_overdue_pressure(tasks, today)

    conn = get_connection(args.db_path)
    try:
        insert_snapshot(conn, today, total_pressure, len(details), now)
    finally:
        conn.close()

    print(f"[{today.isoformat()}] snapshot written: pressure={total_pressure:.4f}, overdue_count={len(details)}")


if __name__ == "__main__":
    main()
