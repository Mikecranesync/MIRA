"""FactoryLM Hub bundle builder for the ProveIt bottling demo.

Produces a self-describing JSON bundle (assets + scenarios + evidence links + UNS map + supervision
flags) that the FactoryLM Hub can import. The Hub is OPTIONAL for local execution: the bundle is just a
file. The "adapter" writes that file; a real Hub import would POST it. No network in a deterministic run.
"""
from __future__ import annotations

import json
from pathlib import Path

import bottling_demo as bd

BUNDLE_VERSION = "1.0"
EXPORTS_DIR = bd.HERE / "exports"
BUNDLE_PATH = EXPORTS_DIR / "proveit_bottling_factorylm_bundle.json"


def build_bundle() -> dict:
    assets_doc = bd.load_assets()
    scenarios_doc = bd.load_scenarios()
    evidence_doc = bd.load_evidence_links()
    manifest = bd.conv_simple_manifest()

    assets = assets_doc["assets"]
    scenarios = scenarios_doc["scenarios"]

    uns_map = {a["key"]: {"uns": a["uns"], "mqtt_topic": a["mqtt_topic"]} for a in assets}
    supervision = {
        a["key"]: {
            "mode": a["mode"],
            "requires_supervision": a["requires_supervision"],
            "runs_24_7": a["runs_24_7"],
            "layer": a["layer"],
        }
        for a in assets
    }

    # Scenario summaries with their resolved evidence titles (receipts) — Hub renders these.
    by_evidence_id = {e["id"]: e for e in manifest.get("evidence", [])}
    scenario_summaries = []
    for s in scenarios:
        receipts = [
            {"id": rid, "title": by_evidence_id[rid]["title"], "source": by_evidence_id[rid]["source"]}
            for rid in s.get("evidence_refs", [])
            if rid in by_evidence_id
        ]
        scenario_summaries.append(
            {
                "id": s["id"],
                "kind": s["kind"],
                "asset_uns": s["asset_uns"],
                "symptom": s["symptom"],
                "question": s["question"],
                "receipts": receipts,
                "review_notes": s.get("review_notes", ""),
            }
        )

    return {
        "factorylm_bundle_version": BUNDLE_VERSION,
        "demo": "proveit_bottling",
        "uns_root": assets_doc["uns_root"],
        "areas": assets_doc["areas"],
        "asset_count": len(assets),
        "scenario_count": len(scenarios),
        "assets": assets,
        "scenarios": scenario_summaries,
        "evidence_links": evidence_doc,
        "uns_map": uns_map,
        "supervision": supervision,
        "notes": "Hub-importable bundle. Hub optional locally — this file IS the import payload. "
                 "Conv_Simple is a live_supervised_bench cell (requires_supervision=true, runs_24_7=false).",
    }


def write_bundle(bundle: dict, path: Path = BUNDLE_PATH) -> Path:
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def export_for_hub() -> dict:
    """Offline adapter: build + write the bundle. Returns a small status dict (no network)."""
    bundle = build_bundle()
    path = write_bundle(bundle)
    return {
        "written": str(path.relative_to(bd.ROOT)),
        "asset_count": bundle["asset_count"],
        "scenario_count": bundle["scenario_count"],
        "hub_import": "offline — file written; a live Hub would POST this payload to /api/import",
    }
