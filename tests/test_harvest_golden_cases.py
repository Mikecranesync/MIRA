"""Tests for the golden-case harvester (pure core — no DB, no network).

Verifies the Phase 4a contract: corrected conversation_eval rows render as
paste-ready GOLDEN_CASES dicts with the correction/bad-response/source-uuid as
review comments, and the batch footer carries the exact --mark-applied command.
Print-only: nothing here touches tests/bot_regression.py or the database.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

# Load tools/harvest_golden_cases.py by spec (no sys.path mutation — same
# discipline tests/bot_regression.py uses for mira-bots modules).
_MOD_PATH = Path(__file__).resolve().parents[1] / "tools" / "harvest_golden_cases.py"
_spec = importlib.util.spec_from_file_location("harvest_golden_cases", _MOD_PATH)
harvest = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(harvest)


def _row(**kw):
    base = {
        "id": "11111111-1111-1111-1111-111111111111",
        "user_message": "What does F004 mean on a PowerFlex 525?",
        "bot_response": "I need the manufacturer and model first.",
        "intent": "industrial",
        "correction": "F004 is an overcurrent fault on the PowerFlex 525.",
        "auto_score": 2,
        "human_score": 1,
    }
    base.update(kw)
    return base


# --- slugify ----------------------------------------------------------------


def test_slugify_basic():
    assert harvest.slugify("What does F004 mean?") == "what_does_f004_mean"


def test_slugify_caps_word_count_and_length():
    slug = harvest.slugify("one two three four five six seven eight nine")
    assert slug.count("_") <= harvest._MAX_SLUG_WORDS - 1
    assert len(slug) <= harvest._MAX_SLUG_LEN


def test_slugify_empty_falls_back():
    assert harvest.slugify("") == "case"
    assert harvest.slugify("???") == "case"


# --- row_to_proposal --------------------------------------------------------


def test_row_to_proposal_maps_fields():
    p = harvest.row_to_proposal(_row())
    assert p["name"] == "harvested_what_does_f004_mean_on_a"  # slugify caps at 6 words
    assert p["input"] == "What does F004 mean on a PowerFlex 525?"
    assert p["intent"] == "industrial"
    assert p["source_id"] == "11111111-1111-1111-1111-111111111111"
    assert "overcurrent" in p["correction"]


def test_row_to_proposal_defaults_intent():
    p = harvest.row_to_proposal(_row(intent=None))
    assert p["intent"] == harvest._DEFAULT_INTENT


# --- render_proposal --------------------------------------------------------


def test_render_proposal_is_pasteable_and_carries_review_context():
    p = harvest.row_to_proposal(_row())
    text = harvest.render_proposal(p)
    # The runnable case fields.
    assert '"name": ' in text
    assert '"input": ' in text
    assert '"intent": ' in text
    # The review context, as comments.
    assert "# harvested from conversation_eval row 11111111-1111-1111-1111-111111111111" in text
    assert "correction   :" in text
    assert "bad response :" in text
    # Every non-dict line is a comment or structural — no un-commented prose.
    for line in text.splitlines():
        s = line.strip()
        assert s.startswith("#") or s in ("{", "},") or s.endswith(",") or s.endswith("{")


def test_render_proposal_escapes_quotes_in_input():
    p = harvest.row_to_proposal(_row(user_message='he said "reset" now'))
    text = harvest.render_proposal(p)
    # repr() gives a valid Python literal regardless of embedded quotes.
    assert "\\'" in text or '\\"' in text or "'he said \"reset\" now'" in text


def test_render_proposal_truncates_long_correction():
    long_corr = "x" * 999
    p = harvest.row_to_proposal(_row(correction=long_corr))
    text = harvest.render_proposal(p)
    assert "…" in text
    assert "x" * 999 not in text


# --- render_batch -----------------------------------------------------------


def test_render_batch_empty_queue():
    out = harvest.render_batch([])
    assert "No un-harvested corrections" in out
    assert "--mark-applied" not in out  # nothing to mark


def test_render_batch_footer_lists_all_ids_and_command():
    rows = [
        _row(id="aaaaaaaa-0000-0000-0000-000000000001"),
        _row(id="bbbbbbbb-0000-0000-0000-000000000002", user_message="reset a GS10"),
    ]
    proposals = [harvest.row_to_proposal(r) for r in rows]
    out = harvest.render_batch(proposals)
    assert "2 correction(s) ready to harvest" in out
    assert "aaaaaaaa-0000-0000-0000-000000000001" in out
    assert "bbbbbbbb-0000-0000-0000-000000000002" in out
    # The mark-applied command (not the header) carries BOTH ids.
    cmd_line = next(
        line for line in out.splitlines() if "harvest_golden_cases.py --mark-applied" in line
    )
    assert "aaaaaaaa-0000-0000-0000-000000000001" in cmd_line
    assert "bbbbbbbb-0000-0000-0000-000000000002" in cmd_line


def test_names_are_unique_per_distinct_question():
    a = harvest.row_to_proposal(_row(user_message="reset a GS10 fault"))
    b = harvest.row_to_proposal(_row(user_message="what is P01.24"))
    assert a["name"] != b["name"]
