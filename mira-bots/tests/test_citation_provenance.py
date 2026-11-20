"""#3049 — a citation must be evidence for the unit the technician named.

Measured 2026-11-17 on origin/main 88c7b8e26 (Python Supervisor, citation
enforcement at its default ON), with real staging retrieval:

* "GS13N-42P0 frame size?" — the model cited the right document
  (AutomationDirect GS10, whose table lists GS13N-42P0). The relevance gate
  stripped it as "unestablished" because the technician never typed
  "AutomationDirect". The salvage rewrite then inserted the next retrieved
  label, ``Siemens — 4.3 Power Modules Blocksize (PM340)``, and that is what the
  technician read: a correct frame size cited to a Siemens manual.
* "GA50U2001 semiconductor fuse part number?" — 22 of 31 refusals still carried
  a ``[Source:]`` tag: ``manual SIRIUS circuit breaker 3RV en US`` (stored
  ``manufacturer`` is NULL, so no vendor check can read it) or the Sources
  footer label ``2100 — CA 004, p. 1``. Neither document mentions GA50U2001.

The rule under test: when the technician's own words contain a catalog-style
identifier and the turn's retrieved chunks are known, a ``[Source:]`` tag that
names a retrieved chunk stays only if that chunk mentions the identifier or
comes from a manufacturer the technician (or trusted state) established. The
salvage rewrite may only insert labels that pass the same gate.

Run from the repo/worktree ROOT:
    python3.12 -m pytest mira-bots/tests/test_citation_provenance.py -q
"""

from __future__ import annotations

import asyncio

from shared.citation_compliance import (
    check_citation_compliance,
    enforce_citation_via_rewrite,
    evaluate_citation_relevance,
)

# --- Real-shaped chunks (public OEM corpus, content trimmed) -----------------
AD_GS10 = {
    "manufacturer": "AutomationDirect",
    "model_number": "GS10",
    "metadata": {},
    "content": "GS10 460V Class Specifications; Frame Size A, B. Model Name: GS13N-41P0 "
    "Frame A; GS13N-42P0 Frame B; GS13N-43P0 Frame B.",
}
AD_LABEL = "AutomationDirect GS10"

SIEMENS_PM340 = {
    "manufacturer": "Siemens",
    "model_number": None,
    "metadata": {"section": "4.3 Power Modules Blocksize (PM340)"},
    "content": "Figure 4-29 PM340, frame size FSB. AC Drive Manual, 6SL3097-4AL00-0BP4.",
}
SIEMENS_LABEL = "Siemens — 4.3 Power Modules Blocksize (PM340)"

SIRIUS_NULL_MFR = {
    "manufacturer": None,
    "model_number": "manual SIRIUS circuit breaker 3RV en US",
    "metadata": {"page_num": 1},
    "source_url": "gdrive://manual_SIRIUS_circuit_breaker_3RV_en-US.pdf",
    "content": "fuse (if it is required) are described in the Siemens Industry Online Support.",
}
SIRIUS_LABEL = "manual SIRIUS circuit breaker 3RV en US"

MCC_NULL_MFR = {
    "manufacturer": None,
    "model_number": "2100 ca004  en p",
    "metadata": {"page_num": 1},
    "source_url": "gdrive://2100-ca004_-en-p.pdf",
    "content": "CENTERLINE 2100 Motor Control Centers selection guide. Fuse clips 600V.",
}

YASKAWA_TABLE = {
    "manufacturer": "Yaskawa",
    "model_number": "GA500",
    "metadata": {"section": "Table 2.5"},
    "content": "Table 2.5 Three-Phase 200 V Class. 2001 FWH-25A14F; 2002 FWH-25A14F.",
}
YASKAWA_LABEL = "Yaskawa GA500 — Table 2.5"

PARTIAL = {"status": "partial"}
GS10_Q = "GS13N-42P0 frame size?"
FUSE_Q = "GA50U2001 semiconductor fuse part number?"


def _tags(text: str) -> list[str]:
    import re

    return re.findall(r"\[Source:\s*([^\]]+?)\s*\]", text or "")


# ---------------------------------------------------------------------------
# The gate
# ---------------------------------------------------------------------------
def test_right_document_naming_the_unit_is_kept_when_vendor_was_never_typed():
    """RED on main: the AutomationDirect tag is stripped as 'unestablished'."""
    reply = f"Frame size B, 2 HP / 1.5 kW. [Source: {AD_LABEL}]"
    out = check_citation_compliance(
        reply,
        PARTIAL,
        fsm_state="IDLE",
        chat_id="t-gs10",
        uns_context={"manufacturer": "", "model": ""},
        established_text=GS10_Q,
        chunks=[SIEMENS_PM340, AD_GS10],
        enforce=True,
    )
    assert out["relevant"] is True
    assert out["sanitized_reply"] is None


def test_off_vendor_document_that_never_mentions_the_unit_is_stripped():
    reply = f"Frame size B, 2 HP / 1.5 kW. [Source: {SIEMENS_LABEL}]"
    out = check_citation_compliance(
        reply,
        PARTIAL,
        fsm_state="IDLE",
        chat_id="t-gs10-wrong",
        uns_context={"manufacturer": "", "model": ""},
        established_text=GS10_Q,
        chunks=[SIEMENS_PM340, AD_GS10],
        enforce=True,
    )
    assert out["relevant"] is False
    assert SIEMENS_LABEL not in (out["sanitized_reply"] or "")
    assert "Frame size B" in out["sanitized_reply"]


def test_null_manufacturer_title_citation_is_stripped():
    """RED on main: no vendor is readable from the label, so nothing flags it."""
    reply = (
        "I don't have documentation for the GA50U2001 in my records. Paste a link or "
        f"upload the PDF and I'll index it. [Source: {SIRIUS_LABEL}, p. 1]"
    )
    out = check_citation_compliance(
        reply,
        PARTIAL,
        fsm_state="Q1",
        chat_id="t-fuse-sirius",
        uns_context={"manufacturer": "", "model": ""},
        established_text=FUSE_Q,
        chunks=[SIRIUS_NULL_MFR, YASKAWA_TABLE],
        enforce=True,
    )
    assert out["relevant"] is False
    assert "[Source:" not in out["sanitized_reply"]
    assert "GA50U2001" in out["sanitized_reply"]


def test_sources_footer_label_for_an_unrelated_chunk_is_stripped():
    """RED on main: the footer renders `2100 — CA 004, p. 1` (response_formatter
    label format, not the prompt label), the gate canonicalizes no vendor from it
    and the digit-led party is excluded, so it ships on a refusal."""
    from shared.response_formatter import _format_citation_label
    from shared.workers.rag_worker import kb_citation_entry

    footer_label = _format_citation_label(kb_citation_entry(MCC_NULL_MFR))
    reply = (
        "I don't have documentation for the GA50U2001 in my records — that looks like a "
        f"Yaskawa GA500.\n\n[Source: {footer_label}]"
    )
    out = check_citation_compliance(
        reply,
        PARTIAL,
        fsm_state="Q1",
        chat_id="t-fuse-footer",
        uns_context={"manufacturer": "", "model": ""},
        established_text=FUSE_Q,
        chunks=[MCC_NULL_MFR],
        enforce=True,
    )
    assert out["relevant"] is False
    assert "[Source:" not in out["sanitized_reply"]


def test_document_from_the_established_vendor_is_kept_without_the_identifier():
    """Control: the technician named Yaskawa, and the cited Yaskawa table keys its
    rows by suffix (2001, not GA50U2001). Vendor provenance alone keeps it."""
    q = "Which Bussmann semiconductor fuse does Yaskawa require for a GA50U2001?"
    reply = f"FWH-25A14F. [Source: {YASKAWA_LABEL}]"
    out = check_citation_compliance(
        reply,
        PARTIAL,
        fsm_state="Q1",
        chat_id="t-fuse-yaskawa",
        uns_context={"manufacturer": "Yaskawa", "model": "GA50U2001"},
        established_text=q,
        chunks=[YASKAWA_TABLE, SIRIUS_NULL_MFR],
        enforce=True,
    )
    assert out["relevant"] is True
    assert out["sanitized_reply"] is None


def test_without_chunks_the_gate_is_unchanged():
    """Control: a caller that cannot supply the turn's chunks gets the old behavior —
    the unestablished vendor tag is still stripped, the null-vendor one still kept."""
    reply = f"Frame size B. [Source: {AD_LABEL}]"
    old = evaluate_citation_relevance(reply, None, GS10_Q)
    new = evaluate_citation_relevance(reply, None, GS10_Q, chunks=None)
    assert old == new
    assert new["relevant"] is False and new["reason"] == "unestablished"

    sirius = f"See the breaker manual. [Source: {SIRIUS_LABEL}]"
    assert evaluate_citation_relevance(sirius, None, FUSE_Q)["relevant"] is True


def test_short_or_numeric_tokens_do_not_activate_the_rule():
    """Control: '525', 'F0004', 'P01-01' are not catalog identifiers. The GS10
    question has none of them, so the generic chunk's citation is judged exactly
    as before (no vendor named by the technician -> AutomationDirect tag unestablished)."""
    q = "PowerFlex 525 F0004 after setting P01-01"
    reply = "Check the DC bus. [Source: Rockwell Automation PowerFlex 525 — Fault Codes]"
    rockwell = {
        "manufacturer": "Rockwell Automation",
        "model_number": "PowerFlex 525",
        "metadata": {"section": "Fault Codes"},
        "content": "F004 UnderVoltage: DC bus voltage fell below the minimum value.",
    }
    with_chunks = evaluate_citation_relevance(reply, "Rockwell Automation", q, chunks=[rockwell])
    without = evaluate_citation_relevance(reply, "Rockwell Automation", q)
    assert with_chunks == without
    assert with_chunks["relevant"] is True


def test_conflict_case_is_untouched_by_provenance():
    """Control: expected vendor resolved + a different vendor cited is still a
    conflict even if that chunk happens to contain the identifier."""
    q = "AutomationDirect GS13N-42P0 frame size?"
    siemens_mentions = dict(SIEMENS_PM340, content="Cross-reference: GS13N-42P0 ~ PM340 FSB.")
    reply = f"Frame B. [Source: {SIEMENS_LABEL}]"
    out = evaluate_citation_relevance(reply, "AutomationDirect", q, chunks=[siemens_mentions])
    assert out["relevant"] is False and out["reason"] == "conflict"


# ---------------------------------------------------------------------------
# The salvage rewrite
# ---------------------------------------------------------------------------
def _llm_returning(text: str, calls: list):
    async def _llm(messages):
        calls.append(messages)
        return text

    return _llm


def test_salvage_never_inserts_an_off_vendor_label():
    """RED on main: the salvage offers every retrieved label, so after the gate
    strips a citation it re-tags the reply with the Siemens chunk."""
    uncited = (
        "Frame size B, 2 HP / 1.5 kW. Verify the frame on the drive's nameplate before mounting."
    )
    calls: list = []
    rewritten = f"Frame size B, 2 HP / 1.5 kW. [Source: {SIEMENS_LABEL}] Verify the frame on the drive's nameplate before mounting."
    out = asyncio.run(
        enforce_citation_via_rewrite(
            uncited,
            [SIEMENS_PM340],
            PARTIAL,
            fsm_state="DIAGNOSIS",
            chat_id="t-salvage-wrong",
            llm_call=_llm_returning(rewritten, calls),
            uns_context={"manufacturer": "", "model": ""},
            established_text=GS10_Q,
        )
    )
    assert out == uncited
    assert calls == [], "no label passes the gate, so the rewrite must not even be attempted"


def test_salvage_may_insert_the_label_that_proves_the_unit():
    """Control: the right document is still salvageable."""
    uncited = (
        "Frame size B, 2 HP / 1.5 kW. Verify the frame on the drive's nameplate before mounting."
    )
    calls: list = []
    rewritten = f"Frame size B, 2 HP / 1.5 kW. [Source: {AD_LABEL}] Verify the frame on the drive's nameplate before mounting."
    out = asyncio.run(
        enforce_citation_via_rewrite(
            uncited,
            [SIEMENS_PM340, AD_GS10],
            PARTIAL,
            fsm_state="DIAGNOSIS",
            chat_id="t-salvage-right",
            llm_call=_llm_returning(rewritten, calls),
            uns_context={"manufacturer": "", "model": ""},
            established_text=GS10_Q,
        )
    )
    assert out == rewritten
    offered = calls[0][1]["content"]
    assert AD_LABEL in offered and SIEMENS_LABEL not in offered


def test_salvage_also_refuses_an_unestablished_vendor_without_identifiers():
    """RED on main: no identifier in the question, nothing established — the gate's
    case 2 would strip any vendor-attributed tag, so the salvage must not add one."""
    q = "the drive faulted"
    uncited = "Check the DC bus voltage and reset the drive."
    calls: list = []
    rewritten = f"Check the DC bus voltage [Source: {SIEMENS_LABEL}] and reset the drive."
    out = asyncio.run(
        enforce_citation_via_rewrite(
            uncited,
            [SIEMENS_PM340],
            PARTIAL,
            fsm_state="DIAGNOSIS",
            chat_id="t-salvage-vague",
            llm_call=_llm_returning(rewritten, calls),
            uns_context={"manufacturer": "", "model": ""},
            established_text=q,
        )
    )
    assert out == uncited
    assert calls == []


def test_engine_threads_one_set_of_relevance_inputs_to_gate_and_salvage():
    """The gate and the salvage must judge with the SAME inputs and the turn's own
    chunks: _citation_relevance_inputs records them on `parsed`, and
    _evidence_from_parsed hands them to the salvage bridge."""
    import os

    os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")
    from shared.engine import Supervisor

    state = {"state": "IDLE", "context": {"history": [{"role": "user", "content": "hello"}]}}
    parsed = {"_last_chunks": [AD_GS10], "_kb_status": PARTIAL}
    gate_kwargs = Supervisor._citation_relevance_inputs(GS10_Q, state, parsed)
    assert gate_kwargs["chunks"] == [AD_GS10]
    assert GS10_Q in gate_kwargs["established_text"]

    evidence = Supervisor._evidence_from_parsed(parsed)
    assert evidence["chunks"] == [AD_GS10]
    assert evidence["established_text"] == gate_kwargs["established_text"]
    assert evidence["uns_context"] == gate_kwargs["uns_context"]


def test_right_null_manufacturer_document_is_proven_by_a_sibling_chunk():
    """Control for the per-document rule: a customer upload stored with no
    manufacturer, cited from its fault table (which never repeats the model), is
    kept because another retrieved chunk of the SAME document names the unit."""
    url = "upload://tenant/acme-drive-manual.pdf"
    fault_table = {
        "manufacturer": "",
        "model_number": "acme drive manual",
        "source_url": url,
        "metadata": {"section": "Fault Codes"},
        "content": "oC: overcurrent. Check motor leads and acceleration time.",
    }
    spec_table = {
        "manufacturer": "",
        "model_number": "acme drive manual",
        "source_url": url,
        "metadata": {"section": "Ratings"},
        "content": "Model QX4-2200 rated 2.2 kW, 400 V.",
    }
    label = "acme drive manual — Fault Codes"
    reply = f"oC is an overcurrent trip — check the motor leads. [Source: {label}]"
    q = "QX4-2200 shows oC on start"
    kept = evaluate_citation_relevance(reply, None, q, chunks=[fault_table, spec_table])
    assert kept["relevant"] is True, kept
    # Mutation of the control: without the sibling, the same tag is unproven.
    alone = evaluate_citation_relevance(reply, None, q, chunks=[fault_table])
    assert alone["relevant"] is False and alone["reason"] == "unproven"


def test_document_whose_url_names_the_unit_is_kept():
    """The beta-gate shape: a stranger uploads `zx9000_manual.pdf` (no stored
    manufacturer) and asks about the ZX9000."""
    chunk = {
        "manufacturer": "",
        "model_number": "",
        "source_url": "upload://tenant/zx9000_manual.pdf",
        "metadata": {"section": "Alarms"},
        "content": "Alarm 12: DC bus undervoltage.",
    }
    from shared.workers.rag_worker import format_source_label

    reply = f"Alarm 12 is DC bus undervoltage. [Source: {format_source_label(chunk)}]"
    out = evaluate_citation_relevance(reply, None, "ZX9000 alarm 12?", chunks=[chunk])
    assert out["relevant"] is True, out


def test_engine_process_keeps_right_tag_and_salvage_cannot_retag_with_siemens(tmp_path):
    """End to end through Supervisor: the real gate (_gate_reply_citations) runs
    with this turn's chunks and records its inputs on the evidence; process()
    then runs the REAL salvage bridge, whose stubbed LLM tries to insert the
    Siemens label. The final reply must keep neither the strip nor the re-tag."""
    import os
    from unittest.mock import AsyncMock, patch

    os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")
    from shared.engine import Supervisor

    sup = Supervisor(
        db_path=str(tmp_path / "t.db"),
        openwebui_url="http://stub",
        api_key="",
        collection_id="",
        tenant_id="00000000-0000-0000-0000-000000000001",
    )
    state = {"state": "IDLE", "context": {"history": []}}

    # 1) Gate: the model cited the right document — it must survive.
    evidence = {"kb_status": PARTIAL, "chunks": [SIEMENS_PM340, AD_GS10], "sources": []}
    with patch.dict(os.environ, {"MIRA_CITATION_ENFORCE": "1"}):
        gated = sup._gate_reply_citations(
            f"Frame size B, 2 HP / 1.5 kW. [Source: {AD_LABEL}]",
            GS10_Q,
            state,
            "t-e2e",
            evidence=evidence,
        )
    assert AD_LABEL in gated and "removed a citation" not in gated
    assert evidence["established_text"] and GS10_Q in evidence["established_text"]

    # 2) Salvage: an uncited reply reaches process(); the LLM offers Siemens.
    uncited = (
        "Frame size B, 2 HP / 1.5 kW. Verify the frame on the drive's nameplate before mounting."
    )
    siemens = f"Frame size B, 2 HP / 1.5 kW. [Source: {SIEMENS_LABEL}] Verify the frame on the drive's nameplate before mounting."
    evidence_siemens_only = dict(evidence, chunks=[SIEMENS_PM340])
    sup.rag._call_llm = AsyncMock(return_value=siemens)
    full = {
        "reply": uncited,
        "next_state": "DIAGNOSIS",
        "dispatch_kind": "",
        "_citation_evidence": evidence_siemens_only,
    }
    with (
        patch.object(sup, "process_full", new=AsyncMock(return_value=full)),
        patch.object(sup, "_apply_quality_gate", new=AsyncMock(side_effect=lambda *a, **k: a[2])),
        patch("shared.engine.check_quota", new=AsyncMock(return_value=(True, ""))),
        patch.dict(os.environ, {"MIRA_CITATION_REWRITE": "1", "MIRA_CITATION_ENFORCE": "1"}),
    ):
        final = asyncio.run(sup.process(chat_id="t-e2e", message=GS10_Q))
    assert SIEMENS_LABEL not in final, final
    assert sup.rag._call_llm.await_count == 0, "no gate-passing label → salvage never calls the LLM"


def test_salvage_without_context_is_unchanged():
    """Control: legacy callers that pass no uns_context/established_text keep the
    old behavior (any retrieved label may be inserted)."""
    uncited = "Check the DC bus voltage and reset the drive."
    calls: list = []
    rewritten = f"Check the DC bus voltage [Source: {SIEMENS_LABEL}] and reset the drive."
    out = asyncio.run(
        enforce_citation_via_rewrite(
            uncited,
            [SIEMENS_PM340],
            PARTIAL,
            fsm_state="DIAGNOSIS",
            chat_id="t-salvage-legacy",
            llm_call=_llm_returning(rewritten, calls),
        )
    )
    assert out == rewritten
    assert _tags(out) == [SIEMENS_LABEL]
