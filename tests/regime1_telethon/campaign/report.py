"""End-of-run campaign report.

Every campaign run ends with one markdown file that answers three questions:
what did this run find, what happened to each finding, and what changed since
last time. Without it the ledger is 200 KB of JSONL nobody re-reads, which is
how two tier-8 SUSPECTs sat untriaged across four rounds.

Findings are keyed by fingerprint (see `findings.py`), NOT by conversation id,
so a defect that shows up in three rounds is one row with three sightings — and
a defect previously marked fixed that comes back is called out as a regression
instead of blending in with the new failures.

  py -3 -m tests.regime1_telethon.campaign.report --campaign c1r4 --previous c1
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[3]))  # repo root

from tests.regime1_telethon.campaign import findings  # noqa: E402
from tests.regime1_telethon.campaign import ledger as ledger_mod  # noqa: E402

REPORT_DIR = Path(__file__).parents[3] / "docs" / "testing" / "campaign-reports"
PASSING = "PASS"


def load_verdicts(campaign: str) -> list[dict]:
    """Every verdict record for a campaign, in ledger order."""
    p = ledger_mod.LEDGER_DIR / f"{campaign}.jsonl"
    if not p.exists():
        raise SystemExit(f"no ledger for campaign {campaign!r} at {p}")
    out = []
    for line in p.read_text(encoding="utf-8").splitlines():
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        if r.get("kind") == "verdict":
            out.append(r)
    return out


def frozen_path(campaign: str, conv: str) -> Path:
    return ledger_mod.FROZEN_DIR / f"{campaign}_{conv}.json"


def tally(verdicts: list[dict]) -> dict[int, Counter]:
    per_tier: dict[int, Counter] = defaultdict(Counter)
    for v in verdicts:
        per_tier[v.get("tier")][v.get("verdict", "?")] += 1
    return dict(sorted(per_tier.items(), key=lambda kv: str(kv[0])))


def _evidence(campaign: str, conv: str, limit: int = 400) -> str:
    """The bot turn that earned the failure, for the report body."""
    p = frozen_path(campaign, conv)
    if not p.exists():
        return ""
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return ""
    judge = (d.get("meta") or {}).get("judge") or {}
    if judge.get("evidence"):
        return str(judge["evidence"])[:limit]
    mira = [t for t in d.get("transcript", []) if t.get("role") == "mira"]
    return (mira[-1]["text"] if mira else "")[:limit]


def render(
    campaign: str,
    verdicts: list[dict],
    disp: dict[str, findings.Disposition],
    previous: str | None = None,
    previous_verdicts: list[dict] | None = None,
) -> str:
    per_tier = tally(verdicts)
    total = len(verdicts)
    passed = sum(1 for v in verdicts if v.get("verdict") == PASSING)
    failures = [v for v in verdicts if v.get("verdict") != PASSING]
    shas = sorted({v.get("deploy_sha", "") for v in verdicts if v.get("deploy_sha")})

    lines: list[str] = []
    lines.append(f"# Campaign `{campaign}` — run report")
    lines.append("")
    lines.append(f"**Date:** {date.today().isoformat()}  ")
    lines.append(f"**Build:** {', '.join(shas) or 'not recorded'}  ")
    pct = f"{passed / total * 100:.0f}%" if total else "n/a"
    lines.append(f"**Result:** {passed}/{total} conversations passed ({pct})")
    lines.append("")

    lines.append("## By tier")
    lines.append("")
    lines.append("| tier | pass | fail | suspect |")
    lines.append("|---|---|---|---|")
    for tier, c in per_tier.items():
        lines.append(
            f"| {tier} | {c.get('PASS', 0)} | {c.get('FAIL', 0)} | {c.get('SUSPECT', 0)} |"
        )
    lines.append("")

    # ---- findings, keyed by defect rather than conversation --------------
    by_fp: dict[str, list[dict]] = defaultdict(list)
    for v in failures:
        by_fp[findings.fingerprint(v["conv"], v.get("tier"))].append(v)

    lines.append("## Findings")
    lines.append("")
    if not by_fp:
        lines.append("No failures in this run.")
        lines.append("")
    else:
        lines.append("| finding | seen as | status | fix applied | issue |")
        lines.append("|---|---|---|---|---|")
        for fp in sorted(by_fp):
            d = disp.get(fp)
            status = d.status if d else findings.OPEN
            applied = "yes" if (d and d.applied) else "no"
            issue = f"#{d.issue}" if (d and d.issue) else "—"
            convs = ", ".join(f"`{v['conv']}`" for v in by_fp[fp])
            lines.append(f"| `{fp}` | {convs} | {status} | {applied} | {issue} |")
        lines.append("")

        regressions = [fp for fp in by_fp if fp in disp and findings.regressed(disp[fp], campaign)]
        if regressions:
            lines.append("### ⚠️ Regressions — previously fixed, failed again")
            lines.append("")
            for fp in regressions:
                d = disp[fp]
                lines.append(f"- `{fp}` — fix on record: {d.fix or 'unrecorded'}. {d.summary}")
            lines.append("")

        lines.append("### Detail")
        lines.append("")
        for fp in sorted(by_fp):
            d = disp.get(fp)
            lines.append(f"#### `{fp}`")
            lines.append("")
            if d and d.summary:
                lines.append(f"{d.summary}")
                lines.append("")
            for v in by_fp[fp]:
                cat = v.get("category") or "UNTRIAGED"
                note = (v.get("notes") or "").strip()
                lines.append(f"- **{v['conv']}** ({v.get('verdict')}, {cat})")
                if note:
                    lines.append(f"  - judge: {note}")
                ev = _evidence(campaign, v["conv"])
                if ev:
                    ev_one = " ".join(ev.split())
                    lines.append(f"  - evidence: `{ev_one}`")
                lines.append(f"  - replay: `{frozen_path(campaign, v['conv']).name}`")
            if d and d.status == findings.FIXED:
                lines.append(
                    f"- **Fix:** {d.fix or 'unrecorded'} (applied: {'yes' if d.applied else 'no'})"
                )
            if d and d.status == findings.FALSE_POSITIVE:
                lines.append(f"- **Not a defect:** {d.note or 'no reason recorded'}")
            lines.append("")

    # ---- comparison against the previous run -----------------------------
    if previous and previous_verdicts is not None:
        # Only tiers BOTH runs executed can be compared. A tier this run skipped
        # has not been fixed — it has not been tested, and reporting it as
        # "now passing" is the exact false reassurance this report exists to
        # prevent (c1r4 ran tiers 1-2 only, while the two tier-8 SUSPECTs from
        # c1 sat untriaged).
        tiers_now = {v.get("tier") for v in verdicts}
        tiers_prev = {v.get("tier") for v in previous_verdicts}
        comparable = tiers_now & tiers_prev
        not_rerun = sorted(tiers_prev - tiers_now, key=str)

        prev_fail = {
            findings.fingerprint(v["conv"], v.get("tier"))
            for v in previous_verdicts
            if v.get("verdict") != PASSING and v.get("tier") in comparable
        }
        now_fail = {fp for fp, vs in by_fp.items() if any(v.get("tier") in comparable for v in vs)}
        fixed = sorted(prev_fail - now_fail)
        new = sorted(now_fail - prev_fail)
        still = sorted(now_fail & prev_fail)

        lines.append(f"## Change since `{previous}`")
        lines.append("")
        lines.append(f"Comparing tiers {sorted(comparable, key=str)} — run in both.")
        lines.append("")
        lines.append(f"- **Now passing:** {', '.join(f'`{f}`' for f in fixed) or 'none'}")
        lines.append(f"- **New failures:** {', '.join(f'`{f}`' for f in new) or 'none'}")
        lines.append(f"- **Still failing:** {', '.join(f'`{f}`' for f in still) or 'none'}")
        if not_rerun:
            carried = sorted(
                findings.fingerprint(v["conv"], v.get("tier"))
                for v in previous_verdicts
                if v.get("verdict") != PASSING and v.get("tier") in set(not_rerun)
            )
            lines.append(
                f"- **Not re-run this round:** tier(s) {not_rerun} — "
                f"status UNKNOWN, not fixed: {', '.join(f'`{f}`' for f in carried) or 'no open findings'}"
            )
        lines.append("")

    open_findings = [fp for fp in by_fp if not disp.get(fp) or disp[fp].status == findings.OPEN]
    lines.append("## Owed")
    lines.append("")
    if open_findings:
        lines.append("Findings still OPEN — no recorded fix. Triage, fix, then record the outcome:")
        lines.append("")
        for fp in sorted(open_findings):
            lines.append(f"- [ ] `{fp}`")
    else:
        lines.append("Every finding in this run carries a disposition.")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--campaign", required=True)
    ap.add_argument("--previous", default="", help="earlier campaign id to diff against")
    ap.add_argument(
        "--out", default="", help="output path (default: docs/testing/campaign-reports/)"
    )
    ap.add_argument(
        "--no-observe",
        action="store_true",
        help="do not record this run's sightings into dispositions.yml",
    )
    args = ap.parse_args()

    verdicts = load_verdicts(args.campaign)
    disp = findings.load()

    if not args.no_observe:
        for v in verdicts:
            if v.get("verdict") != PASSING:
                findings.observe(
                    disp,
                    v["conv"],
                    v.get("tier"),
                    args.campaign,
                    summary=findings.summarize_verdict(v),
                )
        findings.save(disp)

    prev_verdicts = load_verdicts(args.previous) if args.previous else None
    body = render(args.campaign, verdicts, disp, args.previous or None, prev_verdicts)

    out = (
        Path(args.out)
        if args.out
        else REPORT_DIR / f"{date.today().isoformat()}-{args.campaign}.md"
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(body, encoding="utf-8")
    print(f"wrote {out}")
    n_open = sum(1 for line in body.splitlines() if line.startswith("- [ ] "))
    print(f"{len(verdicts)} conversations, {n_open} finding(s) awaiting triage")
    return 0


if __name__ == "__main__":
    sys.exit(main())
