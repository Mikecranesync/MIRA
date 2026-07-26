"""Phase 3 — blind-reread verification for PrintSense (roadmap Phase 3).

Runs a second full-page interpretation — the reader is never shown the first
graph — and compares the designations both passes assert. Findings the second
pass does not witness stay ``proposed`` (unconfirmed, not demoted — a second
pass omitting an item is not evidence the item is wrong). The machine never
writes ``human_verified`` (that is a technician sign-off).

WHAT AGREEMENT PROVES (amended 2026-07-25). This module used to promote a
finding to ``machine_verified`` whenever the second pass asserted the same
designation. That is wrong when the second pass is the SAME model, prompt
family, preprocessing path and source image: measured self-consistency on a
customer corpus returned byte-identical graphs across four runs, and a
systematic character-level misread (`P9DI900-0` read as `P9D900-0`) reproduced
in 16 of 16 affected designations. Two such passes agreeing is
**reproducibility, not independent corroboration** — and promoting on it
laundered a confident misread into ``machine_verified``.

So: repeat agreement from the same evidence class is recorded (it is a real
stability signal, and it is returned as ``reproducibility``) but CANNOT by
itself promote an exact character-level designation. Promotion requires a
materially independent evidence class — see ``INDEPENDENT_EVIDENCE_CLASSES``.
Different run IDs do not make two reads of the same image independent.

Design note (why a blind full-page pass, not per-entity crops): the roadmap
sketched per-entity crop rereads, but reliable localization requires the tag to
be a verbatim printed label. Composite/prefixed graph tags (``-21/A13:24VDC``,
``-21/A13``) are NOT single printed strings, so locate-by-tag returns "not found"
and verifies nothing (measured). A blind full-page reread + agreement comparison
is robust and needs no coordinates — but per the amendment above it measures
REPRODUCIBILITY. Turning it into verification takes a second evidence CLASS, not
a second run. Anthropic-isolated: reuses ``printsense.interpret`` building blocks.
"""

from __future__ import annotations

import json
import logging

from printsense import grader, interpret
from printsense.models import PrintSynthGraph, TrustState

logger = logging.getLogger("printsense.verify")

# The sections a technician acts on — what we verify.
_FIELD_CRITICAL = ("devices", "cables", "conductors", "off_page_references", "terminals")

#: The evidence class of the primary read AND of :func:`_blind_reread` — the same
#: model, prompt, preprocessing and image. Agreement between two reads of this
#: class is reproducibility, never independent corroboration.
PRIMARY_EVIDENCE_CLASS = "model_vision"

#: Evidence classes materially independent of the primary model read. ONLY these
#: may promote an exact character-level designation to ``machine_verified``.
#: Adding a class here is a claim that it does not share the primary read's
#: failure modes — do not add a label merely because it carries a different run id.
INDEPENDENT_EVIDENCE_CLASSES = frozenset(
    {
        "deterministic_ocr",  # a real OCR engine over the same pixels
        "human_annotation",  # a technician transcribed it
        "authoritative_source",  # the source CAD/DWG or an OEM parts list
        "trusted_structured_source",  # an already-verified structured import
    }
)


def is_independent(evidence_class: str | None) -> bool:
    """True when ``evidence_class`` may corroborate a character-level designation.

    Unknown / missing classes are NOT independent (fail closed).
    """
    return evidence_class in INDEPENDENT_EVIDENCE_CLASSES


def _head(tag) -> str:
    """Atomic head of a designation — drop a ``:port`` suffix (``-21/A13:24VDC`` -> ``-21/A13``)."""
    return str(tag).split(":")[0].strip()


def _blind_reread(image_bytes: bytes):
    """ONE independent full-page interpretation. The reader is NOT shown the first
    graph — a fresh call on the same image, via the exact production path
    (preprocess + prompt + effort + confidence gate). Returns ``(graph, usage)``."""
    from printsense import preprocess

    client = interpret._client()
    pages = [preprocess.prepare_print_image(image_bytes, "image/jpeg")]
    content = [interpret._source_block(d, mt) for d, mt in pages]
    content.append({"type": "text", "text": interpret._user_prompt({"drawing_type": None}, None)})
    with client.messages.stream(
        model=interpret.DEFAULT_MODEL,
        max_tokens=interpret.MAX_TOKENS,
        system=interpret._SYSTEM,
        thinking={"type": "adaptive"},
        output_config={"effort": interpret.EFFORT},
        messages=[{"role": "user", "content": content}],
    ) as stream:
        msg = stream.get_final_message()
    graph = interpret._apply_confidence_gate(
        PrintSynthGraph.model_validate(
            json.loads(interpret._strip_fences(interpret._first_text(msg)))
        )
    )
    return graph, {"input_tokens": msg.usage.input_tokens, "output_tokens": msg.usage.output_tokens}


def _pool(graph: PrintSynthGraph) -> set[str]:
    """Normalized atomic designations a graph asserts (entity tag heads + connects targets)."""
    out: set[str] = set()
    for e in graph.all_entities():
        if e.tag and e.tag != "UNREADABLE":
            out.add(grader._norm(_head(e.tag)))
        for c in e.connects:
            out.add(grader._norm(_head(c)))
    out.discard("")
    return out


def verify(
    image_bytes: bytes,
    graph: PrintSynthGraph,
    blind_pass=None,
    evidence_class: str = PRIMARY_EVIDENCE_CLASS,
) -> dict:
    """Blind-verify field-critical entities against a second full-page reread.

    ``blind_pass`` overrides the second read (for tests, or to supply a genuinely
    independent reader). ``evidence_class`` declares what that second read IS;
    it defaults to :data:`PRIMARY_EVIDENCE_CLASS` because :func:`_blind_reread`
    is the same model over the same image. Agreement promotes to
    ``machine_verified`` ONLY when :func:`is_independent` accepts the class —
    otherwise agreement is recorded as reproducibility and the finding stays
    ``proposed``.

    Returns ``{"graph", "decisions", "blind_graph", "usage", "evidence_class",
    "independent", "reproducibility"}``.
    """
    graph_b, usage = (blind_pass or _blind_reread)(image_bytes)
    # A genuinely independent reader is the whole point of the promotion gate,
    # and the classes that qualify — deterministic OCR, a human annotation, an
    # authoritative source — do not spend tokens. Requiring LLM token counts here
    # would mean the only second pass that can run is the same-model one that can
    # never promote.
    usage = usage or {}
    pool_b = _pool(graph_b)
    independent = is_independent(evidence_class)

    improved = graph.model_copy(deep=True)
    decisions: list[dict] = []
    for section in _FIELD_CRITICAL:
        for e in getattr(improved, section):
            if e.tag == "UNREADABLE":
                continue
            head = grader._norm(_head(e.tag))
            agreed = bool(head) and head in pool_b
            decision = {
                "tag": e.tag,
                "section": section,
                "evidence_class": evidence_class,
                "agreed": agreed,
            }
            if agreed and independent:
                e.trust = TrustState.machine_verified
                e.evidence = (
                    f"phase-3: independent {evidence_class} evidence agreed on {e.tag}. "
                ) + (e.evidence or "")
                decision |= {"decision": "agree", "action": "machine_verified"}
            elif agreed:
                # Reproducible, NOT corroborated: the same reader over the same
                # image repeating itself cannot establish character-level truth.
                e.evidence = (
                    f"phase-3: second {evidence_class} pass reproduced {e.tag} "
                    "(reproducibility only — not independent corroboration). "
                ) + (e.evidence or "")
                decision |= {
                    "decision": "agree_same_evidence_class",
                    "action": "kept_proposed_not_independent",
                }
            else:
                decision |= {"decision": "no_second_witness", "action": "kept_proposed"}
            decisions.append(decision)

    reproduced = sum(1 for d in decisions if d["agreed"])
    promoted = sum(1 for d in decisions if d["action"] == "machine_verified")
    logger.info(
        "PHASE3_DONE class=%s independent=%s reproduced=%d promoted=%d/%d tok=%d/%d",
        evidence_class,
        independent,
        reproduced,
        promoted,
        len(decisions),
        usage.get("input_tokens", 0),
        usage.get("output_tokens", 0),
    )
    return {
        "graph": improved,
        "decisions": decisions,
        "blind_graph": graph_b.model_dump(),
        "usage": usage,
        "evidence_class": evidence_class,
        "independent": independent,
        # Retained signal: how self-consistent the reader was, without any claim
        # that self-consistency implies correctness.
        "reproducibility": {
            "reproduced": reproduced,
            "checked": len(decisions),
            "promoted": promoted,
        },
    }
