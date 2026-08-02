"""The common runtime context contract — "one technician brain, many evidence
producers" (ADR-0033, Phase 3).

This module EXTENDS the ADR-0029 materialized-evidence machinery by
composition. It deliberately does NOT add fields to ``EvidenceManifest``:
that dataclass is hash-stable (``content_hash`` is computed over its dict
form), and any new field would silently invalidate every existing recall key.
``TechnicianContext`` is the runtime object assembled per answer; evidence
items may back-reference manifests/records by hash and — new here — by
``document_lineage_key``, closing the evidence-identity↔corpus-lineage gap
found in the Phase-1 inventory.

Design sources (inventory verdicts):
- versioning/validation discipline: this package (ADR-0029);
- live-state overlay shape: ``mira-hub/src/lib/machine-context-packet.ts``
  (FreshnessSummary, machine_state, evidence window) — mirrored, not imported;
- allowed-actions vocabulary with write-verb REJECTION:
  ``mira-bots/shared/observe/agent_registry.py`` — mirrored constants, no
  cross-package import (this package must stay dependency-free);
- untyped legacy producers (``state["uns_context"]``, ``ignition_chat``
  ``asset_context``, recall chunk dicts) adapt IN via the pure functions at
  the bottom; they are not extended.

Read-only law: a context whose ``allowed_actions`` contains a write-shaped
verb fails validation. Execution paths, if they ever exist, are authorized
OUTSIDE this contract (ADR-0033 rule 3 + fieldbus-readonly doctrine).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any

CONTEXT_CONTRACT_VERSION = "1.0"


class TaskMode(str, Enum):
    GENERAL_TROUBLESHOOTING = "general_troubleshooting"
    DRIVE_COMMANDER = "drive_commander"
    PRINTSENSE = "printsense"
    GRAPH_REASONING = "graph_reasoning"
    LIVE_STATE_DIAGNOSIS = "live_state_diagnosis"
    WORK_ORDER_ASSIST = "work_order_assist"


class EvidenceKind(str, Enum):
    MANUAL_CHUNK = "manual_chunk"
    DRIVE_PACK_FACT = "drive_pack_fact"
    PRINT_OBSERVATION = "print_observation"
    KG_PATH = "kg_path"
    ONTOLOGY_VALIDATION = "ontology_validation"
    LIVE_TAG = "live_tag"
    HISTORIAN_WINDOW = "historian_window"
    WORK_ORDER = "work_order"
    PRIOR_DECISION = "prior_decision"
    TECHNICIAN_CORRECTION = "technician_correction"


class Freshness(str, Enum):
    LIVE = "live"
    STALE = "stale"
    SIMULATED = "simulated"
    UNKNOWN = "unknown"


# Superset of agent_registry._WRITE_VERBS plus contract-local additions
# (clear/jog/energize/stop/.set). tests/test_context_contract.py parses the
# agent_registry source and asserts every one of its verbs is caught here —
# a real lockstep test, no cross-package runtime import.
FORBIDDEN_ACTION_SUBSTRINGS = (
    "write",
    "set_",
    ".set",
    "reset",
    "clear",
    "force",
    "jog",
    "start",
    "stop",
    "energize",
    "bypass",
    "override",
    "delete",
    "update",
    "command",
    "control",
    "actuate",
    "submit",
    "close",
    "create_work_order",
)

ALLOWED_ACTION_VOCAB = (
    "read",
    "cite",
    "suggest",
    "explain",
    "request_measurement",
    "request_document",
    "request_crop",
    "escalate",
    "refuse",
)


@dataclass(frozen=True)
class EvidenceItem:
    """One typed piece of evidence from one producer.

    ``citation_id`` is the stable handle the answer text cites.
    ``document_lineage_key`` is the OPTIONAL corpus back-reference (None for
    live/tenant-transient evidence) — the bridge the inventory found missing.
    """

    kind: EvidenceKind
    citation_id: str
    payload: dict[str, Any]
    source_locator: str = ""
    confidence: float | str | None = None
    trust: str = "candidate"  # mirrors TrustStatus values; free-form tolerated
    producer_name: str = ""
    producer_version: str = ""
    evidence_hash: str | None = None
    manifest_ref: str | None = None
    document_lineage_key: str | None = None
    freshness: Freshness | None = None
    observed_at: str | None = None  # RFC3339, caller stamps
    # Document coordinates (corpus-spine G4, spine PR B): where inside the
    # source document this item came from. Only document-backed kinds
    # (MANUAL_CHUNK, PRINT_OBSERVATION, ...) populate them; live / tenant-
    # transient evidence leaves all three None. bbox is [x0, y0, x1, y1] in
    # the producer's page/image coordinate space, carried verbatim.
    page: int | None = None
    section: str | None = None
    bbox: list[float] | None = None
    # A NON-GROUNDING producer signal that must reach the policy (e.g. the visual
    # lane's CONFLICTING / NEEDS_CONTEXT / FIELD_VERIFICATION_REQUIRED). Set ONLY
    # for states that mean "do not treat this as a settled fact — reconcile or ask
    # for the next-best evidence" (ADR-0033). None for ordinary grounded evidence,
    # which renders unchanged. to_prompt_block surfaces it so the signal is never
    # erased into a plain candidate line.
    evidence_state: str | None = None

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["kind"] = self.kind.value
        if self.freshness is not None:
            d["freshness"] = self.freshness.value
        return d


@dataclass(frozen=True)
class LiveTag:
    tag_path: str
    value: Any
    quality: str = "unknown"  # good|bad|stale|uncertain — ingest_contract enum
    freshness: Freshness = Freshness.UNKNOWN
    observed_at: str | None = None


@dataclass(frozen=True)
class LiveStateOverlay:
    """Mirror of MachineContextPacket's load-bearing half, with the silent
    truncation made explicit (``dropped_tag_count``)."""

    machine_state: str = "unknown"  # idle|running|faulted|comm_down|estopped|unknown
    state_since: str | None = None
    freshness_summary: dict[str, int] = field(default_factory=dict)  # Freshness value -> count
    tags: list[LiveTag] = field(default_factory=list)
    dropped_tag_count: int = 0
    active_conditions: list[str] = field(default_factory=list)
    evidence_window_ref: str | None = None

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        for t in d["tags"]:
            t["freshness"] = (
                t["freshness"].value if isinstance(t["freshness"], Freshness) else t["freshness"]
            )
        return d


@dataclass(frozen=True)
class Contradiction:
    a_citation: str
    b_citation: str
    description: str


@dataclass(frozen=True)
class AssetIdentity:
    uns_path: str | None = None
    equipment_entity_id: str | None = None
    manufacturer: str | None = None
    model: str | None = None
    confidence: str | None = None  # band per uns-message-resolver-spec §2.4
    source: str | None = None  # chat_resolver | technician_hint | direct_connection


@dataclass(frozen=True)
class TechnicianContext:
    """The single runtime context the one technician policy answers from."""

    contract_version: str
    task_mode: TaskMode
    tenant_id: str
    environment: str  # mirrors materialized_evidence Environment values
    asset: AssetIdentity = field(default_factory=AssetIdentity)
    question: str = ""
    conversation_state: dict[str, Any] = field(default_factory=dict)
    evidence: list[EvidenceItem] = field(default_factory=list)
    live: LiveStateOverlay | None = None
    contradictions: list[Contradiction] = field(default_factory=list)
    unknowns: list[str] = field(default_factory=list)
    allowed_actions: list[str] = field(default_factory=lambda: list(ALLOWED_ACTION_VOCAB))
    authorization_state: str = "read_only"

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["task_mode"] = self.task_mode.value
        d["evidence"] = [e.to_dict() for e in self.evidence]
        if self.live is not None:
            d["live"] = self.live.to_dict()
        return d


def validate_context(ctx: TechnicianContext) -> list[str]:
    """Deterministic validation; empty list = valid. Fail-closed on actions."""
    violations: list[str] = []
    if ctx.contract_version != CONTEXT_CONTRACT_VERSION:
        violations.append(f"contract_version:{ctx.contract_version}")
    if not ctx.tenant_id:
        violations.append("tenant_id:missing")
    for action in ctx.allowed_actions:
        low = action.lower()
        if any(bad in low for bad in FORBIDDEN_ACTION_SUBSTRINGS):
            violations.append(f"forbidden_action:{action}")
    if ctx.authorization_state != "read_only":
        violations.append(f"authorization_state:{ctx.authorization_state}")
    seen: set[str] = set()
    for item in ctx.evidence:
        if not item.citation_id:
            violations.append(f"evidence_missing_citation_id:{item.kind.value}")
        elif item.citation_id in seen:
            violations.append(f"duplicate_citation_id:{item.citation_id}")
        seen.add(item.citation_id)
    for c in ctx.contradictions:
        if c.a_citation not in seen or c.b_citation not in seen:
            violations.append(f"contradiction_cites_unknown_evidence:{c.description[:40]}")
    return violations


def to_prompt_block(ctx: TechnicianContext) -> str:
    """Deterministic, ordered rendering of the context for the model prompt.

    Ordering is fixed (identity → live → evidence by (kind, citation_id) →
    contradictions → unknowns) so identical contexts render byte-identically.
    """
    lines: list[str] = [f"[task_mode: {ctx.task_mode.value}]"]
    a = ctx.asset
    if a.uns_path or a.manufacturer or a.model:
        ident = " / ".join(x for x in (a.uns_path, a.manufacturer, a.model) if x)
        conf = f" (identity confidence: {a.confidence})" if a.confidence else ""
        lines.append(f"[asset: {ident}{conf}]")
    if ctx.live is not None:
        fs = ", ".join(f"{k}={v}" for k, v in sorted(ctx.live.freshness_summary.items()))
        lines.append(f"[machine_state: {ctx.live.machine_state}; freshness: {fs or 'unknown'}]")
        for t in sorted(ctx.live.tags, key=lambda t: t.tag_path):
            lines.append(
                f"[live_tag {t.tag_path} = {t.value} (quality {t.quality}, {t.freshness.value})]"
            )
        if ctx.live.dropped_tag_count:
            lines.append(f"[note: {ctx.live.dropped_tag_count} additional live tags not shown]")
    for item in sorted(ctx.evidence, key=lambda e: (e.kind.value, e.citation_id)):
        # A non-grounding producer signal (e.g. CONFLICTING) renders right after
        # trust so the policy sees "not a settled fact" before the claim text —
        # never erased. Vocabulary-agnostic: only producers that set it (the
        # visual lane, for the non-grounding trio) surface a marker; grounded
        # items leave it None and render byte-identically.
        state = f", {item.evidence_state}" if item.evidence_state else ""
        conf = f", confidence {item.confidence}" if item.confidence is not None else ""
        where = ""
        if item.page is not None:
            where += f", page {item.page}"
        if item.section:
            where += f", section {item.section}"
        lines.append(
            f"Evidence [{item.citation_id}] ({item.kind.value}, {item.trust}{state}{conf}{where}): "
            + _payload_line(item)
        )
    for c in ctx.contradictions:
        lines.append(f"[contradiction: {c.a_citation} vs {c.b_citation} — {c.description}]")
    for u in ctx.unknowns:
        lines.append(f"[unknown: {u}]")
    return "\n".join(lines)


def _payload_line(item: EvidenceItem) -> str:
    p = item.payload
    for key in ("claim", "text", "content", "summary"):
        if isinstance(p.get(key), str):
            return p[key]
    return json.dumps(p, sort_keys=True, ensure_ascii=False)


# --------------------------------------------------------------------------
# Adapters IN — pure functions over the dict shapes existing producers emit.
# No cross-package imports: callers pass plain dicts.
# --------------------------------------------------------------------------
def _as_int(value: Any) -> int | None:
    """Coerce a page/ordinal to int, or None. Mirrors the Hub's ``Number(...)``
    on ``source_page`` (rows arrive as int or numeric string depending on the
    driver). ``bool`` is rejected — it is an ``int`` subclass in Python and a
    ``True`` page is meaningless."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError:
            return None
    return None


def evidence_from_recall_chunks(chunks: list[dict[str, Any]]) -> list[EvidenceItem]:
    """mira-bots ``recall_knowledge`` / Hub ``ManualChunk`` rows → items.

    Document coordinates + corpus lineage (spine PR B): the page comes from
    ``page_num`` (top-level, then ``metadata.page_num``), and then — for
    Hub-shaped rows that carry no ``page_num`` at all — from
    ``source_page``/``sourcePage`` under the SAME mis-stamp test the Hub itself
    applies in ``manual-rag.ts displayPage()``: a row is a mis-stamp *exactly*
    when the page equals the chunk index, so that case yields no page, while a
    row whose page differs from its chunk index carries a real OEM page.

    That test is the Hub's, not ours, and it is empirically grounded: legacy
    ingest (gdrive / ``ingest_manuals.py``) stamped ``source_page`` with the
    chunk ORDINAL and is 100% ``sp == cidx`` on staging, whereas the crawler
    copy stores a real page and is ``sp != cidx`` for 1067/1069 rows
    (#2910/#2968). Reading ``source_page`` *unconditionally* would fabricate
    citations ("p. 47 when we mean chunk 47"); refusing it *unconditionally*
    silently drops the real page off every crawler-sourced Hub chunk, which is
    the coordinate loss this contract exists to prevent. Fail-closed stays the
    default: when the mis-stamp test cannot clear the value, the page is None.

    ``metadata.section`` maps to ``section``, and an EXPLICIT
    ``document_lineage_key`` (top-level or in metadata) is carried through. The
    key is never synthesized from manufacturer/source_url here — only the
    producer that holds the corpus registry may perform that join (fail-closed:
    absent means None, per oem-crawler-trusted "a selector is not a provenance
    test").
    """
    items = []
    for i, ch in enumerate(chunks, 1):
        locator = str(ch.get("source_url") or ch.get("sourceUrl") or "")
        meta = ch.get("metadata") if isinstance(ch.get("metadata"), dict) else {}
        # An explicitly-null chunk index is a real Hub shape (node rows carry
        # `page_start` with `chunkIndex: null`). `dict.get(k, default)` returns
        # the stored None in that case, so the default never fires and the
        # locator used to render the literal string "#chunkNone". Resolve to the
        # first NON-None of either dialect; when the producer gave no ordinal,
        # omit the fragment rather than substitute the loop counter — inventing
        # an ordinal is the same class of fabrication as inventing a page.
        idx = _as_int(ch.get("chunk_index"))
        if idx is None:
            idx = _as_int(ch.get("chunkIndex"))

        page = _as_int(_first_present(ch, "page_num"))
        if page is None:
            page = _as_int(_first_present(meta, "page_num"))
        if page is None:
            # Hub dialect: source_page is a real page iff it != the chunk index.
            sp = _as_int(_first_present(ch, "source_page"))
            if sp is None:
                sp = _as_int(_first_present(ch, "sourcePage"))
            if sp is not None and (idx is None or sp != idx):
                page = sp

        section = _first_present(ch, "section") or _first_present(meta, "section")
        lineage = _first_present(ch, "document_lineage_key") or _first_present(
            meta, "document_lineage_key"
        )
        items.append(
            EvidenceItem(
                kind=EvidenceKind.MANUAL_CHUNK,
                citation_id=f"M{i}",
                payload={"text": str(ch.get("content") or ch.get("text") or "")},
                source_locator=f"{locator}#chunk{idx}" if idx is not None else locator,
                confidence=ch.get("similarity"),
                trust="verified" if ch.get("verified") else "candidate",
                producer_name="recall_knowledge",
                document_lineage_key=str(lineage) if lineage else None,
                page=page,
                section=str(section) if section else None,
            )
        )
    return items


def evidence_from_drive_pack_answer(ans: dict[str, Any], pack_id: str) -> list[EvidenceItem]:
    """DrivePackAnswer-shaped dict → items (citations list carries locators)."""
    items = []
    for i, cite in enumerate(ans.get("citations") or [], 1):
        items.append(
            EvidenceItem(
                kind=EvidenceKind.DRIVE_PACK_FACT,
                citation_id=f"D{i}",
                payload={"claim": str(cite.get("claim") or cite.get("text") or cite)},
                source_locator=f"pack:{pack_id}#{cite.get('ref', i) if isinstance(cite, dict) else i}",
                trust="verified",
                producer_name="drive_pack_ask",
            )
        )
    return items


def evidence_from_kg_context(paths: list[dict[str, Any]]) -> list[EvidenceItem]:
    """Hub traversal / engine _build_kg_context rows → items (verified-only
    rows should be passed in; approval filtering happens at the producer)."""
    items = []
    for i, p in enumerate(paths, 1):
        items.append(
            EvidenceItem(
                kind=EvidenceKind.KG_PATH,
                citation_id=f"G{i}",
                payload={
                    "summary": str(p.get("summary") or p.get("path") or p),
                },
                source_locator=str(p.get("relationship_id") or p.get("id") or ""),
                confidence=p.get("confidence"),
                trust=str(p.get("approval_state") or "proposed"),
                producer_name="kg_traversal",
            )
        )
    return items


def _first_present(d: dict[str, Any], *keys: str) -> Any:
    """First key PRESENT with a usable value (not None / "").

    Unlike an ``a or b`` chain this honors falsy-but-valid values (id ``0``)
    and falls through a present-but-None key to the next candidate
    (2026-07-29 adversarial-review findings, spine PR B).
    """
    for k in keys:
        if k in d and d[k] not in (None, ""):
            return d[k]
    return None


def _freshness(value: Any) -> Freshness:
    """Tolerant parse for untyped legacy producers — unexpected strings map to
    UNKNOWN instead of raising (2026-07-29 adversarial-review finding)."""
    try:
        return Freshness(str(value or "unknown").lower())
    except ValueError:
        return Freshness.UNKNOWN


def live_overlay_from_machine_packet(packet: dict[str, Any]) -> LiveStateOverlay:
    """MachineContextPacket-shaped dict (TS producer) → overlay.

    Mirrors the REAL TS shape (verified against
    ``mira-hub/src/lib/machine-context-packet.ts``): ``machine_state`` may be
    a nested ``{state, since, fresh}`` object; the freshness summary field is
    named ``freshness`` in TS (``freshness_summary`` also accepted).
    """
    tags = []
    for t in packet.get("live_tags") or packet.get("liveTags") or []:
        tags.append(
            LiveTag(
                tag_path=str(t.get("tag_path") or t.get("tagPath") or t.get("plc_tag") or ""),
                value=t.get("value"),
                quality=str(t.get("quality") or "unknown"),
                freshness=_freshness(t.get("freshness")),
                observed_at=t.get("observed_at") or t.get("observedAt"),
            )
        )
    fs = (
        packet.get("freshness")
        or packet.get("freshness_summary")
        or packet.get("freshnessSummary")
        or {}
    )
    raw_state = packet.get("machine_state") or packet.get("machineState") or "unknown"
    if isinstance(raw_state, dict):
        state = str(raw_state.get("state") or "unknown")
        since = raw_state.get("since")
    else:
        state = str(raw_state)
        since = packet.get("state_since") or packet.get("stateSince")
    return LiveStateOverlay(
        machine_state=state,
        state_since=since,
        freshness_summary={str(k): int(v) for k, v in fs.items() if isinstance(v, (int, float))},
        tags=tags,
        dropped_tag_count=int(packet.get("dropped_tag_count") or 0),
        active_conditions=[str(c) for c in packet.get("active_conditions") or []],
        evidence_window_ref=packet.get("evidence_window_ref"),
    )


FACTORYLM_SNAPSHOT_SCHEMA = "factorylm.machine-snapshot.v1"

# ingest quality vocab {good,bad,stale,uncertain} -> Freshness {live,stale,simulated,unknown}.
# The downgrade direction is always toward LESS confidence: an unknown/unmapped
# quality can never become ``live`` (PRD § quality mapping).
_SNAPSHOT_QUALITY_TO_FRESHNESS = {
    "good": "live",
    "stale": "stale",
    "bad": "unknown",
    "uncertain": "unknown",
}
_SNAPSHOT_QUALITY_VOCAB = frozenset(_SNAPSHOT_QUALITY_TO_FRESHNESS)


def overlay_from_factorylm_snapshot(
    snapshot: Any,
) -> tuple[LiveStateOverlay | None, list[str]]:
    """``factorylm.machine-snapshot.v1`` envelope → ``LiveStateOverlay``.

    A thin, pure VALIDATOR + MAPPER that reshapes the FactoryLM producer envelope
    into the MachineContextPacket dict ``live_overlay_from_machine_packet`` already
    consumes, then delegates to it — it does NOT re-implement ``LiveTag``, the
    freshness enum, the summary count, or any rendering (ADR-0033: one producer,
    one overlay type). See ``contracts/machine_snapshot/`` for the shared fixture.

    Returns ``(overlay, [])`` on success, or ``(None, violations)`` when the
    envelope is invalid — the caller renders no live evidence that turn and the
    diagnosis still answers normally (never raises). Read-only by construction:
    no network, no fieldbus, no writes; a command/actuator field is ignored, not
    executed.
    """
    if not isinstance(snapshot, dict):
        return None, ["snapshot_not_an_object"]

    violations: list[str] = []
    if snapshot.get("schema_version") != FACTORYLM_SNAPSHOT_SCHEMA:
        violations.append(f"schema_version:{snapshot.get('schema_version')!r}")
    if not snapshot.get("snapshot_id"):
        violations.append("snapshot_id:missing")
    if not snapshot.get("captured_at"):
        violations.append("captured_at:missing")
    if not snapshot.get("tenant_id"):
        violations.append("tenant_id:missing")

    raw_tags = snapshot.get("tags")
    if not isinstance(raw_tags, list):
        violations.append("tags:not_a_list")
        raw_tags = []
    elif not raw_tags:
        # Parity with the FactoryLM producer's ``validate_envelope``, which
        # already rejects this ("tags must be a non-empty list"). Accepting it
        # here built an overlay with ZERO tags that still asserted
        # ``machine_state`` — a live block claiming e.g. "running" with no
        # evidence behind it. The producer being stricter than the consumer is
        # backwards: the consumer is the side facing untrusted input.
        violations.append("tags:empty")
    for t in raw_tags:
        # Structural malformation (non-dict, or no canonical tag_path) is a
        # validation failure — never a silently remapped tag.
        if not isinstance(t, dict) or not str(t.get("tag_path") or "").strip():
            violations.append("malformed_tag")
            break

    if violations:
        return None, violations

    simulated = str(snapshot.get("source_system") or "").lower() == "simulator"
    live_tags: list[dict[str, Any]] = []
    summary: dict[str, int] = {}
    for t in raw_tags:
        quality = str(t.get("quality") or "unknown").lower()
        if quality not in _SNAPSHOT_QUALITY_VOCAB:
            quality = "uncertain"  # unknown quality downgrades toward less confidence, never good
        freshness = _SNAPSHOT_QUALITY_TO_FRESHNESS[quality]
        if simulated and freshness == "live":
            freshness = "simulated"  # a simulated row is never presented as real telemetry
        summary[freshness] = summary.get(freshness, 0) + 1
        live_tags.append(
            {
                "tag_path": str(t.get("tag_path")),
                "value": t.get("value"),
                "quality": quality,
                "freshness": freshness,
                "observed_at": t.get("observed_at"),
            }
        )

    packet = {
        "machine_state": str(snapshot.get("machine_state") or "unknown").lower(),
        "active_conditions": snapshot.get("active_conditions") or [],
        "live_tags": live_tags,
        "freshness": summary,
    }
    return live_overlay_from_machine_packet(packet), []


def asset_from_uns_context(uns_context: dict[str, Any]) -> AssetIdentity:
    """engine ``state["context"]["uns_context"]`` (untyped legacy) → identity."""
    return AssetIdentity(
        uns_path=uns_context.get("uns_path"),
        equipment_entity_id=uns_context.get("equipment_entity_id"),
        manufacturer=uns_context.get("manufacturer"),
        model=uns_context.get("model"),
        confidence=uns_context.get("confidence"),
        source=uns_context.get("source"),
    )


def evidence_from_printsense_graph(
    entities: list[dict[str, Any]], sheet: str | None = None
) -> list[EvidenceItem]:
    """PrintSynth ``graph.json`` entity dicts (devices/terminals/wires) → items.

    Producers pass the entity rows they want cited (each carries tag/type/
    detail/evidence/confidence/trust per ``printsense/models.py``); geometry
    and crops stay behind ``source_locator`` references, never inlined.
    """
    items = []
    for i, e in enumerate(entities, 1):
        tag = str(e.get("tag") or e.get("id") or f"entity{i}")
        detail = str(e.get("detail") or e.get("type") or "")
        raw_bbox = e.get("bbox") or e.get("evidence_bbox")
        bbox = (
            [float(v) for v in raw_bbox]
            if isinstance(raw_bbox, (list, tuple))
            and len(raw_bbox) == 4
            and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in raw_bbox)
            else None
        )
        items.append(
            EvidenceItem(
                kind=EvidenceKind.PRINT_OBSERVATION,
                citation_id=f"P{i}",
                payload={"summary": f"{tag}: {detail}".strip(": ")},
                source_locator=f"sheet:{sheet or e.get('sheet') or ''}#{tag}",
                confidence=e.get("confidence"),
                trust=str(e.get("trust") or "candidate"),
                producer_name="printsense",
                bbox=bbox,
            )
        )
    return items


def evidence_from_ontology_validation(results: list[dict[str, Any]]) -> list[EvidenceItem]:
    """SHACL/ontology validation outcomes → items (kind ONTOLOGY_VALIDATION).

    Each result row: {shape, conforms: bool, message?, focus?}. A
    non-conforming result is evidence AGAINST a claim — the policy must treat
    it as a rejection reason, never silently drop it.
    """
    items = []
    for i, r in enumerate(results, 1):
        conforms = bool(r.get("conforms"))
        items.append(
            EvidenceItem(
                kind=EvidenceKind.ONTOLOGY_VALIDATION,
                citation_id=f"O{i}",
                payload={
                    "summary": (
                        f"shape {r.get('shape')}: "
                        + ("conforms" if conforms else f"VIOLATION — {r.get('message', '')}")
                    ).strip(),
                    "conforms": conforms,
                },
                source_locator=str(r.get("focus") or r.get("shape") or ""),
                trust="verified" if conforms else "rejected",
                producer_name="ontology_validator",
            )
        )
    return items


# --------------------------------------------------------------------------
# Spine PR B adapters — the four EvidenceKinds that had no producer path
# (corpus-spine ledger G4/G8). Same discipline as the adapters above: pure
# functions over plain dicts, no cross-package imports, fail-closed on rows
# that cannot be cited or audited.
# --------------------------------------------------------------------------
def evidence_from_historian_window(windows: list[dict[str, Any]]) -> list[EvidenceItem]:
    """Historian trend-window summaries → items (kind HISTORIAN_WINDOW).

    Each window row: ``{tag_path, window_start|start, window_end|end,
    summary? | stats?, ref?, freshness?, confidence?, trust?}``. Rows missing
    a tag_path or either window bound are DROPPED (fail-closed — an
    unanchored window cannot be cited or re-queried). Historian data is
    tenant-transient: no document lineage, and freshness defaults to STALE
    (it is history by definition) unless the producer says otherwise.
    """
    items: list[EvidenceItem] = []
    for w in windows:
        tag = str(w.get("tag_path") or w.get("tagPath") or "")
        start = w.get("window_start") or w.get("start")
        end = w.get("window_end") or w.get("end")
        if not tag or not start or not end:
            continue
        summary = w.get("summary")
        payload: dict[str, Any] = (
            {"summary": summary}
            if isinstance(summary, str) and summary
            else {"stats": w.get("stats") or {}}
        )
        payload["tag_path"] = tag
        payload["window"] = {"start": str(start), "end": str(end)}
        items.append(
            EvidenceItem(
                kind=EvidenceKind.HISTORIAN_WINDOW,
                citation_id=f"H{len(items) + 1}",
                payload=payload,
                source_locator=str(w.get("ref") or f"historian:{tag}@{start}/{end}"),
                confidence=w.get("confidence"),
                trust=str(w.get("trust") or "candidate"),
                producer_name="historian_window",
                freshness=(
                    _freshness(w["freshness"])
                    if w.get("freshness") is not None
                    else Freshness.STALE
                ),
                observed_at=str(end),
            )
        )
    return items


def evidence_from_work_orders(orders: list[dict[str, Any]]) -> list[EvidenceItem]:
    """CMMS work-order rows (Atlas / ``cmms_*`` dicts) → items (kind WORK_ORDER).

    Rows without an id are DROPPED (fail-closed — an uncitable record). A
    work order is a system-of-record row: what it SAYS is verifiable against
    the CMMS, so trust defaults to "verified"; producers pass ``trust`` to
    downgrade drafts/imports. Work orders are tenant-scoped operational
    records — never a document lineage key.
    """
    items: list[EvidenceItem] = []
    for o in orders:
        oid = _first_present(o, "id", "work_order_id", "wo_number")
        if oid is None:
            continue
        title = str(o.get("title") or o.get("summary") or "")
        desc = str(o.get("description") or "")
        status = str(o.get("status") or "unknown")
        text_ = f"WO {oid} [{status}] {title}".strip()
        if desc:
            text_ = f"{text_}: {desc}"
        when = _first_present(o, "completed_at", "updated_at", "created_at")
        items.append(
            EvidenceItem(
                kind=EvidenceKind.WORK_ORDER,
                citation_id=f"W{len(items) + 1}",
                payload={"text": text_, "status": status},
                source_locator=f"wo:{oid}",
                trust=str(o.get("trust") or "verified"),
                producer_name="cmms_work_orders",
                observed_at=str(when) if when is not None else None,
            )
        )
    return items


def evidence_from_prior_decisions(traces: list[dict[str, Any]]) -> list[EvidenceItem]:
    """``decision_traces`` rows → items (kind PRIOR_DECISION).

    The real table (migration 032 / ``mira-bots/shared/decision_trace.py``)
    stores its content in ``recommendation`` and its timestamp in ``ts`` —
    both accepted here alongside the generic ``summary``/``decision``/
    ``created_at`` spellings. Content is PII-sanitized at capture
    (``decision_trace._sanitize``); this adapter carries it verbatim.

    A prior MIRA decision is a HYPOTHESIS the policy may weigh, never ground
    truth: trust is hard-coded "candidate" (not producer-overridable — a past
    answer cannot promote itself; see the KG never-auto-verify law). Rows
    without an id, or with no decision content, are DROPPED (fail-closed).
    """
    items: list[EvidenceItem] = []
    for t in traces:
        tid = _first_present(t, "id", "trace_id")
        summary = str(_first_present(t, "summary", "decision", "recommendation") or "")
        if tid is None or not summary:
            continue
        when = _first_present(t, "created_at", "ts")
        items.append(
            EvidenceItem(
                kind=EvidenceKind.PRIOR_DECISION,
                citation_id=f"R{len(items) + 1}",
                payload={"summary": summary, "outcome": str(t.get("outcome") or "unknown")},
                source_locator=f"decision:{tid}",
                confidence=_first_present(t, "groundedness", "confidence"),
                trust="candidate",
                producer_name="decision_traces",
                observed_at=str(when) if when is not None else None,
            )
        )
    return items


def evidence_from_technician_corrections(events: list[dict[str, Any]]) -> list[EvidenceItem]:
    """Technician correction EVENTS → items (kind TECHNICIAN_CORRECTION).

    Canonical shape: ``correction-event.v1``
    (``docs/specs/continuous-learning-factory/schemas/``) — ``correction_id``
    / ``at`` / ``corrected_answer``, with ``run_id`` naming the result being
    corrected. Generic ``event_id``/``occurred_at``/``correction`` spellings
    are tolerated for pre-schema producers.

    Corrections are immutable events (corpus-spine G8): every event adapts
    1:1 — never merged, never rewritten. Each item carries the event id +
    timestamp as its audit anchor AND a content hash (``evidence_hash`` =
    sha256 over id/at/text/run_id) so a replayed event whose text was
    rewritten under the same id is detectable. Events missing the id, the
    timestamp, or the correction text are DROPPED (fail-closed — an
    unanchored correction cannot be audited; an ``action: accept`` event with
    a null ``corrected_answer`` carries no citable text and is likewise
    dropped).

    The "what was corrected" pointer is durable, never per-context: ``run_id``
    (and legacy ``corrected_claim`` free text) are carried; ephemeral
    citation ids like "P1" are NOT accepted as pointers — they alias across
    context assemblies.

    Rights + trust are fail-closed by construction: a correction here is
    runtime evidence ONLY — no ``document_lineage_key``, no training rights
    (the correction/conversation rights class ships denied-until-registered,
    spine PR D). Trust is hard-coded "candidate" exactly like PRIOR_DECISION:
    a correction is the technician's claim, authoritative about what they
    SAID, and cannot arrive pre-promoted (never-auto-verify law). Producers
    MUST feed only the PII-sanitized capture stream (``conversation_eval`` /
    ``decision_trace._sanitize`` precedent); this adapter carries text
    verbatim and never de-redacts.
    """
    items: list[EvidenceItem] = []
    for ev in events:
        eid = _first_present(ev, "correction_id", "event_id", "id")
        when = _first_present(ev, "at", "occurred_at", "created_at")
        text_ = str(_first_present(ev, "corrected_answer", "correction", "text", "content") or "")
        if eid is None or when is None or not text_:
            continue
        run_id = _first_present(ev, "run_id")
        payload: dict[str, Any] = {"text": text_}
        if ev.get("action"):
            payload["action"] = str(ev["action"])
        if run_id is not None:
            payload["corrects_run_id"] = str(run_id)
        corrected_claim = _first_present(ev, "corrected_claim")
        if corrected_claim is not None:
            payload["corrects"] = str(corrected_claim)
        anchor = json.dumps(
            {"at": str(when), "id": str(eid), "run_id": str(run_id or ""), "text": text_},
            sort_keys=True,
            ensure_ascii=False,
        )
        items.append(
            EvidenceItem(
                kind=EvidenceKind.TECHNICIAN_CORRECTION,
                citation_id=f"T{len(items) + 1}",
                payload=payload,
                source_locator=f"correction:{eid}",
                trust="candidate",
                producer_name="technician_corrections",
                evidence_hash=hashlib.sha256(anchor.encode("utf-8")).hexdigest(),
                observed_at=str(when),
            )
        )
    return items


# --------------------------------------------------------------------------
# Bravo runtime boundary — the local VLM/OCR lane is an EVIDENCE PRODUCER, not
# a second assistant. Its VisualSession ledger (ADR-0027 / migration 063:
# evidence_item, region_of_interest, observation) adapts IN here to typed
# candidate PRINT_OBSERVATION items. Same discipline as the adapters above:
# pure, dict-in, no cross-package import (the bot containers must not import
# this root package). The visual EvidenceState / review_state string constants
# are mirrored, not imported — like the FORBIDDEN_ACTION_SUBSTRINGS mirror of
# agent_registry. Trust is fail-closed: model output is ``candidate`` forever;
# only the human ``review_state`` raises it. Nothing here is derived from a
# filename, list order, or prose.
# --------------------------------------------------------------------------
# Observation.evidence_state values (mira-bots/shared/visual/evidence_state.py)
# that mean "not active" — the store's _ACTIVE_FILTER drops exactly these.
_VISUAL_INACTIVE_STATES = frozenset({"REJECTED", "SUPERSEDED"})
# Observation.review_state values (the HUMAN gate) that raise trust to verified.
# "unreviewed" (raw model output) is deliberately absent — see the never-auto-
# verify law and the Bravo boundary in NORTH_STAR.md.
_VISUAL_HUMAN_VERIFIED_REVIEW = frozenset({"confirmed", "corrected"})
# Observation.evidence_state values (mira-bots/shared/visual/evidence_state.py)
# that are NON-GROUNDING: they mean "the answer is blocked / disputed / needs
# field verification" — the policy must reconcile or ask for the next-best
# evidence (ADR-0033), NOT read them as settled facts. These are surfaced on the
# EvidenceItem (evidence_state) so to_prompt_block never erases the signal into a
# plain candidate line. CONFLICTING = EvidenceState.requires_next_evidence() ∪
# NEEDS_CONTEXT; FIELD_VERIFICATION_REQUIRED = the "approvable with field
# verification" open-item tier. Grounded states (VISIBLE/DOCUMENTED/
# MACHINE_VERIFIED/LIKELY) carry no signal and render unchanged.
_VISUAL_NONGROUNDING_STATES = frozenset(
    {"CONFLICTING", "NEEDS_CONTEXT", "FIELD_VERIFICATION_REQUIRED"}
)


def _visual_bbox(region: dict[str, Any] | None) -> list[float] | None:
    """Recover [x0, y0, x1, y1] from a region row ONLY when it explicitly holds
    a rectangle. A stored rect is ``geometry = {"type": "bbox", x, y, w, h}``
    (region_schema.to_storage_geometry, normalized 0..1) → ``[x, y, x+w, y+h]``.
    An explicit verbatim ``bbox`` list of four numbers is carried as-is. Point /
    polygon / ellipse geometries carry NO bbox — we never synthesize a
    rectangle. Returns None when nothing rectangular is explicitly present."""
    if not region:
        return None
    geom = region.get("geometry") or {}
    # Verbatim 4-list, on the region or its geometry (mirrors the printsense
    # graph adapter's bbox handling exactly).
    for raw in (region.get("bbox"), geom.get("bbox") if isinstance(geom, dict) else None):
        if (
            isinstance(raw, (list, tuple))
            and len(raw) == 4
            and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in raw)
        ):
            return [float(v) for v in raw]
    # Stored rect {type: bbox, x, y, w, h} → corner form, rounded to the region
    # schema's precision so x+w / y+h carry no float noise.
    if isinstance(geom, dict) and geom.get("type") == "bbox":
        xs = [geom.get("x"), geom.get("y"), geom.get("w"), geom.get("h")]
        if all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in xs):
            x, y, w, h = (float(v) for v in xs)
            return [round(x, 6), round(y, 6), round(x + w, 6), round(y + h, 6)]
    return None


def evidence_from_visual_session(
    observations: list[dict[str, Any]],
    *,
    evidence: list[dict[str, Any]] | None = None,
    regions: list[dict[str, Any]] | None = None,
) -> list[EvidenceItem]:
    """Serialized VisualSession ledger rows → PRINT_OBSERVATION items.

    ``observations`` is the citable unit (the ``observation`` table — one
    atomic visual claim each). ``evidence`` and ``regions`` are the joined
    ``evidence_item`` / ``region_of_interest`` rows they reference, supplying
    the source hash / page and the bounding box respectively. All three are
    plain dicts with the migration-063 column names (as
    ``mira-bots/shared/visual/models.py`` ``from_row`` reads them).

    Trust / provenance guarantees (Bravo is an evidence lane, never an oracle):
    - ``trust`` is ``candidate`` unless the row's HUMAN ``review_state`` is
      ``confirmed``/``corrected`` — a model's own ``evidence_state`` (even
      MACHINE_VERIFIED) or ``confidence`` can NEVER promote it. Model output
      cannot self-certify as human-verified truth.
    - Rejected / superseded observations are DROPPED (``evidence_state`` in
      {REJECTED, SUPERSEDED}, ``review_state == rejected``, or ``superseded_by``
      set) — mirrors the store's ``_ACTIVE_FILTER``.
    - Rows with no citable text are DROPPED (fail-closed).
    - ``producer_name`` = the row's ``extractor`` (vision_worker / ocr /
      schematic_intelligence / …) so vision prose, OCR text, and schematic
      inference stay distinguishable. ``producer_version`` (the VLM/OCR model)
      is carried ONLY from an explicit ``model_version`` key — never inferred.
    - ``evidence_hash`` is the source image's ``original_hash`` when present;
      ``page`` comes from the evidence ``page_ref`` only when it is an explicit
      integer; ``bbox`` only when the region explicitly holds a rectangle.
      Nothing (page, bbox, hash, model version, asset) is derived from a
      filename, list order, or prose. Missing → absent, never invented.
    - ``document_lineage_key`` is None: a session observation is tenant-transient
      runtime evidence, not a corpus document. Human review, not this adapter,
      promotes anything to durable truth.
    """
    evidence_by_id = {str(e["evidence_id"]): e for e in (evidence or []) if e.get("evidence_id")}
    regions_by_id = {str(r["region_id"]): r for r in (regions or []) if r.get("region_id")}

    items: list[EvidenceItem] = []
    for obs in observations:
        state = str(obs.get("evidence_state") or "").upper()
        review = str(obs.get("review_state") or "unreviewed").lower()
        if state in _VISUAL_INACTIVE_STATES or review == "rejected" or obs.get("superseded_by"):
            continue
        # A durable audit anchor is mandatory. Without BOTH ids the source_locator
        # is the un-citable "visual_session:#observation:" that validate_context()
        # would still accept — drop the row, exactly as the prior-decision /
        # correction adapters drop id-less rows.
        session_id = str(obs.get("session_id") or "")
        obs_id = str(obs.get("observation_id") or "")
        if not session_id or not obs_id:
            continue
        text = str(obs.get("normalized_value") or obs.get("raw_value") or "").strip()
        if not text:
            continue

        tenant_id = str(obs.get("tenant_id") or "")
        obs_ev_id = str(obs.get("evidence_id") or "")

        # Provenance may only ride from ledger rows that PROVABLY belong to this
        # observation. Migration 063 / the store do not enforce these FKs, so a
        # malformed row could otherwise emit image A's hash/page with image B's
        # bounding box. Carry the evidence (hash/page) only when it shares this
        # observation's tenant AND session; carry the region (bbox) only when the
        # evidence link is valid AND the region shares this tenant and points at
        # the SAME evidence. Any mismatch drops that provenance — never the claim.
        ev = evidence_by_id.get(obs_ev_id) if obs_ev_id else None
        if ev is not None and (
            str(ev.get("tenant_id") or "") != tenant_id
            or str(ev.get("session_id") or "") != session_id
        ):
            ev = None
        region = regions_by_id.get(str(obs.get("region_id"))) if obs.get("region_id") else None
        if region is not None and (
            ev is None
            or str(region.get("tenant_id") or "") != tenant_id
            or str(region.get("evidence_id") or "") != obs_ev_id
        ):
            region = None

        # producer_version: explicit model_version only (observation metadata,
        # then the evidence capture_meta). "model" alone is ambiguous (an
        # equipment model number is not a VLM version) and is NOT accepted.
        obs_meta = obs.get("metadata") or {}
        cap_meta = (ev or {}).get("capture_meta") or {}
        model_version = obs_meta.get("model_version") or cap_meta.get("model_version") or ""

        items.append(
            EvidenceItem(
                kind=EvidenceKind.PRINT_OBSERVATION,
                citation_id=f"V{len(items) + 1}",
                payload={"summary": text, "obs_kind": str(obs.get("obs_kind") or "entity")},
                source_locator=f"visual_session:{session_id}#observation:{obs_id}",
                confidence=obs.get("confidence"),
                trust=("verified" if review in _VISUAL_HUMAN_VERIFIED_REVIEW else "candidate"),
                producer_name=str(obs.get("extractor") or "visual_session"),
                producer_version=str(model_version),
                evidence_hash=(ev.get("original_hash") if ev else None),
                observed_at=(str(obs["created_at"]) if obs.get("created_at") else None),
                page=_as_int(ev.get("page_ref")) if ev else None,
                bbox=_visual_bbox(region),
                # Surface a NON-GROUNDING state so the policy reconciles / asks for
                # the next-best evidence instead of reading a disputed or
                # unverified claim as a settled fact (ADR-0033). Grounded states
                # carry no signal and render unchanged. Mapping these into
                # TechnicianContext.contradictions / .unknowns is the context
                # assembler's job (the future runtime slice) — this adapter
                # returns list[EvidenceItem] and cannot populate context-level
                # fields without inventing the other side of a contradiction.
                evidence_state=(state if state in _VISUAL_NONGROUNDING_STATES else None),
            )
        )
    return items
