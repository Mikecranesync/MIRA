"""Run diff — compare an observed run against a baseline; classify severity.

delta = observed_avg - baseline_avg. Severity by sigma distance using k_sigma:

    |delta| > k_sigma * stddev   -> 'critical'
    |delta| > 1       * stddev   -> 'warning'
    otherwise                    -> 'info'

Degenerate baseline (stddev == 0): any nonzero delta is 'critical' (the signal
was perfectly stable across normal runs, so any drift is maximally surprising);
zero delta is 'info'.

A run with ANY warning/critical diff is 'anomalous'.
"""

from __future__ import annotations

import statistics
from typing import Optional

from .models import PhaseStats, Reading, RunAnomalyDiff


def _severity(delta: float, stddev: float, k_sigma: float) -> str:
    ad = abs(delta)
    if stddev == 0:
        return "info" if ad == 0 else "critical"
    if ad > k_sigma * stddev:
        return "critical"
    if ad > stddev:
        return "warning"
    return "info"


def compute_run_diff(
    observed_readings: list[Reading],
    baseline: dict[tuple[str, str], PhaseStats],
    *,
    k_sigma: float,
    phase_name: str = "default",
    event_timestamp: Optional[float] = None,
    uns_path: Optional[str] = None,
) -> list[RunAnomalyDiff]:
    """Diff an observed run's per-tag means against the baseline.

    Only tags present in ``baseline`` (for ``phase_name``) are diffed; observed
    tags with no baseline are skipped (nothing to compare against).
    """
    tag_values: dict[str, list[float]] = {}
    for r in observed_readings:
        if r.value is None:
            continue
        tag_values.setdefault(r.tag_path, []).append(float(r.value))

    diffs: list[RunAnomalyDiff] = []
    for (tag, phase), stats in baseline.items():
        if phase != phase_name:
            continue
        values = tag_values.get(tag)
        if not values:
            continue
        observed_avg = statistics.fmean(values)
        delta = observed_avg - stats.avg
        delta_percent = (delta / stats.avg * 100.0) if stats.avg != 0 else 0.0
        diffs.append(
            RunAnomalyDiff(
                tag_path=tag,
                phase_name=phase,
                observed=observed_avg,
                baseline=stats.avg,
                delta=delta,
                delta_percent=delta_percent,
                severity=_severity(delta, stats.stddev, k_sigma),
                sample_count=len(values),
                uns_path=uns_path,
                event_timestamp=event_timestamp,
            )
        )
    return diffs


def run_status_from_diffs(diffs: list[RunAnomalyDiff]) -> str:
    """'anomalous' if any diff is warning/critical, else 'closed'."""
    severities = {d.severity for d in diffs}
    if "critical" in severities or "warning" in severities:
        return "anomalous"
    return "closed"
