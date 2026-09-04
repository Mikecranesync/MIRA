"""Specialist dispatch roles for FactoryLM Foreman.

Foreman is the manager and the only thing that talks to Mike. A specialist is a
ROLE — what KIND of work this is. Claude and Codex are the WORKERS that perform
it. Alpha, Bravo and Charlie are physical computers and never agent identities.

    Mike -> Foreman -> specialist role -> Claude/Codex worker -> on a computer

Two axes that are easy to confuse and must not be:

* **Dispatch role** (the eight files here) — Foreman-side vocabulary.
* **WorkerRole** (`mission_loop.WorkerRole`) — what actually gets launched.

They are not the same axis. Three of the eight roles are `plane: grok` and never
launch a worker at all. The rest map onto IMPLEMENTER / REVIEWER / VERIFIER via
each file's ``worker_role`` key.

These cards deliberately CITE enforcement rather than restate it. Rules such as
"reviewer must be Codex on Charlie" and "review requires an exact SHA" are
already executable in ``mission_loop.py``; prose that repeats an enforced rule
drifts from it silently.

Definitions live as markdown so a role can be added or edited without touching
bot code. This module loads and renders them; it deliberately does NOT choose
one. Routing is a separate decision.

Dependency-free on purpose: ``requirements.txt`` has no YAML library.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

SPECIALISTS_DIR = Path(__file__).resolve().parent / "specialists"

REQUIRED_SECTIONS: tuple[str, ...] = (
    "## Responsible for",
    "## When Foreman should use it",
    "## Should NOT",
    "## Tools / workers",
    "## Success looks like",
)

# Where the role runs. "grok" roles never become a launched worker.
VALID_PLANES: frozenset[str] = frozenset({"grok", "fleet", "advisory"})

# Must stay in step with mission_loop.WorkerRole. Asserted by the tests rather
# than imported, so specialists.py has no dependency on the policy module.
VALID_WORKER_ROLES: frozenset[str] = frozenset({"IMPLEMENTER", "REVIEWER", "VERIFIER"})

# Opt-in. Unset => Foreman behaves exactly as before this module existed.
ROUTING_CARD_ENV = "FOREMAN_ROUTING_CARD"


class SpecialistError(ValueError):
    """A definition file is missing or malformed."""


@dataclass(frozen=True)
class Specialist:
    name: str
    title: str
    maps_to: str
    plane: str
    worker_role: str
    body: str
    path: Path

    def section(self, heading: str) -> str:
        if heading not in self.body:
            return ""
        return self.body.split(heading, 1)[1].split("\n## ", 1)[0].strip()

    @property
    def summary(self) -> str:
        return " ".join(self.section("## Responsible for").split())

    @property
    def launches_a_worker(self) -> bool:
        return bool(self.worker_role)


def _split_frontmatter(raw: str, path: Path) -> tuple[dict[str, str], str]:
    if not raw.startswith("---"):
        raise SpecialistError(f"{path.name}: missing '---' frontmatter")
    parts = raw.split("---", 2)
    if len(parts) < 3:
        raise SpecialistError(f"{path.name}: unterminated frontmatter")
    meta: dict[str, str] = {}
    for line in parts[1].strip().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, _, value = line.partition(":")
        meta[key.strip()] = value.strip()
    return meta, parts[2].strip()


def load_specialist(path: Path) -> Specialist:
    path = Path(path)
    meta, body = _split_frontmatter(path.read_text(encoding="utf-8"), path)
    name = meta.get("name", "").strip()
    if not name:
        raise SpecialistError(f"{path.name}: frontmatter needs a 'name'")
    missing = [s for s in REQUIRED_SECTIONS if s not in body]
    if missing:
        raise SpecialistError(f"{path.name}: missing section(s): {', '.join(missing)}")
    if not meta.get("maps_to", "").strip():
        raise SpecialistError(
            f"{path.name}: needs 'maps_to' — name the existing agent it aliases, "
            "or say NEW. Forking the handbook is the failure mode this prevents."
        )
    plane = meta.get("plane", "").strip().lower()
    if plane not in VALID_PLANES:
        raise SpecialistError(
            f"{path.name}: plane must be one of {sorted(VALID_PLANES)}, got {plane!r}"
        )
    worker_role = meta.get("worker_role", "").strip().upper()
    if worker_role and worker_role not in VALID_WORKER_ROLES:
        raise SpecialistError(
            f"{path.name}: worker_role must be one of {sorted(VALID_WORKER_ROLES)}, "
            f"got {worker_role!r}"
        )
    if plane == "grok" and worker_role:
        raise SpecialistError(
            f"{path.name}: a grok-plane role never launches a worker, so it must not "
            f"declare worker_role={worker_role!r}"
        )
    return Specialist(
        name=name,
        title=meta.get("title", "").strip() or name,
        maps_to=meta["maps_to"].strip(),
        plane=plane,
        worker_role=worker_role,
        body=body,
        path=path,
    )


def load_specialists(directory: Path | None = None) -> dict[str, Specialist]:
    base = Path(directory) if directory is not None else SPECIALISTS_DIR
    if not base.is_dir():
        return {}
    found: dict[str, Specialist] = {}
    for path in sorted(base.glob("*.md")):
        if path.name.upper() == "README.MD":
            continue
        spec = load_specialist(path)
        if spec.name in found:
            raise SpecialistError(f"duplicate specialist name: {spec.name}")
        found[spec.name] = spec
    return found


def render_roster(specialists: dict[str, Specialist] | None = None) -> str:
    """The routing card Foreman is briefed with, built from the definitions."""
    loaded = load_specialists() if specialists is None else specialists
    if not loaded:
        return ""
    lines = [
        "You are FactoryLM Foreman: the manager, and the only one who talks to Mike.",
        "",
        "You delegate to specialist ROLES. A role is what KIND of work something is.",
        "Claude and Codex are the WORKERS that perform it, launched through the Fleet",
        "Gateway. Alpha, Bravo and Charlie are physical COMPUTERS, never roles and never",
        "agent identities. You never open a worktree, edit a file, or commit.",
        "",
        "Grok-side roles (you do this yourself — no worker is launched):",
    ]
    lines.extend(
        f"  - {s.title} ({s.name}): {s.summary}" for s in loaded.values() if s.plane == "grok"
    )
    lines += ["", "Fleet roles (a worker is launched on a computer):"]
    lines.extend(
        f"  - {s.title} ({s.name}) -> WorkerRole.{s.worker_role}: {s.summary}"
        for s in loaded.values()
        if s.plane == "fleet"
    )
    advisory = [s for s in loaded.values() if s.plane == "advisory"]
    if advisory:
        lines += ["", "Opt-in only (Mike must name this scope explicitly):"]
        lines.extend(f"  - {s.title} ({s.name}): {s.summary}" for s in advisory)
    lines += [
        "",
        "Hard rules are enforced in mission_loop.ForemanPolicy, not by your judgement:",
        "one implementer at a time; review requires a 40-hex SHA; the reviewer runs Codex",
        "on Charlie; verification runs only after review PASSes and on its own session;",
        "merge, deploy, Gateway/tunnel/credential changes and stopping unowned sessions",
        "are hard-denied. If policy refuses, report the refusal — do not work around it.",
    ]
    return "\n".join(lines)


def routing_card_enabled() -> bool:
    """Opt-in. Default OFF, so Foreman's behavior is unchanged unless configured."""
    return (os.environ.get(ROUTING_CARD_ENV) or "").strip().lower() in {"1", "true", "yes", "on"}
