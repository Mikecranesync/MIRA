"""Question-focus resolution (Package B) — hermetic tests.

Covers ``shared/visual/question_resolution.py``: pronoun→last_entity
continuity, explicit-tag matching (case/hyphen-insensitive), the K17.1↔K17
child-alias fold with its Derived note, no-match honesty, and the
designations-import-failure fallback to deterministic prefix matching.
"""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

import pytest  # noqa: E402

from shared.visual import question_resolution as qr  # noqa: E402

KNOWN = ["-K17", "13  14", "-F12"]


# --------------------------------------------------------------------------- #
# pronoun / device-noun continuity
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "text",
    [
        "why would it drop out?",
        "what does this relay do?",
        "is the contactor wired through the overload?",
        "was macht es?",  # German pronoun
    ],
)
def test_pronoun_resolves_to_last_entity(text):
    resolved = qr.resolve_question_focus(text, "-K17", KNOWN)
    assert resolved.focus_tag == "-K17"
    assert resolved.alias_note is None
    assert resolved.text == text  # text is never rewritten


def test_pronoun_without_last_entity_stays_unresolved():
    resolved = qr.resolve_question_focus("why would it drop out?", None, KNOWN)
    assert resolved.focus_tag is None


# --------------------------------------------------------------------------- #
# explicit tags (case/hyphen-insensitive)
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("text", ["what feeds K17?", "what feeds k17?", "what feeds -K17?"])
def test_explicit_tag_matches_ledger_form(text):
    resolved = qr.resolve_question_focus(text, None, KNOWN)
    assert resolved.focus_tag == "-K17"  # the ledger's own spelling
    assert resolved.alias_note is None


def test_explicit_tag_beats_pronoun():
    resolved = qr.resolve_question_focus("is this the same as F12?", "-K17", KNOWN)
    assert resolved.focus_tag == "-F12"


# --------------------------------------------------------------------------- #
# child alias (K17.1 <-> K17)
# --------------------------------------------------------------------------- #


def test_child_alias_folds_to_ledger_parent_with_note():
    resolved = qr.resolve_question_focus("what does K17.1 do here?", None, KNOWN)
    assert resolved.focus_tag == "-K17"
    assert resolved.alias_note == "answering for -K17 (K17.1 is its contact/child designation)"


def test_parent_question_folds_to_ledger_child_with_note():
    resolved = qr.resolve_question_focus("what about K17?", None, ["-K17.1", "-F12"])
    assert resolved.focus_tag == "-K17.1"
    assert resolved.alias_note == (
        "answering for -K17.1 (-K17.1 is a contact/child designation of K17)"
    )


def test_terminal_pin_alias_folds_to_parent():
    resolved = qr.resolve_question_focus("check X2:4 for me", None, ["-X2"])
    assert resolved.focus_tag == "-X2"
    assert resolved.alias_note is not None


def test_designations_import_failure_falls_back_to_prefix(monkeypatch):
    """A broken/absent printsense.designations must not break alias folding."""
    monkeypatch.setitem(sys.modules, "printsense.designations", None)
    monkeypatch.setitem(sys.modules, "printsense.designations.decoder", None)
    monkeypatch.setitem(sys.modules, "printsense.designations.relationships", None)
    assert qr._designations_related("K17.1", "-K17") is None  # unavailable -> undecidable
    resolved = qr.resolve_question_focus("what does K17.1 do here?", None, KNOWN)
    assert resolved.focus_tag == "-K17"
    assert resolved.alias_note == "answering for -K17 (K17.1 is its contact/child designation)"


# --------------------------------------------------------------------------- #
# no match
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "text",
    [
        "where does wire 412 land?",
        "yes",
        "thanks",
        "what about Q99?",  # tag-shaped but unknown, no alias relation
        "",
    ],
)
def test_no_match_returns_none_focus_and_unchanged_text(text):
    resolved = qr.resolve_question_focus(text, None, KNOWN)
    assert resolved.focus_tag is None
    assert resolved.alias_note is None
    assert resolved.text == text


def test_empty_known_tags_and_none_inputs_are_safe():
    assert qr.resolve_question_focus("what feeds K17?", None, []).focus_tag is None
    assert qr.resolve_question_focus("what feeds K17?", None, None).focus_tag is None
    resolved = qr.resolve_question_focus("why would it drop out?", "-K17", None)
    assert resolved.focus_tag == "-K17"  # pronoun continuity needs no ledger tags
