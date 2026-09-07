"""The screen snapshot contract.

One shape, produced by two drivers (Playwright `page.evaluate`, or CDP
`Runtime.evaluate` against the WebView) so web and mobile are judged by
identical code. `extract.js` is the browser-side producer.

Design note — why selector resolution fails closed
--------------------------------------------------
The cheapest way for a detector to be wrong is to look for something with a
selector that matches nothing and report "no defect found". That reads exactly
like a pass. Detectors therefore resolve roles through `derive.require()`,
which raises when nothing derives the role. A detector that cannot see its
subject reports UNKNOWN, never PASS.

This module deliberately exposes NO marker-matching helpers. An earlier draft
had `has_marker`/`with_marker`/`require` keyed on invented `data-fl-*`
attributes; they were left behind after the rebuild, dead but documented, which
is how a future author walks back into a vocabulary the product never emits.

Two fields exist because one word was covering two questions:

* ``rendered``  — the box is non-empty and display/visibility/opacity allow paint.
* ``hittable``  — ``document.elementFromPoint`` at the node's centre returns this
  node or a descendant.

They differ exactly when it matters. ``.fl-scrim`` is ``position: fixed; inset: 0``
(shell.css:22-25) and ``Overlay.tsx:62`` sets ``inert`` only while a modal layer is
CLOSED — so with the drawer open the main content is rendered, not inert, not
aria-hidden, and completely unreachable. A display-derived check calls all of it
visible. That is the 42 phantom dead controls, and collapsing the two fields is
how it would arrive here.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional

SCHEMA_VERSION = 1

#: A raw UUID as it appears inside a filename or label.
UUID_RE = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
    re.IGNORECASE,
)


class SnapshotError(ValueError):
    """The snapshot is unusable. Never downgrade this to a pass."""


@dataclass(frozen=True)
class Box:
    x: float
    y: float
    w: float
    h: float

    @property
    def area(self) -> float:
        return self.w * self.h


@dataclass(frozen=True)
class Node:
    """One rendered element. `text` is the element's own visible text."""

    id: str
    tag: str
    text: str = ""
    #: Extractor-synthesized parentage. NOT in `attrs`, because `attrs` means
    #: "what the product emits" and a synthesized key there would force the
    #: vocabulary guard to whitelist it — a hole in the guard meant to catch
    #: invented attributes.
    parent_id: Optional[str] = None
    role: Optional[str] = None
    attrs: dict[str, str] = field(default_factory=dict)
    style: dict[str, str] = field(default_factory=dict)
    box: Optional[Box] = None
    #: Paints. Says nothing about whether a technician can touch it.
    rendered: bool = True
    #: `elementFromPoint` at the centre returns this node or a descendant.
    hittable: bool = True

    def attr(self, name: str) -> Optional[str]:
        return self.attrs.get(name)

    def classes(self) -> set[str]:
        return set((self.attrs.get("class") or "").split())


@dataclass(frozen=True)
class Snapshot:
    """Everything a detector is allowed to see.

    `build_sha` is not decoration. A presentation verdict about an
    unidentifiable build is worse than no verdict, so it is required and
    validated — see docs/specs/chatgpt-class-ux-acceptance.md §2.4.
    """

    build_sha: str
    viewport: tuple[int, int]
    surface: str  # "web" | "mobile"
    route: str
    nodes: tuple[Node, ...]
    #: Which computed-style properties the extractor actually captured. A
    #: snapshot taken with two properties and one taken with twelve are
    #: otherwise indistinguishable, so a detector could PASS on a snapshot that
    #: never captured the property it reads. Detectors declare what they need
    #: and `require_style` raises on absent CAPTURE, distinct from absent value.
    style_properties: frozenset[str] = frozenset()
    schema_version: int = SCHEMA_VERSION

    # -- construction ----------------------------------------------------

    @staticmethod
    def from_dict(raw: dict[str, Any]) -> "Snapshot":
        if not isinstance(raw, dict):
            raise SnapshotError("snapshot must be an object")

        version = raw.get("schemaVersion")
        if version != SCHEMA_VERSION:
            raise SnapshotError(
                f"schemaVersion {version!r} != {SCHEMA_VERSION}; refusing to judge "
                "a snapshot whose shape this detector does not understand"
            )

        sha = raw.get("buildSha")
        if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{40}", sha):
            raise SnapshotError(
                f"buildSha {sha!r} is not a 40-char hex commit sha — a verdict about "
                "an unidentifiable build is not a verdict"
            )

        vp = raw.get("viewport") or {}
        try:
            viewport = (int(vp["width"]), int(vp["height"]))
        except (KeyError, TypeError, ValueError) as exc:
            raise SnapshotError(f"viewport missing or malformed: {vp!r}") from exc

        surface = raw.get("surface")
        if surface not in ("web", "mobile"):
            raise SnapshotError(f"surface must be 'web' or 'mobile', got {surface!r}")

        raw_nodes = raw.get("nodes")
        if not isinstance(raw_nodes, list) or not raw_nodes:
            raise SnapshotError(
                "snapshot has no nodes — an empty screen is an extractor failure, "
                "not a clean result"
            )

        style_props = raw.get("styleProperties")
        if not isinstance(style_props, list):
            raise SnapshotError(
                "styleProperties missing — without it a detector cannot tell an "
                "absent value from a property the extractor never captured"
            )

        nodes = tuple(Snapshot._node(n, i) for i, n in enumerate(raw_nodes))
        return Snapshot(
            build_sha=sha,
            viewport=viewport,
            surface=surface,
            route=str(raw.get("route", "")),
            nodes=nodes,
            style_properties=frozenset(str(p) for p in style_props),
        )

    @staticmethod
    def _node(raw: dict[str, Any], index: int) -> Node:
        if not isinstance(raw, dict):
            raise SnapshotError(f"node[{index}] is not an object")
        box_raw = raw.get("box")
        box = None
        if isinstance(box_raw, dict):
            try:
                box = Box(
                    float(box_raw["x"]),
                    float(box_raw["y"]),
                    float(box_raw["w"]),
                    float(box_raw["h"]),
                )
            except (KeyError, TypeError, ValueError) as exc:
                raise SnapshotError(f"node[{index}] box malformed: {box_raw!r}") from exc
        for required in ("rendered", "hittable"):
            if required not in raw:
                raise SnapshotError(
                    f"node[{index}] ({raw.get('id')!r}) has no {required!r}. A node the "
                    "extractor could not measure must not default to visible — a "
                    "partial extraction would make detectors see MORE, not less."
                )
        return Node(
            id=str(raw.get("id", f"n{index}")),
            tag=str(raw.get("tag", "")).lower(),
            text=str(raw.get("text", "")),
            parent_id=(str(raw["parentId"]) if raw.get("parentId") else None),
            role=raw.get("role"),
            attrs={str(k): str(v) for k, v in (raw.get("attrs") or {}).items()},
            style={str(k): str(v) for k, v in (raw.get("style") or {}).items()},
            box=box,
            rendered=bool(raw["rendered"]),
            hittable=bool(raw["hittable"]),
        )

    # -- querying --------------------------------------------------------

    def rendered_nodes(self) -> Iterable[Node]:
        """Nodes that paint. Includes anything sitting behind a scrim."""
        return (n for n in self.nodes if n.rendered)

    def reachable_nodes(self) -> Iterable[Node]:
        """Nodes a technician can actually touch. The stricter of the two."""
        return (n for n in self.nodes if n.rendered and n.hittable)

    def require_style(self, *properties: str) -> None:
        """Raise unless the extractor captured every property named.

        Absent CAPTURE and absent VALUE are different facts, and only one of
        them is a clean read.
        """
        missing = [p for p in properties if p not in self.style_properties]
        if missing:
            raise SnapshotError(
                f"snapshot captured {sorted(self.style_properties)}; this detector "
                f"reads {missing} which was never captured — that is UNKNOWN, not PASS"
            )
