#!/usr/bin/env python3
"""Catalog validator — makes the archaeology catalog machine-checkable.

Fails (exit 1) when unsupported claims or structural defects enter the catalog.
This is the guard that keeps the catalog a "durable, developer-grade catalog"
rather than the shallow, speculative doc dump the archaeology plan forbids.

Checks (proportional, dependency-light — stdlib + PyYAML only):
  1. Every fact object has the required fields (fact/repository/confidence/
     detection_method/last_verified) and valid enum values + ISO date.
  2. confidence=confirmed  ⇒  non-empty `file` AND a code-level detection_method
     (never gh-description / manual-reasoning / existing-doc alone).
  3. Referenced `file` exists — for repos whose checkout we can resolve locally
     (MIRA = catalog root's repo, factorylm = ~/factorylm). Missing file on a
     resolvable repo is an error (surfaces deleted/renamed components). Other
     repos are skipped (not cloned) and reported as SKIPPED, not passed silently.
  4. No duplicate identifiers within an inventory list (id / name / canonical_name).
  5. Mermaid diagrams (catalog/*.mmd) pass a basic syntax sanity check, and
     compile via mmdc if it is installed.
  6. organization.yaml is present and every repo row carries name + classification.

Usage: python catalog/validate.py   (run from repo root or catalog/)
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("FATAL: PyYAML not installed (pip install pyyaml). Cannot validate.", file=sys.stderr)
    sys.exit(2)

CATALOG = Path(__file__).resolve().parent
REPO_ROOT = CATALOG.parent  # the MIRA worktree/checkout that contains catalog/

# Where each repository's working tree lives locally, for file-existence checks.
LOCAL_CHECKOUTS = {
    "MIRA": REPO_ROOT,
    "factorylm": Path.home() / "factorylm",
}

CODE_LEVEL_METHODS = {"rg", "grep", "ls", "fd", "file-read", "ast-grep", "codegraph", "yq", "jq", "syft", "osv-scanner", "gh-cli"}
VALID_METHODS = CODE_LEVEL_METHODS | {"gh-description", "manual-reasoning", "existing-doc"}
VALID_CONFIDENCE = {"confirmed", "strong-inference", "unknown"}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

errors: list[str] = []
warnings: list[str] = []
skipped_files = 0
fact_count = 0


def is_fact(obj) -> bool:
    return isinstance(obj, dict) and "fact" in obj and "confidence" in obj


def check_fact(fact: dict, where: str) -> None:
    global skipped_files, fact_count
    fact_count += 1
    fid = fact.get("fact", "<no-fact>")[:60]
    for req in ("fact", "repository", "confidence", "detection_method", "last_verified"):
        if not fact.get(req):
            errors.append(f"{where}: fact '{fid}' missing required field '{req}'")
    conf = fact.get("confidence")
    if conf and conf not in VALID_CONFIDENCE:
        errors.append(f"{where}: fact '{fid}' invalid confidence '{conf}'")
    method = fact.get("detection_method")
    if method and method not in VALID_METHODS:
        errors.append(f"{where}: fact '{fid}' invalid detection_method '{method}'")
    lv = fact.get("last_verified", "")
    if lv and not DATE_RE.match(str(lv)):
        errors.append(f"{where}: fact '{fid}' last_verified not ISO date: '{lv}'")
    if conf == "confirmed":
        if not fact.get("file"):
            errors.append(f"{where}: CONFIRMED fact '{fid}' has no `file` evidence")
        if method and method not in CODE_LEVEL_METHODS:
            errors.append(
                f"{where}: CONFIRMED fact '{fid}' uses non-code detection_method "
                f"'{method}' — downgrade to strong-inference or verify in code"
            )
    # File existence for resolvable repos
    f = fact.get("file")
    repo = fact.get("repository")
    if f and f.startswith("catalog/"):
        # Catalog artifact (e.g. evidence/*.txt) — always lives in the catalog repo,
        # regardless of which repository the fact is ABOUT.
        if not (REPO_ROOT / f).exists():
            errors.append(f"{where}: fact '{fid}' references missing catalog artifact '{f}'")
    elif f and repo in LOCAL_CHECKOUTS:
        base = LOCAL_CHECKOUTS[repo]
        if not base.exists():
            warnings.append(f"{where}: repo '{repo}' checkout not found at {base}; skipped file check")
        elif not (base / f).exists():
            errors.append(f"{where}: fact '{fid}' references missing file '{f}' in {repo}")
    elif f and repo not in LOCAL_CHECKOUTS:
        skipped_files += 1


def walk(obj, where: str) -> None:
    if is_fact(obj):
        check_fact(obj, where)
    if isinstance(obj, dict):
        for v in obj.values():
            walk(v, where)
    elif isinstance(obj, list):
        for v in obj:
            walk(v, where)


def check_dup_ids(obj, where: str) -> None:
    """Reject duplicate id/name/canonical_name within any list of dicts."""
    if isinstance(obj, dict):
        for v in obj.values():
            check_dup_ids(v, where)
    elif isinstance(obj, list):
        seen: dict[str, int] = {}
        for item in obj:
            if isinstance(item, dict):
                key = item.get("id") or item.get("canonical_name") or item.get("name")
                if key:
                    seen[key] = seen.get(key, 0) + 1
            check_dup_ids(item, where)
        for key, n in seen.items():
            if n > 1:
                errors.append(f"{where}: duplicate identifier '{key}' appears {n}x in a list")


def check_mermaid() -> None:
    mmdc = shutil.which("mmdc")
    for mmd in sorted(CATALOG.glob("*.mmd")):
        text = mmd.read_text()
        if not text.strip():
            errors.append(f"{mmd.name}: empty mermaid file")
            continue
        head = text.strip().splitlines()[0].strip()
        if not re.match(r"^(graph|flowchart|sequenceDiagram|classDiagram|erDiagram|stateDiagram|C4Context)", head):
            errors.append(f"{mmd.name}: first line is not a mermaid diagram type: '{head[:40]}'")
        if text.count("[") != text.count("]"):
            warnings.append(f"{mmd.name}: unbalanced [] brackets ({text.count('[')} vs {text.count(']')})")
        if mmdc:
            r = subprocess.run([mmdc, "-i", str(mmd), "-o", "/tmp/_mmd_check.svg"],
                               capture_output=True, text=True)
            if r.returncode != 0:
                errors.append(f"{mmd.name}: mmdc compile failed: {r.stderr.strip()[:200]}")
        else:
            warnings.append(f"{mmd.name}: mmdc not installed — syntax sanity only")


def main() -> int:
    # YAML files
    for yml in sorted(CATALOG.rglob("*.yaml")):
        if "evidence/" in str(yml.relative_to(CATALOG)):
            continue  # raw evidence, not schema-checked
        try:
            data = yaml.safe_load(yml.read_text())
        except yaml.YAMLError as e:
            errors.append(f"{yml.name}: YAML parse error: {e}")
            continue
        rel = str(yml.relative_to(CATALOG))
        walk(data, rel)
        check_dup_ids(data, rel)

    # relationships.json
    rjson = CATALOG / "relationships.json"
    if rjson.exists():
        try:
            data = json.loads(rjson.read_text())
            walk(data, "relationships.json")
            check_dup_ids(data, "relationships.json")
        except json.JSONDecodeError as e:
            errors.append(f"relationships.json: parse error: {e}")

    # organization.yaml required + row shape
    org = CATALOG / "organization.yaml"
    if not org.exists():
        errors.append("organization.yaml is missing (Phase 1 required output)")
    else:
        odata = yaml.safe_load(org.read_text()) or {}
        repos = odata.get("repositories", [])
        if not repos:
            errors.append("organization.yaml has no `repositories` list")
        for r in repos:
            if not r.get("name") or not r.get("classification"):
                errors.append(f"organization.yaml: repo row missing name/classification: {r.get('name', r)}")

    check_mermaid()

    print(f"catalog validate: {fact_count} facts checked, "
          f"{skipped_files} file-checks skipped (repo not cloned locally)")
    for w in warnings:
        print(f"  WARN  {w}")
    if errors:
        print(f"\nFAILED with {len(errors)} error(s):")
        for e in errors:
            print(f"  ERROR {e}")
        return 1
    print("OK — catalog is internally consistent and evidence-backed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
