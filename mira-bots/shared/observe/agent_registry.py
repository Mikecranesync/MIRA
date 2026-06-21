"""Preformatted industrial agent template registry (Cognite-style workbench wedge).

Each "agent" here is **not** a separate execution engine. MIRA has exactly one
answer engine (``Supervisor.process``). A preformatted agent is a *contract +
label* over that engine: a fixed scope, a read-only tool allowlist, the context
it requires approved, the output fields it must produce, a risk level, and an
eval pack. The registry's job is to (1) load those manifests, (2) enforce the
read-only invariant at load time, and (3) route a question to the right manifest
so its id/version/risk land on the answer's ``AnswerTrace``.

Design constraints (mirror the rest of ``shared/observe``):

- **Dependency-light.** Stdlib only. No ``simlab`` / ``mira-bots`` engine imports
  so the engine and adapters can read manifests without a dependency cycle.
- **Read-only by construction.** A manifest whose ``allowed_tools`` contains any
  known write/control verb is REJECTED at load — the registry refuses to expose
  an agent that could mutate the plant. This is real load-time enforcement, not a
  runtime sandbox (there is no tool dispatch to sandbox — the engine is read-only
  today and these manifests label that reality).
- **Observational.** Routing/labelling never changes the reply. Failure to match
  an agent falls back to the default; a malformed manifest is skipped, not fatal.

Manifests live as JSON under ``agent_manifests/`` next to this module.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("mira-gsd.observe")

# Risk bands a manifest may declare (matches the blueprint trace model).
RISK_LOW = "low"
RISK_MEDIUM = "medium"
RISK_SAFETY_REVIEW = "safety_review"
_RISK_LEVELS = {RISK_LOW, RISK_MEDIUM, RISK_SAFETY_REVIEW}

# The forbidden tool surface. Any tool whose name implies a write, reset, control
# command, work-order submission/closure, or safety bypass is a write/control
# tool. A preformatted agent may *block* these but may NEVER *allow* one — the
# product is read-only troubleshooting intelligence first (NORTH_STAR, TOO
# Non-Goals, .claude/rules/fieldbus-readonly.md, .claude/rules/train-before-deploy.md).
_WRITE_VERBS = (
    "write",
    "set_",
    ".set",
    "reset",
    "submit",
    "close",
    "create_work_order",
    "command",
    "control",
    "actuate",
    "start_machine",
    "stop_machine",
    "bypass",
    "override",
    "delete",
    "update_tag",
    "force",
)

DEFAULT_AGENT_ID = "maintenance_troubleshooter"

_MANIFEST_DIR = Path(__file__).resolve().parent / "agent_manifests"


def is_write_tool(tool: str) -> bool:
    """True if a tool name implies a write/control/reset/submit action."""
    t = (tool or "").lower()
    return any(v in t for v in _WRITE_VERBS)


class AgentManifestError(ValueError):
    """A manifest is malformed or violates the read-only invariant."""


@dataclass
class AgentManifest:
    """A preformatted industrial agent: fixed scope, read-only tools, contract."""

    id: str
    name: str
    version: str
    scope: str
    risk_level: str = RISK_MEDIUM
    allowed_tools: list[str] = field(default_factory=list)
    blocked_tools: list[str] = field(default_factory=list)
    required_context: list[str] = field(default_factory=list)
    required_outputs: list[str] = field(default_factory=list)
    eval_pack: Optional[str] = None
    route_signals: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "AgentManifest":
        """Build + validate a manifest. Raises ``AgentManifestError`` on violation."""
        for required in ("id", "name", "version", "scope"):
            if not d.get(required):
                raise AgentManifestError(f"manifest missing required field {required!r}")

        risk = d.get("risk_level", RISK_MEDIUM)
        if risk not in _RISK_LEVELS:
            raise AgentManifestError(
                f"manifest {d['id']!r} has invalid risk_level {risk!r} "
                f"(must be one of {sorted(_RISK_LEVELS)})"
            )

        allowed = list(d.get("allowed_tools", []))
        # Read-only invariant — the registry refuses to expose a write-capable agent.
        offending = [t for t in allowed if is_write_tool(t)]
        if offending:
            raise AgentManifestError(
                f"manifest {d['id']!r} allows write/control tool(s) {offending} — "
                "preformatted agents are read-only by construction"
            )

        return cls(
            id=d["id"],
            name=d["name"],
            version=d["version"],
            scope=d["scope"],
            risk_level=risk,
            allowed_tools=allowed,
            blocked_tools=list(d.get("blocked_tools", [])),
            required_context=list(d.get("required_context", [])),
            required_outputs=list(d.get("required_outputs", [])),
            eval_pack=d.get("eval_pack"),
            route_signals=[s.lower() for s in d.get("route_signals", [])],
        )


@lru_cache(maxsize=1)
def load_registry() -> dict[str, AgentManifest]:
    """Load + validate every JSON manifest in ``agent_manifests/`` (cached).

    A manifest that fails validation is logged and skipped — one bad file never
    takes down the whole registry. Returns ``{agent_id: AgentManifest}``.
    """
    registry: dict[str, AgentManifest] = {}
    if not _MANIFEST_DIR.is_dir():
        logger.warning("agent manifest dir missing: %s", _MANIFEST_DIR)
        return registry
    for path in sorted(_MANIFEST_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            manifest = AgentManifest.from_dict(data)
        except (AgentManifestError, json.JSONDecodeError, OSError) as exc:
            logger.warning("skipping invalid agent manifest %s: %s", path.name, exc)
            continue
        if manifest.id in registry:
            logger.warning("duplicate agent id %r in %s — keeping first", manifest.id, path.name)
            continue
        registry[manifest.id] = manifest
    return registry


def all_manifests() -> list[AgentManifest]:
    """Every loaded manifest (for the Agent Library surface)."""
    return list(load_registry().values())


def get_manifest(agent_id: Optional[str]) -> Optional[AgentManifest]:
    """Look up one manifest by id, or ``None``."""
    if not agent_id:
        return None
    return load_registry().get(agent_id)


def route_agent(
    question: Optional[str], uns_context: Optional[dict] = None
) -> Optional[AgentManifest]:
    """Pick the preformatted agent for a question (keyword routing, default fallback).

    Pure + cheap: matches the question text against each manifest's
    ``route_signals``. The most-specific match wins (longest matched signal);
    ties break by manifest order. Falls back to ``DEFAULT_AGENT_ID``. Returns
    ``None`` only if the registry is empty (no manifests on disk).

    ``uns_context`` is accepted for future signal-based routing (e.g. a
    direct-connection asset that pins a specific agent) but is not required today.
    """
    registry = load_registry()
    if not registry:
        return None
    q = (question or "").lower()

    best: Optional[AgentManifest] = None
    best_len = 0
    for manifest in registry.values():
        for signal in manifest.route_signals:
            if signal == "default":
                continue
            if signal and signal in q and len(signal) > best_len:
                best = manifest
                best_len = len(signal)
    if best is not None:
        return best
    return registry.get(DEFAULT_AGENT_ID) or next(iter(registry.values()))
