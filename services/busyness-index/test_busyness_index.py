"""Acceptance tests for busyness_index.py, hand-verified against the spec's
scenario: 3 overdue tasks (5/15/40 days overdue, priorities medium/high/low),
4 tasks due in the next 7 days, a chronic load averaging 3/week over the past
4 weeks, 5 of 20 incomplete tasks stagnant, and 10 tasks due in the last 30
days with 7 completed on time.

NOTE ON FIXTURE DESIGN: the spec describes this as one blended scenario, but
the 28-day chronic window and the (now 90-day, decay-weighted) completion
window overlap so heavily — the 90-day window fully contains the 28-day one
— that literally sharing one task list across both sub-scores would make the
chronic and completion counts impossible to pin to independent target
values. Each sub-score is therefore tested against its own independent,
self-contained task list. The final aggregation test then combines the four
*scores* that come out of those isolated scenarios (not the task lists
themselves) to verify the weighted-average + renormalization math
end-to-end.
"""

from datetime import date

import pytest

from busyness_index import (
    aggregate_busyness_index,
    compute_overdue_pressure_score,
    compute_recent_completion_score,
    compute_recent_load_score,
    compute_stagnation_score,
)
from vikunja_client import VikunjaTask

REFERENCE_DATE = date(2026, 8, 3)


def _task(
    id: int,
    due: str | None = None,
    done: bool = False,
    priority: int | None = None,
    created: str | None = None,
    updated: str | None = None,
    done_at: str | None = None,
) -> VikunjaTask:
    return VikunjaTask(
        id=id, title=f"task-{id}", done=done, project_id=1,
        due_date=due, start_date=None, created=created, updated=updated,
        done_at=done_at, priority=priority,
    )


def _iso(d: date) -> str:
    return f"{d.isoformat()}T00:00:00Z"


# ── 逾期壓力分 ───────────────────────────────────────────────────────────

def test_overdue_pressure_score_normal():
    tasks = [
        _task(1, due=_iso(date(2026, 7, 29)), priority=2),  # 5 days overdue, medium
        _task(2, due=_iso(date(2026, 7, 19)), priority=3),  # 15 days overdue, high
        _task(3, due=_iso(date(2026, 6, 24)), priority=1),  # 40 days overdue, low
    ]
    # pressure = min(5,30)/30*(1+0.25) + min(15,30)/30*(1+0.5) + min(40,30)/30*(1+0)
    #          = 0.208333...       + 0.75              + 1.0
    #          = 1.958333...
    # baseline chosen as 2.0 for a clean illustrative ratio (not from the spec —
    # the spec doesn't pin a baseline value, only the formula).
    score, details = compute_overdue_pressure_score(tasks, REFERENCE_DATE, historical_baseline=2.0)
    assert len(details) == 3
    assert score == 49  # round_half_up(1.958333/2.0*50) = round_half_up(48.9583) = 49


def test_overdue_pressure_score_zero_baseline_no_overdue():
    tasks = [_task(1, due=_iso(date(2026, 8, 10)))]  # future, not overdue
    score, _ = compute_overdue_pressure_score(tasks, REFERENCE_DATE, historical_baseline=0.0)
    assert score == 0.0


def test_overdue_pressure_score_zero_baseline_with_overdue():
    tasks = [_task(1, due=_iso(date(2026, 7, 29)), priority=2)]
    score, _ = compute_overdue_pressure_score(tasks, REFERENCE_DATE, historical_baseline=0.0)
    assert score == 100.0


def test_overdue_pressure_score_no_baseline_data():
    tasks = [_task(1, due=_iso(date(2026, 7, 29)), priority=2)]
    score, details = compute_overdue_pressure_score(tasks, REFERENCE_DATE, historical_baseline=None)
    assert score is None
    assert len(details) == 1  # intermediate detail still computed for the "why" breakdown


def test_overdue_pressure_score_ignores_done_tasks():
    tasks = [_task(1, due=_iso(date(2026, 7, 29)), done=True, priority=3)]
    score, details = compute_overdue_pressure_score(tasks, REFERENCE_DATE, historical_baseline=2.0)
    assert details == []
    assert score == 0.0


# ── 近期負荷分 (ACWR) ────────────────────────────────────────────────────

def test_recent_load_score_normal():
    acute_tasks = [
        _task(1, due=_iso(date(2026, 8, 3))),   # today, boundary
        _task(2, due=_iso(date(2026, 8, 5))),
        _task(3, due=_iso(date(2026, 8, 7))),
        _task(4, due=_iso(date(2026, 8, 10))),  # +7 days, boundary
    ]
    # 12 tasks due within the past 28 days -> chronic_load = 12/4 = 3
    chronic_tasks = [
        _task(100 + i, due=_iso(date(2026, 7, 6) + __import__("datetime").timedelta(days=i * 2)), done=True)
        for i in range(12)
    ]
    score, acute, chronic, ratio = compute_recent_load_score(acute_tasks + chronic_tasks, REFERENCE_DATE)
    assert acute == 4
    assert chronic == 3.0
    assert ratio == 4 / 3
    # (4/3 - 0.5) * 100 = 83.333... -> round_half_up -> 83
    assert score == 83


def test_recent_load_score_chronic_zero_no_acute():
    score, acute, chronic, ratio = compute_recent_load_score([], REFERENCE_DATE)
    assert chronic == 0.0
    assert acute == 0
    assert ratio is None
    assert score == 0.0


def test_recent_load_score_chronic_zero_with_acute():
    tasks = [_task(1, due=_iso(date(2026, 8, 5)))]
    score, acute, chronic, ratio = compute_recent_load_score(tasks, REFERENCE_DATE)
    assert chronic == 0.0
    assert acute == 1
    assert score == 100.0


# ── 停滯分 ───────────────────────────────────────────────────────────────

def test_stagnation_score_normal():
    old = _iso(date(2026, 7, 1))       # >14 days before reference -> old enough
    recent = _iso(date(2026, 8, 1))    # <14 days before reference -> too recent

    stagnant = [_task(i, done=False, created=old, updated=old) for i in range(5)]
    recently_touched = [_task(10 + i, done=False, created=old, updated=recent) for i in range(10)]
    freshly_created = [_task(30 + i, done=False, created=recent, updated=recent) for i in range(5)]

    tasks = stagnant + recently_touched + freshly_created
    assert len(tasks) == 20

    score, stagnant_ids = compute_stagnation_score(tasks, REFERENCE_DATE)
    assert len(stagnant_ids) == 5
    assert score == 25  # round_half_up(5/20*100)


def test_stagnation_score_no_incomplete_tasks():
    tasks = [_task(1, done=True)]
    score, stagnant_ids = compute_stagnation_score(tasks, REFERENCE_DATE)
    assert score is None
    assert stagnant_ids == []


def test_stagnation_score_missing_timestamps_excluded():
    # created/updated missing (None) -> can't judge staleness, excluded from
    # the stagnant count but still counts in the incomplete-tasks denominator.
    tasks = [_task(1, done=False, created=None, updated=None)]
    score, stagnant_ids = compute_stagnation_score(tasks, REFERENCE_DATE)
    assert score == 0
    assert stagnant_ids == []


# ── 近期完成率分 — 指數衰減加權如期完成率 (v2, replaces the old hard 30-day
# window: it overlapped almost entirely with 近期負荷分's 28-day chronic
# window, double-counting the same tasks across two sub-scores) ───────────

def _due_days_ago(days_ago: int) -> str:
    return _iso(REFERENCE_DATE - __import__("datetime").timedelta(days=days_ago))


def test_recent_completion_score_decay_weighted_scenario():
    # days_ago = 1, 7, 15, 30, 60; on-time = [yes, yes, no, yes, no].
    # HALF_LIFE=30 (config default): w = 0.5**(days_ago/30)
    #   w(1)=0.977160  w(7)=0.850667  w(15)=0.707107  w(30)=0.5  w(60)=0.25
    # Σw = 0.977160+0.850667+0.707107+0.5+0.25 = 3.284934
    # Σ(w*s) = 0.977160+0.850667+0+0.5+0 = 2.327827  (task 3 and 5 contribute 0)
    # rate = 2.327827 / 3.284934 = 0.708637
    # score = round_half_up((1-0.708637)*100) = round_half_up(29.1363) = 29
    tasks = [
        _task(1, due=_due_days_ago(1), done=True, done_at=_due_days_ago(2)),   # on time
        _task(2, due=_due_days_ago(7), done=True, done_at=_due_days_ago(8)),   # on time
        _task(3, due=_due_days_ago(15), done=True, done_at=_due_days_ago(10)),  # late (completed after due)
        _task(4, due=_due_days_ago(30), done=True, done_at=_due_days_ago(31)),  # on time
        _task(5, due=_due_days_ago(60), done=False),                            # never completed
    ]
    score, rate, approximated_count = compute_recent_completion_score(tasks, REFERENCE_DATE)
    assert rate == pytest.approx(0.7086374316066559)
    assert score == 29
    assert approximated_count == 0


def test_recent_completion_score_old_task_below_min_weight_sum():
    # A single task at the edge of the 90-day window: w = 0.5**(90/30) = 0.125,
    # below MIN_WEIGHT_SUM (0.5) -> null, not a real (if tiny-weighted) score.
    tasks = [_task(1, due=_due_days_ago(90), done=True, done_at=_due_days_ago(91))]
    score, rate, approximated_count = compute_recent_completion_score(tasks, REFERENCE_DATE)
    assert score is None
    assert rate is None


def test_recent_completion_score_done_at_fallback_to_updated():
    # No done_at -> falls back to `updated`, and this counts toward
    # approximated_count since the fallback was actually used.
    tasks = [_task(1, due=_due_days_ago(5), done=True, done_at=None, updated=_due_days_ago(6))]
    score, rate, approximated_count = compute_recent_completion_score(tasks, REFERENCE_DATE)
    assert rate == 1.0
    assert score == 0
    assert approximated_count == 1


def test_recent_completion_score_done_at_present_not_counted_as_approximated():
    tasks = [_task(1, due=_due_days_ago(5), done=True, done_at=_due_days_ago(6))]
    _, _, approximated_count = compute_recent_completion_score(tasks, REFERENCE_DATE)
    assert approximated_count == 0


def test_recent_completion_score_no_window_tasks():
    tasks = [_task(1, due=_iso(date(2020, 1, 1)), done=True)]  # far outside the 90-day window
    score, rate, approximated_count = compute_recent_completion_score(tasks, REFERENCE_DATE)
    assert score is None
    assert rate is None
    assert approximated_count == 0


# ── Aggregation / weight renormalization ────────────────────────────────

def test_aggregate_full_scenario():
    # The four sub-scores from the isolated fixtures above: 49, 83, 25, 30.
    busy_index, null_components = aggregate_busyness_index(49, 83, 25, 30)
    # weighted_sum = 0.4*49 + 0.3*83 + 0.2*25 + 0.1*30 = 19.6+24.9+5.0+3.0 = 52.5
    # round_half_up(52.5) = 53 (not Python's banker's-rounded 52)
    assert busy_index == 53
    assert null_components == []


def test_aggregate_missing_stagnation_renormalizes():
    busy_index, null_components = aggregate_busyness_index(49, 83, None, 30)
    assert null_components == ["stagnation"]
    # Renormalized weights: 0.4/0.8=0.5, 0.3/0.8=0.375, 0.1/0.8=0.125
    # weighted = 0.5*49 + 0.375*83 + 0.125*30 = 24.5 + 31.125 + 3.75 = 59.375
    assert busy_index == 59  # round_half_up(59.375)


def test_aggregate_all_none():
    busy_index, null_components = aggregate_busyness_index(None, None, None, None)
    assert busy_index is None
    assert set(null_components) == {"overdue_pressure", "recent_load", "stagnation", "recent_completion"}


def test_aggregate_clamps_to_0_100():
    # Sub-scores are already 0-100 by construction, but the aggregator still
    # clamps defensively in case a future sub-score formula overshoots.
    busy_index, _ = aggregate_busyness_index(100, 100, 100, 100)
    assert busy_index == 100
    busy_index, _ = aggregate_busyness_index(0, 0, 0, 0)
    assert busy_index == 0


# ── config_version ───────────────────────────────────────────────────────

def test_config_version_stable_across_calls():
    from config import get_config_version
    assert get_config_version() == get_config_version()


def test_config_version_changes_when_a_weight_changes():
    import dataclasses
    from config import CONFIG, WEIGHTS, get_config_version

    baseline = get_config_version()
    # BusynessWeights validates its four fields sum to 1.0 in __post_init__,
    # so the replacement has to be a real, valid weight set, not just one
    # field nudged in isolation.
    changed_weights = dataclasses.replace(
        WEIGHTS, overdue_pressure=0.50, recent_load=0.20, stagnation=0.20, recent_completion=0.10
    )
    changed = get_config_version(config=CONFIG, weights=changed_weights)
    assert changed != baseline


def test_config_version_changes_when_a_threshold_changes():
    import dataclasses
    from config import CONFIG, WEIGHTS, get_config_version

    baseline = get_config_version()
    changed_config = dataclasses.replace(CONFIG, completion_half_life_days=45)
    changed = get_config_version(config=changed_config, weights=WEIGHTS)
    assert changed != baseline


def test_config_version_unchanged_when_nothing_changes():
    import dataclasses
    from config import CONFIG, WEIGHTS, get_config_version

    identical_config = dataclasses.replace(CONFIG)
    identical_weights = dataclasses.replace(WEIGHTS)
    assert get_config_version(config=identical_config, weights=identical_weights) == get_config_version()


# ── history_db.build_upsert (pure SQL-building, no real Postgres) ─────────

def test_build_upsert_full_report():
    from busyness_index import BusynessReport
    from history_db import build_upsert

    report = BusynessReport(
        busy_index=53,
        overdue_pressure_score=49.0,
        recent_load_score=83.0,
        stagnation_score=25.0,
        recent_completion_score=30.0,
        null_components=[],
        approximated_count=2,
    )
    sql, params = build_upsert(report, date(2026, 8, 3), "abc123def456")

    assert "INSERT INTO busyness_index_history" in sql
    assert "ON CONFLICT (date) DO UPDATE" in sql
    assert params == (
        date(2026, 8, 3), 53, 49, 83, 25, 30, 2, [], "abc123def456",
    )


def test_build_upsert_with_null_subscores():
    from busyness_index import BusynessReport
    from history_db import build_upsert

    report = BusynessReport(
        busy_index=59,
        overdue_pressure_score=49.0,
        recent_load_score=83.0,
        stagnation_score=None,
        recent_completion_score=30.0,
        null_components=["stagnation"],
        approximated_count=0,
    )
    sql, params = build_upsert(report, date(2026, 8, 3), "abc123def456")
    assert params == (
        date(2026, 8, 3), 59, 49, 83, None, 30, 0, ["stagnation"], "abc123def456",
    )


def test_build_upsert_rejects_none_busy_index():
    from busyness_index import BusynessReport
    from history_db import build_upsert

    report = BusynessReport(
        busy_index=None,
        overdue_pressure_score=None,
        recent_load_score=None,
        stagnation_score=None,
        recent_completion_score=None,
    )
    with pytest.raises(ValueError, match="NOT NULL"):
        build_upsert(report, date(2026, 8, 3), "abc123def456")


# ── compute_daily.py failure path ───────────────────────────────────────

def test_compute_daily_api_failure_writes_nothing_and_exits_1(tmp_path, monkeypatch):
    import sqlite3
    from unittest.mock import MagicMock

    import compute_daily

    monkeypatch.setenv("VIKUNJA_URL", "https://example.invalid")
    monkeypatch.setenv("VIKUNJA_TOKEN", "fake-token")

    # Redirect the error log into tmp_path -- see compute_daily's
    # _setup_error_logger() docstring for why it rebuilds handlers on every
    # call instead of reusing a stale one.
    monkeypatch.setattr(compute_daily, "LOG_DIR", tmp_path / "logs")
    monkeypatch.setattr(compute_daily, "LOG_FILE", tmp_path / "logs" / "busyness_error.log")

    mock_client = MagicMock()
    mock_client.list_all_tasks.side_effect = RuntimeError("Vikunja API unreachable")
    monkeypatch.setattr(compute_daily, "VikunjaClient", lambda: mock_client)

    sqlite_path = tmp_path / "snapshots.db"
    monkeypatch.setattr(
        "sys.argv",
        ["compute_daily.py", "--date", "2026-08-03", "--sqlite-path", str(sqlite_path)],
    )

    exit_code = compute_daily.main()

    assert exit_code == 1

    log_file = tmp_path / "logs" / "busyness_error.log"
    assert log_file.exists()
    assert "Vikunja API unreachable" in log_file.read_text(encoding="utf-8")

    # No overdue_snapshots row should exist -- either the SQLite file was
    # never created, or it was created (get_connection() runs the schema
    # migration eagerly) but has zero rows in it. Both count as "wrote
    # nothing" for this test's purposes.
    if sqlite_path.exists():
        conn = sqlite3.connect(sqlite_path)
        count = conn.execute("SELECT COUNT(*) FROM overdue_snapshots").fetchone()[0]
        conn.close()
        assert count == 0


def test_compute_daily_missing_database_url_writes_nothing_and_exits_1(tmp_path, monkeypatch):
    # NOTE: this is NOT testing the "busy_index is None" guard in
    # compute_daily.run() -- that branch turns out to be unreachable through
    # the real pipeline. recent_load_score (weight 0.30) is deliberately
    # "always computable, never None" by design (0 acute/chronic load is a
    # real, meaningful state, not missing data — see
    # compute_recent_load_score's docstring), so aggregate_busyness_index()
    # always has at least that one component to average, even with zero
    # tasks. busy_index can therefore never actually be None in practice;
    # the guard is defensive code for if a future change ever makes
    # recent_load_score nullable too. What THIS test verifies instead is
    # that an environment/config problem (missing DATABASE_URL) is caught
    # by the same broad except-and-log path as a Vikunja API failure,
    # rather than crashing cron with an unhandled traceback and no log entry.
    from unittest.mock import MagicMock

    import compute_daily

    monkeypatch.setenv("VIKUNJA_URL", "https://example.invalid")
    monkeypatch.setenv("VIKUNJA_TOKEN", "fake-token")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(compute_daily, "LOG_DIR", tmp_path / "logs")
    monkeypatch.setattr(compute_daily, "LOG_FILE", tmp_path / "logs" / "busyness_error.log")

    mock_client = MagicMock()
    mock_client.list_all_tasks.return_value = []
    monkeypatch.setattr(compute_daily, "VikunjaClient", lambda: mock_client)

    sqlite_path = tmp_path / "snapshots.db"
    monkeypatch.setattr(
        "sys.argv",
        ["compute_daily.py", "--date", "2026-08-03", "--sqlite-path", str(sqlite_path)],
    )

    exit_code = compute_daily.main()

    assert exit_code == 1
    log_file = tmp_path / "logs" / "busyness_error.log"
    assert log_file.exists()
    assert "DATABASE_URL" in log_file.read_text(encoding="utf-8")
