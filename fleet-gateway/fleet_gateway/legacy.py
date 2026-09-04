"""Read-only discovery + fail-closed mapping for pre-existing Claude/Codex sessions.

Does not launch, restart, attach, or send keys. Ownership is conferred only by
``adopt_legacy_session`` writing a durable fleet artifact.
"""

from __future__ import annotations

import json
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

PROTECTED_NAMES = frozenset({"fleet-gateway"})
PROTECTED_PREFIXES = ("cao-server",)

# Unicode dashes that render like ASCII "-" but are not it. Without folding
# these, `cao‐server` (U+2010) reads as an ordinary adoptable session.
_DASHES = "\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uff0d"


def normalize_session_name(name: str | None) -> str:
    """Fold a session name to the form protected-name matching is done against.

    NFKC + casefold + dash unification. Protection must not be defeatable by
    typing `Fleet-Gateway` or by swapping in a look-alike hyphen.
    """
    text = unicodedata.normalize("NFKC", (name or "").strip())
    for dash in _DASHES:
        text = text.replace(dash, "-")
    return text.casefold()


@dataclass(frozen=True)
class LegacySession:
    node: str
    provider: str
    local_session_id: str | None
    cwd: str | None
    pid: int | None
    tmux_name: str | None
    bridge_session_id: str | None
    classification: str
    adoptable: bool

    def identity_tokens(self) -> frozenset[str]:
        tokens: set[str] = set()
        for raw in (
            self.local_session_id,
            self.tmux_name,
            self.bridge_session_id,
        ):
            text = (raw or "").strip()
            if text:
                tokens.add(text)
        return frozenset(tokens)

    def matches(self, external_id: str) -> bool:
        needle = (external_id or "").strip()
        return bool(needle) and needle in self.identity_tokens()

    def to_public_dict(self) -> dict[str, object]:
        return {
            "node": self.node,
            "provider": self.provider,
            "local_session_id": self.local_session_id,
            "cwd": self.cwd,
            "pid": self.pid,
            "tmux_name": self.tmux_name,
            "bridge_session_id": self.bridge_session_id,
            "classification": self.classification,
            "adoptable": self.adoptable,
        }


class LegacySessionProbe(Protocol):
    def list_sessions(self, node: str) -> list[LegacySession]: ...

    def known_nodes(self) -> tuple[str, ...]: ...


class EmptyProbe:
    """Fail-closed default: no live sessions are visible."""

    def list_sessions(self, node: str) -> list[LegacySession]:
        del node
        return []

    def known_nodes(self) -> tuple[str, ...]:
        return ()


class FakeLegacySessionProbe:
    """Hermetic inventory. Tests inject sessions; never touches real tmux."""

    def __init__(self, by_node: dict[str, list[LegacySession]] | None = None) -> None:
        self.by_node = {k: list(v) for k, v in (by_node or {}).items()}
        self.list_calls: list[str] = []

    def list_sessions(self, node: str) -> list[LegacySession]:
        self.list_calls.append(node)
        return list(self.by_node.get(node, []))

    def known_nodes(self) -> tuple[str, ...]:
        return tuple(self.by_node)


def classify_name(tmux_name: str | None, *, running: bool) -> tuple[str, bool]:
    """Return (classification, adoptable). Ordinary Claude/Codex CLIs are legacy."""
    if not running:
        return "stale", False
    name = normalize_session_name(tmux_name)
    if name in PROTECTED_NAMES or name.startswith(PROTECTED_PREFIXES):
        return "protected", False
    return "legacy", True


class FilesystemClaudeProbe:
    """Read-only parse of ``~/.claude/sessions/<pid>.json``.

    ``pid_alive`` is injected so tests never inspect the host process table.
    """

    def __init__(
        self,
        *,
        node: str,
        sessions_dir: Path,
        pid_alive: Callable[[int], bool] | None = None,
    ) -> None:
        self.node = node
        self.sessions_dir = Path(sessions_dir)
        self.pid_alive = pid_alive or (lambda _pid: False)

    def known_nodes(self) -> tuple[str, ...]:
        return (self.node,)

    def list_sessions(self, node: str) -> list[LegacySession]:
        if node != self.node:
            return []
        if not self.sessions_dir.is_dir():
            return []
        found: list[LegacySession] = []
        for path in sorted(self.sessions_dir.glob("*.json")):
            if not path.stem.isdigit():
                continue
            pid = int(path.stem)
            if pid <= 0:
                # 0 = "my process group", negative = a group. Neither identifies
                # a session, and both make os.kill(pid, 0) succeed spuriously.
                continue
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(data, dict):
                continue
            session_id = str(data.get("sessionId") or data.get("session_id") or "").strip()
            # Don't synthesize identity from PID: only use name if present in metadata
            name_from_metadata = str(data.get("name") or "").strip()
            tmux_name = name_from_metadata or session_id or None
            cwd = str(data.get("cwd") or "").strip() or None
            bridge = data.get("bridgeSessionId")
            bridge_id = str(bridge).strip() if bridge else None
            running = self.pid_alive(pid)
            classification, adoptable = classify_name(tmux_name or path.stem, running=running)
            provider = "claude"
            entry = str(data.get("entrypoint") or data.get("kind") or "").lower()
            if "codex" in entry:
                provider = "codex"
            found.append(
                LegacySession(
                    node=self.node,
                    provider=provider,
                    local_session_id=session_id or None,
                    cwd=cwd,
                    pid=pid,
                    tmux_name=tmux_name,
                    bridge_session_id=bridge_id or None,
                    classification=classification,
                    adoptable=adoptable,
                )
            )
        return found
