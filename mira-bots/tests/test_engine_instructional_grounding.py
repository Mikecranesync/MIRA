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
    # NOT mocked here: several tests exercise the real `_instructional_kb_context`.
    # Mocking it in the fixture silently made those tests assert nothing — they passed
    # against the mock's "" and never reached the code under test.
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


def test_covered_question_is_answered_from_documentation(sup) -> None:
    """Grounded IN PLACE, not delegated.

    An earlier revision handed the whole turn to `_handle_general_question`. That
    grounded it but broke the answer for a technician: the general handler owns a
    doc-search decision tree, so "how do I set the accel time on a PowerFlex 525?"
    came back as "I don't have documentation — type PROCEED" *while two chunks were
    retrieved*. Trading an ungrounded answer for a stall is not an improvement.
    """
    sup._instructional_kb_context = MagicMock(
        return_value="[Source: Allen-Bradley PowerFlex 525]\nAccel time is parameter P041."
    )
    with patch.object(sup, "_instructional_kb_coverage", return_value=True):
        asyncio.run(sup._handle_instructional_question("c1", SEED_001, _state(), "t"))

    assert not sup._handle_general_question.await_count, "must not delegate — that caused the stall"
    sup.router.complete.assert_awaited_once()
    msgs = sup.router.complete.await_args.args[0]
    system, user = msgs[0]["content"], msgs[-1]["content"]
    assert "numbered steps" in system, "the procedural shape must survive grounding"
    assert "P041" in user, "retrieved documentation must reach the prompt"
    assert "[Source:" in system, "the model must be told to cite what it was given"


def test_uncovered_question_still_gets_a_direct_answer(sup) -> None:
    """The no-coverage path is deliberately unchanged. Routing it to a grounded
    handler with nothing to ground would turn a useful answer into a refusal."""
    sup._instructional_kb_context = MagicMock(return_value="")
    with patch.object(sup, "_instructional_kb_coverage", return_value=False):
        out = asyncio.run(
            sup._handle_instructional_question(
                "c2", "how do I bleed a hydraulic line?", _state(), "t"
            )
        )

    sup.router.complete.assert_awaited_once()
    msgs = sup.router.complete.await_args.args[0]
    assert "Documentation:" not in msgs[-1]["content"], "no KB coverage means no injected context"
    assert out["reply"] == "direct llm answer"


def test_the_bypass_comment_cannot_quietly_return() -> None:
    """The handler's contract is now 'grounded when it can be'. If someone restores
    the unconditional direct-LLM path, this fails rather than silently regressing
    every ASK_PROCEDURAL turn back to uncited answers."""
    from pathlib import Path

    src = Path("mira-bots/shared/engine.py").read_text(encoding="utf-8")
    start = src.index("async def _handle_instructional_question")
    body = src[start : start + 9000]  # the handler grew; must reach the LLM call
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
        "the KB check must run BEFORE the LLM call, or it grounds nothing"
    )
    assert "numbered steps" in code, (
        "the procedural answer shape is a product requirement, not incidental — a "
        "technician on the floor needs steps, not prose"
    )


# ── Codex review round 1 — the two blockers, pinned ──────────────────────────


def test_retrieval_uses_the_authoritative_tenant_not_state(sup) -> None:
    """BLOCKER 1. `state["tenant_id"]` can be absent or stale; the caller's
    `resolved_tenant` is authoritative. `knowledge_entries` is a hybrid corpus with
    `is_private=true` per-tenant rows, so the wrong tenant is a CROSS-TENANT read."""
    seen = {}

    def _recall(emb, tenant, **kw):
        seen["tenant"] = tenant
        return [{"content": "Accel time is P041.", "manufacturer": "Allen-Bradley"}]

    st = _state()
    st["tenant_id"] = "STALE-TENANT"
    with (
        patch("shared.neon_recall.recall_knowledge", side_effect=_recall),
        patch("shared.workers.rag_worker.format_source_label", return_value="AB PF525"),
    ):
        sup._instructional_kb_context("accel time?", st, [], tenant_id="AUTHORITATIVE")

    assert seen["tenant"] == "AUTHORITATIVE", (
        f"retrieval ran under {seen['tenant']!r} — a stale session tenant can read "
        f"another tenant's private KB rows"
    )


def test_coverage_probe_also_uses_the_authoritative_tenant(sup) -> None:
    seen = {}

    def _resolve(combined, tenant_id=None):
        seen["tenant"] = tenant_id
        return _resolution()

    st = _state()
    st["tenant_id"] = "STALE-TENANT"
    with (
        patch("shared.engine.resolve_uns_path_multi", side_effect=_resolve),
        patch("shared.engine.kb_has_coverage", return_value=(True, "covered")),
    ):
        sup._instructional_kb_coverage("accel time?", st, [], tenant_id="AUTHORITATIVE")

    assert seen["tenant"] == "AUTHORITATIVE"


def test_a_malformed_chunk_falls_back_instead_of_aborting_the_turn(sup) -> None:
    """BLOCKER 2. Formatting used to sit outside the try, so a bad chunk raised and
    killed a covered turn — worse than the ungrounded answer this fix replaced."""
    with (
        patch("shared.neon_recall.recall_knowledge", return_value=["not-a-dict", None, 42]),
        patch("shared.workers.rag_worker.format_source_label", return_value="x"),
    ):
        assert sup._instructional_kb_context("q", _state(), [], tenant_id="t") == ""


def test_a_raising_label_formatter_falls_back(sup) -> None:
    with (
        patch("shared.neon_recall.recall_knowledge", return_value=[{"content": "body"}]),
        patch("shared.workers.rag_worker.format_source_label", side_effect=RuntimeError("boom")),
    ):
        assert sup._instructional_kb_context("q", _state(), [], tenant_id="t") == ""


def test_retrieval_failure_falls_back(sup) -> None:
    with patch("shared.neon_recall.recall_knowledge", side_effect=RuntimeError("neon down")):
        assert sup._instructional_kb_context("q", _state(), [], tenant_id="t") == ""


def test_empty_chunks_produce_no_context(sup) -> None:
    with patch("shared.neon_recall.recall_knowledge", return_value=[]):
        assert sup._instructional_kb_context("q", _state(), [], tenant_id="t") == ""


def test_context_uses_the_canonical_label_helper(sup) -> None:
    """Requirement 4, asserted by a test rather than by prose in the docstring."""
    with (
        patch("shared.neon_recall.recall_knowledge", return_value=[{"content": "Set P041."}]),
        patch(
            "shared.workers.rag_worker.format_source_label", return_value="Allen-Bradley PF525"
        ) as fmt,
    ):
        out = sup._instructional_kb_context("q", _state(), [], tenant_id="t")

    fmt.assert_called_once()
    assert out.startswith("[Source: Allen-Bradley PF525]")


def test_chunk_bodies_are_capped(sup) -> None:
    """Prompt growth stays bounded, so documentation cannot crowd out the
    numbered-steps instruction."""
    with (
        patch("shared.neon_recall.recall_knowledge", return_value=[{"content": "x" * 5000}]),
        patch("shared.workers.rag_worker.format_source_label", return_value=""),
    ):
        assert len(sup._instructional_kb_context("q", _state(), [], tenant_id="t")) <= 1200


# ── Relevance gate (#3605) — vendor coverage is not evidence ──────────────────
#
# The regression this closes: grounding was gated on `kb_has_coverage`, a per-VENDOR
# COUNT. "Allen-Bradley has 38k chunks" read as covered, embedding-less recall returned
# topically-unrelated passages, and the model anchored on those instead of its own
# correct knowledge. DeepEval caught it at category level:
# `de-in-04 [instructional] Technical Accuracy = 0.20`.
#
# Grounding on the wrong document is worse than not grounding: accuracy drops AND a
# citation is attached, which makes the weaker answer look more trustworthy.

from shared.uns_resolver import chunk_matches_model  # noqa: E402


def _ctx(sup, chunks, *, vendor="Allen-Bradley", model="PowerFlex 525"):
    st = _state()
    st["_instructional_vendor"] = vendor
    st["_instructional_model"] = model
    with patch("shared.neon_recall.recall_knowledge", return_value=chunks):
        return sup._instructional_kb_context("accel time?", st, [], tenant_id="t")


def test_vendor_and_correct_model_is_accepted(sup) -> None:
    out = _ctx(
        sup,
        [
            {
                "content": "Accel time is P041.",
                "manufacturer": "Allen-Bradley",
                "model_number": "PowerFlex 525",
            }
        ],
    )
    assert "P041" in out


def test_vendor_but_wrong_model_is_rejected(sup) -> None:
    """Same OEM, different drive. This is the case vendor-level coverage let through."""
    out = _ctx(
        sup,
        [
            {
                "content": "Torque proving on the 753.",
                "manufacturer": "Allen-Bradley",
                "model_number": "PowerFlex 753",
            }
        ],
    )
    assert out == ""


def test_a_valid_alias_is_accepted(sup) -> None:
    """`PF525` resolves through FAMILY_FROM_ALIAS — the resolver's own table, not a
    second mapping that could drift from it."""
    out = _ctx(
        sup, [{"content": "Set P041.", "manufacturer": "Allen-Bradley", "model_number": "PF525"}]
    )
    assert "P041" in out


def test_unrelated_vendor_chunk_is_rejected(sup) -> None:
    out = _ctx(
        sup, [{"content": "Yaskawa oC fault.", "manufacturer": "Yaskawa", "model_number": "A1000"}]
    )
    assert out == ""


def test_no_relevant_chunks_means_no_context_and_the_old_path(sup) -> None:
    """Nothing survives -> "" -> the handler answers exactly as it did before."""
    out = _ctx(
        sup,
        [
            {
                "content": "Overload relay current ratings.",
                "manufacturer": "Allen-Bradley",
                "model_number": "193-EE",
            }
        ],
    )
    assert out == ""


def test_rejected_chunks_never_produce_a_citation(sup) -> None:
    """The gate runs BEFORE format_source_label, so a rejected chunk cannot be cited."""
    with patch("shared.workers.rag_worker.format_source_label") as fmt:
        out = _ctx(
            sup,
            [
                {
                    "content": "Torque proving.",
                    "manufacturer": "Allen-Bradley",
                    "model_number": "PowerFlex 753",
                }
            ],
        )
    assert out == ""
    fmt.assert_not_called(), "a rejected chunk must never reach the citation formatter"


def test_relevant_chunk_survives_alongside_an_irrelevant_one(sup) -> None:
    out = _ctx(
        sup,
        [
            {
                "content": "Torque proving on the 753.",
                "manufacturer": "Allen-Bradley",
                "model_number": "PowerFlex 753",
            },
            {
                "content": "Accel time is P041.",
                "manufacturer": "Allen-Bradley",
                "model_number": "PowerFlex 525",
            },
        ],
    )
    assert "P041" in out
    assert "753" not in out


def test_uncovered_question_path_is_untouched_by_the_gate(sup) -> None:
    """No coverage -> no retrieval at all -> the original procedural answer."""
    sup._instructional_kb_context = MagicMock(return_value="")
    with patch.object(sup, "_instructional_kb_coverage", return_value=False):
        out = asyncio.run(
            sup._handle_instructional_question("g", "how do I bleed a line?", _state(), "t")
        )
    assert out["reply"] == "direct llm answer"


# ── the matcher itself ───────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("chunk_model", "chunk_text", "query_model", "expected"),
    [
        ("PowerFlex 525", None, "PowerFlex 525", True),
        ("PF525", None, "PowerFlex 525", True),  # alias
        ("PowerFlex 753", None, "PowerFlex 525", False),  # same vendor, wrong model
        ("PowerFlex 520", None, "PowerFlex 525", False),  # adjacent model
        ("PowerFlex", None, "PowerFlex 525", True),  # series-level doc
        (None, "See PowerFlex525 accel time", "PowerFlex 525", True),  # body, no tag
        (None, "Overload relay ratings", "PowerFlex 525", False),
        ("anything", None, None, True),  # no model asked
        (None, None, "PowerFlex 525", False),  # nothing to judge on
    ],
)
def test_chunk_matches_model(chunk_model, chunk_text, query_model, expected) -> None:
    assert chunk_matches_model(chunk_model, chunk_text, query_model) is expected
