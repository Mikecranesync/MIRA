"""Learning Capture — diff benchmark runs, write learnings, file regressions.

Runs after every benchmark suite (or weekly cron). Compares the latest
`benchmark_v*.json` (in repo root) against the previous one and produces:

  1. A dated learning note in `docs/learnings/YYYY-MM-DD_<version>.md`
     summarising overall delta, regressions, and improvements.
  2. A GitHub issue per *new* regression — one issue per case_id, deduped by
     title so re-runs don't spam the tracker.
  3. A Telegram summary (`benchmark` agent persona) so Mike sees it immediately.
  4. A "rubric drift" report flagging cases that have regressed three runs in a
     row — strong signal the rubric is wrong, not the model.

Inputs
------
* `benchmark_v*.json` files in repo root (or `--results-dir` override).
* Schema: each file has `version`, `overall_score`, `grade`, `case_results: [
  {case_id, dimension, score, error, reasoning, ...}, ... ]`.

Outputs
-------
* `docs/learnings/YYYY-MM-DD_<version>.md`
* `gh issue create` for each NEW regression
* Telegram summary

Usage
-----
    python3 mira-crawler/agents/learning_capture.py
    python3 mira-crawler/agents/learning_capture.py --dry-run
    python3 mira-crawler/agents/learning_capture.py --results-dir /tmp/runs
    python3 mira-crawler/agents/learning_capture.py --no-issues
"""

from __future__ import annotations

import argparse
import json
import logging
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] learning: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("learning_capture")


def _load_notify():
    try:
        from mira_crawler.reporting.telegram_notify import notify as _n  # type: ignore

        return _n
    except ImportError:
        pass
    import importlib.util

    tn_path = Path(__file__).resolve().parent.parent / "reporting" / "telegram_notify.py"
    if tn_path.exists():
        spec = importlib.util.spec_from_file_location("telegram_notify", tn_path)
        if spec and spec.loader:
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod.notify

    def _stub(agent_key: str, message: str, **_) -> bool:
        print(f"[{agent_key}] {message}")
        return True

    return _stub


notify = _load_notify()


REGRESSION_THRESHOLD = 0.10  # 10pt absolute drop counts as a regression
IMPROVEMENT_THRESHOLD = 0.10
RUBRIC_DRIFT_RUNS = 3  # consecutive regressions → suggest rubric review


@dataclass
class CaseDelta:
    case_id: str
    dimension: str
    previous_score: float
    current_score: float
    delta: float
    likely_cause: str
    suggested_fix: str
    error: str | None = None
    reasoning: str | None = None


# ── File discovery ───────────────────────────────────────────────────────────


def find_benchmark_files(results_dir: Path) -> list[Path]:
    """Return all `benchmark_v*.json` sorted by version (newest last)."""
    files = sorted(results_dir.glob("benchmark_v*.json"))
    return files


def load_benchmark(path: Path) -> dict:
    with open(path) as f:
        return json.load(f)


# ── Diff logic ───────────────────────────────────────────────────────────────


def index_cases(data: dict) -> dict[str, dict]:
    return {c["case_id"]: c for c in data.get("case_results", [])}


def classify_regression(prev: dict, curr: dict) -> CaseDelta | None:
    delta = (curr.get("score") or 0) - (prev.get("score") or 0)
    if delta > -REGRESSION_THRESHOLD:
        return None

    cause = "unknown"
    fix = "Review reasoning + retrieval for this case"

    err = curr.get("error")
    reasoning = curr.get("reasoning") or ""
    if err:
        cause = f"runtime error: {err[:120]}"
        fix = "Fix the runtime error first, then re-run benchmark"
    elif "not found" in reasoning.lower() or "no relevant" in reasoning.lower():
        cause = "retrieval miss — KB chunk likely missing"
        fix = "Check KB ingest for the topic; consider re-chunking source manuals"
    elif "incorrect" in reasoning.lower() or "wrong" in reasoning.lower():
        cause = "incorrect reasoning despite retrieval"
        fix = "Inspect prompt + tools — the retrieved context didn't drive the right answer"
    elif "incomplete" in reasoning.lower() or "missing" in reasoning.lower():
        cause = "answer too sparse"
        fix = "Tune the response template / Supervisor verbosity for this dimension"

    return CaseDelta(
        case_id=curr.get("case_id", "?"),
        dimension=curr.get("dimension", "?"),
        previous_score=prev.get("score") or 0.0,
        current_score=curr.get("score") or 0.0,
        delta=delta,
        likely_cause=cause,
        suggested_fix=fix,
        error=err,
        reasoning=reasoning[:400] if reasoning else None,
    )


def classify_improvement(prev: dict, curr: dict) -> CaseDelta | None:
    delta = (curr.get("score") or 0) - (prev.get("score") or 0)
    if delta < IMPROVEMENT_THRESHOLD:
        return None
    return CaseDelta(
        case_id=curr.get("case_id", "?"),
        dimension=curr.get("dimension", "?"),
        previous_score=prev.get("score") or 0.0,
        current_score=curr.get("score") or 0.0,
        delta=delta,
        likely_cause="improvement",
        suggested_fix="",
    )


def detect_rubric_drift(history: list[dict], case_id: str) -> bool:
    """If the same case has regressed `RUBRIC_DRIFT_RUNS` runs in a row, the
    rubric is more suspect than the model. Heuristic, not a verdict."""
    if len(history) < RUBRIC_DRIFT_RUNS + 1:
        return False
    scores = []
    for run in history[-(RUBRIC_DRIFT_RUNS + 1) :]:
        case = next((c for c in run.get("case_results", []) if c.get("case_id") == case_id), None)
        if case is None:
            return False
        scores.append(case.get("score") or 0)
    # Strictly decreasing or all below 0.5
    return all(s < 0.5 for s in scores[-RUBRIC_DRIFT_RUNS:])


# ── Output: learning note ────────────────────────────────────────────────────


def write_learning_note(
    out_dir: Path,
    curr: dict,
    prev: dict | None,
    regressions: list[CaseDelta],
    improvements: list[CaseDelta],
    drift: list[str],
) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    version = curr.get("version", "unknown")
    fname = out_dir / f"{today}_v{version}.md"

    lines: list[str] = []
    lines.append(f"# Learning Capture — Benchmark v{version}")
    lines.append(f"\n_Generated {datetime.now(timezone.utc).isoformat(timespec='seconds')}_\n")

    overall = curr.get("overall_score", 0)
    if prev is not None:
        prev_overall = prev.get("overall_score", 0)
        diff = overall - prev_overall
        arrow = "↑" if diff > 0 else ("↓" if diff < 0 else "→")
        lines.append(
            f"## Headline\n\n**{overall:.1f}%** ({arrow}{abs(diff):.1f} from v{prev.get('version', '?')}) — grade {curr.get('grade', '?')}"
        )
    else:
        lines.append(
            f"## Headline\n\n**{overall:.1f}%** — grade {curr.get('grade', '?')} (no previous run to compare)"
        )

    lines.append("\n## Dimension scores")
    lines.append("\n| Dimension | Score | Cases |")
    lines.append("|-----------|-------|-------|")
    for dim, score in curr.get("dimension_scores", {}).items():
        n = curr.get("dimension_case_counts", {}).get(dim, "?")
        lines.append(f"| {dim} | {score:.1f}% | {n} |")

    if regressions:
        lines.append(f"\n## Regressions ({len(regressions)})\n")
        for r in regressions:
            lines.append(f"### `{r.case_id}` ({r.dimension})")
            lines.append(
                f"- previous: **{r.previous_score:.2f}** → current: **{r.current_score:.2f}** (Δ {r.delta:+.2f})"
            )
            lines.append(f"- likely cause: {r.likely_cause}")
            lines.append(f"- suggested fix: {r.suggested_fix}")
            if r.error:
                lines.append(f"- runtime error: `{r.error[:120]}`")
            if r.reasoning:
                lines.append(f"- reasoning: _{r.reasoning[:200]}_")
            lines.append("")

    if improvements:
        lines.append(f"\n## Improvements ({len(improvements)})\n")
        for imp in improvements:
            lines.append(
                f"- `{imp.case_id}` ({imp.dimension}): {imp.previous_score:.2f} → {imp.current_score:.2f} (Δ {imp.delta:+.2f})"
            )

    if drift:
        lines.append(f"\n## Rubric Drift Candidates ({len(drift)})\n")
        lines.append(
            "These cases have regressed for 3+ runs. The rubric may be wrong, not the model.\n"
        )
        for case_id in drift:
            lines.append(
                f"- `{case_id}` — review the expected answer vs. what the model is producing"
            )

    lines.append("\n---\n_Generated by `mira-crawler/agents/learning_capture.py`_\n")

    fname.write_text("\n".join(lines), encoding="utf-8")
    return fname


# ── GitHub issue creation ────────────────────────────────────────────────────


def gh_available() -> bool:
    return shutil.which("gh") is not None


def existing_issue_titles() -> set[str]:
    """List open issues with the `benchmark-regression` label so we don't dupe."""
    if not gh_available():
        return set()
    try:
        out = subprocess.check_output(
            [
                "gh",
                "issue",
                "list",
                "--label",
                "benchmark-regression",
                "--state",
                "open",
                "--json",
                "title",
                "--limit",
                "200",
            ],
            text=True,
            timeout=30,
        )
        return {item["title"] for item in json.loads(out)}
    except Exception as exc:  # noqa: BLE001
        logger.warning("gh issue list failed: %s", exc)
        return set()


def file_issue(reg: CaseDelta, version: str, dry_run: bool) -> bool:
    title = f"benchmark regression: {reg.case_id} ({reg.dimension}) v{version}"
    body = "\n".join(
        [
            f"**Case:** `{reg.case_id}` ({reg.dimension})",
            f"**Previous score:** {reg.previous_score:.2f}",
            f"**Current score:** {reg.current_score:.2f}  (Δ {reg.delta:+.2f})",
            f"**Likely cause:** {reg.likely_cause}",
            f"**Suggested fix:** {reg.suggested_fix}",
            "",
            f"_Auto-filed by `learning_capture.py` from benchmark v{version}._",
        ]
    )
    if reg.error:
        body += f"\n\n**Runtime error:**\n```\n{reg.error[:500]}\n```"
    if reg.reasoning:
        body += f"\n\n**Reasoning:**\n> {reg.reasoning[:500]}"

    if dry_run or not gh_available():
        logger.info("[dry-run/no-gh] would file: %s", title)
        return False
    try:
        subprocess.run(
            [
                "gh",
                "issue",
                "create",
                "--title",
                title,
                "--body",
                body,
                "--label",
                "benchmark-regression",
            ],
            check=True,
            timeout=30,
            capture_output=True,
            text=True,
        )
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("gh issue create failed for %s: %s", reg.case_id, exc)
        return False


# ── Telegram summary ─────────────────────────────────────────────────────────


def telegram_summary(
    curr: dict,
    prev: dict | None,
    regressions: list[CaseDelta],
    improvements: list[CaseDelta],
    note_path: Path,
) -> str:
    overall = curr.get("overall_score", 0)
    version = curr.get("version", "?")
    if prev is not None:
        diff = overall - prev.get("overall_score", 0)
        arrow = "↑" if diff > 0 else "↓"
        head = f"*Benchmark v{version}: {overall:.1f}%* ({arrow}{abs(diff):.1f} from v{prev.get('version', '?')})"
    else:
        head = f"*Benchmark v{version}: {overall:.1f}%*"

    lines = [
        head,
        f"Grade: {curr.get('grade', '?')} — {len(regressions)} regression(s), {len(improvements)} improvement(s)",
    ]
    if regressions:
        lines.append("\n🔻 Regressions:")
        for r in regressions[:5]:
            lines.append(
                f"  • `{r.case_id}` {r.previous_score:.2f}→{r.current_score:.2f} ({r.likely_cause[:40]})"
            )
    if improvements:
        lines.append("\n🔼 Top improvements:")
        for imp in sorted(improvements, key=lambda x: -x.delta)[:3]:
            lines.append(f"  • `{imp.case_id}` {imp.previous_score:.2f}→{imp.current_score:.2f}")
    lines.append(
        f"\n📝 Full note: `{note_path.relative_to(Path.cwd()) if note_path.is_absolute() else note_path}`"
    )
    return "\n".join(lines)


# ── Main ─────────────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Capture learnings from benchmark runs")
    parser.add_argument(
        "--results-dir",
        default=".",
        help="Where to look for benchmark_v*.json (default: repo root)",
    )
    parser.add_argument(
        "--learnings-dir",
        default="docs/learnings",
        help="Where to write learning notes (default: docs/learnings)",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--no-issues", action="store_true", help="Skip GitHub issue creation")
    parser.add_argument("--no-telegram", action="store_true")
    args = parser.parse_args(argv)

    results_dir = Path(args.results_dir).resolve()
    learnings_dir = Path(args.learnings_dir).resolve()

    files = find_benchmark_files(results_dir)
    if not files:
        logger.error("no benchmark_v*.json found in %s", results_dir)
        return 1

    curr = load_benchmark(files[-1])
    prev = load_benchmark(files[-2]) if len(files) > 1 else None
    history = [load_benchmark(f) for f in files[-10:]]  # last 10 runs for drift

    if prev is None:
        logger.info("first benchmark run — no diff possible, writing snapshot only")
        regressions: list[CaseDelta] = []
        improvements: list[CaseDelta] = []
    else:
        prev_idx = index_cases(prev)
        curr_idx = index_cases(curr)
        regressions = []
        improvements = []
        for case_id, curr_case in curr_idx.items():
            prev_case = prev_idx.get(case_id)
            if prev_case is None:
                continue
            r = classify_regression(prev_case, curr_case)
            if r:
                regressions.append(r)
                continue
            i = classify_improvement(prev_case, curr_case)
            if i:
                improvements.append(i)

    drift = [r.case_id for r in regressions if detect_rubric_drift(history, r.case_id)]

    note_path = write_learning_note(learnings_dir, curr, prev, regressions, improvements, drift)
    logger.info("wrote %s", note_path)

    if regressions and not args.no_issues:
        existing = existing_issue_titles()
        version = curr.get("version", "?")
        filed = 0
        for r in regressions:
            # dedupe by case_id to avoid filing per-version when the same case keeps regressing
            if any(r.case_id in t for t in existing):
                continue
            if file_issue(r, version, args.dry_run):
                filed += 1
        logger.info("filed %d new GitHub issue(s)", filed)

    if not args.no_telegram:
        msg = telegram_summary(curr, prev, regressions, improvements, note_path)
        if args.dry_run:
            print(msg)
        else:
            notify("benchmark", msg)

    return 0 if not regressions else 2


if __name__ == "__main__":
    sys.exit(main())
