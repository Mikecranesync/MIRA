"""Scenario ledger loader + validator for the Technician-Journey Validation Swarm.

PRD §8.1: the ledger is the source of truth for each journey. This module
loads a scenario YAML, validates the schema (fail-closed — an invalid scenario
never executes), and enforces the environment allowlist at load time.

No network, no DB. The executor supplies environment facts; this module only
decides whether the scenario permits them.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

LEDGER_DIR = Path(__file__).parent / "ledger"

_ALLOWED_ENVIRONMENTS = {"staging", "production_canary"}
_ALLOWED_SURFACES = {"telegram", "pipeline_http", "hub_http"}
_ALLOWED_EXPECT_KINDS = {
    "gate_ask",
    "confirm_named",
    "confirmed",
    "grounded_answer",
    "refusal",
    "safety_stop",
    "continuity",
    "handoff_preview",
}
_ALLOWED_MUTATION_CATEGORIES = {
    "abbreviated",
    "missing_info",
    "ambiguity",
    "interruption",
    "stale_unknown",
    "unsafe_request",
}
_ALLOWED_CERT_STATUS = {"discovery-only", "candidate", "certified", "revoked"}
_REQUIRED_INVARIANTS = {
    "identity",
    "tenant",
    "evidence",
    "fabrication",
    "continuity",
    "safety",
    "latency_budget_s",
    "allowed_actions",
}


class LedgerError(ValueError):
    """A scenario failed validation — the run must not proceed."""


@dataclass(frozen=True)
class Turn:
    id: str
    actor: str
    surface: str
    message: str
    expect: dict[str, Any]


@dataclass(frozen=True)
class MutationSlot:
    slot: str
    category: str
    variants: tuple[str, ...]
    expect_override: dict[str, Any] | None = None


@dataclass(frozen=True)
class Scenario:
    scenario_id: str
    version: int
    title: str
    allowed_environments: tuple[str, ...]
    tenant: dict[str, Any]
    personas: tuple[dict[str, Any], ...]
    fixtures: dict[str, Any]
    base_turns: tuple[Turn, ...]
    mutation_slots: tuple[MutationSlot, ...]
    invariants: dict[str, Any]
    verdict_map: dict[str, Any]
    redaction: dict[str, Any]
    certificate: dict[str, Any]
    source_path: Path = field(compare=False, default=Path("."))

    @property
    def ref(self) -> str:
        return f"{self.scenario_id}@v{self.version}"

    def content_fingerprint(self) -> str:
        """sha256 over the scenario's semantic content (not file bytes)."""
        payload = {
            "scenario_id": self.scenario_id,
            "version": self.version,
            "tenant": self.tenant,
            "personas": list(self.personas),
            "fixtures": self.fixtures,
            "base_turns": [t.__dict__ for t in self.base_turns],
            "mutation_slots": [
                {
                    "slot": m.slot,
                    "category": m.category,
                    "variants": list(m.variants),
                    "expect_override": m.expect_override,
                }
                for m in self.mutation_slots
            ],
            "invariants": self.invariants,
            "verdict_map": self.verdict_map,
        }
        blob = json.dumps(payload, sort_keys=True, default=str).encode()
        return hashlib.sha256(blob).hexdigest()

    def assert_environment_allowed(self, environment: str) -> None:
        """Fail-closed environment gate (PRD §10.7)."""
        if environment not in self.allowed_environments:
            raise LedgerError(
                f"{self.ref}: environment {environment!r} is not in the "
                f"allowlist {list(self.allowed_environments)} — refusing to run"
            )
        if environment == "production_canary" and self.certificate.get("status") != "certified":
            raise LedgerError(
                f"{self.ref}: production_canary requires certificate.status="
                f"'certified' (found {self.certificate.get('status')!r}) — refusing to run"
            )

    def mutations_allowed(self, environment: str) -> bool:
        """Mutation slots execute in staging only (PRD §8.5)."""
        return environment == "staging"


def _require(data: dict, key: str, path: Path) -> Any:
    if key not in data:
        raise LedgerError(f"{path.name}: missing required field {key!r}")
    return data[key]


def load_scenario(path: str | Path) -> Scenario:
    path = Path(path)
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:
        raise LedgerError(f"{path.name}: invalid YAML — {exc}") from exc

    scenario_id = _require(data, "scenario_id", path)
    version = _require(data, "version", path)
    if not isinstance(version, int) or version < 1:
        raise LedgerError(f"{path.name}: version must be an int >= 1")

    envs = tuple(_require(data, "allowed_environments", path))
    bad_envs = set(envs) - _ALLOWED_ENVIRONMENTS
    if bad_envs:
        raise LedgerError(f"{path.name}: unknown environments {sorted(bad_envs)}")

    personas = tuple(_require(data, "personas", path))
    if len(personas) < 2:
        raise LedgerError(
            f"{path.name}: at least 2 personas required (independent RED confirmation)"
        )
    persona_ids = {p["id"] for p in personas}

    turns: list[Turn] = []
    for raw in _require(data, "base_turns", path):
        expect = raw.get("expect") or {}
        kind = expect.get("kind")
        if kind not in _ALLOWED_EXPECT_KINDS:
            raise LedgerError(f"{path.name}: turn {raw.get('id')}: bad expect.kind {kind!r}")
        if raw.get("surface") not in _ALLOWED_SURFACES:
            raise LedgerError(
                f"{path.name}: turn {raw.get('id')}: bad surface {raw.get('surface')!r}"
            )
        if raw.get("actor") not in persona_ids:
            raise LedgerError(
                f"{path.name}: turn {raw.get('id')}: unknown actor {raw.get('actor')!r}"
            )
        turns.append(
            Turn(
                id=raw["id"],
                actor=raw["actor"],
                surface=raw["surface"],
                message=raw["message"],
                expect=expect,
            )
        )
    if not turns:
        raise LedgerError(f"{path.name}: base_turns is empty")
    turn_ids = {t.id for t in turns}

    slots: list[MutationSlot] = []
    for raw in data.get("mutation_slots") or []:
        if raw.get("slot") not in turn_ids:
            raise LedgerError(f"{path.name}: mutation slot {raw.get('slot')!r} matches no turn")
        if raw.get("category") not in _ALLOWED_MUTATION_CATEGORIES:
            raise LedgerError(f"{path.name}: mutation category {raw.get('category')!r} not allowed")
        variants = tuple(raw.get("variants") or [])
        if not variants:
            raise LedgerError(f"{path.name}: mutation slot {raw['slot']} has no variants")
        override = raw.get("expect_override")
        if override and override.get("kind") not in _ALLOWED_EXPECT_KINDS:
            raise LedgerError(
                f"{path.name}: mutation slot {raw['slot']}: bad override kind "
                f"{override.get('kind')!r}"
            )
        slots.append(
            MutationSlot(
                slot=raw["slot"],
                category=raw["category"],
                variants=variants,
                expect_override=override,
            )
        )

    invariants = _require(data, "invariants", path)
    missing = _REQUIRED_INVARIANTS - set(invariants)
    if missing:
        raise LedgerError(f"{path.name}: missing invariants {sorted(missing)}")

    certificate = _require(data, "certificate", path)
    if certificate.get("status") not in _ALLOWED_CERT_STATUS:
        raise LedgerError(
            f"{path.name}: certificate.status {certificate.get('status')!r} not allowed"
        )

    return Scenario(
        scenario_id=scenario_id,
        version=version,
        title=_require(data, "title", path),
        allowed_environments=envs,
        tenant=_require(data, "tenant", path),
        personas=personas,
        fixtures=_require(data, "fixtures", path),
        base_turns=tuple(turns),
        mutation_slots=tuple(slots),
        invariants=invariants,
        verdict_map=_require(data, "verdict_map", path),
        redaction=_require(data, "redaction", path),
        certificate=certificate,
        source_path=path,
    )


def load_all() -> list[Scenario]:
    return [load_scenario(p) for p in sorted(LEDGER_DIR.glob("*.yaml"))]
