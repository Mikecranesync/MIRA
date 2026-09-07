"""Map real rendered markup onto the semantic roles detectors ask for.

Why this layer exists
---------------------
Detectors should not know CSS class names, and fixtures should not be written
in a vocabulary the product never emits. An earlier draft of this package
invented `data-fl-citation-label`; nothing in the app produces it, so every
detector built on it would have been green forever against a marker that does
not exist — a fixture written in a language only the test speaks.

So fixtures carry the REAL markup (verified against
`packages/factorylm-ui/src/parts.tsx` and `Conversation.tsx`), and this module
does the mapping. When the markup moves, this file changes and the detectors
do not.

Verified anchors, read off the components on 2026-09-07:

  source chip   button[data-part-type="source"]
                  > span.fl-source__kind      ("OEM" | "FILE" | "HIST")
                  > span                       (the TITLE — the only unclassed span)
                  > span.fl-source__locator   ("p. 14")
  evidence basis span[data-part-type="evidence_basis"][data-basis-kind][data-authorized]
  turn context  .fl-turn__head > span.fl-card__meta  ("No machine context" | "<machine> · …")

The title is positional in the DOM, which is brittle: adding one span shifts
it. We therefore derive it by SUBTRACTION — full chip text minus the classed
spans — so an added span cannot silently retarget the detector.
"""

from __future__ import annotations

from .snapshot import Node, Snapshot

#: Semantic roles detectors may ask for.
CITATION_LABEL = "citation-label"
CONTEXT_LABEL = "context-label"
ANSWER = "answer"
EVIDENCE_BASIS = "evidence-basis"


def _classes(node: Node) -> set[str]:
    return set((node.attrs.get("class") or "").split())


def derive_role(node: Node, snapshot: Snapshot) -> str | None:
    """The semantic role of a rendered node, or None when it carries no role."""
    part_type = node.attrs.get("data-part-type")

    if part_type == "source":
        return CITATION_LABEL
    if part_type == "evidence_basis":
        return EVIDENCE_BASIS
    if "fl-turn__parts" in _classes(node):
        return ANSWER
    if "fl-card__meta" in _classes(node) and node.attrs.get("data-turn-head") == "":
        return CONTEXT_LABEL
    if node.attrs.get("data-context-site"):
        # breadcrumb / title / machine pill / composer "Using:" line — the four
        # sites the mobile teardown found rendering one identifier.
        return CONTEXT_LABEL
    return None


def citation_title(chip: Node, children: list[Node]) -> str:
    """The document name inside a source chip, derived by subtraction.

    `chip.text` is the whole chip ("FILE  nameplate-….txt  p. 1"). The kind and
    locator spans are classed and therefore identifiable; whatever remains is
    the title. Position is never used.
    """
    remainder = chip.text
    for child in children:
        classes = _classes(child)
        if "fl-source__kind" in classes or "fl-source__locator" in classes:
            if child.text:
                remainder = remainder.replace(child.text, " ", 1)
    return " ".join(remainder.split()).strip()


def children_of(snapshot: Snapshot, parent_id: str) -> list[Node]:
    return [n for n in snapshot.nodes if n.attrs.get("data-parent") == parent_id]


def select(snapshot: Snapshot, role: str) -> list[Node]:
    """Visible nodes carrying `role`. May legitimately be empty."""
    return [n for n in snapshot.visible_nodes() if derive_role(n, snapshot) == role]


def require(snapshot: Snapshot, role: str) -> list[Node]:
    """`select`, but zero matches is an error rather than a clean result.

    This is the guard against the commonest way an outside-in check silently
    stops checking: the markup moves, the anchor matches nothing, and "no
    defects" is reported about a screen nobody looked at.
    """
    from .snapshot import SnapshotError  # local import keeps this module leaf-ish

    found = select(snapshot, role)
    if not found:
        raise SnapshotError(
            f"no visible node derives the role {role!r} on route {snapshot.route!r} "
            f"({snapshot.surface} {snapshot.viewport[0]}x{snapshot.viewport[1]}). "
            "The detector cannot see its subject; this is UNKNOWN, not PASS."
        )
    return found
