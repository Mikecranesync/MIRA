"""Baseline computation — per-tag per-phase stats over the last N normal runs.

Stdlib ``statistics`` only (NO numpy / no new dependency). The sample for a tag
is ONE value per normal run: that run's mean for the tag. Stats (min/max/avg/
stddev) are then computed across those per-run means. ``stddev`` is the
POPULATION standard deviation so a single-run baseline is defined (stddev=0).

v1 uses a single ``"default"`` phase.
"""

from __future__ import annotations

import statistics

from .models import PhaseStats, Reading


def compute_baseline(
    normal_runs_readings: list[list[Reading]],
    *,
    k_sigma: float = 3.0,
    phase_name: str = "default",
) -> dict[tuple[str, str], PhaseStats]:
    """Compute baseline stats from the windowed readings of N normal runs.

    Args:
        normal_runs_readings: one list of Readings per normal run.
        k_sigma: severity multiplier carried into each PhaseStats.
        phase_name: phase these stats belong to (v1: "default").

    Returns ``{(tag_path, phase_name): PhaseStats}``.
    """
    per_tag_run_means: dict[str, list[float]] = {}

    for run_readings in normal_runs_readings:
        tag_values: dict[str, list[float]] = {}
        for r in run_readings:
            if r.value is None:
                continue
            tag_values.setdefault(r.tag_path, []).append(float(r.value))
        for tag, values in tag_values.items():
            if values:
                per_tag_run_means.setdefault(tag, []).append(statistics.fmean(values))

    out: dict[tuple[str, str], PhaseStats] = {}
    for tag, means in per_tag_run_means.items():
        if not means:
            continue
        out[(tag, phase_name)] = PhaseStats(
            tag_path=tag,
            phase_name=phase_name,
            min=min(means),
            max=max(means),
            avg=statistics.fmean(means),
            stddev=statistics.pstdev(means),  # population stddev -> 0 for n==1
            sample_count=len(means),
            k_sigma=k_sigma,
        )
    return out
