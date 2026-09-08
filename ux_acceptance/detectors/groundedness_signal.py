"""E-2 — a cited answer and a general-knowledge answer must not look identical.

Observed on mobile, 2026-09-07: no groundedness signal renders at all. An
answer backed by a manual and an answer from model general knowledge are
typographically identical. For a product whose claim is grounded, cited
answers, that is a trust failure rather than a styling one — a wrong torque
spec has physical consequences, so "the manual says" must be visibly different
from "generally speaking" *in the answer*, not inferred from the absence of a
chip.

The shell already has the mechanism. `packages/factorylm-ui/src/parts.tsx:139`
renders an `evidence_basis` part carrying `data-basis-kind` and
`data-authorized`. So the defect is that the part is not EMITTED per turn on
mobile, not that the component lacks a way to say it. That distinction matters:
this detector looks for a missing part, not a missing attribute.

Absence of a citation chip is deliberately NOT treated as a signal. It is
indistinguishable from a citation that failed to render — which is exactly the
state the mobile walk was in. The claim has to be made positively.
"""

from __future__ import annotations

from ..derive import ANSWER, EVIDENCE_BASIS, require, select
from ..snapshot import Snapshot
from .base import Finding, Verdict

TEST_ID = "E-2"

#: The kinds `data-basis-kind` may carry.
VALID_KINDS = frozenset({"cited", "partial", "general", "none"})


def detect_groundedness_signal(snapshot: Snapshot) -> Finding:
    """FAIL when answers do not each declare a visible evidence basis."""
    answers = require(snapshot, ANSWER)
    bases = select(snapshot, EVIDENCE_BASIS)

    if not bases:
        return Finding(
            detector="groundedness_signal",
            test_id=TEST_ID,
            verdict=Verdict.FAIL,
            summary=(
                f"{len(answers)} answer(s) render with no evidence_basis part at all — "
                "a manual-cited answer and a general-knowledge answer are "
                "typographically identical"
            ),
            evidence=tuple(f"{n.id}: no evidence basis" for n in answers),
        )

    if len(bases) < len(answers):
        return Finding(
            detector="groundedness_signal",
            test_id=TEST_ID,
            verdict=Verdict.FAIL,
            summary=(
                f"only {len(bases)} of {len(answers)} answer(s) declare an evidence "
                "basis; the rest state nothing, which reads as general knowledge"
            ),
        )

    invalid = [
        f"{n.id}: data-basis-kind={n.attrs.get('data-basis-kind')!r} not in {sorted(VALID_KINDS)}"
        for n in bases
        if n.attrs.get("data-basis-kind") not in VALID_KINDS
    ]
    if invalid:
        return Finding(
            detector="groundedness_signal",
            test_id=TEST_ID,
            verdict=Verdict.FAIL,
            summary=f"{len(invalid)} evidence basis part(s) carry an unrecognised kind",
            evidence=tuple(invalid),
        )

    # Declared is not the same as shown. Two different bases that render with
    # one identical treatment leave the technician unable to tell them apart.
    kinds = {n.attrs.get("data-basis-kind") for n in bases}
    if len(kinds) > 1:
        treatments = {
            (
                n.style.get("color", ""),
                n.style.get("background-color", ""),
                "fl-pill--primary" in (n.attrs.get("class") or ""),
            )
            for n in bases
        }
        if len(treatments) == 1:
            return Finding(
                detector="groundedness_signal",
                test_id=TEST_ID,
                verdict=Verdict.FAIL,
                summary=(
                    f"{len(kinds)} distinct evidence bases render with one identical "
                    "visual treatment — declared but not shown"
                ),
                evidence=tuple(sorted(str(k) for k in kinds)),
            )

    return Finding(
        detector="groundedness_signal",
        test_id=TEST_ID,
        verdict=Verdict.PASS,
        summary=f"{len(answers)} answer(s) declare a valid, visually distinct basis",
    )


detect_groundedness_signal.test_id = TEST_ID  # type: ignore[attr-defined]
