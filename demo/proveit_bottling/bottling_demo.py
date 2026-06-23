"""ProveIt bottling demo — loaders, the MIRA answer-card builder, and the live-cell probe.

Card sources:
  * simulated scenarios  -> data-driven card from scenarios.json (honest: simulated, no OEM manual)
  * pe101_blocked (live) -> REUSES demo/conv_simple_demo.py (the real Conv_Simple card)  [no duplication]
  * gs10_fault   (live)  -> a GS10-fault card citing the real GS10 evidence

Deterministic, stdlib-only (+ the sibling demo packages). No clock, no randomness, no network.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent          # demo/proveit_bottling/
DEMO = HERE.parent                              # demo/
ROOT = DEMO.parent                              # worktree root
for _p in (str(DEMO), str(ROOT / "mqtt_uns")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import conv_simple_demo as cs  # noqa: E402  (the existing Conv_Simple demo — reused, never modified)

ASSETS_PATH = HERE / "assets.json"
SCENARIOS_PATH = HERE / "scenarios.json"
EVIDENCE_LINKS_PATH = HERE / "evidence_links.json"


def _load(path: Path) -> dict:
    d = json.loads(Path(path).read_text(encoding="utf-8"))
    d.pop("_comment", None)
    return d


def load_assets() -> dict:
    return _load(ASSETS_PATH)


def load_scenarios() -> dict:
    return _load(SCENARIOS_PATH)


def load_evidence_links() -> dict:
    return _load(EVIDENCE_LINKS_PATH)


def conv_simple_manifest() -> dict:
    """The REAL Conv_Simple evidence manifest (demo/evidence/evidence_manifest.json) — referenced, not copied."""
    return cs.load_manifest()


def live_cell_available() -> bool:
    """Is the supervised Conv_Simple bench online? Deterministic-safe: OFF unless explicitly enabled.

    The bench is a real, supervised asset (not 24/7), so a normal demo run treats it as offline and
    degrades to the evidence snapshot. Set CONV_SIMPLE_LIVE_CELL=1 to assert it is online."""
    return os.environ.get("CONV_SIMPLE_LIVE_CELL", "") == "1"


# --- card building ------------------------------------------------------------------------------

def _manuals_from_refs(refs: list, manifest: dict) -> list:
    by_id = {e["id"]: e for e in manifest.get("evidence", [])}
    out = []
    for rid in refs:
        e = by_id.get(rid)
        if e:
            out.append({"id": e["id"], "title": e["title"], "source": e["source"], "why": e["why_mira_uses_it"]})
    return out


def build_card(scenario: dict, manifest: dict) -> dict:
    """Return a normalized answer-card dict (the 9 sections) for any scenario."""
    # Live Conv_Simple photoeye scenario -> reuse the REAL card from conv_simple_demo (no duplication).
    if scenario.get("use_conv_simple_card"):
        card = cs.build_answer_card(cs.FLAGSHIP, manifest)
        return {
            "scenario_id": scenario["id"],
            "asset_uns": scenario["asset_uns"],
            "kind": scenario["kind"],
            "question": card.question,
            "most_likely_cause": card.most_likely_cause,
            "confidence": card.confidence,
            "why": card.why,
            "evidence_for": card.evidence_for,
            "evidence_against": card.evidence_against,
            "manuals_used": card.manuals_used,
            "similar_history": card.similar_history,
            "technician_checks": card.technician_checks,
            "human_review": card.human_review,
        }

    # GS10-fault live scenario -> a card citing the real GS10 evidence (contrast: drive fault present).
    if scenario.get("card_builder") == "gs10_fault":
        t = scenario.get("tags", {})
        return {
            "scenario_id": scenario["id"],
            "asset_uns": scenario["asset_uns"],
            "kind": scenario["kind"],
            "question": scenario["question"],
            "most_likely_cause": "The GS10 VFD tripped on a drive fault (E07 overcurrent) — this IS a "
                                 "drive fault, not a photoeye jam.",
            "confidence": "High",
            "why": [
                "GS10 reports fault code E07 (overcurrent)",
                "Conveyor run = FALSE and motor RPM = 0",
                "The photoeye beam is CLEAR — so this is NOT a photo-eye jam (contrast pe101_blocked)",
            ],
            "evidence_for": [f"{k} = {v}" for k, v in t.get("abnormal", {}).items()],
            "evidence_against": [f"{k} = {v}" for k, v in t.get("healthy", {}).items()]
            + ["Photoeye clear → rules out the A12 photo-eye jam path."],
            "manuals_used": _manuals_from_refs(scenario.get("evidence_refs", []), manifest),
            "similar_history": ["GS10 E07 overcurrent has been seen on belt-overload — see the GS10 fault chapter."],
            "technician_checks": [
                "Read the GS10 keypad fault (confirm E07) and the last current peak.",
                "Under LOTO, check the belt/motor for a mechanical bind or overload.",
                "Confirm the load is free before clearing the fault and restarting.",
            ],
            "human_review": ["Confirm the GS10 fault on the keypad before resetting (do not auto-reset)."],
        }

    # Simulated scenario -> data-driven card from scenarios.json (honest: simulated, no OEM manual).
    c = scenario.get("card", {})
    t = scenario.get("tags", {})
    return {
        "scenario_id": scenario["id"],
        "asset_uns": scenario["asset_uns"],
        "kind": scenario["kind"],
        "question": scenario["question"],
        "most_likely_cause": c.get("most_likely_cause", ""),
        "confidence": c.get("confidence", "Medium"),
        "why": c.get("why", []),
        "evidence_for": c.get("evidence_for", [f"{k} = {v}" for k, v in t.get("abnormal", {}).items()]),
        "evidence_against": c.get("evidence_against", [f"{k} = {v}" for k, v in t.get("healthy", {}).items()]),
        "manuals_used": _manuals_from_refs(scenario.get("evidence_refs", []), manifest),
        "similar_history": c.get("similar_history", []),
        "technician_checks": c.get("technician_checks", []),
        "human_review": c.get("human_review", []),
    }


def render_card(card: dict) -> str:
    L = [f"# Ask MIRA — {card['scenario_id']} ({card['kind']})", ""]
    L.append(f"**Asset:** `{card['asset_uns']}`")
    L.append(f"**Question:** {card['question']}")
    L.append("")
    L.append(f"**Most likely cause:** {card['most_likely_cause']}")
    L.append(f"**Confidence:** {card['confidence']}")
    for title, key in (("Why MIRA thinks that", "why"), ("Evidence for", "evidence_for"),
                       ("Evidence against", "evidence_against")):
        L.append("")
        L.append(f"**{title}:**")
        for x in card.get(key, []):
            L.append(f"- {x}")
    L.append("")
    L.append("**Manuals / procedures used (receipts):**")
    if card["manuals_used"]:
        for m in card["manuals_used"]:
            L.append(f"- {m['title']} — `{m['source']}`")
    else:
        L.append("- (none — SIMULATED asset; no OEM manual on file)")
    for title, key in (("Similar history", "similar_history"), ("Technician checks", "technician_checks"),
                       ("Human review needed", "human_review")):
        L.append("")
        L.append(f"**{title}:**")
        for x in card.get(key, []):
            L.append(f"- {x}")
    return "\n".join(L)
