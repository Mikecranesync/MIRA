"""Manual truth table — was the RIGHT manual found, used, and cited?

One manual-first turn passes through five stages. A failed turn has exactly one
EARLIEST broken stage, and that stage — not the symptom — is what a fix targets:

  identify  -> did MIRA propose which machine this is?
  find      -> did a manual for it reach "ready"?
  document  -> does that manual actually CONTAIN the asked-for code?   <- 2026-10-04
  retrieve  -> did the turn's evidence hold it?
  cite      -> does a cited passage hold the code AND its meaning?

plus one cross-cutting rule, `honesty`: with no supporting citation, the answer
must not assert what the code means.

WHY THE `document` STAGE EXISTS (2026-10-04, Golden Walk + Pixel 9a)
The acquisition judge (mira-bots/shared/manual_search/judge.py) asks one
question — "is this a user manual for THIS model?" — and stops at the first yes.
A PowerFlex 525 COMMUNICATIONS manual (520COM-UM001, 398 chunks, zero contain
"F005"), a Portuguese ACS580 firmware manual and an ATV320 Getting Started guide
all truthfully answer yes. MIRA then honestly says "the excerpts do not define
F005" — correct behaviour on the wrong book. Without this stage that turn reads
as a retrieval miss and the fix lands in the wrong place.

WHO DECIDES EACH CELL
Deterministic wherever a deterministic check exists (zero-token rule):
`document` is a whole-token search of the scoped document's indexed chunks, not
a judgment. Jev decides only what code cannot: when the document holds the code
but no citation did, was the evidence missing from the turn (retrieval) or
present and unused (generation)? `jev_sufficient` (shadow, #3949) answers that.
Jev's cells are recorded beside the deterministic ones so the two can be scored
against each other; a Jev value never overrides a deterministic cell.

KNOWN LIMITS
- `meaning` keywords are English. A correct Portuguese citation fails `cite`.
- `asserted` is a phrase heuristic over the answer text: it catches "F30002 is a
  motor overload fault" and misses a definition that never repeats the code.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass

TRUTH_TABLE_VERSION = "manual-truth-v1"

# Jev's `jev_sufficient` is a probability; below this the evidence did not hold
# the answer. PROVISIONAL — the midpoint, same as jev-candidates.ts, not fitted.
JEV_LOW = 0.5

_DECLINE = re.compile(
    r"\b(do(?:es)? not (?:define|contain|list|include|mention|cover)|"
    r"(?:is|are) not (?:defined|listed|included|in the)|"
    r"(?:don't|do not|can't|cannot|couldn't|could not) (?:have|find|see|confirm|pull up)|"
    r"no (?:definition|mention|entry)|not (?:found|available) in)\b",
    re.I,
)


def asserts_meaning(answer: str, code_present: bool) -> bool:
    """The answer names the code and says what it means, rather than declining.

    `code_present` is the caller's whole-token test of the code in the answer;
    an answer that never names the code is not counted (stated limit)."""
    return code_present and not _DECLINE.search(answer or "")


@dataclass(frozen=True)
class Cells:
    expect_manual: bool
    identified: bool
    found: bool
    # None = not checked (no manual, or the chunk probe was unavailable).
    document_has_code: bool | None
    cited: bool
    citation_true: bool
    asserted: bool
    # Jev shadow (`packet.answer_gate.jev_sufficient`); None when it did not run.
    jev_sufficient: float | None = None


@dataclass(frozen=True)
class Verdict:
    verdict: str
    stage: str  # earliest broken stage, or "none"
    honest: bool  # False = the answer claimed more than its evidence
    decided_by: str  # "deterministic" | "jev" | "unknown"
    jev_agrees: bool | None  # None when the row makes no prediction about Jev
    version: str = TRUTH_TABLE_VERSION

    def as_dict(self) -> dict:
        return asdict(self)


def _jev_low(c: Cells) -> bool | None:
    return None if c.jev_sufficient is None else c.jev_sufficient < JEV_LOW


def classify(c: Cells) -> Verdict:
    """First matching row wins; rows are ordered by stage."""
    jl = _jev_low(c)
    if not c.expect_manual:  # a machine that does not exist: only honesty is scored
        if c.cited:
            return Verdict("CITED_NONEXISTENT", "cite", False, "deterministic", None)
        if c.asserted:
            return Verdict("UNGROUNDED_ASSERTION", "honesty", False, "deterministic", None)
        return Verdict("PASS", "none", True, "deterministic", None)
    if c.citation_true:
        # Evidence held the answer, so a working sufficiency judge says high.
        return Verdict("PASS", "none", True, "deterministic", None if jl is None else not jl)
    if c.cited:
        return Verdict("MISCITATION", "cite", False, "deterministic", None)
    # No supporting citation from here on: an asserted meaning is ungrounded.
    honest = not c.asserted
    if not c.identified:
        return Verdict("NO_IDENTITY", "identify", honest, "deterministic", None)
    if not c.found:
        return Verdict("NOT_FOUND", "find", honest, "deterministic", None)
    if c.document_has_code is False:
        # The code is not in the book, so no retrieved excerpt can hold it.
        return Verdict("WRONG_DOCUMENT", "document", honest, "deterministic", jl)
    if c.document_has_code is None:
        return Verdict("UNVERIFIED_DOCUMENT", "document", honest, "unknown", None)
    # The book holds the code and nothing cited it: only a relevance judgment
    # can say whether the turn's evidence held it.
    if jl is None:
        return Verdict("RETRIEVAL_OR_GENERATION", "retrieve", honest, "unknown", None)
    if jl:
        return Verdict("RETRIEVAL_MISS", "retrieve", honest, "jev", None)
    return Verdict("EVIDENCE_IGNORED", "cite", honest, "jev", None)
