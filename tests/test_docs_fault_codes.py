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

# Words that turn "X" into "X, except not X". A bare "/" counts: it is how the
# compound contradictions in Codex round 2 were written. Safe to treat as a
# marker because it is only ever inspected in the text AFTER the correct name,
# and the one pack name containing a slash ("I/O Board Fail") is consumed whole
# by the prefix match, leaving an empty remainder.
_CONTRADICTION_RE = re.compile(
    r"(?:/|\bor\b|\bbut\b|\bnot\b|\bactually\b|\brather\b|\binstead\b)", re.IGNORECASE
)


# How far past the captured name to keep reading. The capture stops at the
# first comma, colon, or parenthesis (its class is letters/space//-), which is
# exactly where "F004 = UnderVoltage, not OverVoltage" hides its contradiction —
# the capture is a clean "UnderVoltage" and the refutation sits just outside it
# (Codex #3332 round 3). So the claim's tail is inspected too, bounded by a real
# claim terminator: a table-cell pipe, a sentence end, or a semicolon.
_CLAIM_END_RE = re.compile(r"\||;|\.\s|\.$")
_TAIL_CHARS = 90


def _claim_tail(line: str, end: int) -> str:
    """Text after the captured name, up to the end of the same claim."""
    rest = line[end : end + _TAIL_CHARS]
    stop = _CLAIM_END_RE.search(rest)
    return rest[: stop.start()] if stop else rest


def _pack_fault_names() -> dict[str, str]:
    """`{"F004": "UnderVoltage", ...}` from the shipped pack."""
    pack = json.loads(_PACK.read_text(encoding="utf-8"))
    codes = pack["live_decode"]["fault_codes"]
    return {f"F{int(k):03d}": v for k, v in codes.items() if isinstance(v, str)}


def _normalise(text: str) -> str:
    return re.sub(r"[^a-z]", "", text.lower())


def _agrees(
    claimed: str,
    truth: str,
    all_names: "tuple[str, ...] | None" = None,
    tail: str = "",
) -> bool:
    """Does `claimed` LEAD with the fault's real name?

    The claim must open with the true name, on a word boundary. Three
    comparisons were tried; only this one is both sound and quiet.

    1. **Substring, either direction** — the original. Accepted three shapes of
       wrong, because each contains the true name (Codex #3332 F2):

           F004 = Not UnderVoltage            (negation)
           F004 = OverVoltage / UnderVoltage  (names two faults, one wrong)
           F013 = Ground Faultlessness        (superstring)

    2. **Strict equality** — rejected all three, but flagged a correct claim:
       `F004=UnderVoltage sample present` in a checklist row, where the capture
       swallowed adjacent prose. A guard that fails on correct text is the
       false-positive problem that already forced the matcher to narrow once.

    3. **Word-prefix equality** — accept if any leading run of words normalises
       to the true name. Rejected all of the above and stopped flagging the
       checklist row, but a prefix says nothing about what FOLLOWS it, so
       `F004 = UnderVoltage / OverVoltage` and `F004 = UnderVoltage but actually
       OverVoltage` both passed (Codex #3332 round 2).

    4. **Word-prefix, then inspect the remainder** (this one) — the claim must
       lead with the true name AND the text after it must not contradict:
       no OTHER fault name from the pack, and no contradiction marker. The pack
       itself is the authority for "another fault name", so this needs no
       hand-maintained list of wrong answers.

    `all_names` is every fault name in the pack. Passing it is what lets the
    remainder check work; without it this degrades to case 3.
    """
    t = _normalise(truth)
    if not t:
        return False
    words = claimed.split()
    for k in range(1, len(words) + 1):
        if _normalise(" ".join(words[:k])) != t:
            continue
        remainder = (" ".join(words[k:]) + " " + tail).strip()
        if not remainder:
            return True
        rn = _normalise(remainder)
        # another fault name after the correct one => the claim names two faults
        for other in all_names or ():
            on = _normalise(other)
            if on and on != t and on in rn:
                return False
        if _CONTRADICTION_RE.search(remainder):
            return False
        return True
    return False


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
                tail = _claim_tail(line, m.end())
                if _agrees(claimed, truth, tuple(names.values()), tail=tail):
                    continue
                shown = (claimed + tail).strip()
                violations.append(
                    f"{rel}:{lineno} claims {code} = {shown!r}; the shipped pack says {truth!r}"
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
    assert not _agrees(claimed, names[code], tuple(names.values())), (
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
                if truth and not _agrees(claimed, truth, tuple(names.values())):
                    out.append(f"{code}={claimed}")
        return out

    quoted = "> It originally read: F004 on a PowerFlex 525 = ground fault."
    reintroduced = "| Reply B — F004 on a PowerFlex 525 = ground fault. Confirm this |"

    assert scan(quoted) == [], "a retraction quoting the wrong text must stay legal"
    assert scan(reintroduced), "the reintroduced defect slipped through — false green"


@pytest.mark.parametrize(
    ("claimed", "truth", "agrees"),
    [
        # agreement, including harmless formatting variation
        ("Ground Fault", "Ground Fault", True),
        ("ground fault", "Ground Fault", True),
        ("Under Voltage", "UnderVoltage", True),
        ("UnderVoltage fault", "UnderVoltage", True),  # trailing prose after the name
        ("UnderVoltage sample present", "UnderVoltage", True),  # real checklist row in docs/audits/
        # the three shapes the substring comparison wrongly accepted (#3332 F2)
        ("Not UnderVoltage", "UnderVoltage", False),  # negation
        ("OverVoltage / UnderVoltage", "UnderVoltage", False),  # names two faults
        ("Ground Faultlessness", "Ground Fault", False),  # superstring
        # compound contradictions — correct name FIRST, wrong one after
        # (Codex #3332 round 2; word-prefix matching alone accepted all three)
        ("UnderVoltage / OverVoltage", "UnderVoltage", False),
        ("UnderVoltage but actually OverVoltage", "UnderVoltage", False),
        ("Ground Fault / OverVoltage", "Ground Fault", False),
        # the one pack name containing "/" must not trip the contradiction
        # marker — the prefix consumes it whole, leaving an empty remainder
        ("I/O Board Fail", "I/O Board Fail", True),
        # plainly different
        ("ground fault", "UnderVoltage", False),
    ],
)
def test_agreement_is_equality_not_substring(claimed, truth, agrees):
    """A claim must NAME the fault, not merely contain its name.

    Every False row here passed as agreement before #3332 F2.
    """
    assert _agrees(claimed, truth, tuple(_pack_fault_names().values())) is agrees


@pytest.mark.parametrize(
    ("line", "expect_violation"),
    [
        # punctuation-hidden contradictions (Codex #3332 round 3). The capture
        # class stops at a comma/colon/paren, so each of these presents a clean
        # correct name and refutes it just outside the capture.
        ("F004 = UnderVoltage, not OverVoltage", True),
        ("F004 = UnderVoltage (actually OverVoltage)", True),
        ("F013 = Ground Fault: not Ground Fault", True),
        ("F004 = UnderVoltage / OverVoltage", True),  # round 2, still caught
        # legitimate claims that must stay quiet
        ("F013 = Ground Fault", False),
        ("F004 = Under Voltage", False),
        ("F122 = I/O Board Fail", False),  # the one pack name containing "/"
        ("F013 = Ground Fault (see manual p.161)", False),  # benign parenthetical
        # real line from docs/audits/ — correct claim, checklist prose after it
        ("| `/x` | HTTP 200; F004=UnderVoltage sample present; IMPORT HELD |", False),
    ],
)
def test_scanner_sees_past_punctuation(line, expect_violation):
    """Exercises the SCANNER path, not just `_agrees` in isolation.

    The round-3 defect lived in the boundary between the two: `_agrees` was
    correct, and never saw the contradicting text because the capture ended at a
    comma. Testing the helper alone would not have caught it.
    """
    names = _pack_fault_names()
    all_names = tuple(names.values())
    violations = []
    for m in _CLAIM_RE.finditer(line):
        code = f"F{int(m.group(1)):03d}"
        truth = names.get(code)
        if truth is None:
            continue
        if not _agrees(m.group(2).strip(), truth, all_names, tail=_claim_tail(line, m.end())):
            violations.append(code)
    assert bool(violations) is expect_violation
