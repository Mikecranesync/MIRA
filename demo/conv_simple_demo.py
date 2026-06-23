"""ProveIt Conv_Simple demo — asset/UNS model + flagship fault scenario + Ask-MIRA answer card.

Real bench assets only (GS10 VFD, Micro820 PLC, PE-101 photoeye, conveyor motor, conveyor). The answer
card's "Manuals/procedures used" are REAL receipts pulled from `evidence/evidence_manifest.json` — the
card never cites a document that isn't in the evidence folder, and never fabricates a part number for the
UNKNOWN_MODEL assets (photoeye, motor).

Deterministic, stdlib-only. No clock, no randomness.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
MANIFEST_PATH = HERE / "evidence" / "evidence_manifest.json"
UNS_ROOT = "enterprise.proveit.bench.conv_simple"


def load_manifest(path: Path = MANIFEST_PATH) -> dict:
    d = json.loads(Path(path).read_text(encoding="utf-8"))
    d.pop("_comment", None)
    return d


# Real Conv_Simple tags (from plc/GS10_Integration_Guide.md + the Modbus map). UNS-pathed onto the bench.
TAGS = {
    "di05_photoeye": {"uns": f"{UNS_ROOT}.photoeye_pe101.status.blocked", "type": "BOOL", "desc": "Photoeye PE-101 beam (DI_05)"},
    "conv_run": {"uns": f"{UNS_ROOT}.conveyor.status.running", "type": "BOOL", "desc": "Conveyor run state"},
    "vfd_motor_rpm": {"uns": f"{UNS_ROOT}.conveyor_motor.process.rpm", "type": "WORD", "desc": "GS10 reported motor RPM"},
    "vfd_fault_code": {"uns": f"{UNS_ROOT}.gs10_vfd.faults.fault_code", "type": "WORD", "desc": "GS10 fault code"},
    "vfd_dc_bus_v": {"uns": f"{UNS_ROOT}.gs10_vfd.process.dc_bus_v", "type": "WORD", "desc": "GS10 DC-bus voltage"},
}


@dataclass(frozen=True)
class Scenario:
    id: str
    question: str
    symptom: str
    cause_asset: str          # the root-cause asset key
    ground_truth_cause: str
    abnormal: dict            # tag -> observed (the symptoms present)
    healthy: dict             # tag -> observed (evidence against alternatives)
    chain: tuple              # cause -> effect chain


# The flagship ProveIt scenario: photoeye blocked -> conveyor stopped (anomaly A12 photo-eye jam).
FLAGSHIP = Scenario(
    id="photoeye_blocked",
    question="Why did the conveyor stop?",
    symptom="conveyor_stopped",
    cause_asset="photoeye_pe101",
    ground_truth_cause="Photoeye PE-101 blocked / fouled",
    abnormal={
        "di05_photoeye": "BLOCKED (TRUE)",
        "conv_run": "FALSE (stopped)",
        "vfd_motor_rpm": "0",
    },
    healthy={
        "vfd_fault_code": "0 (no GS10 fault)",
        "vfd_dc_bus_v": "~320 V (nominal)",
    },
    chain=(
        "Photoeye PE-101 beam is blocked (DI_05 latched)",
        "Ladder asserts the photo-eye jam (anomaly A12)",
        "Conveyor soft-stops to protect product",
        "Motor RPM drops to 0 — but the GS10 reports NO drive fault",
    ),
)

SCENARIOS = {FLAGSHIP.id: FLAGSHIP}


@dataclass
class AnswerCard:
    question: str
    most_likely_cause: str
    confidence: str
    why: list = field(default_factory=list)
    evidence_for: list = field(default_factory=list)
    evidence_against: list = field(default_factory=list)
    manuals_used: list = field(default_factory=list)   # real receipts from the manifest
    similar_history: list = field(default_factory=list)
    technician_checks: list = field(default_factory=list)
    human_review: list = field(default_factory=list)

    def to_dict(self) -> dict:
        from dataclasses import asdict
        return asdict(self)


def _tag_line(tag: str, value: str) -> str:
    t = TAGS.get(tag, {})
    return f"{t.get('desc', tag)} [`{t.get('uns', tag)}`] = {value}"


def build_answer_card(scenario: Scenario, manifest: dict) -> AnswerCard:
    """Deterministically build the 9-section maintenance answer card for a scenario, grounded in the
    real tags + the evidence manifest (manuals = real receipts; nothing invented)."""
    manuals = [
        {"id": e["id"], "title": e["title"], "source": e["source"], "why": e["why_mira_uses_it"]}
        for e in manifest.get("evidence", [])
        if scenario.id in e.get("scenario_supported", [])
    ]

    return AnswerCard(
        question=scenario.question,
        most_likely_cause="Photoeye PE-101 appears blocked — the conveyor stopped on a photo-eye jam, "
                           "not a drive or motor fault.",
        confidence="High",
        why=list(scenario.chain),
        evidence_for=[_tag_line(t, v) for t, v in scenario.abnormal.items()]
        + ["Anomaly A12 'Photo-eye jam' fired (di05_photoeye blocked ≥ threshold)."],
        evidence_against=[_tag_line(t, v) for t, v in scenario.healthy.items()]
        + ["No GS10 fault code present → this is NOT a VFD fault (rules out the drive)."],
        manuals_used=manuals,
        similar_history=[
            "Bench log: a 'flaky_photoeye' event was captured before "
            "(plc/conv_simple_anomaly/live_logger.py --label flaky_photoeye). Same DI_05 signature.",
        ],
        technician_checks=[
            "Clean the PE-101 lens (product debris / condensation / label adhesive).",
            "Clear the beam and confirm DI_05 (di05_photoeye) toggles in the PLC.",
            "Inspect the belt for a jammed item holding the beam broken.",
            "Confirm the GS10 shows NO fault (no E07 / CE comm fault) — drive is healthy.",
        ],
        human_review=[
            "Confirm on the bench before acting — this is MIRA's most likely hypothesis.",
            "PE-101 exact model is UNKNOWN_MODEL (not on file) — read the sensor part number off the "
            "bench and record it in demo/evidence/photoeye/notes.md.",
        ],
    )


def render_card(card: AnswerCard) -> str:
    L = []
    L.append("# Ask MIRA — Conv_Simple demo answer card")
    L.append("")
    L.append(f"**Question:** {card.question}")
    L.append("")
    L.append(f"**Most likely cause:** {card.most_likely_cause}")
    L.append(f"**Confidence:** {card.confidence}")
    L.append("")
    L.append("**Why MIRA thinks that:**")
    for s in card.why:
        L.append(f"- {s}")
    L.append("")
    L.append("**Evidence for:**")
    for e in card.evidence_for:
        L.append(f"- {e}")
    L.append("")
    L.append("**Evidence against:**")
    for e in card.evidence_against:
        L.append(f"- {e}")
    L.append("")
    L.append("**Manuals / procedures used (receipts):**")
    for m in card.manuals_used:
        L.append(f"- {m['title']} — `{m['source']}`  ·  {m['why']}")
    L.append("")
    L.append("**Similar history:**")
    for h in card.similar_history:
        L.append(f"- {h}")
    L.append("")
    L.append("**Technician checks:**")
    for c in card.technician_checks:
        L.append(f"- {c}")
    L.append("")
    L.append("**Human review needed:**")
    for r in card.human_review:
        L.append(f"- {r}")
    L.append("")
    L.append("_Every manual above is a real entry in demo/evidence/evidence_manifest.json. Nothing is "
             "invented; UNKNOWN_MODEL assets are flagged, not fabricated._")
    return "\n".join(L)
