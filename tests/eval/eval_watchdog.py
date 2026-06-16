"""eval_watchdog.py — Parse the latest eval scorecard into a structured JSON failure report.

The eval-fixer agent runs this first to understand what broke before deciding whether and
how to patch. Outputs JSON to stdout; everything else goes to stderr.

Usage:
    python3 tests/eval/eval_watchdog.py [--runs-dir PATH] [--json]

Exit codes:
    0  — clean (no failures) or failures reported in JSON
    1  — error reading/parsing scorecard
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

# Checkpoint name → autopatch eligibility and patch target hint
CHECKPOINT_META: dict[str, dict] = {
    "cp_reached_state": {
        "autopatch": True,
        "target_files": ["mira-bots/shared/engine.py"],
        "label": "FSM state",
    },
    "cp_keyword_match": {
        "autopatch": True,
        "target_files": [
            "mira-bots/shared/guardrails.py",
            "prompts/diagnose/active.yaml",
        ],
        "label": "Keyword match",
    },
    "cp_turn_budget": {
        "autopatch": True,
        "target_files": ["mira-bots/shared/engine.py"],
        "label": "Turn budget",
    },
    "cp_pipeline_active": {
        "autopatch": False,
        "target_files": [],
        "label": "Pipeline active",
        "skip_reason": "Infra/response-generation issue — needs human diagnosis",
    },
    "cp_citation_groundedness": {
        "autopatch": False,
        "target_files": [],
        "label": "Citation groundedness",
        "skip_reason": "Hallucination root cause too broad — needs human diagnosis",
    },
    "cp_no_5xx": {
        "autopatch": False,
        "target_files": [],
        "label": "No 5xx",
        "skip_reason": "HTTP errors are infra, not code",
    },
}

# Map scorecard column header text → canonical checkpoint key
HEADER_TO_KEY: dict[str, str] = {
    "fsm state": "cp_reached_state",
    "pipeline active": "cp_pipeline_active",
    "keyword match": "cp_keyword_match",
    "no 5xx": "cp_no_5xx",
    "turn budget": "cp_turn_budget",
    "citation groundedness": "cp_citation_groundedness",
}


def find_latest_scorecard(runs_dir: Path) -> Path | None:
    """Return the most recently modified .md scorecard in runs_dir."""
    candidates = [
        p for p in runs_dir.glob("*.md")
        if not p.name.startswith(".")
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def parse_pass_rate(text: str) -> tuple[int, int]:
    """Extract (passed, total) from the **Pass rate:** header line."""
    m = re.search(r"\*\*Pass rate:\*\*\s*(\d+)/(\d+)", text)
    if m:
        return int(m.group(1)), int(m.group(2))
    return 0, 0


def parse_failures(text: str) -> list[dict]:
    """
    Parse the ## Failures section.

    Returns a list of dicts:
        {
          "fixture_id": str,
          "checkpoints_failed": [
              {"key": "cp_keyword_match", "reason": "No honesty signal..."},
              ...
          ],
          "last_response_snippet": str,
          "autopatch_eligible": bool,
          "patch_targets": [str],
        }
    """
    failures_section = re.search(
        r"## Failures\s*(.*?)(?=^## |\Z)", text, re.DOTALL | re.MULTILINE
    )
    if not failures_section:
        return []

    section = failures_section.group(1)
    # Each fixture block starts with "### fixture_id"
    blocks = re.split(r"^### ", section, flags=re.MULTILINE)
    results = []

    for block in blocks:
        if not block.strip():
            continue

        lines = block.strip().splitlines()
        fixture_id = lines[0].strip()
        checkpoints_failed = []
        last_response = ""

        for line in lines[1:]:
            # Checkpoint failure: "- **cp_reached_state** FAILED: reason"
            cp_match = re.match(
                r"\s*-\s+\*\*(\w+)\*\*\s+FAILED:\s+(.*)", line
            )
            if cp_match:
                raw_key = cp_match.group(1).strip()
                reason = cp_match.group(2).strip()
                # Normalize: "FSM state" → "cp_reached_state" if needed
                key = raw_key if raw_key.startswith("cp_") else (
                    HEADER_TO_KEY.get(raw_key.lower(), raw_key)
                )
                checkpoints_failed.append({"key": key, "reason": reason})

            # Last response snippet
            resp_match = re.match(r"\s*-\s+Last response:\s+(.*)", line)
            if resp_match:
                last_response = resp_match.group(1).strip()

        if not checkpoints_failed:
            continue

        # Determine autopatch eligibility: ALL failed checkpoints must be patchable
        patchable = [cp for cp in checkpoints_failed if CHECKPOINT_META.get(cp["key"], {}).get("autopatch")]
        not_patchable = [cp for cp in checkpoints_failed if not CHECKPOINT_META.get(cp["key"], {}).get("autopatch")]

        # Collect unique patch targets across all patchable checkpoints
        patch_targets: list[str] = []
        seen: set[str] = set()
        for cp in patchable:
            for f in CHECKPOINT_META.get(cp["key"], {}).get("target_files", []):
                if f not in seen:
                    patch_targets.append(f)
                    seen.add(f)

        results.append({
            "fixture_id": fixture_id,
            "checkpoints_failed": checkpoints_failed,
            "patchable_checkpoints": [cp["key"] for cp in patchable],
            "skip_checkpoints": [
                {
                    "key": cp["key"],
                    "skip_reason": CHECKPOINT_META.get(cp["key"], {}).get("skip_reason", "Unknown"),
                }
                for cp in not_patchable
            ],
            "autopatch_eligible": bool(patchable) and not bool(not_patchable),
            "patch_targets": patch_targets,
            "last_response_snippet": last_response[:200],
        })

    return results


def parse_regressions(text: str) -> list[str]:
    """Return fixture IDs listed under 'Regressions (was passing, now failing)'."""
    section = re.search(
        r"(?:Regressions|was passing.*?now failing)[^\n]*\n(.*?)(?=\n##|\Z)",
        text,
        re.DOTALL | re.IGNORECASE,
    )
    if not section:
        return []
    items = re.findall(r"[-*]\s+(\S+)", section.group(1))
    return items


def parse_judge_summary(text: str) -> dict | None:
    """Extract judge dimension averages if present."""
    summary_match = re.search(
        r"## Judge Summary\s*(.*?)(?=^## |\Z)", text, re.DOTALL | re.MULTILINE
    )
    if not summary_match:
        return None
    summary_text = summary_match.group(1)
    dims: dict[str, float] = {}
    for m in re.finditer(r"\|\s*(\w+)\s*\|\s*([\d.]+)\s*\|", summary_text):
        dims[m.group(1).lower()] = float(m.group(2))
    return dims if dims else None


def build_report(scorecard_path: Path) -> dict:
    """Parse scorecard and return structured report dict."""
    text = scorecard_path.read_text(encoding="utf-8")

    passed, total = parse_pass_rate(text)
    failures = parse_failures(text)
    regressions = parse_regressions(text)
    judge_summary = parse_judge_summary(text)

    patchable = [f for f in failures if f["autopatch_eligible"]]
    skip_only = [f for f in failures if not f["autopatch_eligible"]]

    # Cluster patchable failures by target file
    file_clusters: dict[str, list[str]] = {}
    for f in patchable:
        for target in f["patch_targets"]:
            file_clusters.setdefault(target, []).append(f["fixture_id"])

    return {
        "scorecard_path": str(scorecard_path),
        "pass_rate": {"passed": passed, "total": total, "pct": round(passed / total * 100) if total else 0},
        "total_failures": len(failures),
        "patchable_failures": len(patchable),
        "skip_failures": len(skip_only),
        "clean": len(failures) == 0,
        "regressions": regressions,
        "judge_summary": judge_summary,
        "file_clusters": file_clusters,
        "failures": failures,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Parse latest MIRA eval scorecard into JSON")
    parser.add_argument(
        "--runs-dir",
        default="tests/eval/runs",
        help="Directory containing scorecard .md files (default: tests/eval/runs)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        default=True,
        help="Output JSON (default: True)",
    )
    parser.add_argument(
        "--scorecard",
        default=None,
        help="Path to specific scorecard file (overrides --runs-dir latest-detection)",
    )
    args = parser.parse_args()

    # Resolve runs dir relative to repo root (script may be invoked from any cwd)
    script_dir = Path(__file__).parent
    repo_root = script_dir.parent.parent
    runs_dir = Path(args.runs_dir) if Path(args.runs_dir).is_absolute() else repo_root / args.runs_dir

    if args.scorecard:
        scorecard_path = Path(args.scorecard)
        if not scorecard_path.is_absolute():
            scorecard_path = repo_root / args.scorecard
    else:
        scorecard_path = find_latest_scorecard(runs_dir)

    if scorecard_path is None or not scorecard_path.exists():
        print(json.dumps({"error": f"No scorecard found in {runs_dir}"}), flush=True)
        sys.exit(1)

    print(f"Parsing: {scorecard_path}", file=sys.stderr)

    try:
        report = build_report(scorecard_path)
    except Exception as exc:
        print(json.dumps({"error": str(exc), "scorecard": str(scorecard_path)}), flush=True)
        sys.exit(1)

    print(json.dumps(report, indent=2), flush=True)

    if report["clean"]:
        print("Eval clean — no failures detected.", file=sys.stderr)
    else:
        print(
            f"{report['total_failures']} failures: "
            f"{report['patchable_failures']} autopatch-eligible, "
            f"{report['skip_failures']} need human review.",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
