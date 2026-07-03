"""Plain dataclasses + config parsing for the run engine.

Deliberately free of DB/Celery imports so the pure core stays unit-testable.

NOTE on the #2339 historian link: the ``Run`` DTO that the Historian Query API
(``mira-relay`` branch ``feat/historian-query-api-2339``) exposes is::

    @dataclass
    class Run:
        run_id: str
        status: Optional[str]      # 'open' | 'closed' | 'anomalous'
        started_at: Optional[datetime]
        ended_at: Optional[datetime]

The ``machine_run`` table (migration 038) is shaped to map onto it 1:1
(``stopped_at`` -> ``ended_at``). This engine's richer ``Run`` below is a
superset used internally; the table is the contract.
TODO(#2339): wire PostgresHistorianAdapter.list_runs() after both branches merge.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class RunTrigger:
    """A run is 'running' while ``tag_path``'s numeric value > ``threshold``."""

    tag_path: str
    threshold: float


@dataclass
class Reading:
    """One numeric tag reading (the engine's view of a tag_events row).

    ``value`` is the parsed numeric value (None when non-numeric / unparseable).
    ``raw_value`` keeps the original text for provenance.
    """

    tag_path: str
    value: Optional[float]
    event_timestamp: float  # epoch seconds (sortable, window math)
    uns_path: Optional[str] = None
    value_type: str = "float"
    quality: str = "good"
    event_id: Optional[str] = None
    simulated: bool = False
    source_system: Optional[str] = None
    raw_value: Optional[str] = None
    metadata: dict = field(default_factory=dict)


@dataclass
class Run:
    """A detected machine run. Maps onto migration 038 ``machine_run``."""

    run_id: str
    tenant_id: str
    uns_path: str
    run_trigger_tag: str
    run_trigger_threshold: float
    started_at: float  # epoch seconds
    equipment_id: Optional[str] = None
    stopped_at: Optional[float] = None
    duration_seconds: Optional[float] = None
    status: str = "open"  # open | closed | anomalous
    phase_name: str = "default"
    metadata: dict = field(default_factory=dict)


@dataclass
class RunStep:
    """One phase within a run. v1 always writes a single 'default' step."""

    run_id: str
    tenant_id: str
    phase_name: str
    phase_index: int
    started_at: float
    ended_at: Optional[float] = None
    duration_seconds: Optional[float] = None
    metadata: dict = field(default_factory=dict)


@dataclass
class PhaseStats:
    """Baseline stats for one (tag, phase) over the last N normal runs.

    Maps onto migration 038 ``run_baseline``. ``stddev`` is the POPULATION
    standard deviation (``statistics.pstdev``) so a single-sample baseline is
    well-defined (stddev = 0) instead of raising.
    """

    tag_path: str
    phase_name: str
    min: float
    max: float
    avg: float
    stddev: float
    sample_count: int
    k_sigma: float = 3.0


@dataclass
class RunAnomalyDiff:
    """One observed-vs-baseline deviation. Maps onto migration 038 ``run_diff``."""

    tag_path: str
    phase_name: str
    observed: float
    baseline: float
    delta: float
    delta_percent: float
    severity: str  # info | warning | critical
    sample_count: int
    uns_path: Optional[str] = None
    event_timestamp: Optional[float] = None
    metadata: dict = field(default_factory=dict)


def parse_run_triggers(raw: Optional[str]) -> dict[str, RunTrigger]:
    """Parse ``MIRA_RUN_TRIGGERS`` into ``{uns_path: RunTrigger}``.

    Format: ``uns_path=tag_path:threshold`` entries, comma-separated. Example::

        demo/cell1/conveyor/cv101=vfd_freq:0.1,demo/cell1/mixer/mx1=speed:5

    Malformed entries are skipped (the task logs nothing here — parsing stays
    pure). An empty / None string yields an empty dict.
    """
    out: dict[str, RunTrigger] = {}
    if not raw:
        return out
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry or "=" not in entry:
            continue
        uns_path, _, spec = entry.partition("=")
        uns_path = uns_path.strip()
        spec = spec.strip()
        if not uns_path or ":" not in spec:
            continue
        tag_path, _, thresh = spec.rpartition(":")
        tag_path = tag_path.strip()
        try:
            threshold = float(thresh.strip())
        except (TypeError, ValueError):
            continue
        if not tag_path:
            continue
        out[uns_path] = RunTrigger(tag_path=tag_path, threshold=threshold)
    return out
