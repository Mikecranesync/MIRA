"""UNSEEN-2 + UNSEEN-4 — German print-question routing and the deterministic
contact-state caveat append. Pure module tests (no I/O, no network), same shape
as test_print_translator.py."""

from __future__ import annotations

from shared import print_translator
from shared.print_translator import CONTACT_STATE_CAVEAT, format_theory_reply, is_print_question

# ── UNSEEN-2: German questions must route ────────────────────────────────────

GERMAN_ROUTES = [
    "Welche Klemme ist belegt?",  # the benchmark's exact routing miss
    "wo ist der Querverweis",
    "Schaltplan bitte erklären",
    "was bedeutet -27/Q30",
    "ist die Sicherung auf diesem Blatt",
    "welche Leitung geht zur Klemme X7",
    "Kontakt 21/22 am Schütz?",
    "wie funktioniert diese Verdrahtung",
    "Versorgung 24VDC wo?",
]


def test_german_print_questions_route():
    for caption in GERMAN_ROUTES:
        assert is_print_question(caption) is True, caption


GERMAN_NON_ROUTES = [
    "danke dir",
    "bin morgen wieder da",
    "alles gut hier",
    "schönes Wochenende",
]


def test_german_small_talk_does_not_route():
    for caption in GERMAN_NON_ROUTES:
        assert is_print_question(caption) is False, caption


ENGLISH_NEGATIVES_STILL_NEGATIVE = [
    # "was" is an English past-tense verb — the German signal must not
    # hijack plain English statements without domain context
    "the site visit was fine",
    "he was here yesterday",
    "order the part when you can",
]


def test_english_negatives_unchanged():
    for caption in ENGLISH_NEGATIVES_STILL_NEGATIVE:
        assert is_print_question(caption) is False, caption


# ── UNSEEN-4: deterministic contact-state caveat append ──────────────────────


def test_caveat_appended_when_verdict_ships_bare():
    raw = "Contact 13/14 on -91/K01 is a normally open auxiliary contact."
    out = format_theory_reply(raw)
    assert out.startswith(raw)
    assert CONTACT_STATE_CAVEAT in out


def test_caveat_not_duplicated_when_verification_language_present():
    raw = "13/14 is normally open by convention — verify with a meter before working."
    assert format_theory_reply(raw) == raw


def test_no_caveat_without_contact_verdict():
    raw = "This sheet shows a 24VDC control circuit feeding terminal strip X7."
    assert format_theory_reply(raw) == raw


def test_empty_reply_fallback_unchanged():
    assert format_theory_reply("") == print_translator.FALLBACK_REPLY


def test_caveat_append_is_idempotent():
    raw = "Contact 21/22 is normally closed."
    once = format_theory_reply(raw)
    assert format_theory_reply(once) == once
