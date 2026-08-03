"""Postgres storage for the daily busyness_index_history table — the shared
Aiportal Postgres instance, connected via DATABASE_URL (same convention the
rest of the Aiportal stack uses).

SQL-building is split out as a pure function (build_upsert) so it can be
tested without a real Postgres connection — see test_busyness_index.py.
"""

from __future__ import annotations

import os
from datetime import date
from typing import Optional

import psycopg

from busyness_index import BusynessReport

SCHEMA = """
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
"""

UPSERT_SQL = """
INSERT INTO busyness_index_history
    (date, score, overdue_score, load_score, stagnation_score, completion_score,
     approximated_count, null_components, config_version)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (date) DO UPDATE SET
    score = EXCLUDED.score,
    overdue_score = EXCLUDED.overdue_score,
    load_score = EXCLUDED.load_score,
    stagnation_score = EXCLUDED.stagnation_score,
    completion_score = EXCLUDED.completion_score,
    approximated_count = EXCLUDED.approximated_count,
    null_components = EXCLUDED.null_components,
    config_version = EXCLUDED.config_version,
    computed_at = now();
"""


def get_postgres_connection() -> "psycopg.Connection":
    return psycopg.connect(os.environ["DATABASE_URL"])


def ensure_schema(conn: "psycopg.Connection") -> None:
    with conn.cursor() as cur:
        cur.execute(SCHEMA)
    conn.commit()


def _int_or_none(x: Optional[float]) -> Optional[int]:
    return None if x is None else int(round(x))


def build_upsert(report: BusynessReport, computed_date: date, config_version: str) -> tuple[str, tuple]:
    """Pure SQL-building function — no DB connection, so it's testable
    without a real Postgres instance. Raises ValueError instead of building
    a row that would violate the `score NOT NULL` constraint; the caller
    (compute_daily.py) must check report.busy_index is not None before
    calling this, same as it must for any other write."""
    if report.busy_index is None:
        raise ValueError(
            "Cannot upsert a history row with busy_index=None — the `score` "
            "column is NOT NULL. Caller must check this before calling build_upsert()."
        )
    params = (
        computed_date,
        int(report.busy_index),
        _int_or_none(report.overdue_pressure_score),
        _int_or_none(report.recent_load_score),
        _int_or_none(report.stagnation_score),
        _int_or_none(report.recent_completion_score),
        report.approximated_count,
        list(report.null_components),
        config_version,
    )
    return UPSERT_SQL, params


def upsert_report(
    conn: "psycopg.Connection", computed_date: date, report: BusynessReport, config_version: str
) -> None:
    sql, params = build_upsert(report, computed_date, config_version)
    with conn.cursor() as cur:
        cur.execute(sql, params)
    conn.commit()
