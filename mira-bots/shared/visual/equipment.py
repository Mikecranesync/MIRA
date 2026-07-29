"""Equipment identity resolution + pack/manual-grounded answering (ADR-0027 Phase 2).

Thin, deterministic layer between the Phase-1 VisualSession spine and the
existing Drive Commander pack seam (``shared/drive_packs/``). Nothing here
duplicates pack matching, manual retrieval, or answer composition — it wires
already-existing, already-tested primitives together:

  - ``resolve_service_pack`` / ``list_packs`` / ``load_pack``
    (``shared/drive_packs/{resolver,loader}.py``) for pack identity.
  - ``recall_knowledge`` (``shared/neon_recall.py``) + the SAME Ollama embed
    path ``RAGWorker`` uses, for tenant-scoped manual retrieval.
  - ``compose_answer`` (``.answer_composer`` — UNMODIFIED, safety-critical)
    for turning observations + citations into a grounded ``AnswerEnvelope``.

THE SAFETY-CRITICAL CRUX — ``resolve_equipment``
=================================================
``resolve_service_pack`` resolves ONE signal at a time and returns on the
first single-match signal (see its own docstring: "first non-empty signal
wins the attempt"). That is correct for its own contract, but it means a
genuine disagreement BETWEEN signals — a technician typed "GS10" while the
photographed nameplate reads "PowerFlex 525" — is invisible to a caller that
only makes one combined call: ``drive_name`` is checked first and returns
before ``nameplate`` is ever consulted.

``resolve_equipment`` closes that gap by calling ``resolve_service_pack``
ONCE PER INDEPENDENT SIGNAL (never combining two identifiers into one call),
comparing the results, and refusing to name a single pack whenever the
signals disagree or are incomplete:

  1. Build the independent signal calls that are non-empty (nameplate dict,
     nameplate's own ``model`` field treated as a drive name, an explicit
     ``drive_name``, an explicit ``asset_make_model``, and the nameplate's
     ``manufacturer + model`` combined).
  2. Classify each ``PackResolution``: resolved (a pack_id) / ambiguous
     (``ambiguous=True``) / none.
  3. ``distinct_resolved`` = the set of pack_ids any signal cleanly resolved.
  4. For every AMBIGUOUS signal, re-derive its full candidate set using only
     the PUBLIC loader API (``list_packs`` + ``load_pack`` +
     ``family.aliases``/``family.series``/``nameplate.match_keywords``) —
     ``resolve_service_pack`` only exposes a prose ``reason`` for ambiguity,
     not a structured list, so this reconstructs it independently rather than
     reaching into the resolver's private ``_matching_live_packs``.
  5. Decide, in order:
       - more than one DISTINCT resolved pack -> **CONFLICTING**. Refuse
         (``pack_id=None``); surface both/all identifiers.
       - exactly one resolved pack, and no ambiguous signal points anywhere
         ELSE -> **RESOLVED**.
       - exactly one resolved pack, but an ambiguous signal ALSO points at a
         genuinely different pack -> **AMBIGUOUS** (never silently pick the
         resolved one; surface every candidate).
       - zero resolved packs but at least one ambiguous candidate exists ->
         **AMBIGUOUS**.
       - otherwise -> **NONE**.
  Never RESOLVED when identifiers conflict or are incomplete (Phase 2 rule 5).

Candidate ranking is deterministic (sorted by ``pack_id`` ascending) and the
whole function is a pure computation over its inputs plus the on-disk pack
corpus — no LLM, no network, no DB, matching ``resolve_service_pack``'s own
purity contract.

Everything else in this module (``ManualRetriever``, ``answer_equipment``) is
a thin orchestration layer: gather deterministic pack facts, retrieve
tenant-scoped manual chunks, persist both as DOCUMENTED observations, then
hand off to ``answer_composer.compose_answer`` — completely unmodified — for
the actual claim/evidence-state/safety logic.
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from ..drive_packs import list_packs, load_pack
from ..drive_packs.resolver import resolve_service_pack
from ..drive_packs.schema import DrivePack, EnvelopeBand
from .answer_composer import SAFETY_TRIGGER_PHRASES, compose_answer
from .evidence_state import EvidenceState
from .models import AnswerClaim, AnswerEnvelope

logger = logging.getLogger("mira-gsd.visual_equipment")

# Mirrors shared.workers.nameplate_worker.NAMEPLATE_FIELDS exactly. Kept as a
# literal copy (not an import) so this module — and session_service.py, which
# imports it from here — never pulls in nameplate_worker's httpx/InferenceRouter
# dependency chain just to read a tuple of field names. nameplate_worker.py
# stays the single SOURCE of these field names; this is a stable, tiny mirror.
NAMEPLATE_IDENTITY_FIELDS: tuple[str, ...] = (
    "manufacturer",
    "model",
    "serial",
    "voltage",
    "fla",
    "hp",
    "frequency",
    "rpm",
)


# ─── PackCandidate / EquipmentResolution ────────────────────────────────────


@dataclass(frozen=True, slots=True, kw_only=True)
class PackCandidate:
    """One candidate pack backing (or contending for) an equipment identity."""

    pack_id: str
    confidence: str  # "high" | "medium" | "none" — same bands as PackResolution
    evidence: list[str] = field(default_factory=list)
    source: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "pack_id": self.pack_id,
            "confidence": self.confidence,
            "evidence": list(self.evidence),
            "source": self.source,
        }


@dataclass(frozen=True, slots=True, kw_only=True)
class EquipmentResolution:
    """The result of ``resolve_equipment`` — see module docstring for the
    decision tree. ``status`` is one of RESOLVED / AMBIGUOUS / CONFLICTING /
    NONE. ``pack_id`` is non-None ONLY for RESOLVED. ``candidates`` is always
    sorted by ``pack_id`` ascending.
    """

    status: str
    pack_id: str | None = None
    candidates: list[PackCandidate] = field(default_factory=list)
    evidence: list[str] = field(default_factory=list)
    reason: str = ""
    needs_context: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "pack_id": self.pack_id,
            "candidates": [c.to_dict() for c in self.candidates],
            "evidence": list(self.evidence),
            "reason": self.reason,
            "needs_context": self.needs_context,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> EquipmentResolution:
        """Reconstruct from a persisted ``observation.metadata`` JSONB blob.

        Never raises — an empty/malformed dict degrades to a NONE resolution,
        matching every other "never raise" contract in this package.
        """
        data = data if isinstance(data, dict) else {}
        try:
            candidates = [
                PackCandidate(
                    pack_id=c["pack_id"],
                    confidence=c.get("confidence", "none"),
                    evidence=list(c.get("evidence", [])),
                    source=c.get("source", ""),
                )
                for c in data.get("candidates", [])
                if isinstance(c, dict) and c.get("pack_id")
            ]
        except Exception as exc:  # noqa: BLE001 - malformed persisted metadata must not crash
            logger.warning("EquipmentResolution.from_dict: malformed candidates, dropping: %s", exc)
            candidates = []
        return cls(
            status=data.get("status") or "NONE",
            pack_id=data.get("pack_id"),
            candidates=candidates,
            evidence=list(data.get("evidence", [])),
            reason=data.get("reason", ""),
            needs_context=data.get("needs_context"),
        )


_CONFIDENCE_RANK = {"high": 2, "medium": 1, "none": 0}


def _better_confidence(a: str, b: str) -> str:
    return a if _CONFIDENCE_RANK.get(a, 0) >= _CONFIDENCE_RANK.get(b, 0) else b


def _nonempty_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _nameplate_is_nonempty(nameplate: dict[str, Any]) -> bool:
    """True when the nameplate dict carries at least one real identity field.

    Excludes ``raw_text`` deliberately — the resolver's own nameplate-text
    builder never reads it either (only manufacturer/model/series/description/
    component), so a nameplate dict with ONLY raw_text populated carries no
    signal for pack matching.
    """
    if not nameplate or "parse_error" in nameplate:
        return False
    return any(_nonempty_str(v) is not None for k, v in nameplate.items() if k != "raw_text")


# ─── signal construction (step 1) ───────────────────────────────────────────


@dataclass(frozen=True)
class _Signal:
    name: str
    kwargs: dict[str, Any]
    text: str  # what this signal "means" as plain text, for candidate re-derivation


def _build_signals(
    nameplate: dict[str, Any],
    drive_name: str | None,
    asset_make_model: str | None,
) -> list[_Signal]:
    signals: list[_Signal] = []

    if _nameplate_is_nonempty(nameplate):
        mfr = _nonempty_str(nameplate.get("manufacturer")) or ""
        model = _nonempty_str(nameplate.get("model")) or ""
        text = " ".join(part for part in (mfr, model) if part)
        signals.append(_Signal("nameplate", {"nameplate": nameplate}, text))

    model = _nonempty_str(nameplate.get("model"))
    if model:
        signals.append(_Signal("model_as_drive_name", {"drive_name": model}, model))

    dn = _nonempty_str(drive_name)
    if dn:
        signals.append(_Signal("drive_name", {"drive_name": dn}, dn))

    amm = _nonempty_str(asset_make_model)
    if amm:
        signals.append(_Signal("asset_make_model", {"asset_make_model": amm}, amm))

    mfr = _nonempty_str(nameplate.get("manufacturer"))
    if mfr and model:
        combo = f"{mfr} {model}"
        signals.append(_Signal("nameplate_combo", {"asset_make_model": combo}, combo))

    return signals


# ─── ambiguous-candidate re-derivation (step 4) ─────────────────────────────


def _candidates_for_text(text: str) -> list[str]:
    """Every live pack whose alias/series/keyword case-insensitively appears
    in ``text``. A flat, single-pass, ALL-terms-combined re-derivation — NOT
    the resolver's own two-pass alias-first precedence. That's deliberate: the
    purpose here is "what could this ambiguous signal plausibly mean", so a
    superset re-derivation is the safe direction to be imprecise in.
    """
    if not text:
        return []
    haystack = text.lower()
    hits: list[str] = []
    for pack_id in list_packs():
        pack = load_pack(pack_id)
        terms = [*pack.family.aliases, pack.family.series, *pack.nameplate.match_keywords]
        if any(term and term.lower() in haystack for term in terms):
            hits.append(pack_id)
    return hits


# ─── resolve_equipment ───────────────────────────────────────────────────────


def resolve_equipment(
    *,
    nameplate: dict[str, Any] | None = None,
    drive_name: str | None = None,
    asset_make_model: str | None = None,
) -> EquipmentResolution:
    """Deterministically resolve equipment identity from independent signals.

    See the module docstring for the full algorithm. Pure — no LLM, no
    network, no DB (identical purity contract to ``resolve_service_pack``).
    Never returns RESOLVED when identifiers conflict or are incomplete.
    """
    nameplate = nameplate if isinstance(nameplate, dict) else {}
    signals = _build_signals(nameplate, drive_name, asset_make_model)

    # (signal, PackResolution, kind) where kind in {"resolved","ambiguous","none"}
    triples: list[tuple[_Signal, Any, str]] = []
    for sig in signals:
        result = resolve_service_pack(**sig.kwargs)
        if result.pack_id is not None:
            kind = "resolved"
        elif result.ambiguous:
            kind = "ambiguous"
        else:
            kind = "none"
        triples.append((sig, result, kind))

    all_evidence: list[str] = []
    for _, result, _ in triples:
        for item in result.evidence:
            if item not in all_evidence:
                all_evidence.append(item)

    resolved_by_pack: dict[str, list[tuple[_Signal, Any]]] = {}
    for sig, result, kind in triples:
        if kind == "resolved":
            resolved_by_pack.setdefault(result.pack_id, []).append((sig, result))
    distinct_resolved = sorted(resolved_by_pack.keys())

    ambiguous_candidates_by_signal: dict[str, list[str]] = {}
    for sig, _result, kind in triples:
        if kind == "ambiguous":
            ambiguous_candidates_by_signal[sig.name] = _candidates_for_text(sig.text)
    ambiguous_candidates = sorted(
        {pid for pids in ambiguous_candidates_by_signal.values() for pid in pids}
    )

    def _candidate_for(
        pack_id: str,
        *,
        default_confidence: str,
        contributing: list[tuple[_Signal, Any]] | None,
        extra_source: str | None = None,
    ) -> PackCandidate:
        evidence: list[str] = []
        sources: list[str] = []
        confidence = default_confidence
        for sig, result in contributing or []:
            sources.append(sig.name)
            confidence = _better_confidence(confidence, result.confidence)
            for item in result.evidence:
                if item not in evidence:
                    evidence.append(item)
        if extra_source:
            sources.append(extra_source)
        if not evidence:
            evidence.append(f"matched by {'+'.join(sources) or 'ambiguous re-derivation'}")
        return PackCandidate(
            pack_id=pack_id,
            confidence=confidence,
            evidence=evidence,
            source="+".join(sorted(set(sources))) if sources else "ambiguous_rederivation",
        )

    # ── decision tree (step 5) ──────────────────────────────────────────────

    if len(distinct_resolved) > 1:
        candidates = sorted(
            (
                _candidate_for(pid, default_confidence="none", contributing=resolved_by_pack[pid])
                for pid in distinct_resolved
            ),
            key=lambda c: c.pack_id,
        )
        joined = " vs ".join(f"'{pid}'" for pid in distinct_resolved)
        needs_context = (
            f"the identifiers disagree ({joined}) — send one clear, glare-free photo of the "
            "full nameplate model/catalog number"
        )
        return EquipmentResolution(
            status="CONFLICTING",
            pack_id=None,
            candidates=candidates,
            evidence=all_evidence,
            reason=f"conflicting equipment identity across signals: {', '.join(distinct_resolved)}",
            needs_context=needs_context,
        )

    if len(distinct_resolved) == 1:
        resolved_pack_id = distinct_resolved[0]
        has_extra_candidate = any(
            bool(set(pids) - {resolved_pack_id}) for pids in ambiguous_candidates_by_signal.values()
        )
        if not has_extra_candidate:
            candidate = _candidate_for(
                resolved_pack_id,
                default_confidence="none",
                contributing=resolved_by_pack[resolved_pack_id],
            )
            sources = sorted({sig.name for sig, _ in resolved_by_pack[resolved_pack_id]})
            return EquipmentResolution(
                status="RESOLVED",
                pack_id=resolved_pack_id,
                candidates=[candidate],
                evidence=all_evidence,
                reason=f"resolved via {'+'.join(sources)} -> {resolved_pack_id}",
                needs_context=None,
            )

        union_ids = sorted({resolved_pack_id, *ambiguous_candidates})
        candidates = sorted(
            (
                _candidate_for(
                    pid,
                    default_confidence="medium" if pid != resolved_pack_id else "none",
                    contributing=resolved_by_pack.get(pid),
                    extra_source=None if pid == resolved_pack_id else "ambiguous_rederivation",
                )
                for pid in union_ids
            ),
            key=lambda c: c.pack_id,
        )
        return EquipmentResolution(
            status="AMBIGUOUS",
            pack_id=None,
            candidates=candidates,
            evidence=all_evidence,
            reason=f"ambiguous — {len(candidates)} candidate packs match: {', '.join(union_ids)}",
            needs_context="multiple drives match — send the full catalog/part number",
        )

    if ambiguous_candidates:
        candidates = sorted(
            (
                _candidate_for(
                    pid,
                    default_confidence="medium",
                    contributing=None,
                    extra_source="ambiguous_rederivation",
                )
                for pid in ambiguous_candidates
            ),
            key=lambda c: c.pack_id,
        )
        return EquipmentResolution(
            status="AMBIGUOUS",
            pack_id=None,
            candidates=candidates,
            evidence=all_evidence,
            reason=(
                f"ambiguous — {len(candidates)} candidate packs match: "
                f"{', '.join(ambiguous_candidates)}"
            ),
            needs_context="multiple drives match — send the full catalog/part number",
        )

    model = _nonempty_str(nameplate.get("model"))
    if model:
        needs_context = f"model '{model}' isn't a supported drive yet"
    else:
        needs_context = (
            "couldn't read the drive identity — send a clear photo of the nameplate "
            "manufacturer + model"
        )
    return EquipmentResolution(
        status="NONE",
        pack_id=None,
        candidates=[],
        evidence=all_evidence,
        reason=needs_context,
        needs_context=needs_context,
    )


# ─── manual retrieval (injectable) ──────────────────────────────────────────

# {"doc": str, "page": int|str, "excerpt": str} — matches AnswerClaim.doc_citations'
# tested shape (test_visual_answer_composer.py) and drive_packs.schema.Citation byte-for-byte.
ManualCitation = dict[str, Any]

# (question, tenant_id, manufacturer) -> citations. The DEFAULT implementation is
# async (it awaits an embed call); answer_equipment invokes any retriever — sync
# or async — through _maybe_await, so a hermetic test can inject a plain sync fake.
ManualRetriever = Callable[[str, str, str | None], list[ManualCitation]]


async def _maybe_await(value: Any) -> Any:
    """Accept either a sync or async injected callable's return value.

    Mirrors ``session_service._maybe_await`` exactly. Duplicated locally
    (not imported) because ``session_service.py`` imports THIS module — an
    import the other way would cycle.
    """
    if isinstance(value, Awaitable):
        return await value
    return value


async def default_manual_retriever(
    question: str, tenant_id: str, manufacturer: str | None
) -> list[ManualCitation]:
    """Tenant-scoped manual retrieval via the SAME stack the chat/RAG path uses.

    Lazy-imports ``neon_recall.recall_knowledge`` and the Ollama embed path
    ``RAGWorker`` uses (deployment-separate — sqlalchemy/httpx are not always
    present). ``tenant_id`` is ALWAYS the caller's session tenant — this
    function has no other source of tenant identity, which is the point (see
    ``answer_equipment`` / ``VisualSessionService.ask_equipment``: tenant_id is
    threaded straight from the session, never re-derived).

    Vendor-filtered via ``chunk_matches_vendor`` (the SAME alias-aware
    cross-vendor guard the chat/RAG path already uses) so a same-keyword,
    different-OEM chunk can't attach as a citation on the wrong equipment.

    Graceful-empty on ANY failure (no embed sidecar, no DB, any exception) —
    never raises.
    """
    if not question or not tenant_id:
        return []
    if not os.environ.get("NEON_DATABASE_URL"):
        # Mirrors recall_knowledge's own fail-fast: no DB configured means no
        # retrieval is possible at all -- skip the (possibly slow) embed
        # attempt entirely rather than paying network latency for nothing.
        return []
    try:
        from ..neon_recall import recall_knowledge  # noqa: PLC0415
        from ..workers.rag_worker import (  # noqa: PLC0415
            RAGWorker,
            chunk_matches_vendor,
            format_source_label,
        )
    except Exception as exc:  # noqa: BLE001
        logger.info("default_manual_retriever: retrieval stack unavailable: %s", exc)
        return []

    embedding: list[float] | None = None
    try:
        # RAGWorker._embed_ollama never reads `self` (verified by reading
        # rag_worker.py — the body only touches env vars + httpx) — this reuses
        # the EXACT SAME embed path (env vars, model, fallback URL candidates)
        # without constructing an unrelated multi-stage RAG orchestrator.
        embedding = await RAGWorker._embed_ollama(None, question)  # type: ignore[arg-type]
    except Exception as exc:  # noqa: BLE001
        logger.info("default_manual_retriever: embed failed, continuing lexical-only: %s", exc)
        embedding = None

    try:
        hits = recall_knowledge(embedding, tenant_id, query_text=question)
    except Exception as exc:  # noqa: BLE001
        logger.info("default_manual_retriever: recall_knowledge failed: %s", exc)
        return []

    citations: list[ManualCitation] = []
    for hit in hits or []:
        if not isinstance(hit, dict):
            continue
        if not chunk_matches_vendor(hit.get("manufacturer"), manufacturer):
            continue
        excerpt = str(hit.get("content") or "").strip()
        if not excerpt:
            continue
        doc = format_source_label(hit) or hit.get("manufacturer") or "manual"
        page = hit.get("source_page")
        citations.append({"doc": doc, "page": page if page is not None else "", "excerpt": excerpt})
    return citations


# ─── deterministic pack-fact lookups (no LLM) ───────────────────────────────

_CODE_MNEMONIC_RE = re.compile(r"^[A-Za-z]{1,4}\d{0,3}$")


def _code_label(code: int, meaning: str) -> str:
    """The human-facing label for a fault code.

    Some packs embed the real mnemonic in the meaning text itself (GS10:
    ``"58: CE10 modbus timeout"`` — "CE10" IS how the drive/manual names it).
    Others (PowerFlex) document codes as "F002".."F127" (zero-padded, per the
    pack's own provenance.sources excerpts, e.g. "F007 Motor Overload") without
    embedding that in the meaning string. Prefer the embedded mnemonic when the
    meaning's first token looks code-shaped; otherwise fall back to the
    zero-padded F-number convention — both are grounded in real manual text,
    never invented.
    """
    first = (meaning or "").split(" ", 1)[0]
    if first and _CODE_MNEMONIC_RE.fullmatch(first):
        return first
    return f"F{code:03d}"


def _fault_code_facts(pack: DrivePack, question: str) -> list[tuple[str, dict[str, Any]]]:
    q = (question or "").lower()
    facts: list[tuple[str, dict[str, Any]]] = []
    for code, meaning in sorted(pack.live_decode.fault_codes.items()):
        label = _code_label(code, meaning)
        forms = {label.lower(), f"f{code:03d}", f"f{code:02d}"}
        if code >= 10:  # bare "f2"/"f7" is too easily an accidental substring
            forms.add(f"f{code}")
        if not any(form and form in q for form in forms):
            continue
        first = (meaning or "").split(" ", 1)[0]
        text = meaning if first.lower() == label.lower() else f"{label}: {meaning}"
        citation = {"doc": f"{pack.pack_id} pack", "page": "fault_codes", "excerpt": text}
        facts.append((text, citation))
    return facts


def _param_key(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def _parameter_facts(pack: DrivePack, question: str) -> list[tuple[str, dict[str, Any]]]:
    q_norm = _param_key(question)
    facts: list[tuple[str, dict[str, Any]]] = []
    if not q_norm:
        return facts
    for card in pack.parameters:
        pid_norm = _param_key(card.parameter_id)
        if not pid_norm or pid_norm not in q_norm:
            continue
        header = card.parameter_id + (f" ({card.name})" if card.name else "")
        detail_parts = []
        if card.purpose:
            detail_parts.append(card.purpose)
        if card.default is not None:
            detail_parts.append(f"default {card.default}")
        if card.range:
            detail_parts.append(f"range {card.range}")
        text = header + (" — " + "; ".join(detail_parts) if detail_parts else "")
        citation = {
            "doc": card.source_citation.doc or f"{pack.pack_id} pack",
            "page": card.source_citation.page or "",
            "excerpt": card.source_citation.excerpt or text,
        }
        facts.append((text, citation))
    return facts


_ENVELOPE_TRIGGERS: dict[str, tuple[str, ...]] = {
    "dc_bus": ("dc bus", "dc_bus", "bus voltage", "dc voltage"),
    "current": ("current", "amps", "amperage", "fla"),
    "frequency": ("frequency", "hz", "hertz"),
}


def _format_band(name: str, band: EnvelopeBand) -> str | None:
    unit = band.unit or ""
    parts: list[str] = []
    if band.nominal is not None:
        parts.append(f"nominal {band.nominal}{unit}")
    if band.min is not None or band.max is not None:
        lo = band.min if band.min is not None else "?"
        hi = band.max if band.max is not None else "?"
        parts.append(f"range {lo}-{hi}{unit}")
    if band.rated is not None:
        parts.append(f"rated {band.rated}{unit}")
    if not parts:
        return None  # never guess -- nothing populated on this band
    return f"{name}: " + ", ".join(parts)


def _envelope_facts(pack: DrivePack, question: str) -> list[tuple[str, dict[str, Any]]]:
    q = (question or "").lower()
    facts: list[tuple[str, dict[str, Any]]] = []
    for attr, triggers in _ENVELOPE_TRIGGERS.items():
        if not any(t in q for t in triggers):
            continue
        band = getattr(pack.envelope, attr)
        text = _format_band(attr, band)
        if not text:
            continue
        citation = {"doc": f"{pack.pack_id} pack", "page": "envelope", "excerpt": text}
        facts.append((text, citation))
    return facts


def _gather_pack_facts(pack: DrivePack, question: str) -> list[tuple[str, dict[str, Any]]]:
    """Deterministic dict lookups only — no LLM. Returns (fact_text, citation)
    pairs; fact_text always embeds whatever token of `question` triggered the
    match, so the observation it becomes is guaranteed relevant to compose_answer's
    keyword-overlap matcher."""
    return (
        _fault_code_facts(pack, question)
        + _parameter_facts(pack, question)
        + _envelope_facts(pack, question)
    )


# ─── answer_equipment ────────────────────────────────────────────────────────


def _is_safety_question(question: str) -> bool:
    """Mirrors answer_composer._is_safety_question exactly, via the PUBLIC
    SAFETY_TRIGGER_PHRASES constant (answer_composer.py itself is not modified
    and its private _is_safety_question is not imported)."""
    q = (question or "").lower()
    return any(phrase in q for phrase in SAFETY_TRIGGER_PHRASES)


async def _ask_via_store(
    store: Any,
    session_id: str,
    tenant_id: str,
    question: str,
    *,
    manual_citations: list[dict[str, Any]] | None,
    llm: Callable[[str], str] | None,
) -> AnswerEnvelope:
    """Replicates VisualSessionService.ask()'s body against an injected store.

    equipment.py cannot import session_service (session_service imports
    equipment — ingest_image/ask_equipment route through resolve_equipment/
    answer_equipment), so this mirrors ask()'s four lines instead of calling
    it as a method. It calls the SAME compose_answer, unmodified — this is the
    "make Phase 2 work THROUGH answer_composer" seam.
    """
    observations = await store.load_observations(session_id, tenant_id)
    envelope = compose_answer(question, observations, manual_citations=manual_citations, llm=llm)
    await store.record_answer(session_id, tenant_id, question, envelope)
    return envelope


async def _refuse_without_identity(
    store: Any,
    session_id: str,
    tenant_id: str,
    question: str,
    resolution: EquipmentResolution,
) -> AnswerEnvelope:
    """Equipment-specific questions get a NEEDS_CONTEXT refusal naming the
    SPECIFIC missing evidence — never a silent guess, never a generic bounce."""
    text = resolution.needs_context or "Equipment identity is not resolved for this session yet."
    claim = AnswerClaim(
        text=text,
        evidence_state=EvidenceState.NEEDS_CONTEXT,
        supporting_observation_ids=[],
        doc_citations=[],
        uncertainty=resolution.reason or "No resolved equipment identity backs this question.",
        safety_flag=False,
    )
    envelope = AnswerEnvelope(
        answer=text, claims=[claim], next_best_evidence=resolution.needs_context, safety_notes=[]
    )
    await store.record_answer(session_id, tenant_id, question, envelope)
    return envelope


async def answer_equipment(
    session_id: str,
    tenant_id: str,
    question: str,
    resolution: EquipmentResolution,
    *,
    store: Any,
    retriever: ManualRetriever | None = None,
    llm: Callable[[str], str] | None = None,
) -> AnswerEnvelope:
    """Answer an equipment question, grounded in the resolved pack + tenant manuals.

    If ``resolution.status != "RESOLVED"``: refuse equipment specifics with a
    NEEDS_CONTEXT claim naming the exact missing evidence — UNLESS the
    question is a safety/energization question, which is routed through the
    SAME ask()-equivalent path so ``compose_answer``'s safety short-circuit
    still fires regardless of whether equipment identity is known (a photo
    can never establish a safe/de-energized state either way).

    If RESOLVED: gather deterministic pack facts (fault codes / parameters /
    envelope — dict lookups only, no LLM) and tenant manual citations, persist
    BOTH as new DOCUMENTED observations (append-only), then compose the answer
    exactly as ``ask()`` would. If nothing matched, the composer honestly
    yields NEEDS_CONTEXT — this function never invents a fact.
    """
    if resolution.status != "RESOLVED":
        if _is_safety_question(question):
            return await _ask_via_store(
                store, session_id, tenant_id, question, manual_citations=None, llm=llm
            )
        return await _refuse_without_identity(store, session_id, tenant_id, question, resolution)

    try:
        pack = load_pack(resolution.pack_id)
    except Exception as exc:  # noqa: BLE001 - pack removed/corrupted between resolve and answer
        logger.warning("answer_equipment: load_pack(%s) failed: %s", resolution.pack_id, exc)
        degraded = EquipmentResolution(
            status="NONE",
            candidates=[],
            evidence=[],
            reason=f"pack '{resolution.pack_id}' failed to load: {exc}",
            needs_context=(
                "couldn't load the identified drive's data — try again or name the drive directly"
            ),
        )
        return await _refuse_without_identity(store, session_id, tenant_id, question, degraded)

    pack_facts = _gather_pack_facts(pack, question)
    for text, citation in pack_facts:
        await store.append_observation(
            session_id,
            tenant_id,
            obs_kind="property",
            evidence_state=EvidenceState.DOCUMENTED,
            raw_value=text,
            normalized_value=text,
            extractor="drive_pack",
            metadata={"pack_id": pack.pack_id, "citation": citation},
        )

    active_retriever = retriever if retriever is not None else default_manual_retriever
    manual_citations: list[ManualCitation] = []
    try:
        raw = active_retriever(question, tenant_id, pack.family.manufacturer)
        manual_citations = list(await _maybe_await(raw) or [])
    except Exception as exc:  # noqa: BLE001 - caller-injected retriever must never crash the answer
        logger.info("answer_equipment: manual retriever failed, continuing without it: %s", exc)
        manual_citations = []

    for citation in manual_citations:
        if not isinstance(citation, dict):
            continue
        excerpt = str(citation.get("excerpt") or "").strip()
        if not excerpt:
            continue
        await store.append_observation(
            session_id,
            tenant_id,
            obs_kind="property",
            evidence_state=EvidenceState.DOCUMENTED,
            raw_value=excerpt,
            normalized_value=excerpt,
            extractor="manual",
            metadata={
                "pack_id": pack.pack_id,
                "doc": citation.get("doc"),
                "page": citation.get("page"),
            },
        )

    all_citations = [c for _, c in pack_facts] + manual_citations
    return await _ask_via_store(
        store, session_id, tenant_id, question, manual_citations=all_citations, llm=llm
    )
