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


def site_signature(snapshot: Snapshot, node: Node) -> tuple[tuple[str, tuple[str, ...]], ...]:
    """A node's RENDER SITE: its ancestry as (tag, classes), root-ward.

    Two carriers of the same string are the same *site* when their signatures
    match — one component rendering repeatedly down a list. They are different
    sites when the signatures differ — different components each deciding the
    same fact mattered.

    This is the distinction between spatial and temporal repetition, and it is
    the one the teardown actually drew. Each turn is an `li.fl-turn` carrying
    its own `.fl-turn__head > .fl-card__meta` context line, so a five-turn
    thread renders that line five times legitimately — and would render a
    BOUND machine's name five times too. Counting nodes fails the repaired
    product; counting sites does not.
    """
    chain: list[tuple[str, tuple[str, ...]]] = []
    seen: set[str] = set()
    current: Node | None = node
    while current is not None and current.id not in seen:
        seen.add(current.id)
        chain.append((current.tag, tuple(sorted(current.classes()))))
        current = _parent(snapshot, current)
    return tuple(chain)


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


# ---------------------------------------------------------------------------
# Coverage over the closed part vocabulary.
#
# `DERIVE_ANCHORS` proves anchor -> product: nothing we key on is invented.
# It proves nothing in the other direction. A part the product renders and this
# module does not map produces a false PASS, which is strictly worse than the
# permanent UNKNOWN an invented anchor caused, because a missed site reads as a
# clean screen.
#
# `InteractionPart` (packages/factorylm-interaction/src/types.ts) is a CLOSED
# union, so product -> anchor is decidable: every member is either mapped below
# or carries a written reason for being out of scope. Default-deny, so a new
# part type fails the day it lands rather than at the next audit.
# ---------------------------------------------------------------------------

#: Part types this module derives a role from.
PART_ROLE: dict[str, str] = {
    "source": CITATION_LABEL,
    "evidence_basis": EVIDENCE_BASIS,
}

#: Part types deliberately unmapped, each with the reason. Being listed here is
#: a decision, not an omission — that distinction is the whole point of the file.
PART_OUT_OF_SCOPE: dict[str, str] = {
    "text": "prose; carries no identifier a detector can judge",
    "attachment": "filename display is C-4's subject, not a detector built here yet",
    "safety_notice": "safety copy — reviewed by the safety lane, not by a UX detector",
    "tool_call": "internal mechanics; not a technician-facing claim",
    "tool_result": "internal mechanics; not a technician-facing claim",
    "approval_request": "train-before-deploy surface, governed by its own rule",
    "plan": "Work-mode structure; no citation or context claim",
    "plan_step": "Work-mode structure; no citation or context claim",
    "hypothesis": "reasoning display; carries no document or asset identifier",
    "status": "renders a lifecycle enum, never a free-text identifier",
    "usage": "token accounting; never technician-facing",
    "error": "error copy is G-1..G-5's subject; no detector built here yet",
    "followups": "model-authored suggestion strings; no identifier or citation claim",
    "identity_dispute": "presence-only marker; renders no identifier",
    "unknown": "the union's own fallback member",
    # --- these render titles that CAN carry a raw id. Not yet mapped, and that
    # --- is a gap with a name rather than an oversight. See #3669 discussion.
    "machine_evidence": "GAP: renders a title that can carry a raw id — detector 1 cannot see it",
    "visual_observation": "GAP: renders a title that can carry a raw id — detector 1 cannot see it",
    "observation": "GAP: renders a title that can carry a raw id — detector 1 cannot see it",
    "finding": "GAP: renders a title that can carry a raw id — detector 1 cannot see it",
    "artifact": "GAP: renders artifact names — the most likely second home of the E-1 UUID",
    "context_change": "GAP: renders describeContext (parts.tsx:258) — a third context site "
                      "detector 2 cannot currently count",
}
