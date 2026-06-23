"""The citation system — every conclusion references typed evidence.

A Citation renders as `[Type] statement` (e.g. `[Tag] Conveyor01.PhotoeyeBlocked=True`). The supported
types are exactly the evidence classes MIRA can show receipts for.
"""
from __future__ import annotations

from dataclasses import dataclass


class EvidenceType:
    TAG = "Tag"
    ASSET = "Asset"
    MANUAL = "Manual"
    PROCEDURE = "Procedure"
    HISTORICAL = "History"
    SYNTHETIC_FIXTURE = "Fixture"


@dataclass(frozen=True)
class Citation:
    etype: str
    ref: str            # the locator (uns path / doc+page / proc id / history id)
    statement: str      # human-readable
    source: str         # which fixture / model produced it

    def render(self) -> str:
        return "[%s] %s" % (self.etype, self.statement)

    def to_dict(self) -> dict:
        return {"type": self.etype, "ref": self.ref, "statement": self.statement, "source": self.source}


def tag(uns_path: str, state: str, source: str = "phase1_context_model") -> Citation:
    return Citation(EvidenceType.TAG, uns_path, "%s = %s" % (uns_path, state), source)


def asset(statement: str, ref: str, source: str = "phase1_context_model") -> Citation:
    return Citation(EvidenceType.ASSET, ref, statement, source)


def manual(doc: str, page, section: str, snippet: str, source: str = "maintenance_knowledge") -> Citation:
    ref = "%s p.%s" % (doc, page)
    return Citation(EvidenceType.MANUAL, ref, "%s, p.%s — %s" % (doc, page, section), source)


def procedure(pid: str, title: str, source: str = "procedures") -> Citation:
    return Citation(EvidenceType.PROCEDURE, pid, "%s (%s)" % (title, pid), source)


def historical(history_key: str, summary: dict, source: str = "maintenance_history") -> Citation:
    statement = "Similar fault occurred %s time(s); avg %s min; last action: %s" % (
        summary.get("occurrences", "?"), summary.get("avg_duration_min", "?"),
        summary.get("last_corrective_action", "?"),
    )
    return Citation(EvidenceType.HISTORICAL, history_key, statement, source)
