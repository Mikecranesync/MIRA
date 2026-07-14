#!/usr/bin/env python3
"""Generate catalog/organization.yaml from catalog/evidence/gh-repo-list.json.

Deterministic: classification comes from the gh `isArchived` flag (confirmed,
detection_method gh-cli) refined by an explicit override table + description
heuristics (strong-inference, detection_method gh-description). No hand
transcription of the 98-repo list — regenerate with `python catalog/build_organization.py`.

Classification taxonomy (archaeology plan):
  production-critical | active-supporting | superseded | archived-experimental
  | documentation-only | demo | generated | abandoned
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

CATALOG = Path(__file__).resolve().parent
SRC = CATALOG / "evidence" / "gh-repo-list.json"
OUT = CATALOG / "organization.yaml"
TODAY = date.today().isoformat()

# Explicit, reasoned classifications (confirmed via gh + local checkout inspection).
# name -> (classification, confidence, note)
OVERRIDE = {
    "MIRA": ("production-critical", "confirmed",
             "Primary monorepo. 23 mira-* module dirs + plc/ + simlab/ + ignition/. Active daily (pushed 2026-07-14). The live product surface."),
    "factorylm": ("production-critical", "confirmed",
                  "Separate Digital-Twin monorepo (~40 top-level dirs). Local checkout ~/factorylm (10 behind origin/main as of run). Distinct codebase from MIRA."),
    "MIRA_PLC": ("production-critical", "confirmed",
                 "Private. Micro820 + GS10 VFD firmware + Ignition project + work-instruction PDF generator. NOT cloned locally — internals cataloged at gh-metadata level only."),
    "factorylm-promo-video-generator": ("active-supporting", "confirmed",
                                        "Promo-video generation tool for the Hub from screenshots/notes. Local ~/factorylm-promo-video."),
    "ladder-logic-editor": ("active-supporting", "confirmed",
                            "Web IEC 61131-3 Structured-Text -> Ladder editor with live PLC sim. TypeScript. Local clone present."),
    "FactoryLM_v2.0": ("superseded", "strong-inference",
                       "Private, default branch 'master', last push 2026-04-05. 'v2.0' multi-tenant RAG platform — predecessor framing; superseded by the MIRA/factorylm split. Not archived but stale."),
    "adversarial-dev": ("active-supporting", "strong-inference",
                        "GAN-style 3-agent harness (Claude Agent SDK + Codex SDK). Not archived; tooling, not product."),
    "dotfiles": ("active-supporting", "strong-inference", "Private personal dotfiles. Not archived."),
    "academic-partners": ("documentation-only", "strong-inference", "Private, sparse. Not archived; likely docs/coordination."),
    "FactoryLM_OS": ("documentation-only", "strong-inference", "Archived Obsidian vault (operating brain). Documentation artifact, not code."),
    "factorylm-agent-space": ("documentation-only", "strong-inference", "Archived Obsidian agent-space / persistent-memory vault."),
    "mikecranesync": ("documentation-only", "strong-inference", "Archived GitHub profile repo."),
    "default": ("generated", "strong-inference", "Archived shared Ranger config for all org repos."),
    "factorylm-cosmos-cookoff": ("demo", "strong-inference", "Archived NVIDIA Cosmos Cookoff 2026 demo. Local clone present."),
    "pi-factory-cosmos": ("demo", "strong-inference", "Archived Pi + Cosmos Reason demo appliance."),
    "factorylm-conveyor-demo": ("demo", "strong-inference", "Archived conveyor mech/electrical drawings + BOM demo (D2)."),
    "factorylm-landing": ("demo", "strong-inference", "Archived landing page for factorylm.com."),
}

# Substrings in gh description that imply 'superseded' (merged into a monolith).
SUPERSEDED_HINTS = ("merged into factorylm monolith", "archived - merged")


def classify(repo: dict):
    name = repo["name"]
    desc = (repo.get("description") or "").lower()
    archived = repo.get("isArchived", False)
    if name in OVERRIDE:
        cls, conf, note = OVERRIDE[name]
        return cls, conf, "gh-cli" if conf == "confirmed" else "gh-description", note
    if any(h in desc for h in SUPERSEDED_HINTS):
        return "superseded", "strong-inference", "gh-description", "gh description says merged into the factorylm monolith."
    if archived:
        return "archived-experimental", "confirmed", "gh-cli", "Archived on GitHub (isArchived=true). Part of the 2026-03-03 'great archive'."
    return "active-supporting", "strong-inference", "gh-cli", "Not archived; role not yet code-verified."


def yaml_escape(s: str) -> str:
    if s is None:
        return '""'
    s = str(s).replace('"', '\\"')
    return f'"{s}"'


def main() -> int:
    repos = json.loads(SRC.read_text())
    rows = []
    for r in sorted(repos, key=lambda x: (not _is_active(x), x["name"].lower())):
        cls, conf, method, note = classify(r)
        rows.append({
            "name": r["name"],
            "visibility": r.get("visibility", "").lower(),
            "archived": r.get("isArchived", False),
            "default_branch": (r.get("defaultBranchRef") or {}).get("name") if r.get("defaultBranchRef") else None,
            "primary_language": (r.get("primaryLanguage") or {}).get("name") if r.get("primaryLanguage") else None,
            "last_push": (r.get("pushedAt") or "")[:10],
            "disk_kb": r.get("diskUsage"),
            "classification": cls,
            "classification_confidence": conf,
            "detection_method": method,
            "description": r.get("description") or "",
            "note": note,
        })

    lines = [
        "# organization.yaml — FactoryLM/MIRA GitHub org inventory (Phase 1)",
        "# GENERATED by catalog/build_organization.py from catalog/evidence/gh-repo-list.json.",
        "# Do not hand-edit rows; edit the OVERRIDE table in the generator and regenerate.",
        f"# last_generated: {TODAY}",
        "organization: Mikecranesync",
        f"repository_count: {len(rows)}",
        "detection_method: gh-cli  # `gh repo list Mikecranesync --limit 100 --json ...`",
        "classification_legend:",
        "  production-critical: on the live product path, actively developed",
        "  active-supporting: not archived, supporting tool / not-yet-code-verified role",
        "  superseded: replaced by a newer repo (often merged into a monolith)",
        "  archived-experimental: archived on GitHub; frozen experiment",
        "  documentation-only: vault / profile / docs, not runnable code",
        "  demo: marketing / demo / competition artifact",
        "  generated: generated or shared-config repo",
        "repositories:",
    ]
    for row in rows:
        lines.append(f"  - name: {yaml_escape(row['name'])}")
        lines.append(f"    visibility: {row['visibility']}")
        lines.append(f"    archived: {str(row['archived']).lower()}")
        lines.append(f"    default_branch: {yaml_escape(row['default_branch']) if row['default_branch'] else 'null'}")
        lines.append(f"    primary_language: {yaml_escape(row['primary_language']) if row['primary_language'] else 'null'}")
        lines.append(f"    last_push: {yaml_escape(row['last_push'])}")
        lines.append(f"    disk_kb: {row['disk_kb'] if row['disk_kb'] is not None else 'null'}")
        lines.append(f"    classification: {row['classification']}")
        lines.append(f"    classification_confidence: {row['classification_confidence']}")
        lines.append(f"    detection_method: {row['detection_method']}")
        lines.append(f"    description: {yaml_escape(row['description'])}")
        lines.append(f"    note: {yaml_escape(row['note'])}")
    OUT.write_text("\n".join(lines) + "\n")
    print(f"wrote {OUT} with {len(rows)} repos")
    return 0


def _is_active(r: dict) -> bool:
    return not r.get("isArchived", False)


if __name__ == "__main__":
    raise SystemExit(main())
