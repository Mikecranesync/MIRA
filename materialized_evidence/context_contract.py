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
        conf = f", confidence {item.confidence}" if item.confidence is not None else ""
        where = ""
        if item.page is not None:
            where += f", page {item.page}"
        if item.section:
            where += f", section {item.section}"
        lines.append(
            f"Evidence [{item.citation_id}] ({item.kind.value}, {item.trust}{conf}{where}): "
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
def evidence_from_recall_chunks(chunks: list[dict[str, Any]]) -> list[EvidenceItem]:
    """mira-bots ``recall_knowledge`` / Hub ``ManualChunk`` rows → items.

    Document coordinates + corpus lineage (spine PR B): the page comes from
    ``page_num`` (top-level, then ``metadata.page_num``) — NEVER from
    ``source_page``, which on the legacy corpus holds the chunk ordinal, not a
    PDF page (#2910/#2968; rendering it as a page would fabricate citations —
    same law as ``rag_worker.py`` / ``response_formatter.py`` /
    ``manual-rag.ts displayPage()``). ``metadata.section`` maps to ``section``,
    and an EXPLICIT ``document_lineage_key`` (top-level or in metadata) is
    carried through. The key is never synthesized from manufacturer/source_url
    here — only the producer that holds the corpus registry may perform that
    join (fail-closed: absent means None, per oem-crawler-trusted "a selector
    is not a provenance test").
    """
    items = []
    for i, ch in enumerate(chunks, 1):
        locator = str(ch.get("source_url") or ch.get("sourceUrl") or "")
        idx = ch.get("chunk_index", ch.get("chunkIndex", i))
        meta = ch.get("metadata") if isinstance(ch.get("metadata"), dict) else {}
        page = _first_present(ch, "page_num")
        if page is None:
            page = _first_present(meta, "page_num")
        section = _first_present(ch, "section") or _first_present(meta, "section")
        lineage = _first_present(ch, "document_lineage_key") or _first_present(
            meta, "document_lineage_key"
        )
        items.append(
            EvidenceItem(
                kind=EvidenceKind.MANUAL_CHUNK,
                citation_id=f"M{i}",
                payload={"text": str(ch.get("content") or ch.get("text") or "")},
                source_locator=f"{locator}#chunk{idx}",
                confidence=ch.get("similarity"),
                trust="verified" if ch.get("verified") else "candidate",
                producer_name="recall_knowledge",
                document_lineage_key=str(lineage) if lineage else None,
                page=page if isinstance(page, int) and not isinstance(page, bool) else None,
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
