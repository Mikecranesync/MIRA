"""Weekly Digest — CEO Dashboard.

Reads all agent report Markdown files produced in the last 7 days,
extracts key metrics from each, and builds a single master HTML report
that Mike reads Sunday evening.

Sections:
  1. Executive Summary (overall status + alert roll-up)
  2. KB Growth (kb-growth-cron: PDFs ingested, failed, remaining)
  3. Social Media (social-publisher: posts published this week)
  4. Benchmark Scores (from benchmark_*.json files in repo root)
  5. Billing Health (billing-health: from most recent report)

Usage:
  python weekly_digest.py                     # last 7 days, save to /opt/mira/reports/
  python weekly_digest.py --days 14           # look back 14 days
  python weekly_digest.py --output ./reports  # local output dir
  python weekly_digest.py --dry-run           # print Markdown, don't save
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("weekly_digest")

_HERE = Path(__file__).parent
_REPO = _HERE.parent.parent
DEFAULT_REPORT_DIR = Path(os.environ.get("MIRA_REPORT_DIR", "/opt/mira/reports"))


# ── Report file discovery ─────────────────────────────────────────────────────

def find_reports(report_dir: Path, days: int) -> dict[str, list[Path]]:
    """Return {agent_slug: [path, ...]} for all .md reports within `days` days."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    found: dict[str, list[Path]] = {}
    if not report_dir.exists():
        return found
    for agent_dir in sorted(report_dir.iterdir()):
        if not agent_dir.is_dir():
            continue
        slug = agent_dir.name
        reports = []
        for md in sorted(agent_dir.glob("*.md")):
            # filename format: YYYY-MM-DD_slug.md
            m = re.match(r"^(\d{4}-\d{2}-\d{2})_", md.name)
            if not m:
                continue
            try:
                file_date = datetime.fromisoformat(m.group(1)).replace(tzinfo=timezone.utc)
            except ValueError:
                continue
            if file_date >= cutoff:
                reports.append(md)
        if reports:
            found[slug] = reports
    return found


# ── Metric extraction from Markdown ──────────────────────────────────────────

_METRIC_RE = re.compile(r"^\| (.+?) \| (.+?) \| ([▲▼─]?) \|")


def extract_metrics(md_text: str) -> dict[str, str]:
    """Pull all metric rows from a markdown report into {name: value} dict."""
    metrics: dict[str, str] = {}
    in_table = False
    for line in md_text.splitlines():
        if line.startswith("## Key Metrics"):
            in_table = True
            continue
        if in_table:
            if line.startswith("|---"):
                continue
            m = _METRIC_RE.match(line)
            if m:
                metrics[m.group(1).strip()] = m.group(2).strip()
            elif line.startswith("##") or not line.strip():
                in_table = False
    return metrics


def sum_metric(reports: list[Path], metric_name: str) -> float:
    total = 0.0
    for p in reports:
        try:
            text = p.read_text(encoding="utf-8")
            val = extract_metrics(text).get(metric_name, "0")
            # strip units like "3 PDFs"
            total += float(re.match(r"[\d.]+", val.strip()).group())  # type: ignore[union-attr]
        except Exception:
            pass
    return total


def latest_metric(reports: list[Path], metric_name: str) -> str:
    """Return the metric value from the most recent report."""
    for p in reversed(reports):
        try:
            text = p.read_text(encoding="utf-8")
            val = extract_metrics(text).get(metric_name, "")
            if val:
                return val
        except Exception:
            pass
    return "—"


# ── Benchmark score extraction ─────────────────────────────────────────────────

def load_benchmark_scores() -> dict[str, Any]:
    """Find the latest benchmark_*.json in the repo root and parse it."""
    candidates = sorted(_REPO.glob("benchmark_*.json"), reverse=True)
    if not candidates:
        return {}
    try:
        with open(candidates[0]) as f:
            data = json.load(f)
        logger.info("Benchmark file: %s", candidates[0].name)
        return data
    except Exception as exc:
        logger.warning("Could not read benchmark file: %s", exc)
        return {}


def _bench_summary(data: dict[str, Any]) -> tuple[str, list[list[str]]]:
    if not data:
        return "No benchmark data found.", []
    # Structure varies — try common shapes
    rows: list[list[str]] = []
    overall = "—"
    if "results" in data and isinstance(data["results"], list):
        passed = sum(1 for r in data["results"] if r.get("passed") or r.get("status") == "pass")
        total = len(data["results"])
        pct = f"{100*passed//total}%" if total else "—"
        overall = f"{passed}/{total} ({pct})"
        for r in data["results"][:10]:
            rows.append([
                str(r.get("id", r.get("case_id", "?"))),
                str(r.get("status", "pass" if r.get("passed") else "fail")),
                str(r.get("score", "—")),
                str(r.get("name", r.get("question", "?"))[:60]),
            ])
    elif "summary" in data:
        s = data["summary"]
        overall = str(s.get("pass_rate", s.get("score", "—")))
    return overall, rows


# ── Digest builder ────────────────────────────────────────────────────────────

def build_digest(report_dir: Path, days: int) -> "AgentReport":  # type: ignore[name-defined]
    from mira_crawler.reporting.agent_report import AgentReport

    now = datetime.now(timezone.utc)
    week_label = f"Week of {(now - timedelta(days=days)).strftime('%b %-d')} – {now.strftime('%b %-d, %Y')}"

    report = (
        AgentReport("weekly-digest")
        .set_title("CEO Dashboard — Weekly Digest", week_label)
    )

    reports_by_agent = find_reports(report_dir, days)
    logger.info("Agents with reports: %s", list(reports_by_agent))

    all_critical = False
    all_warnings = 0

    # ── 1. KB Growth ──────────────────────────────────────────────────────────
    kb_reports = reports_by_agent.get("kb-growth-cron", [])
    kb_done  = int(sum_metric(kb_reports, "Done"))
    kb_failed = int(sum_metric(kb_reports, "Failed"))
    kb_remaining = latest_metric(kb_reports, "Remaining")

    report.add_metric("PDFs Ingested", kb_done, "this week", trend="up" if kb_done > 0 else "flat")
    report.add_metric("Ingest Failures", kb_failed, "", trend="flat" if kb_failed == 0 else "down")
    report.add_metric("Queue Remaining", kb_remaining)

    if kb_done == 0 and not kb_reports:
        report.add_alert("warning", "KB Growth: no cron runs found this week")
        all_warnings += 1
    elif kb_failed > 0:
        report.add_alert("warning", f"KB Growth: {kb_failed} PDF ingest failure(s) — check queue")
        all_warnings += 1
    else:
        report.add_alert("ok", f"KB Growth: {kb_done} PDF(s) ingested, {kb_failed} failures")

    # ── 2. Social Media ───────────────────────────────────────────────────────
    social_reports = reports_by_agent.get("social-publisher", [])
    published = int(sum_metric(social_reports, "Published"))
    soc_failed = int(sum_metric(social_reports, "Failed"))

    report.add_metric("Posts Published", published, "this week", trend="up" if published > 0 else "flat")

    if social_reports:
        if soc_failed > 0:
            report.add_alert("warning", f"Social: {published} published, {soc_failed} failed")
            all_warnings += 1
        else:
            report.add_alert("ok", f"Social: {published} post(s) published this week")
    else:
        report.add_alert("ok", "Social: no publish runs this week (no posts due)")

    # ── 3. Benchmark Scores ───────────────────────────────────────────────────
    bench_data = load_benchmark_scores()
    bench_overall, bench_rows = _bench_summary(bench_data)

    report.add_metric("Benchmark Score", bench_overall)

    if bench_rows:
        report.add_table(
            "Benchmark Cases (latest run)",
            rows=bench_rows,
            columns=["ID", "Status", "Score", "Case"],
        )

    if bench_data:
        report.add_alert("ok", f"Benchmark: {bench_overall}")
    else:
        report.add_alert("warning", "Benchmark: no benchmark_*.json found in repo root")
        all_warnings += 1

    # ── 4. Billing Health ─────────────────────────────────────────────────────
    billing_reports = reports_by_agent.get("billing-health", [])
    if billing_reports:
        report.add_section(
            "Billing Health",
            f"Last report: {billing_reports[-1].name}\n"
            + _extract_first_section(billing_reports[-1]),
        )
    else:
        report.add_section("Billing Health", "No billing-health report found this week. Run manually: `python mira-crawler/tasks/billing_health.py`")

    # ── 5. KB Chart ───────────────────────────────────────────────────────────
    if kb_done + kb_failed > 0:
        report.add_chart(
            "KB Ingest Results (this week)",
            chart_type="bar",
            data={"Done": float(kb_done), "Failed": float(kb_failed)},
        )

    # ── 6. Social Chart ───────────────────────────────────────────────────────
    if published + soc_failed > 0:
        report.add_chart(
            "Social Publishing Results (this week)",
            chart_type="bar",
            data={"Published": float(published), "Failed": float(soc_failed)},
        )

    # ── 7. Actions ────────────────────────────────────────────────────────────
    if all_critical:
        report.set_status("critical")
    elif all_warnings > 0:
        report.set_status("warning")
    else:
        report.set_status("ok")

    if kb_failed > 0:
        report.add_action(f"Fix {kb_failed} failed PDF ingest(s) — check manual_queue.json error fields")
    if soc_failed > 0:
        report.add_action(f"Re-queue {soc_failed} failed social post(s) or check API credentials")
    if not bench_data:
        report.add_action("Run weekly benchmark: `pytest tests/eval/ -q --tb=short`")
    if not billing_reports:
        report.add_action("Run billing health check: `python mira-crawler/tasks/billing_health.py`")
    if not kb_reports:
        report.add_action("Verify kb_growth_cron is running on VPS — check /var/log/mira-agents/kb_growth.log")
    if not report.actions:
        report.add_action("Nothing urgent — good week ✓")

    return report


def _extract_first_section(path: Path) -> str:
    try:
        text = path.read_text(encoding="utf-8")
        lines = []
        in_section = False
        for line in text.splitlines():
            if line.startswith("## ") and not in_section:
                in_section = True
            elif line.startswith("## ") and in_section:
                break
            elif in_section:
                lines.append(line)
            if len(lines) > 20:
                break
        return "\n".join(lines[:20])
    except Exception:
        return ""


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Weekly CEO digest — aggregates all agent reports")
    parser.add_argument("--days",    type=int, default=7,  help="Look-back window in days (default: 7)")
    parser.add_argument("--output",  default=None,          help="Output directory (default: $MIRA_REPORT_DIR or /opt/mira/reports)")
    parser.add_argument("--dry-run", action="store_true",   help="Print Markdown to stdout, don't save")
    args = parser.parse_args()

    report_dir = Path(args.output) if args.output else DEFAULT_REPORT_DIR

    try:
        digest = build_digest(report_dir, args.days)
    except ImportError:
        logger.error(
            "Could not import AgentReport. Run from repo root or install mira-crawler package.\n"
            "  cd /opt/mira && doppler run -- python3 mira-crawler/reporting/weekly_digest.py"
        )
        sys.exit(1)

    if args.dry_run:
        print(digest.to_markdown())
        return

    paths = digest.save(output_dir=report_dir, telegram=True)
    print(f"\n✔  Weekly digest saved:")
    for kind, path in paths.items():
        print(f"   {kind}: {path}")


if __name__ == "__main__":
    main()
