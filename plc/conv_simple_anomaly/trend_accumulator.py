"""
Trend accumulator — in-memory per-tag rolling stats + derived trend summaries.

This is the time-series reasoning layer the chart's intelligence panel and (next phase) MIRA
read from. It generalizes the temporal-derivation pattern already proven in
conv_simple_anomaly/engine.py `Tracker.derived()` (max_stale_s / freq_frozen_s / cmd_run_for_s)
into a per-tag summary: rate, direction, min/max/mean, frozen-for, distance-to-threshold.

Pure / stdlib + rules.DEFAULT_CFG only — no Modbus, no HTTP, no SQLite — so it's fully
unit-testable offline (test_trend_accumulator.py). Thread-safety (the historian's poll loop
writes while the HTTP handler reads) is the caller's concern; the historian holds a lock.
"""
from __future__ import annotations
from collections import deque
from dataclasses import dataclass, asdict

import rules  # DEFAULT_CFG thresholds live here

KEEP_S = 600.0        # how much history each tag keeps in memory (>= any summary window)
RATE_EPS = 0.5        # |rate_per_min| below this reads as "stable"
FROZEN_S = 5.0        # unchanged at least this long (and steady) reads as "frozen"
NOLOAD_AMPS = 0.05    # vfd_current_a mean below this while running => unloaded-bench note

# Units per friendly tag name (matches live_logger HR scaling). Bools have no unit.
UNITS: dict[str, str] = {
    "vfd_frequency_hz": "Hz", "vfd_current_a": "A", "vfd_voltage_v": "V",
    "vfd_dc_bus_v": "V", "vfd_freq_setpoint": "Hz", "motor_speed": "rpm",
    "motor_current": "A", "temperature": "°C", "ambient_temp_c": "°C",
    "conveyor_speed": "rpm", "pressure": "kPa",
}
# tag -> (low_threshold_cfg_key, high_threshold_cfg_key); either may be None.
THRESHOLDS: dict[str, tuple[str | None, str | None]] = {
    "vfd_dc_bus_v": ("dc_bus_lo_v", "dc_bus_hi_v"),
    "vfd_current_a": (None, "motor_fla_a"),
}


@dataclass
class TrendSummary:
    tag: str
    unit: str
    window_s: float
    n_samples: int
    current: float | None
    min_val: float | None
    max_val: float | None
    mean_val: float | None
    rate_per_min: float | None
    direction: str               # rising | falling | stable | frozen | unknown
    frozen_for_s: float
    threshold_lo: float | None
    threshold_hi: float | None
    distance_to_threshold: float | None  # +headroom to nearest active limit; - = violated
    quality: str                 # good | stale | no_data
    note: str = ""               # e.g. "unloaded bench — 0A is correct"

    def to_dict(self) -> dict:
        return asdict(self)


class TrendAccumulator:
    """Holds a rolling window of (ts, value, quality) per tag and derives summaries."""

    def __init__(self) -> None:
        self._buf: dict[str, deque[tuple[float, float | None, str]]] = {}
        self._last_change_ts: dict[str, float] = {}
        self._last_value: dict[str, float | None] = {}

    def update(self, tag: str, value: float | None, ts: float, quality: str = "good") -> None:
        buf = self._buf.setdefault(tag, deque())
        buf.append((ts, value, quality))
        # track last real change for frozen-for
        if value is not None and self._last_value.get(tag) != value:
            self._last_value[tag] = value
            self._last_change_ts[tag] = ts
        self._last_change_ts.setdefault(tag, ts)
        # prune memory window
        cutoff = ts - KEEP_S
        while buf and buf[0][0] < cutoff:
            buf.popleft()

    def tags(self) -> list[str]:
        return sorted(self._buf.keys())

    def summarize(self, tag: str, now: float, window_s: float = 60.0,
                  cfg: dict | None = None) -> TrendSummary:
        cfg = cfg or rules.DEFAULT_CFG
        unit = UNITS.get(tag, "")
        buf = self._buf.get(tag, deque())
        win = [(t, v, q) for (t, v, q) in buf if t >= now - window_s]
        goods = [(t, v) for (t, v, q) in win if v is not None and q == "good"]

        lo_key, hi_key = THRESHOLDS.get(tag, (None, None))
        thr_lo = cfg.get(lo_key) if lo_key else None
        thr_hi = cfg.get(hi_key) if hi_key else None

        if not goods:
            quality = "no_data" if not win else "stale"
            return TrendSummary(tag, unit, window_s, len(win), None, None, None, None,
                                None, "unknown", 0.0, thr_lo, thr_hi, None, quality)

        vals = [v for _, v in goods]
        current = goods[-1][1]
        mn, mx = min(vals), max(vals)
        mean = sum(vals) / len(vals)
        first_t, first_v = goods[0]
        last_t, last_v = goods[-1]
        dt = (last_t - first_t)
        rate_per_min = ((last_v - first_v) / dt * 60.0) if dt > 0 else 0.0
        frozen_for_s = now - self._last_change_ts.get(tag, now)

        if frozen_for_s >= FROZEN_S and abs(rate_per_min) < RATE_EPS:
            direction = "frozen"
        elif rate_per_min > RATE_EPS:
            direction = "rising"
        elif rate_per_min < -RATE_EPS:
            direction = "falling"
        else:
            direction = "stable"

        distance = None
        if thr_hi is not None and thr_lo is not None:
            distance = min(current - thr_lo, thr_hi - current)
        elif thr_hi is not None:
            distance = thr_hi - current
        elif thr_lo is not None:
            distance = current - thr_lo

        quality = "good" if (now - last_t) <= max(2.0, window_s * 0.1) else "stale"
        return TrendSummary(tag, unit, window_s, len(goods), current, mn, mx, mean,
                            rate_per_min, direction, frozen_for_s, thr_lo, thr_hi,
                            distance, quality)

    def summarize_all(self, now: float, window_s: float = 60.0,
                      cfg: dict | None = None) -> dict[str, TrendSummary]:
        """Summarize every tag, applying the cross-tag unloaded-bench guard.

        When vfd_current_a mean is ~0 while motor_running latches 1, annotate the current
        summary so neither the chart nor MIRA reads no-load 0A as a jam/overload.
        """
        out = {t: self.summarize(t, now, window_s, cfg) for t in self.tags()}
        cur = out.get("vfd_current_a")
        running = self._last_value.get("motor_running")
        if cur and cur.mean_val is not None and cur.mean_val < NOLOAD_AMPS and running == 1:
            cur.note = "unloaded bench — near-zero current is correct, not a fault"
        return out
