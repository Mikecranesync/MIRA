"""answer_radar.mcq_hub.parse_letter — reads MIRA's exam reply without guessing."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from answer_radar.mcq_hub import format_question, parse_letter  # noqa: E402

OPTS = {
    "A": "Low DC bus voltage",
    "B": "Motor winding short or locked rotor condition",
    "C": "Faulty keypad display",
    "D": "Loose control wiring",
}


@pytest.mark.parametrize(
    "text,letter",
    [
        ("B", "B"),
        ("B) Motor winding short — an immediate trip points at the load.", "B"),
        ("**B** — a locked rotor draws huge current.", "B"),
        ("The correct answer is B because a short draws a lot of current.", "B"),
        ("Answer: D", "D"),
        ("It is most likely a motor winding short or locked rotor condition.", "B"),
        # staging 76887423c: the letter came on its own line under a safety banner
        (
            "⚠️ **Safety flag on a step below:** \u201cmeasure the line voltage\u201d.\n\nB  \n\n1. **Verify**",
            "B",
        ),
        # staging Q55: "D – …" on a later line, under a banner
        ("⚠️ **Safety flag.** Isolate first.\n\nD – Justified energized work.\n\nMore.", "D"),
    ],
)
def test_reads_a_committed_answer(text, letter):
    assert parse_letter(text, OPTS)[0] == letter


@pytest.mark.parametrize(
    "text",
    [
        "",
        "I can't help with that without a manual for this drive.",
        # the article "a" must never read as option A (tests/mira_eval.py's lax rule does)
        "This is a load problem, a classic case; check a meter reading.",
        "The answer is B, or maybe the answer is D.",
        "B\n\nor possibly\n\nD",
    ],
)
def test_never_guesses(text):
    assert parse_letter(text, OPTS)[0] == "UNPARSED"


def test_question_carries_every_option():
    q = {"stem": "Why?", "options": OPTS}
    s = format_question(q)
    assert all(f"{k}) {v}" in s for k, v in OPTS.items())
