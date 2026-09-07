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
                — class on the node, class on its PARENT. `fl-card__meta` alone is
                  far too broad (16 uses); the parent is what makes it a turn header.

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
    return node.classes()


def _parent(snapshot: Snapshot, node: Node) -> Node | None:
    if not node.parent_id:
        return None
    return next((n for n in snapshot.nodes if n.id == node.parent_id), None)


def derive_role(node: Node, snapshot: Snapshot) -> str | None:
    """The semantic role of a node, or None when it carries no role.

    Every branch keys on markup the product emits — verified by scanning
    `packages/` and `mira-mobile/src`. An earlier version had two branches on
    `data-turn-head` and `data-context-site`, which have ZERO occurrences in the
    app. They were the only routes to CONTEXT_LABEL, so against a real snapshot
    nothing ever derived that role and the repetition detector reported UNKNOWN
    forever. It failed closed, which is right, but it could never have judged
    the defect it exists for. See `test_derive_anchors_exist_in_the_product`.
    """
    part_type = node.attrs.get("data-part-type")

    if part_type == "source":
        return CITATION_LABEL
    if part_type == "evidence_basis":
        return EVIDENCE_BASIS
    if "fl-turn__parts" in _classes(node):
        return ANSWER

    parent = _parent(snapshot, node)
    if "fl-card__meta" in _classes(node) and parent and "fl-turn__head" in _classes(parent):
        return CONTEXT_LABEL
    return None


#: Every class/attribute `derive_role` and `citation_title` key on. The guard in
#: the test suite asserts each one occurs in the product, so an invented anchor
#: cannot be reintroduced silently.
DERIVE_ANCHORS = (
    "data-part-type",
    "fl-turn__parts",
    "fl-card__meta",
    "fl-turn__head",
    "fl-source__kind",
    "fl-source__locator",
)


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
    return [n for n in snapshot.nodes if n.parent_id == parent_id]


def is_ancestor(snapshot: Snapshot, ancestor_id: str, node: Node) -> bool:
    """True when `ancestor_id` is above `node`. Guards against double counting:
    a parent's text contains its children's, so an ancestor/descendant pair is
    one rendering, not two."""
    seen: set[str] = set()
    current = node
    while current.parent_id and current.parent_id not in seen:
        if current.parent_id == ancestor_id:
            return True
        seen.add(current.parent_id)
        nxt = _parent(snapshot, current)
        if nxt is None:
            return False
        current = nxt
    return False


def select(snapshot: Snapshot, role: str) -> list[Node]:
    """Visible nodes carrying `role`. May legitimately be empty."""
    return [n for n in snapshot.rendered_nodes() if derive_role(n, snapshot) == role]


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
