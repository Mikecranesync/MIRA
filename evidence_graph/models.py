"""The evidence graph data model.

Nodes are typed facts; edges are evidence relationships. The hard invariant: **no anonymous facts** —
every node carries a `source` and an `evidence_ref` (a back-pointer to where the fact came from), plus
a confidence and an approval status. `violations()` enforces it; the Phase 3 gate fails if it is broken.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field


class NodeKind:
    ASSET = "asset"
    SIGNAL = "signal"
    UNS_PATH = "uns_path"
    CAUSE = "cause"                  # a per-asset hypothesis (asset::failure_mode)
    FAILURE_MODE = "failure_mode"
    MANUAL = "manual"
    PROCEDURE = "procedure"
    HISTORICAL_EVENT = "historical_event"
    CORRECTIVE_ACTION = "corrective_action"
    TECHNICIAN_ACTION = "technician_action"


class EdgeKind:
    CONTAINS = "contains"            # asset -> signal
    FEEDS = "feeds"                  # asset -> asset (inferred flow)
    HAS_UNS = "has_uns"             # asset/signal -> uns_path
    LOCATED_ON = "located_on"        # cause -> asset
    IS_A = "is_a"                    # cause -> failure_mode
    SUPPORTED_BY = "supported_by"    # cause -> signal (evidence FOR)
    CONTRADICTED_BY = "contradicted_by"  # cause -> signal (evidence AGAINST)
    CITES = "cites"                  # cause -> manual
    FOLLOWS_PROCEDURE = "follows_procedure"  # cause -> procedure
    PRECEDED_BY = "preceded_by"      # cause -> historical_event
    REMEDIATED_BY = "remediated_by"  # historical_event -> corrective_action
    RECOMMENDS = "recommends"        # cause -> technician_action


@dataclass
class EvidenceNode:
    id: str
    kind: str
    label: str
    source: str                      # where this fact came from (no anonymous facts)
    evidence_ref: str                # locator: uns path / doc+page / history id / proc id / mode id
    confidence: str = "n/a"          # high / medium / low / review / n/a
    approval_status: str = "n/a"     # suggested / needs_review / approved / observed / hypothesis / n/a
    attrs: dict = field(default_factory=dict)


@dataclass
class EvidenceEdge:
    src: str
    dst: str
    kind: str
    rationale: str = ""


@dataclass
class EvidenceGraph:
    nodes: dict = field(default_factory=dict)     # id -> EvidenceNode
    edges: list = field(default_factory=list)     # EvidenceEdge

    def add_node(self, node: EvidenceNode) -> EvidenceNode:
        self.nodes.setdefault(node.id, node)
        return self.nodes[node.id]

    def add_edge(self, src: str, dst: str, kind: str, rationale: str = "") -> None:
        # dedupe (src, dst, kind) so the graph is deterministic regardless of build order.
        for e in self.edges:
            if e.src == src and e.dst == dst and e.kind == kind:
                return
        self.edges.append(EvidenceEdge(src=src, dst=dst, kind=kind, rationale=rationale))

    def out_edges(self, nid: str, kind: str | None = None) -> list:
        return [e for e in self.edges if e.src == nid and (kind is None or e.kind == kind)]

    def neighbors(self, nid: str, kind: str) -> list:
        return [self.nodes[e.dst] for e in self.out_edges(nid, kind) if e.dst in self.nodes]

    def by_kind(self, kind: str) -> list:
        return [n for n in self.nodes.values() if n.kind == kind]

    def counts(self) -> dict:
        c: dict = {}
        for n in self.nodes.values():
            c[n.kind] = c.get(n.kind, 0) + 1
        c["edges"] = len(self.edges)
        return c

    def violations(self) -> list[str]:
        """No anonymous facts; no dangling edges."""
        bad = []
        for n in self.nodes.values():
            if not (n.source or "").strip():
                bad.append("node %s has no source" % n.id)
            if not (n.evidence_ref or "").strip():
                bad.append("node %s has no evidence_ref" % n.id)
        for e in self.edges:
            if e.src not in self.nodes:
                bad.append("edge %s->%s: missing src" % (e.src, e.dst))
            if e.dst not in self.nodes:
                bad.append("edge %s->%s: missing dst" % (e.src, e.dst))
        return bad

    def to_dict(self) -> dict:
        return {
            "counts": self.counts(),
            "nodes": [asdict(n) for n in self.nodes.values()],
            "edges": [asdict(e) for e in self.edges],
        }
