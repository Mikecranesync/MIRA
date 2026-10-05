"""S3-03 — the same identifier must not be rendered more than once per viewport.

Observed on a Pixel 9a, 2026-09-07: "Sensor v0 overnight 2026-08-28" appeared
FOUR times in the top third of one screen — the header title (wrapping to three
lines), the breadcrumb, a green `confirmed` pill, and the composer's "Using:"
line — plus a fifth in a turn header. Four components each decided the context
mattered; none composes with the others. On a 412px screen that costs over
100px of vertical space to tell the technician one thing four times.

Two design decisions, both learned the hard way.

**Containment, not equality.** The first version compared whole strings, saw
four distinct ones, and passed against the fixture built from the real device.
The renderings wrap one identifier in different chrome — "Notebooks / X",
"X · confirmed", "Using: X".

**No marker to key on.** The second version invented `data-context-site`. The
product emits nothing of the kind, so nothing ever derived the role and this
detector reported UNKNOWN forever — failing closed, but structurally unable to
judge the defect it exists for. There is no attribute marking these four sites,
so repetition is found across rendered text instead, with ancestry excluded: a
parent's text contains its children's, and that is one rendering, not two.

**Sites, not nodes.** The third version counted carrier nodes, and would have
FAILED the repaired product. Each turn is an `li.fl-turn` with its own
`.fl-turn__head > .fl-card__meta` context line (Conversation.tsx), so a
five-turn thread renders that line five times — and renders a BOUND machine's
name five times too. Fixing the underlying defect by binding a machine would
have kept the detector red. A gate that fails on the repaired product gets
muted, which is the same death as a gate that cannot fail, approached from the
other side. So carriers are grouped by render SITE (ancestry signature):
four components rendering one string is the defect; one component rendering it
once per turn is a list doing its job.
"""

from __future__ import annotations

from ..derive import is_ancestor, site_signature
from ..snapshot import Snapshot
from .base import Finding, Verdict

TEST_ID = "S3-03"

#: One rendering is the intent. Two is a decision nobody made.
MAX_RENDERINGS = 1

#: Below this length a string is a fragment and would be contained in everything.
MIN_IDENTIFIER_LEN = 8


def _normalise(text: str) -> str:
    return " ".join(text.split()).strip().casefold()


def detect_identifier_repetition(snapshot: Snapshot) -> Finding:
    """FAIL when one identifier renders more than `MAX_RENDERINGS` times."""
    texts = [
        (n, _normalise(n.text)) for n in snapshot.rendered_nodes() if n.text.strip()
    ]
    if not texts:
        return Finding(
            detector="identifier_repetition",
            test_id=TEST_ID,
            verdict=Verdict.UNKNOWN,
            summary=(
                "no rendered node carries text — an empty screen is an extractor "
                "failure, not a clean result"
            ),
        )

    offenders: list[str] = []
    worst = 1
    seen_groups: set[tuple[str, ...]] = set()

    for node, candidate in texts:
        if len(candidate) < MIN_IDENTIFIER_LEN:
            continue
        carriers = [
            other
            for other, other_text in texts
            if candidate in other_text
            and not is_ancestor(snapshot, other.id, node)
            and not is_ancestor(snapshot, node.id, other)
            or other.id == node.id
        ]
        # Group carriers by render SITE. Repetition down a list is one site.
        by_site: dict[tuple, list[str]] = {}
        for carrier in {c.id: c for c in carriers}.values():
            by_site.setdefault(site_signature(snapshot, carrier), []).append(carrier.id)

        if len(by_site) > MAX_RENDERINGS:
            key = tuple(sorted(tuple(sorted(v)) for v in by_site.values()))
            if key in seen_groups:
                continue
            seen_groups.add(key)
            worst = max(worst, len(by_site))
            where = "; ".join(", ".join(sorted(ids)) for ids in by_site.values())
            offenders.append(
                f"{candidate!r} rendered by {len(by_site)} distinct site(s) at {where}"
            )

    if offenders:
        return Finding(
            detector="identifier_repetition",
            test_id=TEST_ID,
            verdict=Verdict.FAIL,
            summary=(
                f"{len(offenders)} identifier(s) rendered by multiple components in one "
                f"viewport (worst: {worst}x)"
            ),
            evidence=tuple(offenders),
        )

    return Finding(
        detector="identifier_repetition",
        test_id=TEST_ID,
        verdict=Verdict.PASS,
        summary=f"{len(texts)} rendered text node(s), no identifier repeated",
    )


detect_identifier_repetition.test_id = TEST_ID  # type: ignore[attr-defined]
