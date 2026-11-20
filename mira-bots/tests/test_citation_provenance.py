"""#3049 — a citation to a document with no manufacturer must name the unit.

Measured 2026-11-17 on origin/main 88c7b8e26 (Python Supervisor, citation
enforcement at its default ON), with real staging retrieval:

* "GA50U2001 semiconductor fuse part number?" — 22 of 31 refusals still carried
  a ``[Source:]`` tag: ``manual SIRIUS circuit breaker 3RV en US`` (stored
  ``manufacturer`` is NULL, so no vendor check can read it) or the Sources
  footer label ``2100 — CA 004, p. 1``. Neither document mentions GA50U2001.
* "GS13N-42P0 frame size?" — after the gate stripped the model's citation, the
  salvage rewrite inserted ``Siemens — 4.3 Power Modules Blocksize (PM340)``,
  a label the gate itself would have stripped.

The narrowed rule under test (owner Option 1, after Codex round 3):

* **Vendorless provenance.** When THIS message (memory block removed) names a
  catalog number and the turn's chunks are known, a tag whose retrieved
  document has no manufacturer is stripped unless that document names the
  number. Strip-only: it never removes a strip and never touches a tag whose
  document has a manufacturer.
* **Salvage filter.** The salvage rewrite may only insert labels the gate would
  let through.

Run from the repo/worktree ROOT:
    python3.12 -m pytest mira-bots/tests/test_citation_provenance.py -q
"""

from __future__ import annotations

import asyncio
import os

from shared.citation_compliance import (
    CITATION_TAG_RE,
    catalog_identifiers,
    check_citation_compliance,
    enforce_citation_via_rewrite,
    evaluate_citation_relevance,
)
from shared.engine import Supervisor
from shared.response_formatter import _format_citation_label
from shared.workers.rag_worker import format_source_label, kb_citation_entry

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")

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
MCC_FOOTER_LABEL = _format_citation_label(kb_citation_entry(MCC_NULL_MFR))

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


def _main(reply, expected, established):
    """The gate exactly as on main: no chunks, no current text."""
    return evaluate_citation_relevance(reply, expected, established)


def _new(reply, expected, established, chunks, current):
    return evaluate_citation_relevance(
        reply, expected, established, chunks=chunks, current_text=current
    )


def _upload(url: str, content: str, model: str = "manual drive en US", section: str = "") -> dict:
    """A customer/Drive upload stored with no manufacturer. The default label
    ("manual drive en US") is one main's gate leaves alone, so a strip seen in a
    test is this change's, not Case 2's unknown-party rule."""
    return {
        "manufacturer": "",
        "model_number": model,
        "source_url": url,
        "metadata": {"section": section} if section else {},
        "content": content,
    }


# ---------------------------------------------------------------------------
# What the change strips (each RED on main)
# ---------------------------------------------------------------------------
def test_null_manufacturer_title_citation_is_stripped():
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
        current_text=FUSE_Q,
        chunks=[SIRIUS_NULL_MFR, YASKAWA_TABLE],
        enforce=True,
    )
    assert out["relevant"] is False
    assert "[Source:" not in out["sanitized_reply"]
    assert "GA50U2001" in out["sanitized_reply"]


def test_sources_footer_label_for_an_unrelated_chunk_is_stripped():
    """The footer renders ``2100 — CA 004, p. 1`` (response_formatter format, not
    the prompt label); no vendor can be read from it."""
    reply = (
        "I don't have documentation for the GA50U2001 in my records — that looks like a "
        f"Yaskawa GA500.\n\n[Source: {MCC_FOOTER_LABEL}]"
    )
    out = check_citation_compliance(
        reply,
        PARTIAL,
        fsm_state="Q1",
        chat_id="t-fuse-footer",
        uns_context={"manufacturer": "", "model": ""},
        established_text=FUSE_Q,
        current_text=FUSE_Q,
        chunks=[MCC_NULL_MFR],
        enforce=True,
    )
    assert out["relevant"] is False
    assert "[Source:" not in out["sanitized_reply"]
    assert _main(reply, None, FUSE_Q)["relevant"] is True


def test_vendor_conflict_does_not_exempt_a_vendorless_tag():
    """Yaskawa resolved; the reply cites Siemens (conflict) AND the unrelated
    vendorless MCC guide. Both go; the reason stays "conflict"."""
    reply = (
        f"Use the listed semiconductor fuse. [Source: {SIEMENS_LABEL}] [Source: {MCC_FOOTER_LABEL}]"
    )
    out = _new(reply, "Yaskawa", FUSE_Q, [SIEMENS_PM340, MCC_NULL_MFR], FUSE_Q)
    assert out["reason"] == "conflict"
    assert set(out["conflicting_tags"]) == set(CITATION_TAG_RE.findall(reply))
    assert _main(reply, "Yaskawa", FUSE_Q)["conflicting_tags"] == [f"[Source: {SIEMENS_LABEL}]"]


def test_same_titled_uploads_do_not_pool():
    guide_a = _upload(
        "upload://t/a.pdf", "ZX9000 mounting clearances: 50 mm.", "Installation Guide"
    )
    guide_b = _upload("upload://t/b.pdf", "Conveyor belt tensioning.", "Installation Guide")
    guide_a["metadata"] = {"page_num": 4}
    guide_b["metadata"] = {"page_num": 17}
    label_a = _format_citation_label(kb_citation_entry(guide_a))
    label_b = _format_citation_label(kb_citation_entry(guide_b))
    assert label_a != label_b
    q = "ZX9000 clearance?"
    good = _new(f"50 mm. [Source: {label_a}]", None, q, [guide_a, guide_b], q)
    bad = _new(f"50 mm. [Source: {label_b}]", None, q, [guide_a, guide_b], q)
    assert good["relevant"] is True, good
    assert bad["relevant"] is False and bad["reason"] == "unproven", bad


def test_a_rating_or_a_standard_does_not_count_as_the_unit():
    """ "480VAC", "100kAIC" and "NEMA12" are not catalog numbers, so a vendorless
    document that merely states them does not name the unit."""
    assert catalog_identifiers("GA50U2001 on 480VAC 100kAIC SCCR NEMA12 IP65") == {"GA50U2001"}
    mcc = dict(MCC_NULL_MFR, content="2100 MCC fuse clips 480VAC, 100kAIC SCCR, NEMA12.")
    q = "GA50U2001 fuse at 480VAC 100kAIC in a NEMA12 enclosure?"
    out = _new(f"Use class J. [Source: {format_source_label(mcc)}]", None, q, [mcc], q)
    assert out["relevant"] is False, out


def test_a_longer_or_suffixed_model_is_not_the_unit():
    """Exact whole tokens only: ZX90000, ZX9000B2 and ZX9000PRO are other units."""
    q = "ZX9000 alarm 12?"
    for name in ("ZX90000", "ZX9000B2", "ZX9000PRO"):
        doc = _upload(f"upload://t/{name.lower()}_manual.pdf", f"{name} alarm 12: undervoltage.")
        out = _new(f"Alarm 12. [Source: {format_source_label(doc)}]", None, q, [doc], q)
        assert out["relevant"] is False, (name, out)


# ---------------------------------------------------------------------------
# What it keeps: vendorless documents that name the unit
# ---------------------------------------------------------------------------
def test_a_sibling_chunk_of_the_same_document_names_the_unit():
    """A customer upload with no manufacturer, cited from its fault table (which
    never repeats the model), is kept because another chunk of the SAME
    document names the unit."""
    url = "upload://tenant/acme-drive-manual.pdf"
    fault_table = _upload(url, "oC: overcurrent. Check motor leads.", section="Fault Codes")
    spec_table = _upload(url, "Model QX4-2200 rated 2.2 kW, 400 V.", section="Ratings")
    label = format_source_label(fault_table)
    reply = f"oC is an overcurrent trip. [Source: {label}]"
    q = "QX4-2200 shows oC on start"
    assert _new(reply, None, q, [fault_table, spec_table], q)["relevant"] is True
    alone = _new(reply, None, q, [fault_table], q)
    assert alone["relevant"] is False and alone["reason"] == "unproven"


def test_an_upload_whose_url_names_the_unit_is_kept():
    """The beta-gate shape: a stranger uploads ``zx9000_manual.pdf``."""
    chunk = _upload("upload://tenant/zx9000_manual.pdf", "Alarm 12: DC bus undervoltage.")
    reply = f"Alarm 12 is DC bus undervoltage. [Source: {format_source_label(chunk)}]"
    q = "ZX9000 alarm 12?"
    assert _new(reply, None, q, [chunk], q)["relevant"] is True


# ---------------------------------------------------------------------------
# Controls: byte-identical to main
# ---------------------------------------------------------------------------
def test_without_chunks_or_current_text_the_gate_is_main():
    reply = f"See the breaker manual. [Source: {SIRIUS_LABEL}]"
    assert _new(reply, None, FUSE_Q, None, FUSE_Q) == _main(reply, None, FUSE_Q)
    assert _new(reply, None, FUSE_Q, [SIRIUS_NULL_MFR], None) == _main(reply, None, FUSE_Q)
    assert _main(reply, None, FUSE_Q)["relevant"] is True


def test_a_message_naming_no_catalog_number_is_main():
    """Pronoun-only follow-ups, plain model names and fault codes do not turn the
    rule on, whatever the history said."""
    reply = f"Use the listed fuse. [Source: {SIRIUS_LABEL}]"
    established = FUSE_Q + " Which fuse does it take?"
    for message in ("Which fuse does it take?", "PowerFlex 525 F0004 after P01-01", "GS10 CE10"):
        assert _new(reply, None, established, [SIRIUS_NULL_MFR], message) == _main(
            reply, None, established
        ), message


def test_a_document_with_a_manufacturer_is_never_judged():
    """Codex round 3, F5 shape: a vendor-labelled document that does not name the
    unit is left to Cases 1 and 2 exactly as on main. That includes an
    manufacturer the alias table does not know (Konecranes)."""
    v1000 = {
        "manufacturer": "Yaskawa",
        "model_number": "V1000",
        "metadata": {"section": "Fuses"},
        "content": "V1000 input fuse selection: FWP-15B.",
    }
    konecranes = {
        "manufacturer": "Konecranes",
        "model_number": "DR-Pro",
        "metadata": {"section": "Brakes"},
        "content": "Brake air gap 0.4 mm.",
    }
    q = "Yaskawa GA50U2002 fuse?"
    for doc, expected in (
        (v1000, "Yaskawa"),
        (konecranes, None),
        (AD_GS10, None),
        (SIEMENS_PM340, None),
    ):
        reply = f"See the table. [Source: {format_source_label(doc)}]"
        assert _new(reply, expected, q, [doc], q) == _main(reply, expected, q), doc
    # The technician named Konecranes, so main keeps that tag; it must stay kept.
    dq = "Konecranes hoist on the GA50U2002 drive, brake air gap?"
    reply = f"0.4 mm. [Source: {format_source_label(konecranes)}]"
    assert _main(reply, None, dq)["relevant"] is True
    assert _new(reply, None, dq, [konecranes], dq) == _main(reply, None, dq)


def test_round3_f2_switch_to_a_non_catalog_unit_is_main():
    """Codex round 3, F2: GA50U2002 in history, the technician moves to a GS10.
    The GS10 manual (and a vendorless GS10 upload) are judged exactly as on main."""
    history = "Yaskawa GA50U2002 fuse? "
    message = "Different drive now, the AutomationDirect GS10 on line 2. Frame size?"
    upload = _upload("upload://t/line2_drive.pdf", "Frame B, 2 HP.")
    for doc in (AD_GS10, upload):
        reply = f"Frame B. [Source: {format_source_label(doc)}]"
        assert _new(reply, None, history + message, [doc], message) == _main(
            reply, None, history + message
        )


def test_round3_f10_footer_with_both_manuals_is_main():
    """Codex round 3, F10: the footer cites both retrieved manuals. Both carry a
    manufacturer, so the gate's verdict is main's verdict; nothing is rescued."""
    reply = f"Frame FSB. [Source: {AD_LABEL}] [Source: {SIEMENS_LABEL}]"
    new = _new(reply, None, GS10_Q, [AD_GS10, SIEMENS_PM340], GS10_Q)
    assert new == _main(reply, None, GS10_Q)
    assert new["reason"] == "unestablished"


def test_strip_only_over_a_battery():
    """Property: with chunks and current text, the strip list is a superset of
    main's, main's reason is kept, and every added tag is vendorless."""
    upload = _upload("upload://t/zx9000_manual.pdf", "Alarm 12.")
    # "acme drive manual" reads as an unnamed party, so main strips it already.
    acme = _upload("upload://t/acme.pdf", "Alarm 12.", model="acme drive manual")
    cases = [
        (f"x [Source: {SIRIUS_LABEL}] [Source: {YASKAWA_LABEL}]", None, FUSE_Q),
        (f"x [Source: {SIRIUS_LABEL}] [Source: {YASKAWA_LABEL}]", "Yaskawa", FUSE_Q),
        (f"x [Source: {MCC_FOOTER_LABEL}] [Source: {SIEMENS_LABEL}]", "Yaskawa", FUSE_Q),
        (f"x [Source: {AD_LABEL}] [Source: {SIRIUS_LABEL}]", None, GS10_Q),
        (f"x [Source: {format_source_label(upload)}]", None, "ZX9000 alarm?"),
        (f"x [Source: {format_source_label(upload)}]", None, "GA50U2001 alarm?"),
        (f"x [Source: {format_source_label(acme)}]", None, "GA50U2001 alarm?"),
    ]
    chunks = [SIRIUS_NULL_MFR, MCC_NULL_MFR, YASKAWA_TABLE, AD_GS10, SIEMENS_PM340, upload, acme]
    for reply, expected, q in cases:
        base = _main(reply, expected, q)
        new = _new(reply, expected, q, chunks, q)
        assert len(new["conflicting_tags"]) == len(set(new["conflicting_tags"])), reply
        assert new["conflicting_tags"][: len(base["conflicting_tags"])] == base["conflicting_tags"]
        assert set(base["conflicting_tags"]) <= set(new["conflicting_tags"]), reply
        if base["reason"]:
            assert new["reason"] == base["reason"], reply
        for tag in set(new["conflicting_tags"]) - set(base["conflicting_tags"]):
            assert tag in {
                f"[Source: {label}]"
                for label in (SIRIUS_LABEL, MCC_FOOTER_LABEL, format_source_label(upload))
            }, tag


def test_stated_cost_a_part_number_question_strips_a_document_that_omits_it():
    """Pinned: "Is FWH-25A14F the right fuse?" makes the fuse the identifier, so
    a vendorless manual that never prints it is stripped. Stated in the PR."""
    q = "Is FWH-25A14F the right fuse?"
    assert catalog_identifiers(q) == {"FWH25A14F"}
    upload = _upload("upload://t/line3_drive.pdf", "Use the semiconductor fuse in Table 4.")
    out = _new(f"Yes. [Source: {format_source_label(upload)}]", None, q, [upload], q)
    assert out["relevant"] is False and out["reason"] == "unproven"


def test_stated_cost_a_document_that_excludes_the_unit_still_names_it():
    """Pinned under-strip (Codex round 3, F9): a vendorless document that says
    "Not for use with GA50U2001" names the unit and is kept, as on main."""
    mcc = dict(MCC_NULL_MFR, content="Not for use with GA50U2001. For MCC 2100 only.")
    reply = f"Use class J. [Source: {format_source_label(mcc)}]"
    assert _new(reply, None, FUSE_Q, [mcc], FUSE_Q) == _main(reply, None, FUSE_Q)


# ---------------------------------------------------------------------------
# The memory block
# ---------------------------------------------------------------------------
MEMORY = "[MIRA MEMORY — facts from this session]\nAsset: GA50U2001, frame B.\n[END MEMORY]\n\n"


def test_the_memory_block_never_supplies_the_unit():
    assert (
        Supervisor._strip_memory_block(MEMORY + "Which fuse does it take?")
        == "Which fuse does it take?"
    )
    reply = f"Use the listed fuse. [Source: {SIRIUS_LABEL}]"
    message = Supervisor._strip_memory_block(MEMORY + "Which fuse does it take?")
    assert _new(reply, None, FUSE_Q, [SIRIUS_NULL_MFR], message) == _main(reply, None, FUSE_Q)


# ---------------------------------------------------------------------------
# The salvage rewrite
# ---------------------------------------------------------------------------
def _llm_returning(text: str, calls: list):
    async def _llm(messages):
        calls.append(messages)
        return text

    return _llm


UNCITED = "Frame size B, 2 HP / 1.5 kW. Verify the frame on the drive's nameplate before mounting."


def _salvage(chunks, rewritten, calls, established, current=None, uns=None):
    return asyncio.run(
        enforce_citation_via_rewrite(
            UNCITED,
            chunks,
            PARTIAL,
            fsm_state="DIAGNOSIS",
            chat_id="t-salvage",
            llm_call=_llm_returning(rewritten, calls),
            uns_context=uns if uns is not None else {"manufacturer": "", "model": ""},
            established_text=established,
            current_text=current,
        )
    )


def test_salvage_never_inserts_an_unestablished_vendor_label():
    """RED on main: after the gate strips a citation the salvage re-tags the reply
    with the Siemens chunk, a label the gate would itself strip."""
    calls: list = []
    rewritten = UNCITED.replace("kW.", f"kW. [Source: {SIEMENS_LABEL}]")
    assert _salvage([SIEMENS_PM340], rewritten, calls, GS10_Q, GS10_Q) == UNCITED
    assert calls == []


def test_salvage_never_inserts_an_unproven_vendorless_label():
    calls: list = []
    rewritten = UNCITED.replace("kW.", f"kW. [Source: {SIRIUS_LABEL}]")
    assert _salvage([SIRIUS_NULL_MFR], rewritten, calls, FUSE_Q, FUSE_Q) == UNCITED
    assert calls == []


def test_salvage_may_insert_an_established_vendor_label():
    """Control: a label the gate keeps is still salvageable."""
    q = "Yaskawa GA50U2001 fuse?"
    calls: list = []
    rewritten = UNCITED.replace("kW.", f"kW. [Source: {YASKAWA_LABEL}]")
    out = _salvage(
        [YASKAWA_TABLE, SIEMENS_PM340],
        rewritten,
        calls,
        q,
        q,
        uns={"manufacturer": "Yaskawa", "model": ""},
    )
    assert out == rewritten
    offered = calls[0][1]["content"]
    assert YASKAWA_LABEL in offered and SIEMENS_LABEL not in offered


def test_stated_cost_salvage_no_longer_inserts_the_right_unestablished_manual():
    """Pinned: the GS10 manual DOES list GS13N-42P0, but the technician never named
    AutomationDirect, so the gate strips it (as on main) and the salvage now
    refuses it too. That turn ends with the knowledge-gap admission."""
    calls: list = []
    rewritten = UNCITED.replace("kW.", f"kW. [Source: {AD_LABEL}]")
    assert _salvage([AD_GS10], rewritten, calls, GS10_Q, GS10_Q) == UNCITED
    assert calls == []


def test_salvage_without_context_is_unchanged():
    """Control: legacy callers that pass no context may insert any label."""
    calls: list = []
    rewritten = UNCITED.replace("kW.", f"kW. [Source: {SIEMENS_LABEL}]")
    out = asyncio.run(
        enforce_citation_via_rewrite(
            UNCITED,
            [SIEMENS_PM340],
            PARTIAL,
            fsm_state="DIAGNOSIS",
            chat_id="t-salvage-legacy",
            llm_call=_llm_returning(rewritten, calls),
        )
    )
    assert out == rewritten


# ---------------------------------------------------------------------------
# Engine wiring
# ---------------------------------------------------------------------------
def _supervisor(tmp_path):
    from shared.engine import Supervisor

    return Supervisor(
        db_path=str(tmp_path / "t.db"),
        openwebui_url="http://stub",
        api_key="",
        collection_id="",
        tenant_id="00000000-0000-0000-0000-000000000001",
    )


def test_engine_threads_one_set_of_relevance_inputs_to_gate_and_salvage():
    from shared.engine import Supervisor

    state = {"state": "IDLE", "context": {"history": [{"role": "user", "content": FUSE_Q}]}}
    parsed = {"_last_chunks": [SIRIUS_NULL_MFR], "_kb_status": PARTIAL}
    gate_kwargs = Supervisor._citation_relevance_inputs(MEMORY + "Which fuse?", state, parsed)
    assert gate_kwargs["chunks"] == [SIRIUS_NULL_MFR]
    assert gate_kwargs["current_text"] == "Which fuse?"
    evidence = Supervisor._evidence_from_parsed(parsed)
    for key in ("established_text", "uns_context", "current_text"):
        assert evidence[key] == gate_kwargs[key], key


def test_general_question_gate_records_its_inputs_on_the_evidence(tmp_path):
    from unittest.mock import patch

    sup = _supervisor(tmp_path)
    state = {"state": "IDLE", "context": {"history": []}}
    evidence = {"kb_status": PARTIAL, "chunks": [SIRIUS_NULL_MFR], "sources": []}
    with patch.dict(os.environ, {"MIRA_CITATION_ENFORCE": "1"}):
        gated = sup._gate_reply_citations(
            f"Use the listed fuse. [Source: {SIRIUS_LABEL}]",
            MEMORY + FUSE_Q,
            state,
            "t-general",
            evidence=evidence,
        )
    assert evidence["current_text"] == FUSE_Q
    assert SIRIUS_LABEL not in gated, gated
    assert evidence["stripped_labels"] == [SIRIUS_LABEL]


def test_engine_process_salvage_cannot_retag_with_an_unestablished_vendor(tmp_path):
    """End to end through Supervisor.process: the REAL salvage bridge, whose
    stubbed LLM tries to insert the Siemens label, must not be called."""
    from unittest.mock import AsyncMock, patch

    sup = _supervisor(tmp_path)
    evidence = {
        "kb_status": PARTIAL,
        "chunks": [SIEMENS_PM340],
        "sources": [],
        "uns_context": {"manufacturer": "", "model": ""},
        "established_text": GS10_Q,
        "current_text": GS10_Q,
    }
    siemens = UNCITED.replace("kW.", f"kW. [Source: {SIEMENS_LABEL}]")
    sup.rag._call_llm = AsyncMock(return_value=siemens)
    full = {
        "reply": UNCITED,
        "next_state": "DIAGNOSIS",
        "dispatch_kind": "",
        "_citation_evidence": evidence,
    }
    with (
        patch.object(sup, "process_full", new=AsyncMock(return_value=full)),
        patch.object(sup, "_apply_quality_gate", new=AsyncMock(side_effect=lambda *a, **k: a[2])),
        patch("shared.engine.check_quota", new=AsyncMock(return_value=(True, ""))),
        patch.dict(os.environ, {"MIRA_CITATION_REWRITE": "1", "MIRA_CITATION_ENFORCE": "1"}),
    ):
        final = asyncio.run(sup.process(chat_id="t-e2e", message=GS10_Q))
    assert SIEMENS_LABEL not in final, final
    assert sup.rag._call_llm.await_count == 0


def test_engine_process_salvage_cannot_insert_an_unproven_vendorless_label(tmp_path):
    """The salvage bridge must pass this turn's text: only vendorless provenance
    rejects the SIRIUS label (Case 2 has no vendor to read from it)."""
    from unittest.mock import AsyncMock, patch

    sup = _supervisor(tmp_path)
    evidence = {
        "kb_status": PARTIAL,
        "chunks": [SIRIUS_NULL_MFR],
        "sources": [],
        "uns_context": {"manufacturer": "", "model": ""},
        "established_text": FUSE_Q,
        "current_text": FUSE_Q,
    }
    sirius = UNCITED.replace("kW.", f"kW. [Source: {SIRIUS_LABEL}]")
    sup.rag._call_llm = AsyncMock(return_value=sirius)
    full = {
        "reply": UNCITED,
        "next_state": "DIAGNOSIS",
        "dispatch_kind": "",
        "_citation_evidence": evidence,
    }
    with (
        patch.object(sup, "process_full", new=AsyncMock(return_value=full)),
        patch.object(sup, "_apply_quality_gate", new=AsyncMock(side_effect=lambda *a, **k: a[2])),
        patch("shared.engine.check_quota", new=AsyncMock(return_value=(True, ""))),
        patch.dict(os.environ, {"MIRA_CITATION_REWRITE": "1", "MIRA_CITATION_ENFORCE": "1"}),
    ):
        final = asyncio.run(sup.process(chat_id="t-e2e-sirius", message=FUSE_Q))
    assert SIRIUS_LABEL not in final, final
    assert sup.rag._call_llm.await_count == 0


def test_general_question_rag_path_gates_with_the_turn_chunks(tmp_path):
    """Drives the real _handle_general_question RAG branch: the reply cites the
    vendorless SIRIUS manual for a GA50U2001 question and must lose the tag."""
    from unittest.mock import AsyncMock, patch

    sup = _supervisor(tmp_path)
    message = "Yaskawa GA50U2001 semiconductor fuse part number?"
    state = {"state": "IDLE", "exchange_count": 0, "context": {"history": []}}

    async def _rag(msg, st, **kwargs):
        st["_rag_last_chunks"] = [SIRIUS_NULL_MFR]
        st["_rag_kb_status"] = PARTIAL
        return (
            '{"reply": "Use the listed fuse. [Source: ' + SIRIUS_LABEL + ']", "next_state": "IDLE"}'
        )

    rag_mock = AsyncMock(side_effect=_rag)
    with (
        patch("shared.engine.kb_has_coverage", return_value=(True, "test")),
        patch.object(sup.rag, "process", new=rag_mock),
        patch.dict(os.environ, {"MIRA_CITATION_ENFORCE": "1"}),
    ):
        result = asyncio.run(sup._handle_general_question("t-gq", message, state, "trace"))
    assert rag_mock.await_count == 1
    assert "Use the listed fuse" in result["reply"], result["reply"]
    assert SIRIUS_LABEL not in result["reply"], result["reply"]


# ---------------------------------------------------------------------------
# Hub uploads (node-knowledge-ingest writes no manufacturer and no model)
# ---------------------------------------------------------------------------
def _node_upload(uns_path: str, content: str = "Fault oC: overcurrent.", **meta) -> dict:
    return {
        "manufacturer": None,
        "model_number": None,
        "source_type": "node_attachment",
        "source_url": "node-doc/u1/line3_drive_manual.pdf",
        "metadata": {
            "filename": "line3_drive_manual.pdf",
            "uns_path": uns_path,
            "page_num": 12,
            **meta,
        },
        "content": content,
    }


def test_an_upload_attached_to_the_named_unit_is_kept():
    """The asset node the technician attached the manual to names the unit."""
    q = "GA50U2001 shows oC"
    for path in ("enterprise.garage.line3.ga50u2001", "enterprise.garage.line3.ga50u_2001"):
        doc = _node_upload(path)
        label = _format_citation_label(kb_citation_entry(doc))
        assert _new(f"Overcurrent. [Source: {label}]", None, q, [doc], q)["relevant"] is True, path


def test_an_upload_whose_table_lists_the_unit_is_kept():
    doc = _node_upload("enterprise.garage.line3.drive", table_models=["GA50U2001", "GA50U2002"])
    label = _format_citation_label(kb_citation_entry(doc))
    q = "GA50U2002 fuse?"
    assert _new(f"FWH-25A14F. [Source: {label}]", None, q, [doc], q)["relevant"] is True


def test_an_upload_attached_to_another_unit_is_stripped():
    doc = _node_upload("enterprise.garage.line3.ga50u2001")
    label = _format_citation_label(kb_citation_entry(doc))
    q = "GS13N-42P0 shows oC"
    assert _main(f"Overcurrent. [Source: {label}]", None, q)["relevant"] is True
    out = _new(f"Overcurrent. [Source: {label}]", None, q, [doc], q)
    assert out["relevant"] is False and out["reason"] == "unproven", out


def test_stated_cost_a_message_naming_another_device_strips_the_right_upload():
    """Pinned (same-message form of Codex round 3, F2): the gate reads every
    catalog number in this message, including one the technician has moved
    away from or one belonging to another device, so a vendorless document for
    the unit actually in front of them is stripped when it never prints that
    number. Stated in the PR; the fix is a correction-aware resolver (#5688)."""
    gs10 = _upload("upload://t/line2_drive.pdf", "GS10 Frame B, 2 HP.")
    label = format_source_label(gs10)
    for q in (
        "On the GS10 now, not the GA50U2002. Frame size?",
        "Switched from the 1769-L33ER, GS10 frame size?",
        "CIPR-GA50U2001ABA fuse?",
    ):
        out = _new(f"Frame B. [Source: {label}]", None, q, [gs10], q)
        assert _main(f"Frame B. [Source: {label}]", None, q)["relevant"] is True, q
        assert out["relevant"] is False, q
