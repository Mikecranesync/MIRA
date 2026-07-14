#!/usr/bin/env python3.12
"""Hash every Run-A baseline artifact and emit MANIFEST.json + MANIFEST.md.

Deterministic: sha256 of each file in this directory (except the manifests and
this script), sorted by path. Records commit SHA, pack/extractor versions, and
execution timestamp read from env.json (single source of truth for the stamp).
"""
from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
SELF_EXCLUDE = {"MANIFEST.json", "MANIFEST.md", "make_manifest.py"}


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    h.update(p.read_bytes())
    return h.hexdigest()


def git(*a: str) -> str:
    try:
        return subprocess.check_output(["git", "-C", str(REPO), *a], text=True).strip()
    except Exception as exc:
        return f"<git error: {exc}>"


env = json.loads((HERE / "env.json").read_text())

files = sorted(
    p for p in HERE.rglob("*")
    if p.is_file() and p.name not in SELF_EXCLUDE and "__pycache__" not in p.parts
)
entries = [
    {"path": str(p.relative_to(HERE)), "bytes": p.stat().st_size, "sha256": sha256(p)}
    for p in files
]

manifest = {
    "run": "A",
    "subject": "IMPULSE G+ Mini fault-code baseline (frozen)",
    "immutable": True,
    "execution_timestamp_utc": env["executed_utc"],
    "commit_sha": env["repo_commit"],
    "commit_branch_at_capture": env["repo_branch"],
    "python_version": env["python_version"],
    "platform": env["platform"],
    "schema_fault_codes_annotation": env["fault_codes_annotation"],
    "loader_supported_schema_versions": env["loader_supported_schema_versions"],
    "pack_versions": {
        "durapulse_gs10": env["gs10_pack_version"],
        "powerflex_525": env["powerflex_525_pack_version"],
        "powerflex_40": env["powerflex_40_pack_version"],
    },
    "extractor_dir": env["extractor_dir"],
    "extractor_version_note": (
        "tools/drive-pack-extract has no version string; identity is the commit "
        "SHA above. GS10 is registered automatable=false (no generator+gold), and "
        "G+ Mini is absent from the registry entirely."
    ),
    "hash_algorithm": "sha256",
    "self_excluded_from_hashing": sorted(SELF_EXCLUDE),
    "artifact_count": len(entries),
    "artifacts": entries,
}

(HERE / "MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n")

lines = [
    "# Run A baseline — hash manifest",
    "",
    f"- **Run:** A (frozen, immutable)",
    f"- **Subject:** IMPULSE G+ Mini fault-code baseline",
    f"- **Execution timestamp (UTC):** {manifest['execution_timestamp_utc']}",
    f"- **Commit SHA:** `{manifest['commit_sha']}`",
    f"- **Branch at capture:** `{manifest['commit_branch_at_capture']}`",
    f"- **Python:** {manifest['python_version']}  ·  **Platform:** {manifest['platform']}",
    f"- **schema fault_codes annotation:** `{manifest['schema_fault_codes_annotation']}`",
    f"- **Pack versions:** GS10 v{manifest['pack_versions']['durapulse_gs10']}, "
    f"PF525 v{manifest['pack_versions']['powerflex_525']}, "
    f"PF40 v{manifest['pack_versions']['powerflex_40']}",
    f"- **Hash algorithm:** sha256  ·  **Artifacts:** {manifest['artifact_count']}",
    f"- **Self-excluded (chicken-and-egg):** {', '.join(manifest['self_excluded_from_hashing'])}",
    "",
    "| Artifact | Bytes | sha256 |",
    "|---|---|---|",
]
for e in entries:
    lines.append(f"| `{e['path']}` | {e['bytes']} | `{e['sha256']}` |")
lines.append("")
lines.append("Verify: `cd docs/eval/drive-pack-faultcode-runA && "
             "shasum -a 256 <artifact>` and compare, or re-run `make_manifest.py` "
             "and diff MANIFEST.json (byte-identical on an unchanged tree).")
lines.append("")
(HERE / "MANIFEST.md").write_text("\n".join(lines))

print(f"wrote MANIFEST.json + MANIFEST.md ({len(entries)} artifacts hashed)")
for e in entries:
    print(f"  {e['sha256'][:16]}…  {e['path']}")
