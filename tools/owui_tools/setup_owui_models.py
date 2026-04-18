"""setup_owui_models.py — Bootstrap Open WebUI specialized models and prompt templates.

Idempotent: checks if each resource exists before creating. Safe to run multiple times.

Usage:
    doppler run --project factorylm --config prd -- python3 tools/owui_tools/setup_owui_models.py
    doppler run --project factorylm --config prd -- python3 tools/owui_tools/setup_owui_models.py --dry-run

Environment:
    OPENWEBUI_API_KEY   Admin API key for Open WebUI
    MIRA_SERVER_BASE_URL  Base URL (default: http://localhost:3000)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import urllib.request
from dataclasses import dataclass, field

logger = logging.getLogger("owui-setup")

OW_BASE = os.getenv("MIRA_SERVER_BASE_URL", "http://localhost:3000").rstrip("/")
OW_KEY = os.getenv("OPENWEBUI_API_KEY", "")

# ── Model definitions ─────────────────────────────────────────────────────────

@dataclass
class ModelSpec:
    model_id: str
    name: str
    description: str
    system_prompt: str
    tags: list[str] = field(default_factory=list)
    base_model: str = "mira-diagnostic"  # clone from this model


MODELS: list[ModelSpec] = [
    ModelSpec(
        model_id="mira-pm",
        name="MIRA Preventive Maintenance",
        description="Focused on PM scheduling, inspection checklists, lubrication intervals, and OEM-recommended maintenance windows.",
        tags=["pm", "preventive", "scheduling"],
        system_prompt=(
            "You are MIRA, an industrial maintenance assistant specialized in preventive maintenance (PM). "
            "Your focus: PM schedules, inspection intervals, lubrication specs, filter changes, alignment checks, "
            "and OEM-recommended maintenance windows. When a technician asks about a PM task, provide: "
            "(1) the OEM-recommended interval from retrieved documentation, "
            "(2) the specific procedure or checklist items, "
            "(3) the parts or consumables needed. "
            "If no documentation is retrieved, ask what equipment model they're maintaining and what symptom prompted the PM question. "
            "Always cite your source. Response format: plain text, ≤50 words per answer unless detailing a procedure. "
            "Tone: peer, not professor. Direct. No filler words."
        ),
    ),
    ModelSpec(
        model_id="mira-electrical",
        name="MIRA Electrical & Panel Work",
        description="Specialized for electrical panel work, LOTO procedures, arc flash, wiring, cable sizing, and termination specs.",
        tags=["electrical", "loto", "arc-flash", "wiring"],
        system_prompt=(
            "You are MIRA, an industrial maintenance assistant specialized in electrical systems. "
            "SAFETY FIRST: When ANY message indicates live-panel work, energized conductors, or skipping LOTO, "
            "your first line must be 'STOP — [hazard]. De-energize and lock out first.' No exceptions. "
            "Your focus: LOTO procedures, arc flash boundaries, cable sizing (NEC/CEC), termination torque specs, "
            "ground fault troubleshooting, motor control wiring, VFD parameter-wiring relationships. "
            "When answering wiring questions: state voltage/amperage requirements, wire gauge, connector type, "
            "and relevant code section. Cite the source manual or NEC article. "
            "Response format: ≤50 words for Q&A; step-by-step for procedures. Tone: direct, confident."
        ),
    ),
    ModelSpec(
        model_id="mira-cranes",
        name="MIRA Cranes & Hoists",
        description="Specialized for overhead crane electrical systems, hoist controls, load cells, limit switches, and CraneSync integration.",
        tags=["cranes", "hoists", "cranesync"],
        system_prompt=(
            "You are MIRA, an industrial maintenance assistant specialized in overhead cranes and hoists. "
            "Your focus: hoist electrical (contactors, resistors, VFDs on hoist duty), upper/lower limit switches, "
            "load cell calibration, pendant controls, bridge/trolley drives, anti-sway systems, and CraneSync data integration. "
            "Safety: hoist work above ground with suspended loads requires additional caution — always ask if the load "
            "is lowered and the hook is unloaded before suggesting any electrical intervention. "
            "When diagnosing a crane fault: (1) identify which motion (hoist/bridge/trolley), "
            "(2) identify the fault code or symptom, (3) ask what the load and duty cycle were at time of fault. "
            "Cite source when available. Tone: direct, professional."
        ),
    ),
]

# ── Prompt template definitions ───────────────────────────────────────────────

@dataclass
class PromptSpec:
    command: str   # slash command trigger
    title: str
    content: str


PROMPTS: list[PromptSpec] = [
    PromptSpec(
        command="vfd-fault",
        title="VFD Fault Diagnosis",
        content=(
            "I have a {{manufacturer}} {{model}} variable frequency drive showing fault code {{fault_code}}. "
            "Equipment ID: {{equipment_id}}. "
            "It started {{when}}. "
            "Motor HP: {{motor_hp}}. "
            "What does this fault mean and what should I check first?"
        ),
    ),
    PromptSpec(
        command="motor-fault",
        title="Motor Won't Start",
        content=(
            "Motor at {{location}} won't start. "
            "Equipment ID: {{equipment_id}}. "
            "Last known good: {{last_good}}. "
            "Any alarms on the drive or panel: {{alarms}}. "
            "What are the most likely causes?"
        ),
    ),
    PromptSpec(
        command="report-fault",
        title="Report New Fault",
        content=(
            "Equipment: {{equipment_id}} at {{location}}. "
            "Symptom: {{symptom}}. "
            "Started: {{when}}. "
            "Production impact: {{impact}}. "
            "Please help me diagnose and create a work order."
        ),
    ),
    PromptSpec(
        command="nameplate",
        title="Nameplate / Photo Lookup",
        content=(
            "Here is a photo of the equipment nameplate. "
            "What is this piece of equipment and what should I check first for {{symptom}}?"
        ),
    ),
    PromptSpec(
        command="find-manual",
        title="Find Manual or Datasheet",
        content=(
            "Can you find the installation manual or datasheet for {{manufacturer}} {{model}}? "
            "I need information about {{topic}}."
        ),
    ),
]


# ── API helpers ───────────────────────────────────────────────────────────────

def _req(method: str, path: str, body: dict | None = None, dry_run: bool = False) -> dict | None:
    url = f"{OW_BASE}{path}"
    if dry_run:
        logger.info("DRY-RUN %s %s %s", method, url, json.dumps(body or {})[:80])
        return {"id": f"dry-run-{path.split('/')[-1]}"}
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {OW_KEY}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode()[:200]
        logger.error("HTTP %s %s %s: %s", e.code, method, url, body_text)
        return None
    except Exception as e:
        logger.error("%s %s failed: %s", method, url, e)
        return None


def _list_models() -> list[dict]:
    data = _req("GET", "/api/models")
    if not data:
        return []
    return data if isinstance(data, list) else data.get("data", [])


def _list_prompts() -> list[dict]:
    data = _req("GET", "/api/v1/prompts/")
    if not data:
        return []
    return data if isinstance(data, list) else []


# ── Resource creation ─────────────────────────="────────────────────────────

def ensure_models(dry_run: bool = False) -> dict[str, str]:
    """Create specialized models. Returns {model_id: status}."""
    existing = {m.get("id") or m.get("name"): m for m in _list_models()}
    results: dict[str, str] = {}

    for spec in MODELS:
        if spec.model_id in existing:
            logger.info("Model '%s' already exists — skipping", spec.model_id)
            results[spec.model_id] = "exists"
            continue

        payload = {
            "id": spec.model_id,
            "name": spec.name,
            "meta": {
                "description": spec.description,
                "tags": [{"name": t} for t in spec.tags],
            },
            "params": {
                "system": spec.system_prompt,
            },
            "base_model_id": spec.base_model,
        }
        result = _req("POST", "/api/v1/models/create", payload, dry_run=dry_run)
        if result:
            logger.info("Created model '%s'", spec.model_id)
            results[spec.model_id] = "created"
        else:
            logger.warning("Failed to create model '%s'", spec.model_id)
            results[spec.model_id] = "failed"

    return results


def ensure_prompts(dry_run: bool = False) -> dict[str, str]:
    """Create prompt templates. Returns {command: status}."""
    existing = {p.get("command"): p for p in _list_prompts()}
    results: dict[str, str] = {}

    for spec in PROMPTS:
        if spec.command in existing:
            logger.info("Prompt '/%s' already exists — skipping", spec.command)
            results[spec.command] = "exists"
            continue

        payload = {
            "command": spec.command,
            "title": spec.title,
            "content": spec.content,
        }
        result = _req("POST", "/api/v1/prompts/create", payload, dry_run=dry_run)
        if result:
            logger.info("Created prompt '/%s'", spec.command)
            results[spec.command] = "created"
        else:
            logger.warning("Failed to create prompt '/%s'", spec.command)
            results[spec.command] = "failed"

    return results


def enable_chat_sharing(dry_run: bool = False) -> bool:
    """Enable chat sharing toggle in OW config."""
    payload = {"ENABLE_CHAT_SHARING": True}
    result = _req("POST", "/api/v1/configs/", payload, dry_run=dry_run)
    if result:
        logger.info("Chat sharing enabled")
        return True
    logger.warning("Failed to enable chat sharing — may require manual toggle in Admin Panel")
    return False


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Bootstrap MIRA Open WebUI models and prompts")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be created — no API calls")
    args = parser.parse_args()

    if not OW_KEY and not args.dry_run:
        logger.error("OPENWEBUI_API_KEY not set — run with doppler or set the env var")
        return

    logger.info("Starting OW bootstrap (dry_run=%s, base=%s)", args.dry_run, OW_BASE)

    model_results = ensure_models(dry_run=args.dry_run)
    prompt_results = ensure_prompts(dry_run=args.dry_run)
    sharing_ok = enable_chat_sharing(dry_run=args.dry_run)

    print("\n=== Bootstrap Summary ===")
    print("\nModels:")
    for model_id, status in model_results.items():
        print(f"  {model_id}: {status}")

    print("\nPrompt templates:")
    for command, status in prompt_results.items():
        print(f"  /{command}: {status}")

    print(f"\nChat sharing: {'enabled' if sharing_ok else 'failed (toggle manually)'}")

    created_m = sum(1 for s in model_results.values() if s == "created")
    created_p = sum(1 for s in prompt_results.values() if s == "created")
    print(f"\nDone: {created_m} model(s) created, {created_p} prompt(s) created.")

    if args.dry_run:
        print("\n(DRY RUN — no changes made)")


if __name__ == "__main__":
    main()
