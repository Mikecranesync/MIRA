"""The approval-ready contextual factory model.

The model does NOT just store assets/tags. Every unit it stores is a `Suggestion` that preserves:
  * source evidence (which file / locator supports it)
  * confidence (high / medium / low / review)
  * why the suggestion exists (a human-readable statement)
  * what human approval is needed
  * approval status (suggested / approved / rejected / needs_review)

This mirrors the Hub's proposal model (kg_entities + ai_suggestions as `proposed`) closely enough
that a human could review these in the Command Center -- without this package touching the DB.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum


class ApprovalStatus(str, Enum):
    SUGGESTED = "suggested"        # the default for everything this package emits
    APPROVED = "approved"          # a human accepted it (this package never sets this)
    REJECTED = "rejected"          # a human rejected it
    NEEDS_REVIEW = "needs_review"  # flagged for a human BECAUSE it is uncertain / inferred


# Confidence band strings mirror mira_plc_parser.ir.Confidence: high / medium / low / review.
CONFIDENCE_BANDS = ("high", "medium", "low", "review")


@dataclass
class Evidence:
    """Where a suggestion came from. Lifted from the parsed node's Provenance -- never invented."""
    source_file: str
    source_format: str
    locator: str            # the path/xpath within the source -- enough to find it again
    detail: str = ""        # what specifically in the source supports the suggestion


@dataclass
class Suggestion:
    """The approval-ready unit. No fact without evidence: `evidence` must be non-empty."""
    kind: str               # "entity" | "signal" | "relationship"
    statement: str          # why this suggestion exists, in plain language
    confidence: str         # one of CONFIDENCE_BANDS
    approval_needed: str    # the human action required to accept it
    evidence: list[Evidence] = field(default_factory=list)
    status: str = ApprovalStatus.SUGGESTED.value


@dataclass
class FactoryNode:
    """An entity (enterprise..asset) or a signal leaf, with its UNS draft path + suggestion."""
    uns_path: str
    name: str
    level: str              # enterprise / site / area / line / cell / asset / signal
    suggestion: Suggestion
    archetype: str = ""     # signals only (static_metadata / live_bool / ... )
    udt_type: str = ""
    mes_path: str = ""
    unit: str = ""


@dataclass
class Relationship:
    """A proposed edge between two UNS paths. `contains` is structural; `feeds` is inferred."""
    rel_type: str           # "contains" | "feeds"
    source_path: str
    target_path: str
    suggestion: Suggestion


@dataclass
class FactoryModel:
    source: str
    nodes: list[FactoryNode] = field(default_factory=list)
    relationships: list[Relationship] = field(default_factory=list)

    # ---- queries -------------------------------------------------------------------------------
    def by_level(self, level: str) -> list[FactoryNode]:
        return [n for n in self.nodes if n.level == level]

    def entities(self) -> list[FactoryNode]:
        return [n for n in self.nodes if n.level != "signal"]

    def signals(self) -> list[FactoryNode]:
        return [n for n in self.nodes if n.level == "signal"]

    def all_suggestions(self) -> list[Suggestion]:
        out = [n.suggestion for n in self.nodes]
        out += [r.suggestion for r in self.relationships]
        return out

    def counts(self) -> dict:
        levels = ("enterprise", "site", "area", "line", "cell", "asset", "signal")
        c = {lvl: len(self.by_level(lvl)) for lvl in levels}
        c["relationships"] = len(self.relationships)
        return c

    # ---- invariants (the "no fact without evidence" guarantee) ---------------------------------
    def evidence_violations(self) -> list[str]:
        """Return a list of suggestions that break the approval-readiness contract (empty = clean):
        every suggestion must carry >=1 evidence item, a statement, a known confidence band, a
        known status, and a non-empty approval_needed. Nothing this package emits may be a bare
        fact."""
        bad = []
        statuses = {s.value for s in ApprovalStatus}
        for s in self.all_suggestions():
            if not s.evidence:
                bad.append(f"{s.kind}:{s.statement!r} has no evidence")
            if not s.statement.strip():
                bad.append(f"{s.kind} suggestion has no statement")
            if s.confidence not in CONFIDENCE_BANDS:
                bad.append(f"{s.kind}:{s.statement!r} bad confidence {s.confidence!r}")
            if s.status not in statuses:
                bad.append(f"{s.kind}:{s.statement!r} bad status {s.status!r}")
            if not s.approval_needed.strip():
                bad.append(f"{s.kind}:{s.statement!r} has no approval_needed")
        return bad

    def to_dict(self) -> dict:
        return {
            "source": self.source,
            "counts": self.counts(),
            "nodes": [asdict(n) for n in self.nodes],
            "relationships": [asdict(r) for r in self.relationships],
        }
