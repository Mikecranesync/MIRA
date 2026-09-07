"""Detector result types.

Three outcomes, not two. UNKNOWN exists because a detector that could not see
its subject must not be counted as a pass — that collapse is how a gate stops
gating without anyone noticing.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Callable

from ..snapshot import Snapshot, SnapshotError


class Verdict(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    UNKNOWN = "UNKNOWN"  # the detector could not see its subject


@dataclass(frozen=True)
class Finding:
    detector: str
    test_id: str  # the outside-in acceptance test this enforces
    verdict: Verdict
    summary: str
    evidence: tuple[str, ...] = field(default_factory=tuple)

    @property
    def blocking(self) -> bool:
        """UNKNOWN blocks with FAIL. Only PASS is green."""
        return self.verdict is not Verdict.PASS


Detector = Callable[[Snapshot], Finding]


def run_all(snapshot: Snapshot, detectors: list[Detector]) -> list[Finding]:
    """Run every detector, converting a blind detector into UNKNOWN, never PASS."""
    out: list[Finding] = []
    for det in detectors:
        try:
            out.append(det(snapshot))
        except SnapshotError as exc:
            out.append(
                Finding(
                    detector=getattr(det, "__name__", "unknown"),
                    test_id=getattr(det, "test_id", "?"),
                    verdict=Verdict.UNKNOWN,
                    summary=str(exc),
                )
            )
    return out
