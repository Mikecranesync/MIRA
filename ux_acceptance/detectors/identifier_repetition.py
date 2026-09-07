"""S3-03 — the same fact must not be rendered more than once per viewport.

Observed on a Pixel 9a, 2026-09-07: "Sensor v0 overnight 2026-08-28" appeared
FOUR times in the top third of one screen — as the header title (wrapping to
three lines), the breadcrumb, a green `confirmed` pill, and the composer's
"Using:" line — plus a fifth time in a turn header.

The cause is structural rather than cosmetic: four components each decided the
context mattered and none composes with the others. On a 412px screen that
redundancy costs over 100px of vertical space and makes the technician read the
same string four times to learn nothing new.

Scope note: this counts CONTEXT-BEARING labels only, via `data-fl-context-label`.
Counting every string on screen would flag legitimate repeats — a column header
that matches a cell, a word appearing in prose — and a detector that cries wolf
is one the team turns off.
"""

from __future__ import annotations

from collections import Counter

from ..derive import CONTEXT_LABEL, require
from ..snapshot import Snapshot
from .base import Finding, Verdict

TEST_ID = "S3-03"

#: One rendering is the intent. Two is a decision nobody made.
MAX_RENDERINGS = 1


def _normalise(text: str) -> str:
    return " ".join(text.split()).strip().casefold()


#: Below this length a string is a fragment, not an identifier, and would be
#: contained in everything.
MIN_IDENTIFIER_LEN = 8


def detect_identifier_repetition(snapshot: Snapshot) -> Finding:
    """FAIL when one identifier is rendered more than `MAX_RENDERINGS` times.

    Matching is by CONTAINMENT, not equality — and that distinction is the
    whole detector. The four observed renderings were:

        "Sensor v0 overnight 2026-08-28"
        "Notebooks / Sensor v0 overnight 2026-08-28"
        "Sensor v0 overnight 2026-08-28 · confirmed"
        "Using: Sensor v0 overnight 2026-08-28"

    Four *distinct strings* carrying one repeated *identifier*. An equality
    match reports four unique labels and passes — which is what the first
    version of this function did, against the fixture built from the real
    device. Each component wraps the identifier in its own chrome, so the
    repetition only exists at the substring level.
    """
    labels = require(snapshot, CONTEXT_LABEL)

    texts = [(n.id, _normalise(n.text)) for n in labels]
    non_empty = [(nid, t) for nid, t in texts if t]

    if not non_empty:
        return Finding(
            detector="identifier_repetition",
            test_id=TEST_ID,
            verdict=Verdict.UNKNOWN,
            summary=(
                f"{len(labels)} context label(s) present but all empty — the extractor "
                "found the elements and no text; that is a blind read, not a clean one"
            ),
        )

    # A candidate identifier is any label's own text. Count how many labels
    # render it, itself included.
    offenders: list[str] = []
    worst = 1
    for nid, candidate in non_empty:
        if len(candidate) < MIN_IDENTIFIER_LEN:
            continue
        carriers = [other_id for other_id, other in non_empty if candidate in other]
        if len(carriers) > MAX_RENDERINGS:
            worst = max(worst, len(carriers))
            offenders.append(
                f"{candidate!r} rendered {len(carriers)}x at {', '.join(carriers)}"
            )

    # Deduplicate: when two labels carry the same identifier, both nominate it.
    seen_sets: set[tuple[str, ...]] = set()
    unique_offenders: list[str] = []
    for line in offenders:
        key = tuple(sorted(line.split(" at ")[-1].split(", ")))
        if key not in seen_sets:
            seen_sets.add(key)
            unique_offenders.append(line)

    if unique_offenders:
        return Finding(
            detector="identifier_repetition",
            test_id=TEST_ID,
            verdict=Verdict.FAIL,
            summary=(
                f"{len(unique_offenders)} identifier(s) repeat in one viewport "
                f"(worst: {worst}x)"
            ),
            evidence=tuple(unique_offenders),
        )

    return Finding(
        detector="identifier_repetition",
        test_id=TEST_ID,
        verdict=Verdict.PASS,
        summary=f"{len(non_empty)} context label(s), no identifier repeated",
    )


detect_identifier_repetition.test_id = TEST_ID  # type: ignore[attr-defined]
