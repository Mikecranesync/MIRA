"""E-1 — a citation must name the document, not identify it.

Observed on a Pixel 9a, production 1.1.0, 2026-09-07:

    FILE   nameplate-12ac8c22-018a-4104-a247-d81c37bdb292.txt      p. 1

under the answer "Serial number 49849 is listed on the nameplate [1]." The
marker, the kind label and the page number are all correct. The *name* is a
database key. A technician cannot tell which manual that is, cannot say it
aloud to a colleague, and cannot check it — which is the whole commercial
claim ("diagnose with cited sources") rendered as an internal identifier.

This is deliberately a shape check, not a quality one. It cannot tell a good
title from a bad one; it can only tell that we showed an id where a name
belongs. That is exactly the part that needs no taste, so it can gate.
"""

from __future__ import annotations

from ..derive import CITATION_LABEL, children_of, citation_title, require
from ..snapshot import UUID_RE, Snapshot
from .base import Finding, Verdict

TEST_ID = "E-1"

#: Other machine-identifier shapes that are equally unreadable to a technician.
_BARE_ID_HINTS = (
    "urn:",
    "sha256:",
)


def _looks_like_an_identifier(label: str) -> str | None:
    """Return the offending substring, or None when the label reads as a name."""
    match = UUID_RE.search(label)
    if match:
        return match.group(0)
    lowered = label.lower()
    for hint in _BARE_ID_HINTS:
        if hint in lowered:
            return hint
    # A long unbroken hex run is an id even without UUID dashes.
    for token in label.replace("/", " ").replace("_", " ").replace(".", " ").split():
        if len(token) >= 24 and all(c in "0123456789abcdefABCDEF" for c in token):
            return token
    return None


def detect_citation_identity(snapshot: Snapshot) -> Finding:
    """FAIL when any visible citation label identifies rather than names."""
    labels = require(snapshot, CITATION_LABEL)

    offenders: list[str] = []
    for node in labels:
        text = citation_title(node, children_of(snapshot, node.id))
        if not text:
            offenders.append(f"{node.id}: citation label is empty")
            continue
        offending = _looks_like_an_identifier(text)
        if offending:
            offenders.append(f"{node.id}: {text!r} contains {offending!r}")

    if offenders:
        return Finding(
            detector="citation_identity",
            test_id=TEST_ID,
            verdict=Verdict.FAIL,
            summary=(
                f"{len(offenders)} of {len(labels)} citation label(s) show a machine "
                "identifier where a document name belongs"
            ),
            evidence=tuple(offenders),
        )

    return Finding(
        detector="citation_identity",
        test_id=TEST_ID,
        verdict=Verdict.PASS,
        summary=f"{len(labels)} citation label(s) name a document",
    )


detect_citation_identity.test_id = TEST_ID  # type: ignore[attr-defined]
