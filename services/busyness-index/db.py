"""SQLite storage for daily overdue-pressure snapshots, used to compute the
个人歷史月均逾期壓力 baseline that 逾期壓力分 is measured against.

Design note: snapshot.py is meant to run daily (or however often cron allows),
not strictly on the last day of the month — get_monthly_baseline() picks the
*latest* snapshot within each calendar month as that month's representative
value, so a missed day doesn't break the monthly baseline. Only a month with
zero snapshots at all is skipped entirely.
"""

from __future__ import annotations

import sqlite3
from datetime import date, datetime

SCHEMA = """
CREATE TABLE IF NOT EXISTS overdue_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_date TEXT NOT NULL,           -- ISO date this snapshot represents
    total_overdue_pressure REAL NOT NULL,  -- Σ單一任務壓力 at that date
    overdue_task_count INTEGER NOT NULL,
    created_at TEXT NOT NULL               -- when this row was actually written
);
CREATE INDEX IF NOT EXISTS idx_overdue_snapshots_date ON overdue_snapshots(snapshot_date);
"""


def get_connection(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA)
    return conn


def insert_snapshot(
    conn: sqlite3.Connection,
    snapshot_date: date,
    total_overdue_pressure: float,
    overdue_task_count: int,
    run_at: datetime,
) -> None:
    conn.execute(
        "INSERT INTO overdue_snapshots (snapshot_date, total_overdue_pressure, overdue_task_count, created_at) "
        "VALUES (?, ?, ?, ?)",
        (snapshot_date.isoformat(), total_overdue_pressure, overdue_task_count, run_at.isoformat()),
    )
    conn.commit()


def get_monthly_baseline(
    conn: sqlite3.Connection,
    reference_date: date,
    trailing_months: int = 12,
) -> float | None:
    """個人歷史月均逾期壓力：過去 trailing_months 個月（資料不足就用現有月數），
    每個月取最後一筆快照的 total_overdue_pressure，平均。完全沒有快照資料時回傳 None
    (distinct from "0 snapshots this month but data exists elsewhere" — see
    compute_overdue_pressure_score's docstring for the None vs 0 distinction
    this feeds into)."""
    rows = conn.execute(
        "SELECT snapshot_date, total_overdue_pressure FROM overdue_snapshots "
        "WHERE snapshot_date < ? ORDER BY snapshot_date",
        (reference_date.isoformat(),),
    ).fetchall()
    if not rows:
        return None

    latest_per_month: dict[tuple[int, int], tuple[str, float]] = {}
    for snapshot_date_str, pressure in rows:
        d = date.fromisoformat(snapshot_date_str)
        key = (d.year, d.month)
        existing = latest_per_month.get(key)
        if existing is None or snapshot_date_str > existing[0]:
            latest_per_month[key] = (snapshot_date_str, pressure)

    if not latest_per_month:
        return None

    trailing_keys = sorted(latest_per_month.keys(), reverse=True)[:trailing_months]
    values = [latest_per_month[k][1] for k in trailing_keys]
    return sum(values) / len(values)
