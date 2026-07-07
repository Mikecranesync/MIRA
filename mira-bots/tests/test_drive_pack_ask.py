"""Home-ready smoke tests: the GS10 drive-pack question path.

Proves — with NO live hardware — that a plain text question resolves the
PROMOTED ``durapulse_gs10`` pack and yields a grounded, cited, read-only answer
that never falls back to a generic VFD reply. This is the deterministic proof
behind the ``python -m shared.drive_packs.ask`` command Mike runs from home.
"""

from __future__ import annotations

from shared.drive_packs.ask import DrivePackAnswer, answer_question

_GS10 = "durapulse_gs10"


def test_gs10_pack_resolves_for_ce10():
    r = answer_question(_GS10, "For a GS10 drive, what does CE10 mean?")
    assert r.resolved is True
    assert r.pack_id == "durapulse_gs10"
    assert r.schema_version == 2
    assert r.matched is True and r.matched_kind == "fault"
    assert r.answer_source == "drive_pack"
    assert r.fallback_used is False  # never a generic LLM answer
    assert r.live_telemetry is False  # static manual-pack only
    # CE10 identified as a comms/modbus timeout, only because the pack supports it
    assert "CE10" in r.answer
    assert "timeout" in r.answer.lower() or "time-out" in r.answer.lower()
    assert r.citations  # provenance present


def test_drive_commander_gs10_ce10_cites_p0903():
    r = answer_question(_GS10, "Give me a technician-safe first-check procedure for GS10 CE10.")
    assert r.matched is True and r.matched_kind == "fault"
    # the CE10 -> P09.03 comm-timeout link is surfaced and cited to page 4-188
    assert "P09.03" in r.answer
    pages = {c["page"] for c in r.citations}
    assert "4-188" in pages
    # read-only, technician-safe framing — no imperative "change the setting"
    assert r.read_only is True
    assert "VIEW-ONLY" in r.answer


def test_gs10_p0903_documented_answers_from_parameter():
    r = answer_question(_GS10, "Where is GS10 P09.03 documented?")
    assert r.matched is True and r.matched_kind == "parameter"
    assert "P09.03" in r.answer and "COM1 Time-out Detection" in r.answer
    assert any(c["page"] == "4-188" for c in r.citations)
    assert r.answer_source == "drive_pack"


def test_gs10_comm_timeout_intent_resolves_p0903():
    r = answer_question(_GS10, "What GS10 parameter controls communication timeout?")
    assert r.matched is True and r.matched_kind == "parameter"
    assert "P09.03" in r.answer
    assert r.fallback_used is False


def test_ask_mira_gs10_pack_only_no_fallback():
    # A question the pack doesn't document must NOT be answered generically.
    r = answer_question(_GS10, "What is the airspeed velocity of an unladen swallow?")
    assert r.resolved is True  # the pack loaded...
    assert r.matched is False  # ...but nothing matched
    assert r.answer_source == "none"
    assert r.fallback_used is False  # and it did NOT invent a generic answer
    assert "won't guess" in r.answer or "will not guess" in r.answer


def test_gs10_pack_only_directive_reports_coverage_honestly():
    r = answer_question(_GS10, "Only answer from the GS10 drive pack. If the pack is not loaded, say so.")
    assert r.resolved is True
    assert r.answer_source in {"drive_pack", "none"}
    assert r.fallback_used is False
    # it truthfully states what it can cover, grounded in the pack
    assert "P09.03" in r.answer or "CE10" in r.answer


def test_pack_not_loaded_is_honest_not_a_guess():
    r = answer_question("no_such_drive", "what does CE10 mean?")
    assert r.resolved is False
    assert r.matched is False
    assert r.answer_source == "none"
    assert r.citations == []
    assert "not loaded" in r.answer and "guess" in r.answer


def test_answer_is_static_and_read_only_for_every_gs10_answer():
    # The read-only / no-live-telemetry contract holds regardless of question.
    for q in (
        "what does CE10 mean?",
        "where is P09.03?",
        "communication timeout parameter?",
        "unrelated question",
    ):
        r = answer_question(_GS10, q)
        assert isinstance(r, DrivePackAnswer)
        assert r.live_telemetry is False
        assert r.read_only is True
        assert r.fallback_used is False
