"""Busyness index — a "lower is better" 0-100 score computed from Vikunja task
data, combining four independently-computed sub-scores.

Every sub-score can be None when its underlying data is insufficient (never a
0, since 0 has real meaning — "definitely not busy" — and would be a false
signal). The final index re-normalizes the configured weights across
whichever sub-scores are actually available; see aggregate_busyness_index()
for exactly how.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from config import CONFIG, WEIGHTS
from vikunja_client import VikunjaTask

TAIPEI = ZoneInfo(CONFIG.timezone)


def _round_half_up(x: float) -> int:
    """Python's builtin round() uses round-half-to-even (banker's rounding),
    which is surprising for a user-facing score (round(52.5) == 52, not 53).
    All scores in this module are non-negative, so floor(x + 0.5) gives the
    more intuitive round-half-up behavior instead."""
    return math.floor(x + 0.5)


def _parse_vikunja_datetime(iso: Optional[str]) -> Optional[datetime]:
    """Vikunja (Go zero-value time) represents "no date set" as year 1, e.g.
    "0001-01-01T00:00:00Z" — see tasktracker/README.md's gantt-sorting notes.
    Returns None for that sentinel, otherwise an aware datetime in TAIPEI."""
    if not iso or iso.startswith("0001-"):
        return None
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return dt.astimezone(TAIPEI)


def _priority_coefficient(priority: Optional[int]) -> float:
    """Maps Vikunja's 0-5 priority int to this module's high/medium/low
    buckets. See config.py's high_priority_threshold / medium_priority_value
    for the exact cutoffs."""
    if priority is None:
        return CONFIG.priority_coefficient["unset"]
    if priority >= CONFIG.high_priority_threshold:
        return CONFIG.priority_coefficient["high"]
    if priority == CONFIG.medium_priority_value:
        return CONFIG.priority_coefficient["medium"]
    return CONFIG.priority_coefficient["low"]


# ── Sub-score 1: 逾期壓力分 (weight 0.40) ───────────────────────────────────

@dataclass
class OverdueTaskDetail:
    id: int
    title: str
    days_overdue: int
    priority_coefficient: float
    pressure: float


def raw_overdue_pressure(
    tasks: list[VikunjaTask], reference_date: date
) -> tuple[float, list[OverdueTaskDetail]]:
    """Σ單一任務壓力 for `tasks` as of `reference_date`, with no baseline
    comparison — this is what snapshot.py stores daily, and what
    compute_overdue_pressure_score() divides by the historical baseline."""
    details: list[OverdueTaskDetail] = []
    total = 0.0
    for t in tasks:
        if t.done:
            continue
        due = _parse_vikunja_datetime(t.due_date)
        if due is None or due.date() >= reference_date:
            continue
        days_overdue = (reference_date - due.date()).days
        coef = _priority_coefficient(t.priority)
        pressure = min(days_overdue, CONFIG.overdue_days_cap) / CONFIG.overdue_days_cap * (1 + coef)
        total += pressure
        details.append(
            OverdueTaskDetail(id=t.id, title=t.title, days_overdue=days_overdue,
                               priority_coefficient=coef, pressure=pressure)
        )
    return total, details


def compute_overdue_pressure_score(
    tasks: list[VikunjaTask], reference_date: date, historical_baseline: Optional[float]
) -> tuple[Optional[float], list[OverdueTaskDetail]]:
    """逾期壓力分 = clamp(round(Σ單一任務壓力 / 個人歷史月均逾期壓力 × 50), 0, 100).

    Null propagation: historical_baseline is None (zero snapshots ever
    recorded, not "recorded but always zero") -> returns None. This is
    distinct from historical_baseline == 0 (snapshots exist, none of them
    ever had overdue tasks), which is a real 0-or-100 case handled below."""
    total_pressure, details = raw_overdue_pressure(tasks, reference_date)

    if historical_baseline is None:
        return None, details

    if historical_baseline == 0:
        score = 0.0 if total_pressure == 0 else 100.0
    else:
        score = min(100, max(0, _round_half_up(total_pressure / historical_baseline * 50)))
    return float(score), details


# ── Sub-score 2: 近期負荷分 / ACWR (weight 0.30) ────────────────────────────

def compute_recent_load_score(
    tasks: list[VikunjaTask], reference_date: date
) -> tuple[float, int, float, Optional[float]]:
    """借用運動科學的 acute:chronic workload ratio (ACWR) 概念：
    急性負荷 = 未來 7 天(含今天)到期且未完成的任務數
    慢性負荷 = 過去 28 天內到期的任務數（含已完成／未完成）÷ 4
    負荷比 = 急性負荷 / 慢性負荷 -> 近期負荷分 = clamp(round((負荷比-0.5)*100), 0, 100)

    Always computable (never None) — acute/chronic load of exactly 0 is a
    valid, meaningful state (nothing due recently or soon), not a data-
    insufficiency case."""
    acute_end = reference_date + timedelta(days=CONFIG.acute_window_days)
    acute_load = sum(
        1 for t in tasks
        if not t.done
        and (due := _parse_vikunja_datetime(t.due_date)) is not None
        and reference_date <= due.date() <= acute_end
    )

    chronic_start = reference_date - timedelta(days=CONFIG.chronic_window_days)
    chronic_count = sum(
        1 for t in tasks
        if (due := _parse_vikunja_datetime(t.due_date)) is not None
        and chronic_start <= due.date() < reference_date
    )
    chronic_load = chronic_count / CONFIG.chronic_weeks

    if chronic_load == 0:
        score = 0.0 if acute_load == 0 else 100.0
        load_ratio = None
    else:
        load_ratio = acute_load / chronic_load
        score = float(min(100, max(0, _round_half_up((load_ratio - CONFIG.acwr_offset) * 100))))

    return score, acute_load, chronic_load, load_ratio


# ── Sub-score 3: 停滯分 (weight 0.20) ───────────────────────────────────────

def compute_stagnation_score(
    tasks: list[VikunjaTask], reference_date: date
) -> tuple[Optional[float], list[int]]:
    """停滯任務 = 未完成、建立(created)超過 14 天、且最後更新(updated)超過 14 天
    未變動的任務。停滯分 = 停滯任務數 / 全部未完成任務數 × 100。

    "updated" approximation: Vikunja's `updated` field reflects any field
    change (title, description, due date, labels, comments per its own API
    semantics) — we don't have finer-grained field-level change tracking, so
    this is used as-is, not re-derived from anything more granular.

    Null propagation: 0 incomplete tasks -> None, not 0. "Nothing to do" and
    "nothing stagnant among many things to do" are different states; letting
    this be None lets the weight-renormalization step handle it instead of
    silently rewarding an empty task list with a perfect stagnation score."""
    incomplete = [t for t in tasks if not t.done]
    if not incomplete:
        return None, []

    threshold = timedelta(days=CONFIG.stagnation_days_threshold)
    reference_dt = datetime.combine(reference_date, datetime.min.time(), tzinfo=TAIPEI)

    stagnant_ids: list[int] = []
    for t in incomplete:
        created = _parse_vikunja_datetime(t.created)
        updated = _parse_vikunja_datetime(t.updated)
        if created is None or updated is None:
            continue
        age = reference_dt - created
        staleness = reference_dt - updated
        if age >= threshold and staleness >= threshold:
            stagnant_ids.append(t.id)

    score = float(_round_half_up(len(stagnant_ids) / len(incomplete) * 100))
    return score, stagnant_ids


# ── Sub-score 4: 近期完成率分 — 指數衰減加權如期完成率 (weight 0.10) ─────────
#
# v2 (2026-08): replaces the old hard 30-day-window version, which shared
# most of its date range with 近期負荷分's 28-day chronic window and so
# double-counted much of the same task set across two sub-scores. This
# version widens the sample pool to 90 days but weights each task by
# recency (exponential decay, half-life configurable), so old tasks still
# count but contribute less — no hard boundary where a task's influence
# drops from "full" to "zero" between one day and the next.

def compute_recent_completion_score(
    tasks: list[VikunjaTask], reference_date: date
) -> tuple[Optional[float], Optional[float], int]:
    """樣本池 = 過去 completion_window_days（預設90）天內「到期日落在這段期間」的
    所有任務（不限完成狀態）。每筆任務的權重 w = 0.5 ** (days_ago / half_life)，
    到期日越久遠權重越低；如期分數 s：完成時間 ≤ 到期日 -> 1.0，逾期完成或至今
    未完成 -> 0.0（樣本池的到期日恆 <= reference_date，所以「未完成」在這個窗口
    裡必然等同「已逾期未完成」，不需要另外判斷）。

    衰減加權完成率 = Σ(w×s) / Σ(w)
    近期完成率分 = round((1 - 衰減加權完成率) × 100)

    `done_at` fallback: if a task has no done_at (older Vikunja data / API
    variance) but IS done, fall back to `updated` as the completion
    timestamp — an approximation. Each task where this fallback is actually
    used increments the returned approximated_count, surfaced in
    BusynessReport so the dashboard can show "N of these are estimated".

    Null propagation: Σw < min_weight_sum (too few or too-stale samples) ->
    (None, None, approximated_count). approximated_count is still returned
    even when the score is null, same "why" transparency as the other
    sub-scores' intermediate details."""
    window_start = reference_date - timedelta(days=CONFIG.completion_window_days)
    in_window = [
        t for t in tasks
        if (due := _parse_vikunja_datetime(t.due_date)) is not None
        and window_start <= due.date() <= reference_date
    ]

    total_weight = 0.0
    weighted_on_time = 0.0
    approximated_count = 0

    for t in in_window:
        due = _parse_vikunja_datetime(t.due_date)
        days_ago = (reference_date - due.date()).days
        weight = 0.5 ** (days_ago / CONFIG.completion_half_life_days)

        on_time_score = 0.0
        if t.done:
            completed_at = _parse_vikunja_datetime(t.done_at)
            used_fallback = completed_at is None
            if used_fallback:
                completed_at = _parse_vikunja_datetime(t.updated)
            if completed_at is not None and completed_at.date() <= due.date():
                on_time_score = 1.0
            if used_fallback and completed_at is not None:
                approximated_count += 1

        total_weight += weight
        weighted_on_time += weight * on_time_score

    if total_weight < CONFIG.min_weight_sum:
        return None, None, approximated_count

    rate = weighted_on_time / total_weight
    score = float(_round_half_up((1 - rate) * 100))
    return score, rate, approximated_count


# ── Aggregation ──────────────────────────────────────────────────────────

@dataclass
class BusynessReport:
    busy_index: Optional[int]

    overdue_pressure_score: Optional[float]
    recent_load_score: Optional[float]
    stagnation_score: Optional[float]
    recent_completion_score: Optional[float]

    null_components: list[str] = field(default_factory=list)

    # Intermediates, for a "why this score" breakdown in the dashboard.
    overdue_tasks: list[OverdueTaskDetail] = field(default_factory=list)
    acute_load: int = 0
    chronic_load: float = 0.0
    load_ratio: Optional[float] = None
    stagnant_task_ids: list[int] = field(default_factory=list)
    recent_completion_rate: Optional[float] = None
    # Count of tasks in the recent-completion sample pool whose "on time?"
    # judgment used the done_at -> updated fallback (no done_at recorded).
    # Not a null-propagation signal by itself — recent_completion_score can
    # be a real number while approximated_count > 0; it just means some of
    # the inputs to that number are estimates. Surface this in the
    # dashboard as "N of these are estimated" rather than silently treating
    # every completion timestamp as equally precise.
    approximated_count: int = 0


def aggregate_busyness_index(
    overdue_pressure_score: Optional[float],
    recent_load_score: Optional[float],
    stagnation_score: Optional[float],
    recent_completion_score: Optional[float],
) -> tuple[Optional[int], list[str]]:
    """Weighted average of whichever sub-scores are non-None, with the
    configured weights re-normalized to sum to 1.0 over just those. E.g. if
    stagnation_score is None, the remaining weights 0.40/0.30/0.10 (summing
    to 0.80) are used as 0.40/0.80=0.5, 0.30/0.80=0.375, 0.10/0.80=0.125 —
    achieved here by dividing by the sum of available weights rather than by
    hardcoding alternate weight sets per missing-component combination."""
    components: dict[str, tuple[Optional[float], float]] = {
        "overdue_pressure": (overdue_pressure_score, WEIGHTS.overdue_pressure),
        "recent_load": (recent_load_score, WEIGHTS.recent_load),
        "stagnation": (stagnation_score, WEIGHTS.stagnation),
        "recent_completion": (recent_completion_score, WEIGHTS.recent_completion),
    }
    null_components = [name for name, (score, _) in components.items() if score is None]
    available = {name: (score, weight) for name, (score, weight) in components.items() if score is not None}

    if not available:
        return None, null_components

    total_weight = sum(weight for _, weight in available.values())
    weighted_sum = sum(score * weight for score, weight in available.values())
    busy_index = min(100, max(0, _round_half_up(weighted_sum / total_weight)))
    return busy_index, null_components


def compute_busyness_report(
    tasks: list[VikunjaTask],
    reference_date: date,
    historical_baseline: Optional[float],
) -> BusynessReport:
    overdue_score, overdue_details = compute_overdue_pressure_score(tasks, reference_date, historical_baseline)
    recent_load_score, acute_load, chronic_load, load_ratio = compute_recent_load_score(tasks, reference_date)
    stagnation_score, stagnant_ids = compute_stagnation_score(tasks, reference_date)
    completion_score, completion_rate, approximated_count = compute_recent_completion_score(tasks, reference_date)

    busy_index, null_components = aggregate_busyness_index(
        overdue_score, recent_load_score, stagnation_score, completion_score
    )

    return BusynessReport(
        busy_index=busy_index,
        overdue_pressure_score=overdue_score,
        recent_load_score=recent_load_score,
        stagnation_score=stagnation_score,
        recent_completion_score=completion_score,
        null_components=null_components,
        overdue_tasks=overdue_details,
        acute_load=acute_load,
        chronic_load=chronic_load,
        load_ratio=load_ratio,
        stagnant_task_ids=stagnant_ids,
        recent_completion_rate=completion_rate,
        approximated_count=approximated_count,
    )
