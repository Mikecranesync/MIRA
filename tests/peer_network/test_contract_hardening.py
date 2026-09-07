"""P1/P3 hardening checks for FLEET-PEER-NETWORK-001 Slice A.

RED ON PURPOSE against head 844798ac2 — these fail until the claim schema can
express its own lifecycle (P1) and the event schema constrains its payload per
kind (P3). Written by the read-only review lane for cherry-pick onto #3653.

Run locally: ``pytest tests/peer_network -q``.

WHY THE STRUCTURAL ASSERTIONS ARE THE LOAD-BEARING ONES. ``jsonschema`` is
importable on this machine but is NOT declared in ``pyproject.toml``, so a check
that only ran a validator would SKIP on a clean environment and report green
without having verified anything. Every requirement below is therefore asserted
structurally first — that always runs — and the behavioural validation is an
additional proof layered on top when the library happens to be present. A guard
that fails open is the failure mode this mission exists to remove.
"""

from __future__ import annotations

import json
from pathlib import Path

import jsonschema  # hard import: a missing validator must be a RED step, never a silent skip (devops gate, 2026-09-07)
import pytest

ROOT = Path(__file__).resolve().parents[2]
SCHEMAS = ROOT / "docs" / "peer-network" / "schemas"

SHA40 = "^[0-9a-f]{40}$"
CLAIM_STATES = {
    "ACTIVE",
    "BLOCKED",
    "LEASE_AT_RISK",
    "RELEASED",
    "COMPLETE",
}  # five: protocol BLOCKED + PRD LEASE_AT_RISK are distinct states

# kind -> payload properties that must be required for that kind (law 8 / law 9).
PAYLOAD_REQUIREMENTS = {
    "commit": {"sha"},
    "request_review": {"sha"},
    "submit_verdict": {"sha", "verdict"},
    "human_gate": {"gate", "decided_by"},
    "accept_handoff": {"generation"},
}


def _schema(name: str) -> dict:
    return json.loads((SCHEMAS / f"{name}.schema.json").read_text())


def _conditionals(schema: dict) -> list[dict]:
    """Every if/then pair in the schema, however it is composed."""
    out: list[dict] = []
    if "if" in schema and "then" in schema:
        out.append(schema)
    for key in ("allOf", "anyOf", "oneOf"):
        for entry in schema.get(key, []):
            out.extend(_conditionals(entry))
    return out


def _required_payload_props_for(schema: dict, kind: str) -> set[str]:
    """What the schema actually forces into payload for `kind`."""
    forced: set[str] = set()
    for cond in _conditionals(schema):
        const = cond["if"].get("properties", {}).get("kind", {})
        matches = const.get("const") == kind or kind in (const.get("enum") or [])
        if not matches:
            continue
        payload = cond["then"].get("properties", {}).get("payload", {})
        forced |= set(payload.get("required", []))
    return forced


# --------------------------------------------------------------------------- P1


class TestClaimLifecycleIsRepresentable:
    """A claim must be able to say what state it is in.

    START_HERE §3 requires posting `Status: ACTIVE`, standing down to `RELEASED`
    when you lose the race, `COMPLETE` on leave, and `LEASE_AT_RISK` when a
    lease cannot be renewed. The schema is `additionalProperties: false`, so a
    state it does not declare cannot legally appear on a conforming claim —
    which leaves "is this still held?" answerable only from prose, exactly the
    condition under which two sessions both believe they hold one claim.
    """

    def test_status_is_a_required_property(self) -> None:
        claim = _schema("claim")
        assert "status" in claim["properties"], "a claim cannot declare its own lifecycle state"
        assert "status" in claim["required"]

    def test_status_enumerates_exactly_the_documented_states(self) -> None:
        states = set(_schema("claim")["properties"]["status"]["enum"])
        assert states == CLAIM_STATES

    def test_claim_carries_the_timestamp_the_race_is_ordered_by(self) -> None:
        # "the earliest ACTIVE claim wins" needs a field to be earliest BY.
        # `lease_expires_at` orders expiry, not acquisition.
        claim = _schema("claim")
        assert "claimed_at" in claim["properties"], "nothing to order 'earliest wins' by"
        assert "claimed_at" in claim["required"]
        assert claim["properties"]["claimed_at"].get("format") == "date-time"

    def test_additional_properties_stays_closed(self) -> None:
        # Regression guard: the fix must ADD the fields, not open the record up.
        assert _schema("claim")["additionalProperties"] is False


# --------------------------------------------------------------------------- P3


class TestEventPayloadCarriesItsOwnProof:
    """An event must carry the evidence its kind asserts.

    Laws 8 and 9 bind reviews and verification to one immutable 40-character
    SHA. With `payload` unconstrained, a `submit_verdict` naming no SHA is a
    conforming event — a promise in a comment passing as a record.
    """

    @pytest.mark.parametrize("kind,required", sorted(PAYLOAD_REQUIREMENTS.items()))
    def test_kind_forces_its_payload_fields(self, kind: str, required: set[str]) -> None:
        forced = _required_payload_props_for(_schema("event"), kind)
        missing = required - forced
        assert not missing, f"{kind} does not require payload {sorted(missing)}"

    def test_sha_bearing_kinds_constrain_the_sha_to_40_hex(self) -> None:
        # A `sha` of "soon" would satisfy a bare `required` and defeat law 8.
        event = _schema("event")
        for kind in ("commit", "request_review", "submit_verdict"):
            patterns = []
            for cond in _conditionals(event):
                const = cond["if"].get("properties", {}).get("kind", {})
                if const.get("const") != kind and kind not in (const.get("enum") or []):
                    continue
                sha = (
                    cond["then"]
                    .get("properties", {})
                    .get("payload", {})
                    .get("properties", {})
                    .get("sha", {})
                )
                if "pattern" in sha:
                    patterns.append(sha["pattern"])
            assert SHA40 in patterns, f"{kind}.payload.sha is not pinned to 40 hex"


class TestEventPayloadBehaviour:
    """The structural checks above are the gate; these prove they bite.

    Skips only when `jsonschema` is absent — and cannot mask a regression,
    because every requirement is already asserted structurally.
    """

    @staticmethod
    def _validate(instance: dict) -> None:
        jsonschema.validate(instance, _schema("event"))

    @staticmethod
    def _event(kind: str, payload: dict) -> dict:
        return {
            "event_id": "e1",
            "idempotency_key": "k1",
            "ts": "2026-09-07T02:00:00Z",
            "kind": kind,
            "mission_id": "FLEET-PEER-NETWORK-001",
            "session_uuid": "s1",
            "payload": payload,
        }

    def test_a_verdict_naming_no_sha_is_rejected(self) -> None:
        with pytest.raises(jsonschema.ValidationError):
            self._validate(self._event("submit_verdict", {}))

    def test_a_verdict_with_a_short_sha_is_rejected(self) -> None:
        with pytest.raises(jsonschema.ValidationError):
            self._validate(self._event("submit_verdict", {"sha": "844798ac2", "verdict": "PASS"}))

    def test_a_human_gate_naming_no_decider_is_rejected(self) -> None:
        with pytest.raises(jsonschema.ValidationError):
            self._validate(self._event("human_gate", {"gate": "merge"}))

    def test_a_properly_evidenced_verdict_is_accepted(self) -> None:
        # The control: the fix must not make legitimate events unrepresentable.
        self._validate(
            self._event(
                "submit_verdict",
                {"sha": "844798ac230e4881c86f582b955bcff74cc3a357", "verdict": "PASS"},
            )
        )

    def test_a_kind_with_no_payload_requirement_is_unaffected(self) -> None:
        # heartbeat carries no evidence claim, so it must stay permissive.
        self._validate(self._event("heartbeat", {}))
