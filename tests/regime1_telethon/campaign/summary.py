"""One document covering every Telethon campaign run to date.

The per-run reports answer "what happened this round". This answers the question
that actually gets asked months later: *what has this loop ever found, what did
we do about it, and did the fix hold?*

The centre of it is a finding x campaign matrix. A row is one defect; a column is
one run; a cell is PASS / FAIL / not-run. Reading across a row tells you whether
a fix stuck, whether something regressed, and — the case that keeps biting — when
a finding simply was not exercised and its silence got mistaken for health.

  py -3 -m tests.regime1_telethon.campaign.summary
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[3]))  # repo root

from tests.regime1_telethon.campaign import findings  # noqa: E402
from tests.regime1_telethon.campaign import ledger as ledger_mod  # noqa: E402
from tests.regime1_telethon.campaign import report as report_mod  # noqa: E402

DEFAULT_OUT = (
    Path(__file__).parents[3] / "docs" / "testing" / "campaign-reports" / "ALL-TELETHON-RESULTS.md"
)

NOT_RUN = "·"


def discover_campaigns() -> list[str]:
    """Every campaign with a ledger, oldest run first.

    Ordered by the first record's timestamp rather than by name — c1r4 sorts
    before c2 alphabetically but ran before it, and a matrix in the wrong order
    reads as a regression that never happened.
    """
    out: list[tuple[str, str]] = []
    for p in sorted(ledger_mod.LEDGER_DIR.glob("*.jsonl")):
        first_ts = ""
        for line in p.read_text(encoding="utf-8").splitlines():
            try:
                first_ts = json.loads(line).get("ts", "")
            except json.JSONDecodeError:
                continue
            if first_ts:
                break
        out.append((first_ts or "9999", p.stem))
    return [name for _ts, name in sorted(out)]


def campaign_facts(campaign: str) -> dict:
    verdicts = report_mod.load_verdicts(campaign)
    tiers = sorted({v.get("tier") for v in verdicts}, key=str)
    shas = sorted({v.get("deploy_sha", "") for v in verdicts if v.get("deploy_sha")})
    passed = sum(1 for v in verdicts if v.get("verdict") == report_mod.PASSING)
    ts = ""
    p = ledger_mod.LEDGER_DIR / f"{campaign}.jsonl"
    for line in p.read_text(encoding="utf-8").splitlines():
        try:
            ts = json.loads(line).get("ts", "")
        except json.JSONDecodeError:
            continue
        if ts:
            break
    return dict(
        campaign=campaign,
        verdicts=verdicts,
        tiers=tiers,
        build=", ".join(shas) or "not recorded",
        passed=passed,
        total=len(verdicts),
        date=ts[:10],
    )


def build_matrix(facts: list[dict]) -> tuple[dict[str, dict[str, str]], dict[str, set]]:
    """finding -> {campaign: PASS|FAIL} plus the tiers each campaign covered."""
    matrix: dict[str, dict[str, str]] = defaultdict(dict)
    tiers_by_campaign: dict[str, set] = {}
    for f in facts:
        tiers_by_campaign[f["campaign"]] = set(f["tiers"])
        seen: dict[str, str] = {}
        for v in f["verdicts"]:
            fp = findings.fingerprint(v["conv"], v.get("tier"))
            state = "PASS" if v.get("verdict") == report_mod.PASSING else "FAIL"
            # A finding covers a scenario family; if ANY variant failed, the
            # finding failed that round.
            if seen.get(fp) != "FAIL":
                seen[fp] = state
        for fp, state in seen.items():
            matrix[fp][f["campaign"]] = state
    return matrix, tiers_by_campaign


def finding_tier(fp: str) -> str:
    return fp.split(":", 1)[0] if ":" in fp else ""


def render(facts: list[dict], disp: dict[str, findings.Disposition]) -> str:
    full_matrix, tiers_by_campaign = build_matrix(facts)
    campaigns = [f["campaign"] for f in facts]
    total_convs = sum(f["total"] for f in facts)
    total_pass = sum(f["passed"] for f in facts)

    # A FINDING is a scenario that has failed at least once. Everything else is
    # coverage — listing an always-green scenario as an OPEN finding turns the
    # table into a scenario inventory and buries the ~7 rows that matter.
    matrix = {fp: row for fp, row in full_matrix.items() if "FAIL" in row.values()}
    always_green = sorted(set(full_matrix) - set(matrix))

    L: list[str] = []
    L.append("# Telethon UAT — every campaign result to date")
    L.append("")
    L.append(
        f"*Generated {date.today().isoformat()} by `campaign/summary.py`. Regenerate it; don't edit it.*"
    )
    L.append("")
    L.append(
        f"**{len(campaigns)} runs · {total_convs} conversations · {total_pass} passed "
        f"({total_pass / total_convs * 100:.0f}%) · {len(matrix)} distinct defects found**"
    )
    L.append("")
    L.append(
        "MIRA is driven over real Telegram against the staging bot by a real user session. "
        "Replies are graded by the offline battery's expect/forbid semantics (tiers 1-2) or "
        "by an LLM judge (tiers 3/8). Failing conversations are frozen with their full "
        "transcript. Findings are keyed by defect, not by conversation, so one row here is "
        "one defect across every round it appeared in."
    )
    L.append("")

    # ---- runs ------------------------------------------------------------
    L.append("## The runs")
    L.append("")
    L.append("| run | date | build | tiers | result |")
    L.append("|---|---|---|---|---|")
    for f in facts:
        pct = f"{f['passed'] / f['total'] * 100:.0f}%" if f["total"] else "n/a"
        tiers = ", ".join(str(t) for t in f["tiers"])
        L.append(
            f"| `{f['campaign']}` | {f['date']} | `{f['build']}` | {tiers} | "
            f"{f['passed']}/{f['total']} ({pct}) |"
        )
    L.append("")

    # ---- matrix ----------------------------------------------------------
    L.append("## Finding × run")
    L.append("")
    L.append(
        f"Only scenarios that have failed at least once appear here. "
        f"{len(always_green)} further scenario(s) have never failed in any run and are listed "
        "under Coverage at the end."
    )
    L.append("")
    L.append(
        f"`{NOT_RUN}` means the finding's tier was **not exercised** in that run — "
        "unknown, not fixed. That distinction is the one this table exists to preserve."
    )
    L.append("")
    header = "| finding | " + " | ".join(f"`{c}`" for c in campaigns) + " | status | fix applied |"
    L.append(header)
    L.append("|---" * (len(campaigns) + 3) + "|")
    for fp in sorted(matrix, key=lambda k: (finding_tier(k), k)):
        d = disp.get(fp)
        cells = []
        for c in campaigns:
            state = matrix[fp].get(c)
            if state is None:
                tier = finding_tier(fp).lstrip("t")
                covered = {str(t) for t in tiers_by_campaign.get(c, set())}
                cells.append(NOT_RUN if tier not in covered else "PASS")
            else:
                cells.append("**FAIL**" if state == "FAIL" else "PASS")
        status = d.status if d else findings.OPEN
        applied = "yes" if (d and d.applied) else "no"
        issue = (
            f" ([#{d.issue}](https://github.com/Mikecranesync/MIRA/issues/{d.issue}))"
            if (d and d.issue)
            else ""
        )
        L.append(f"| `{fp}`{issue} | " + " | ".join(cells) + f" | {status} | {applied} |")
    L.append("")

    # ---- per finding -----------------------------------------------------
    L.append("## The findings")
    L.append("")
    for fp in sorted(matrix, key=lambda k: (finding_tier(k), k)):
        d = disp.get(fp)
        L.append(f"### `{fp}`")
        L.append("")
        if d and d.summary:
            L.append(d.summary)
            L.append("")
        runs_failed = [c for c in campaigns if matrix[fp].get(c) == "FAIL"]
        runs_passed = [c for c in campaigns if matrix[fp].get(c) == "PASS"]
        L.append(f"- **Failed in:** {', '.join(f'`{c}`' for c in runs_failed) or 'never'}")
        L.append(f"- **Passed in:** {', '.join(f'`{c}`' for c in runs_passed) or 'never'}")
        if d:
            L.append(
                f"- **Status:** {d.status} · fix applied to main: **{'yes' if d.applied else 'no'}**"
            )
            if d.fix:
                L.append(f"- **Fix:** {d.fix}")
            if d.issue:
                L.append(f"- **Issue:** #{d.issue}")
            if d.note:
                L.append(f"- **Notes:** {d.note}")
        else:
            L.append("- **Status:** no disposition recorded")
        L.append("")

    # ---- what is owed ----------------------------------------------------
    open_rows = [
        fp
        for fp in matrix
        if (disp.get(fp).status if disp.get(fp) else findings.OPEN) == findings.OPEN
    ]
    fixed_unmerged = [
        fp
        for fp in matrix
        if disp.get(fp) and disp[fp].status == findings.FIXED and not disp[fp].applied
    ]
    L.append("## Owed")
    L.append("")
    if fixed_unmerged:
        L.append("**Fixed but not merged** — these regress the moment the branch is abandoned:")
        L.append("")
        for fp in sorted(fixed_unmerged):
            L.append(f"- `{fp}` — {disp[fp].fix or 'fix unrecorded'}")
        L.append("")
    if open_rows:
        L.append("**Still open:**")
        L.append("")
        for fp in sorted(open_rows):
            d = disp.get(fp)
            issue = f" (#{d.issue})" if d and d.issue else ""
            L.append(f"- `{fp}`{issue} — {(d.summary if d else '') or 'needs triage'}")
        L.append("")
    if always_green:
        L.append("## Coverage — never failed in any run")
        L.append("")
        L.append(
            "Green throughout. Worth knowing they are exercised, but they are not findings "
            "and carry no disposition."
        )
        L.append("")
        L.append(", ".join(f"`{fp}`" for fp in always_green))
        L.append("")

    L.append("## Reading this honestly")
    L.append("")
    L.append(
        "- **A pass is not a fix.** Several findings here passed in a round where their "
        "mechanism was demonstrably unchanged in the code. Check the mechanism before "
        "flipping a disposition."
    )
    L.append(
        f"- **`{NOT_RUN}` is not a pass.** A tier that was not run tells you nothing, and "
        "reading it as progress is how two tier-8 findings sat untriaged for four rounds."
    )
    L.append(
        "- **One run is one sample.** Tier 1/2 scenarios are scripted, but the bot is an LLM; "
        "the judge on tiers 3/8 varies more still. Prefer transcript-level evidence — a line "
        "that is present or absent — over a pass/fail flip."
    )
    L.append("")
    return "\n".join(L)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--campaigns", default="", help="comma-separated; default = all discovered")
    args = ap.parse_args()

    names = [c.strip() for c in args.campaigns.split(",") if c.strip()] or discover_campaigns()
    facts = [campaign_facts(c) for c in names]
    body = render(facts, findings.load())

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(body, encoding="utf-8")
    print(f"wrote {out}  ({len(names)} runs)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
