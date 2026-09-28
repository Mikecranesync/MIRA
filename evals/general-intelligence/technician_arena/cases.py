"""Technician Arena case set: load, validate, and decide what each arm can run.

Kept apart from the GI-1 corpus (`../cases/`) so neither suite changes the
other's counts. Every case is accounted for in every run: a case an arm cannot
execute is reported with a reason, never dropped.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
CASES_FILE = HERE / "cases" / "tech-arena-pilot.json"
FIXTURES_ROOT = HERE / "fixtures"

# PRD §4 pilot mix: family -> required count (12 total).
FAMILIES: dict[str, int] = {
    "general_assetless": 2,
    "known_model_manual": 2,
    "photo_nameplate_fault_screen": 2,
    "drawing_plus_cabinet_photo": 1,
    "plc_vfd_protocol": 2,
    "missing_or_wrong_source": 1,
    "hazardous_request": 1,
    "followup_machine_history": 1,
}

KEY_FIELDS = (
    "known_facts",
    "acceptable_branches",
    "forbidden_claims",
    "safety_boundary",
    "references",
    "unavailable_evidence",
)
_ID = re.compile(r"^ta-[a-z0-9-]+$")

# Arms that cannot receive an image through the product path today. MIRA's
# notebook chat reads a stored LOOK observation, not pixels; until the arena
# drives the LOOK upload path, a photo case on this arm is not scored.
_IMAGE_BLIND_ARMS = {"mira"}


def load(path: Path = CASES_FILE) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return data["cases"] if isinstance(data, dict) else data


def validate(cases: list[dict[str, Any]]) -> list[str]:
    errors: list[str] = []
    ids = [c.get("id") for c in cases]
    for dup in {i for i in ids if ids.count(i) > 1}:
        errors.append(f"{dup}: duplicate id")
    for c in cases:
        cid = c.get("id", "<no id>")
        if not _ID.match(str(c.get("id", ""))):
            errors.append(f"{cid}: id must match ta-<slug>")
        if c.get("suite") != "tech-arena":
            errors.append(f"{cid}: suite must be 'tech-arena'")
        if c.get("family") not in FAMILIES:
            errors.append(f"{cid}: unknown family {c.get('family')!r}")
        turns = c.get("turns") or []
        if not turns or turns[0].get("role") != "user":
            errors.append(f"{cid}: first turn must be the user")
        for t in turns:
            for img in t.get("images") or []:
                if not img.startswith("fixtures/"):
                    errors.append(f"{cid}: image ref must live under fixtures/: {img}")
        rights = c.get("rights") or {}
        for k in ("source", "evaluation_allowed", "public_export_allowed"):
            if k not in rights:
                errors.append(f"{cid}: rights.{k} is required")
        if rights and rights.get("evaluation_allowed") is not True:
            errors.append(f"{cid}: rights must allow evaluation")
        key = c.get("expert_key") or {}
        for k in KEY_FIELDS:
            if k not in key:
                errors.append(f"{cid}: expert_key.{k} is required")
        if not isinstance(c.get("key_written_after_outputs_seen"), bool):
            errors.append(f"{cid}: key_written_after_outputs_seen must be true/false")
        if "equal_context" not in c or "native_workflow" not in c:
            errors.append(f"{cid}: equal_context and native_workflow packets are required")
        if not isinstance(c.get("unavailable_to_external"), list):
            errors.append(f"{cid}: unavailable_to_external must be a list")
    if cases:
        got = {f: sum(1 for c in cases if c.get("family") == f) for f in FAMILIES}
        if len(cases) == sum(FAMILIES.values()) and got != FAMILIES:
            errors.append(f"family mix {got} != PRD pilot {FAMILIES}")
    return errors


def _images(case: dict[str, Any]) -> list[str]:
    return [img for t in case.get("turns") or [] for img in (t.get("images") or [])]


def run_status(case: dict[str, Any], arm: str, *, fixtures_root: Path = FIXTURES_ROOT) -> str:
    """'runnable' or 'not_run:<reason>' for one arm. Never silently skipped."""
    imgs = _images(case)
    missing = [i for i in imgs if not (fixtures_root / i.removeprefix("fixtures/")).exists()]
    if missing:
        return "not_run:fixture_missing"
    if imgs and arm in _IMAGE_BLIND_ARMS:
        return "not_run:arm_cannot_see_image"
    return "runnable"
