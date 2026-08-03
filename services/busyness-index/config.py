"""Configuration for the busyness index calculation.

WARNING — changing any weight or threshold here breaks the busyness index's
longitudinal comparability (today's "62" is no longer comparable to last
month's "62" once the formula that produced it changes). Any change must be
appended to WEIGHT_CHANGE_LOG below, not just silently edited in place.
"""

import hashlib
import json
from dataclasses import dataclass, field


@dataclass(frozen=True)
class BusynessWeights:
    overdue_pressure: float = 0.40
    recent_load: float = 0.30
    stagnation: float = 0.20
    recent_completion: float = 0.10

    def __post_init__(self) -> None:
        total = self.overdue_pressure + self.recent_load + self.stagnation + self.recent_completion
        if abs(total - 1.0) > 1e-9:
            raise ValueError(f"BusynessWeights must sum to 1.0, got {total}")


# Append one line per weight change here — never edit WEIGHTS below without
# adding an entry, since it invalidates comparisons against scores computed
# under the old weights.
WEIGHT_CHANGE_LOG = """
2026-08-03: initial weights — overdue_pressure=0.40, recent_load=0.30,
            stagnation=0.20, recent_completion=0.10
"""

WEIGHTS = BusynessWeights()


@dataclass(frozen=True)
class BusynessConfig:
    # 逾期壓力分
    overdue_days_cap: int = 30
    priority_coefficient: dict = field(
        default_factory=lambda: {"high": 0.5, "medium": 0.25, "low": 0.0, "unset": 0.0}
    )
    # Vikunja priority is an int 0-5 (0=unset,1=low,2=medium,3=high,4=urgent,
    # 5=do now per tasktracker/docs/api-testing.md). Mapped to this module's
    # high/medium/low buckets: >=high_priority_threshold -> high,
    # ==medium_priority_value -> medium, else low/unset.
    high_priority_threshold: int = 3
    medium_priority_value: int = 2
    baseline_trailing_months: int = 12

    # 近期負荷分（ACWR）
    acwr_offset: float = 0.5
    acute_window_days: int = 7
    chronic_window_days: int = 28
    chronic_weeks: int = 4

    # 停滯分
    stagnation_days_threshold: int = 14

    # 近期完成率分 — 指數衰減加權如期完成率
    completion_window_days: int = 90       # 樣本池：到期日落在過去這麼多天內的任務
    completion_half_life_days: int = 30    # 半衰期：每過這麼多天，任務對分數的權重減半
    min_weight_sum: float = 0.5            # Σw 低於這個門檻 -> 樣本太少/太舊，回傳 null

    timezone: str = "Asia/Taipei"


CONFIG = BusynessConfig()


def get_config_version(
    config: "BusynessConfig | None" = None,
    weights: "BusynessWeights | None" = None,
) -> str:
    """Hashes every parameter that affects the busyness index, so each row in
    busyness_index_history can be tied to the exact config version that
    produced it. Changing ANY value below changes this hash — expect (and
    accept) a visible discontinuity in the historical time series when that
    happens. Record the change date and reason in Obsidian / the changelog,
    not just in WEIGHT_CHANGE_LOG above, since config_version alone doesn't
    explain *why* a parameter changed.

    Defaults to the module-level CONFIG/WEIGHTS singletons; accepts explicit
    values so the test suite can verify "changing a parameter changes the
    hash" without monkeypatching module globals.

    Returns the first 12 hex chars of a sha256 over a canonical (sorted-key)
    JSON encoding of every scoring parameter."""
    config = config or CONFIG
    weights = weights or WEIGHTS
    payload = {
        "weights": {
            "overdue_pressure": weights.overdue_pressure,
            "recent_load": weights.recent_load,
            "stagnation": weights.stagnation,
            "recent_completion": weights.recent_completion,
        },
        "overdue_days_cap": config.overdue_days_cap,
        "priority_coefficient": config.priority_coefficient,
        "high_priority_threshold": config.high_priority_threshold,
        "medium_priority_value": config.medium_priority_value,
        "baseline_trailing_months": config.baseline_trailing_months,
        "acwr_offset": config.acwr_offset,
        "acute_window_days": config.acute_window_days,
        "chronic_window_days": config.chronic_window_days,
        "chronic_weeks": config.chronic_weeks,
        "stagnation_days_threshold": config.stagnation_days_threshold,
        "completion_window_days": config.completion_window_days,
        "completion_half_life_days": config.completion_half_life_days,
        "min_weight_sum": config.min_weight_sum,
    }
    serialized = json.dumps(payload, sort_keys=True)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()[:12]
