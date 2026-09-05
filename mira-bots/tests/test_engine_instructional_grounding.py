"""Procedural questions must be grounded when the KB can ground them (#3602).

`_handle_instructional_question` used to call `router.complete()` for every
`ASK_PROCEDURAL` turn — no retrieval, no citations, no KB-gap admission — while its
sibling `_handle_general_question`, reached from the same DST dispatch table, was
KB-first. Two siblings disagreeing about grounding is an oversight, not a design.

Measured cost: all six MIRA Answer Radar seed questions (real technician posts) landed
here and were answered with zero retrieved chunks, while `recall_knowledge` returns hits
for the same text. One reply described an Allen-Bradley SLC 5/03's DH-485 port as using
"DH+ (Data Highway Plus) framing" three times, uncited — DH-485 and DH+ are different
networks and an SLC 5/03 has no DH+ capability at all.

These tests pin both directions: ground it when we can, and do NOT regress the
no-coverage case into a refusal where a useful answer used to be.
"""

from __future__ import annotations

import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, "mira-bots")

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy-collection")

from shared.engine import Supervisor  # noqa: E402
from shared.uns_resolver import UNSContext, UNSResolution  # noqa: E402

SEED_001 = (
    "An Allen-Bradley SLC 5/03 is on a DH-485 network. A technician wants to replace the "
    "existing protocol-aware interface with a USR-N540 transparent RS-485-to-Ethernet "
    "converter. After the swap the PLC stops communicating. Why does this happen and what "
    "should be checked first?"
)


def _resolution(manufacturer="Allen-Bradley", model="SLC 5/03"):
    primary = UNSContext(manufacturer=manufacturer or None, model=model or None)
    return UNSResolution(primary=primary, candidates=(primary,) if manufacturer else ())


@pytest.fixture
def sup() -> Supervisor:
    s = Supervisor.__new__(Supervisor)
    s.router = MagicMock()
    s.router.complete = AsyncMock(return_value=("direct llm answer", {}))
    s._clear_diagnostic_carryover = MagicMock(side_effect=lambda cid, st, **kw: st)
    s._record_exchange = MagicMock()
    s._infer_confidence = MagicMock(return_value="none")
    s._make_result = MagicMock(side_effect=lambda r, c, t, st: {"reply": r, "state": st})
    s._handle_general_question = AsyncMock(return_value={"reply": "grounded", "state": "IDLE"})
    return s


def _state():
    return {"asset_identified": "", "context": {"history": []}, "state": "IDLE", "tenant_id": "t1"}


# ── The coverage probe ───────────────────────────────────────────────────────


def test_coverage_probe_true_when_vendor_resolved_and_kb_covers(sup) -> None:
    with (
        patch("shared.engine.resolve_uns_path_multi", return_value=_resolution()),
        patch("shared.engine.kb_has_coverage", return_value=(True, "covered")),
    ):
        assert sup._instructional_kb_coverage(SEED_001, _state(), []) is True


def test_coverage_probe_false_when_no_vendor_resolves(sup) -> None:
    """No manufacturer means nothing to look up — do not probe, do not ground."""
    with patch("shared.engine.resolve_uns_path_multi", return_value=_resolution(manufacturer="")):
        assert sup._instructional_kb_coverage("how do I reset a drive?", _state(), []) is False


def test_coverage_probe_false_when_kb_has_no_coverage(sup) -> None:
    with (
        patch("shared.engine.resolve_uns_path_multi", return_value=_resolution()),
        patch("shared.engine.kb_has_coverage", return_value=(False, "no rows")),
    ):
        assert sup._instructional_kb_coverage(SEED_001, _state(), []) is False


def test_coverage_probe_fails_closed_to_the_direct_path(sup) -> None:
    """A KB hiccup must not make the answer WORSE than the old behaviour."""
    with patch("shared.engine.resolve_uns_path_multi", side_effect=RuntimeError("neon down")):
        assert sup._instructional_kb_coverage(SEED_001, _state(), []) is False


def test_coverage_probe_uses_recent_user_turns_not_just_this_message(sup) -> None:
    """Same extraction window as _handle_general_question — the vendor is often
    named a turn earlier, which is why the sibling looks back six turns."""
    history = [{"role": "user", "content": "I have an Allen-Bradley SLC 5/03"}]
    seen = {}

    def _capture(combined, tenant_id=None):
        seen["combined"] = combined
        return _resolution()

    with (
        patch("shared.engine.resolve_uns_path_multi", side_effect=_capture),
        patch("shared.engine.kb_has_coverage", return_value=(True, "covered")),
    ):
        sup._instructional_kb_coverage("how do I swap the interface?", _state(), history)

    assert "SLC 5/03" in seen["combined"], "prior user turns must be in the resolve window"


# ── Routing ──────────────────────────────────────────────────────────────────


def test_covered_question_is_routed_to_the_grounded_handler(sup) -> None:
    with patch.object(sup, "_instructional_kb_coverage", return_value=True):
        out = asyncio.run(sup._handle_instructional_question("c1", SEED_001, _state(), "t"))

    sup._handle_general_question.assert_awaited_once()
    (
        sup.router.complete.assert_not_awaited(),
        "must not answer from parametric memory when the KB covers it",
    )
    assert out["reply"] == "grounded"


def test_uncovered_question_still_gets_a_direct_answer(sup) -> None:
    """The no-coverage path is deliberately unchanged. Routing it to a grounded
    handler with nothing to ground would turn a useful answer into a refusal."""
    with patch.object(sup, "_instructional_kb_coverage", return_value=False):
        out = asyncio.run(
            sup._handle_instructional_question(
                "c2", "how do I bleed a hydraulic line?", _state(), "t"
            )
        )

    sup._handle_general_question.assert_not_awaited()
    sup.router.complete.assert_awaited_once()
    assert out["reply"] == "direct llm answer"


def test_the_bypass_comment_cannot_quietly_return() -> None:
    """The handler's contract is now 'grounded when it can be'. If someone restores
    the unconditional direct-LLM path, this fails rather than silently regressing
    every ASK_PROCEDURAL turn back to uncited answers."""
    from pathlib import Path

    src = Path("mira-bots/shared/engine.py").read_text(encoding="utf-8")
    start = src.index("async def _handle_instructional_question")
    body = src[start : start + 4000]
    # Strip comments and the docstring: this fix documents the old behaviour
    # verbatim so the regression stays legible, and a naive substring search would
    # match that prose instead of the code.
    code = "\n".join(
        ln
        for ln in body.splitlines()
        if not ln.lstrip().startswith("#") and "router.complete()" not in ln
    )
    assert "_instructional_kb_coverage" in code, "the coverage check is gone"
    assert code.index("_instructional_kb_coverage") < code.index("await self.router.complete("), (
        "the KB check must run BEFORE the direct LLM call, or it grounds nothing"
    )
