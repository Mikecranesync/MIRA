"""The judge's dialogue dimension must not reward quizzing by construction.

`llm_judge` scored *"Did MIRA follow the Socratic diagnostic method?"* at
weight 0.25 — a quarter of every diagnostic score rewarded asking, with no
check on whether asking was the right move. Under the adaptive-dialogue policy
(Answer Integrity PRD §2.2) that actively penalises correct behavior: a direct
cited answer to "what does F004 mean?" loses a quarter of its score for not
being a question.

**These tests assert the rubric TEXT, not judge output.** The judge is a paid
Anthropic call, and Mike's spend law limits metered inference to a
budget-declared acceptance test of the artifact under development — a rubric
reword is not that. So there is no live before/after score delta here, and this
file does not pretend otherwise: it pins the prompt contract offline, which is
the part that can be verified for free. The score delta needs its own
budget-declared run on a fixed fixture set.

Both copies of the rubric are checked. They drifted apart once already (one
uses ASCII arrows, one Unicode), and a policy that holds in one and not the
other is worse than no policy.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]

RUBRICS = {
    "llm_judge": REPO / "tests" / "scoring" / "llm_judge.py",
    "prejudged_benchmark_run": REPO / "mira-bots" / "scripts" / "prejudged_benchmark_run.py",
}


def _dimension_3(path: Path) -> str:
    """The dialogue dimension, as written in the prompt.

    Anchored on the dimension NAME, not on "the third numbered line":
    `llm_judge.py` carries two separate scoring prompts, and a positional match
    picked up the other one's GROUNDING dimension. Asserting exactly one match
    also means deleting the dimension fails loudly instead of silently
    satisfying the "no Socratic" check below.
    """
    text = path.read_text(encoding="utf-8")
    lines = re.findall(r"^3\. DIALOGUE MODE.*$", text, re.MULTILINE)
    assert len(lines) == 1, f"expected exactly one dialogue dimension in {path.name}, got {len(lines)}"
    return lines[0]


@pytest.mark.parametrize("name", sorted(RUBRICS))
def test_rubric_does_not_demand_socratic_method(name):
    """The absolute framing is what made a correct direct answer score badly.

    Checked across the WHOLE file: `llm_judge.py` has more than one prompt, and
    the rule has to hold in every scoring path, not just the one reworded.
    """
    text = RUBRICS[name].read_text(encoding="utf-8")
    assert "Socratic" not in text, f"{name} still demands the Socratic method"


@pytest.mark.parametrize("name", sorted(RUBRICS))
def test_rubric_credits_a_direct_answer(name):
    line = _dimension_3(RUBRICS[name])
    assert "DIRECT" in line, "a direct cited answer must be explicitly creditable"
    assert re.search(r"how-to|specification|procedure", line), line


@pytest.mark.parametrize("name", sorted(RUBRICS))
def test_rubric_still_credits_guided_diagnosis(name):
    """The other failure direction — a rubric that bans questions is equally wrong."""
    line = _dimension_3(RUBRICS[name])
    assert "Guided questioning is correct" in line
    assert "incomplete evidence" in line


@pytest.mark.parametrize("name", sorted(RUBRICS))
def test_rubric_penalises_withholding_and_stop_questions(name):
    line = _dimension_3(RUBRICS[name])
    assert "DEFECT" in line
    assert "safety STOP" in line


@pytest.mark.parametrize("name", sorted(RUBRICS))
def test_weight_is_unchanged(name):
    """Keeping 0.25 keeps the score scale comparable across the reword.

    Only the criterion changes, so a shift in results is a real behavioral
    signal rather than an artifact of re-weighting.
    """
    assert "weight 0.25" in _dimension_3(RUBRICS[name])


def test_both_rubrics_agree():
    """Modulo the arrow glyph, the two copies must say the same thing."""
    a, b = (_dimension_3(RUBRICS[k]).replace("→", "->") for k in sorted(RUBRICS))
    a = a.replace("—", "-")
    b = b.replace("—", "-")
    assert a == b, "the two judge rubrics have drifted apart"


def test_result_field_name_is_unchanged():
    """`gsd_compliance` is read by the benchmark scripts and by stored result
    JSON. Renaming the key would break historical comparison, so the reword
    changes the criterion and the display label only."""
    run = RUBRICS["prejudged_benchmark_run"].read_text(encoding="utf-8")
    assert "gsd_compliance: float (0-10)" in run
