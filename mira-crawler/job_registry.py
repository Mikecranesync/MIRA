"""Single source of truth for the crawler's scheduled jobs — dependency-free.

Both sides of the runtime read THIS module, never a private copy:

* ``main._setup_scheduler`` builds the APScheduler jobs from ``JOBS`` (the write
  side — what actually gets scheduled).
* ``health.py`` judges each job's heartbeat against its ``stale_after_seconds``
  (the read side — is the schedule actually firing).

Keeping the id / trigger / cadence in one data table is what stops the two
sides drifting (the classic "health hard-codes its own 'daily' threshold and
rots" trap). It is stdlib-only on purpose: the Phase-1 registry test and the
watchdog's ``health.py`` must import it WITHOUT dragging in docling /
apscheduler, which the minimal-deps CI job does not install.

Cadence vs. stale window
------------------------
``cadence_seconds`` is how often the job is *expected* to run. ``stale_after_seconds``
is the age past which a silent job is *suspicious* — always larger than the
cadence so a job that merely ran on schedule is never flagged. A daily crawl
silent for two days is stale; a weekly report silent for four days is still
healthy; the 30-minute healthcheck silent for 40 minutes means the scheduler
thread is dead (the tightest sentinel).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

_DAY = 86_400
_WEEK = 7 * _DAY


@dataclass(frozen=True)
class JobSpec:
    """One scheduled job, as pure data (no callable — see ``target``)."""

    id: str
    name: str
    kind: str  # manufacturer | curriculum | report | healthcheck
    target: str  # dispatch key resolved to a callable in main.py
    trigger_type: str  # cron | interval
    trigger_kwargs: dict[str, Any]
    cadence_seconds: int  # how often it is expected to run
    stale_after_seconds: int  # age past which silence is suspicious
    args: tuple[Any, ...] = field(default_factory=tuple)  # e.g. ("abb",)


# Nightly manufacturer crawls (staggered by hour), verified live in Phase 0.
_MANUFACTURERS = [
    ("abb", 1, 0),
    ("fanuc", 2, 0),
    ("kuka", 3, 0),
    ("siemens", 4, 0),
    ("rockwell", 5, 0),
    ("automationdirect", 5, 30),
]

JOBS: list[JobSpec] = [
    JobSpec(
        id=f"crawl_{mfr}",
        name=f"Crawl {mfr}",
        kind="manufacturer",
        target="manufacturer_crawl",
        trigger_type="cron",
        trigger_kwargs={"hour": hour, "minute": minute},
        cadence_seconds=_DAY,
        stale_after_seconds=2 * _DAY,  # daily job silent 2d = stale
        args=(mfr,),
    )
    for mfr, hour, minute in _MANUFACTURERS
] + [
    JobSpec(
        id="crawl_curriculum",
        name="Crawl all curriculum sources",
        kind="curriculum",
        target="curriculum_crawl",
        trigger_type="cron",
        trigger_kwargs={"day_of_week": "sun", "hour": 6},
        cadence_seconds=_WEEK,
        stale_after_seconds=_WEEK + 2 * _DAY,  # weekly job silent 9d = stale
    ),
    JobSpec(
        id="generate_report",
        name="Generate weekly crawl report",
        kind="report",
        target="report",
        trigger_type="cron",
        trigger_kwargs={"day_of_week": "mon", "hour": 7},
        cadence_seconds=_WEEK,
        stale_after_seconds=_WEEK + 2 * _DAY,
    ),
    JobSpec(
        id="healthcheck",
        name="Health check",
        kind="healthcheck",
        target="healthcheck",
        trigger_type="interval",
        trigger_kwargs={"minutes": 30},
        cadence_seconds=30 * 60,
        stale_after_seconds=40 * 60,  # 30-min sentinel silent 40m = scheduler dead
    ),
]

_BY_ID: dict[str, JobSpec] = {j.id: j for j in JOBS}


def job_ids() -> list[str]:
    """Registered job ids, in schedule order."""
    return [j.id for j in JOBS]


def get(job_id: str) -> JobSpec:
    """The spec for ``job_id``; raises ``KeyError`` if unknown."""
    return _BY_ID[job_id]
