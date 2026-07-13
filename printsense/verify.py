"""Phase 3 — independent blind-reread verification for PrintSense (roadmap Phase 3).

Runs a second, fully INDEPENDENT full-page interpretation — the reader is never
shown the first graph — and promotes a field-critical finding to
``machine_verified`` only when BOTH passes independently assert the same
designation. Findings the second pass does not independently witness stay
``proposed`` (unconfirmed, not demoted — a second pass omitting an item is not
evidence the item is wrong). The machine never writes ``human_verified`` (that is
a technician sign-off).

Design note (why a blind full-page pass, not per-entity crops): the roadmap
sketched per-entity crop rereads, but reliable localization requires the tag to
be a verbatim printed label. Composite/prefixed graph tags (``-21/A13:24VDC``,
``-21/A13``) are NOT single printed strings, so locate-by-tag returns "not found"
and verifies nothing (measured). A blind full-page reread + agreement comparison
is robust, needs no coordinates, and is the truest reading of "independent blind
reread." Anthropic-isolated: reuses ``printsense.interpret`` building blocks.
"""

from __future__ import annotations

import json
import logging

from printsense import grader, interpret
from printsense.models import PrintSynthGraph, TrustState

logger = logging.getLogger("printsense.verify")

# The sections a technician acts on — what we independently verify.
_FIELD_CRITICAL = ("devices", "cables", "conductors", "off_page_references", "terminals")


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
        PrintSynthGraph.model_validate(json.loads(interpret._strip_fences(interpret._first_text(msg))))
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


def verify(image_bytes: bytes, graph: PrintSynthGraph, blind_pass=None) -> dict:
    """Blind-verify field-critical entities against an independent full-page reread.

    ``blind_pass`` overrides the second read (for tests). Returns
    ``{"graph", "decisions", "blind_graph", "usage"}``.
    """
    graph_b, usage = (blind_pass or _blind_reread)(image_bytes)
    pool_b = _pool(graph_b)

    improved = graph.model_copy(deep=True)
    decisions: list[dict] = []
    for section in _FIELD_CRITICAL:
        for e in getattr(improved, section):
            if e.tag == "UNREADABLE":
                continue
            head = grader._norm(_head(e.tag))
            if head and head in pool_b:
                e.trust = TrustState.machine_verified
                e.evidence = f"phase-3: independent blind reread agreed on {e.tag}. " + (e.evidence or "")
                decisions.append({"tag": e.tag, "section": section, "decision": "agree", "action": "machine_verified"})
            else:
                decisions.append({"tag": e.tag, "section": section, "decision": "no_second_witness", "action": "kept_proposed"})

    verified = sum(1 for d in decisions if d["decision"] == "agree")
    logger.info("PHASE3_DONE verified=%d/%d tok=%d/%d", verified, len(decisions), usage["input_tokens"], usage["output_tokens"])
    return {"graph": improved, "decisions": decisions, "blind_graph": graph_b.model_dump(), "usage": usage}
