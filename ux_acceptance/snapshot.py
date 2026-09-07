"""The screen snapshot contract.

One shape, produced by two drivers (Playwright `page.evaluate`, or CDP
`Runtime.evaluate` against the WebView) so web and mobile are judged by
identical code. `extract.js` is the browser-side producer.

Design note — why selector resolution fails closed
--------------------------------------------------
The cheapest way for a detector to be wrong is to look for something with a
selector that matches nothing and report "no defect found". That reads exactly
like a pass. Every detector here therefore resolves its selectors through
`Snapshot.require()`, which raises when a selector matches zero nodes. A
detector that cannot see its subject reports UNKNOWN, never PASS.
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
    role: Optional[str] = None
    attrs: dict[str, str] = field(default_factory=dict)
    style: dict[str, str] = field(default_factory=dict)
    box: Optional[Box] = None
    visible: bool = True

    def attr(self, name: str) -> Optional[str]:
        return self.attrs.get(name)

    def has_marker(self, marker: str) -> bool:
        """True when the element carries the semantic marker `data-fl-<marker>`."""
        return f"data-fl-{marker}" in self.attrs


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

        nodes = tuple(Snapshot._node(n, i) for i, n in enumerate(raw_nodes))
        return Snapshot(
            build_sha=sha,
            viewport=viewport,
            surface=surface,
            route=str(raw.get("route", "")),
            nodes=nodes,
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
        return Node(
            id=str(raw.get("id", f"n{index}")),
            tag=str(raw.get("tag", "")).lower(),
            text=str(raw.get("text", "")),
            role=raw.get("role"),
            attrs={str(k): str(v) for k, v in (raw.get("attrs") or {}).items()},
            style={str(k): str(v) for k, v in (raw.get("style") or {}).items()},
            box=box,
            visible=bool(raw.get("visible", True)),
        )

    # -- querying --------------------------------------------------------

    def visible_nodes(self) -> Iterable[Node]:
        return (n for n in self.nodes if n.visible)

    def with_marker(self, marker: str) -> list[Node]:
        """Nodes carrying `data-fl-<marker>`. May legitimately be empty."""
        return [n for n in self.visible_nodes() if n.has_marker(marker)]

    def require(self, marker: str) -> list[Node]:
        """`with_marker`, but a zero match is an error rather than a clean result.

        This is the guard against the single most common way an outside-in
        check silently stops checking: the markup moves, the selector matches
        nothing, and "no defects" is reported for a screen nobody looked at.
        """
        found = self.with_marker(marker)
        if not found:
            raise SnapshotError(
                f"no visible node carries data-fl-{marker} on route {self.route!r} "
                f"({self.surface} {self.viewport[0]}x{self.viewport[1]}). The detector "
                "cannot see its subject; this is UNKNOWN, not PASS."
            )
        return found
