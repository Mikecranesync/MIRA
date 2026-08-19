"""Documentation may not contradict the shipped fault table.

MIRA's whole claim is that its answers are grounded in real equipment data. A
document that states a fault code means something it does not is the same defect
as a hallucinated answer, one layer up — and it is worse, because prose gets
copied into prompts, examples, and other docs.

This has now happened twice with the same code:

* #3165 — a runtime answer called PowerFlex 525 **F004** a ground fault.
* #3330 — `docs/specs/mira-answer-quality-standard.md`, the document that
  *defines* what a grounded answer is, used the same wrong definition in its
  worked example and scored it "grounding 5 — fault code interpreted correctly".

F004 is **UnderVoltage**. Ground Fault is **F013**.

Ground truth is the shipped pack (`live_decode.fault_codes`), whose 48 names
were verified against the manual fault table on p.161 in
`docs/audits/2026-07-17-pack-truth-audit-2777.md`. The pack is what the product
actually answers from, so a doc that disagrees with it is wrong by definition.

Scope is deliberately narrow: only lines that make an explicit `Fnnn = name`
style claim in a document that also mentions the drive. Prose that merely
mentions a code is untouched.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_PACK = _ROOT / "mira-bots" / "shared" / "drive_packs" / "packs" / "powerflex_525" / "pack.json"

# Blockquoted lines are exempt, because a retraction has to be able to quote the
# wrong text it is retracting — the #3330 note in the quality standard does
# exactly that.
#
# The first draft used an allowlist keyed on (file, code, claimed name) instead.
# That was a FALSE GREEN: the retraction quote and a genuine reintroduction of
# the defect are byte-identical and live in the same file, so the entry excusing
# the quote also excused the defect. Restoring the original wrong sentence to the
# table left the suite green — verified, which is why this is a marker rule and
# not an allowlist.
#
# The residual hole is that a wrong claim hidden inside a blockquote is not
# caught. That is the cheaper failure: quoted material is understood to be
# somebody else's words, and prose outside a quote is what gets copied.
_QUOTE_PREFIX_RE = re.compile(r"^\s*>")

# Only UNAMBIGUOUS definition forms: "F004 = ground fault",
# "F004 on a PowerFlex 525 = Ground Fault", "F004 means undervoltage".
#
# Dash forms ("F004 — check this first") are deliberately NOT matched. They are
# indistinguishable from headings and list items, and a first draft of this
# regex that accepted them produced eleven false positives against zero real
# defects — a guard that cries wolf gets switched off, so it only claims what it
# can claim cleanly. The #3330 defect used `=`, which this catches.
_CLAIM_RE = re.compile(
    r"\bF(\d{2,3})\b"  # the code
    r"[^.|\n\"']{0,30}?"  # brief intervening prose — no sentence/cell/quote crossing
    r"(?:\s*=\s*|\s+means\s+|\s+stands\s+for\s+)"
    r"\**"
    r"([A-Za-z][A-Za-z /-]{2,30})",  # the claimed name
    re.IGNORECASE,
)

_DRIVE_MENTION_RE = re.compile(r"powerflex\s*525", re.IGNORECASE)


def _pack_fault_names() -> dict[str, str]:
    """`{"F004": "UnderVoltage", ...}` from the shipped pack."""
    pack = json.loads(_PACK.read_text(encoding="utf-8"))
    codes = pack["live_decode"]["fault_codes"]
    return {f"F{int(k):03d}": v for k, v in codes.items() if isinstance(v, str)}


def _normalise(text: str) -> str:
    return re.sub(r"[^a-z]", "", text.lower())


def _docs() -> list[Path]:
    return sorted(p for p in (_ROOT / "docs").rglob("*.md") if p.is_file())


def test_pack_is_readable_and_has_the_codes_this_test_depends_on():
    """If the pack shape changes, fail loudly rather than checking nothing."""
    names = _pack_fault_names()
    assert names, "no fault codes parsed from the pack — this guard would be inert"
    assert names.get("F004") == "UnderVoltage"
    assert names.get("F013") == "Ground Fault"


def test_no_doc_contradicts_the_shipped_fault_table():
    names = _pack_fault_names()
    violations: list[str] = []

    for doc in _docs():
        text = doc.read_text(encoding="utf-8", errors="replace")
        if not _DRIVE_MENTION_RE.search(text):
            continue
        rel = doc.relative_to(_ROOT).as_posix()

        for lineno, line in enumerate(text.splitlines(), start=1):
            if _QUOTE_PREFIX_RE.match(line):
                continue  # a retraction may quote the wrong text it retracts
            for m in _CLAIM_RE.finditer(line):
                code = f"F{int(m.group(1)):03d}"
                claimed = m.group(2).strip()
                truth = names.get(code)
                if truth is None:
                    continue  # not a code the pack knows; out of scope
                if _normalise(truth) in _normalise(claimed) or _normalise(claimed) in _normalise(
                    truth
                ):
                    continue  # agrees
                violations.append(
                    f"{rel}:{lineno} claims {code} = {claimed!r}; the shipped pack says {truth!r}"
                )

    assert not violations, (
        "documentation contradicts mira-bots/shared/drive_packs/packs/powerflex_525/"
        "pack.json (live_decode.fault_codes), which is what the product answers "
        "from:\n  " + "\n  ".join(violations)
    )


def test_the_guard_catches_the_defect_it_was_written_for():
    """Negative control — reconstruct the #3330 text and prove it is rejected.

    Without this, a regex that silently stopped matching would leave the suite
    green while checking nothing.
    """
    names = _pack_fault_names()
    bad = 'Reply B — "F004 on a PowerFlex 525 = ground fault. Confirm this is line-2"'

    hits = [(f"F{int(m.group(1)):03d}", m.group(2).strip()) for m in _CLAIM_RE.finditer(bad)]
    assert hits, "the claim regex no longer matches the original #3330 sentence"

    code, claimed = hits[0]
    assert code == "F004"
    assert _normalise(names[code]) not in _normalise(claimed), (
        "the comparison would have accepted the wrong definition"
    )


@pytest.mark.parametrize(
    ("sentence", "should_match"),
    [
        ("F013 = Ground Fault", True),
        ("F004 means UnderVoltage", True),
        ("the drive logged F004 twice overnight", False),  # mention, not a claim
        ("see fault table for F004 details", False),
    ],
)
def test_only_explicit_definitions_are_in_scope(sentence, should_match):
    """A doc that merely mentions a code must not be flagged."""
    assert bool(_CLAIM_RE.search(sentence)) is should_match


def test_the_retraction_exemption_does_not_swallow_a_real_reintroduction():
    """The false green this guard was rebuilt to close.

    A retraction quoting `F004 = ground fault` must stay legal, while the SAME
    sentence returning to ordinary prose must be caught. The first design
    (allowlist keyed on file+code+name) could not tell them apart and passed on
    the reintroduced defect.
    """
    names = _pack_fault_names()

    def scan(body: str) -> list[str]:
        out = []
        for line in body.splitlines():
            if _QUOTE_PREFIX_RE.match(line):
                continue
            for m in _CLAIM_RE.finditer(line):
                code = f"F{int(m.group(1)):03d}"
                claimed = m.group(2).strip()
                truth = names.get(code)
                if truth and _normalise(truth) not in _normalise(claimed):
                    out.append(f"{code}={claimed}")
        return out

    quoted = "> It originally read: F004 on a PowerFlex 525 = ground fault."
    reintroduced = "| Reply B — F004 on a PowerFlex 525 = ground fault. Confirm this |"

    assert scan(quoted) == [], "a retraction quoting the wrong text must stay legal"
    assert scan(reintroduced), "the reintroduced defect slipped through — false green"
