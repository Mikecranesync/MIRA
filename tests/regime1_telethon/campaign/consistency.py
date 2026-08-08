"""Consistency across seeds — turning one stochastic pass into evidence.

Every result reported so far carries the same caveat: the scenario is scripted,
but the thing answering it is an LLM, so a single PASS is one sample. That caveat
has been attached by hand to every tier-8 conclusion in this program, which is
exactly the sort of thing that gets quietly dropped once it becomes routine.

This measures it instead. The same scenarios are run under several seeds, and a
finding is classified by what the seeds actually did:

  STABLE_PASS   passed under every seed
  STABLE_FAIL   failed under every seed — a real defect, reproduce and fix it
  FLAKY         passed under some and failed under others

FLAKY is the interesting category and the one a single run cannot see. It is
also the honest home for several findings currently sitting at OPEN on the
strength of one bad round, and for the tier-8 pair currently sitting at "did not
reproduce" on the strength of one good one.

  py -3 -m tests.regime1_telethon.campaign.consistency --campaigns c5s41,c5s42,c5s43
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[3]))  # repo root

from tests.regime1_telethon.campaign import findings  # noqa: E402
from tests.regime1_telethon.campaign import report as report_mod  # noqa: E402

STABLE_PASS = "STABLE_PASS"
STABLE_FAIL = "STABLE_FAIL"
FLAKY = "FLAKY"

# The spec asks for at least five seeds on stochastic scenarios. Fewer is still
# informative, but it must not be reported as if it settled the question.
MIN_SEEDS = 5


def observations(campaigns: list[str]) -> dict[str, dict[str, bool]]:
    """finding -> {campaign: passed?} across the given runs."""
    out: dict[str, dict[str, bool]] = defaultdict(dict)
    for c in campaigns:
        for v in report_mod.load_verdicts(c):
            fp = findings.fingerprint(v["conv"], v.get("tier"))
            passed = v.get("verdict") == report_mod.PASSING
            # A finding covers a scenario family; one failing variant fails it.
            out[fp][c] = out[fp].get(c, True) and passed
    return dict(out)


def classify(seed_results: dict[str, bool]) -> str:
    values = list(seed_results.values())
    if all(values):
        return STABLE_PASS
    if not any(values):
        return STABLE_FAIL
    return FLAKY


def pass_rate(seed_results: dict[str, bool]) -> float:
    if not seed_results:
        return 0.0
    return sum(1 for v in seed_results.values() if v) / len(seed_results)


def render(campaigns: list[str], obs: dict[str, dict[str, bool]]) -> str:
    n = len(campaigns)
    rows = {fp: classify(r) for fp, r in obs.items()}
    flaky = sorted(fp for fp, k in rows.items() if k == FLAKY)
    stable_fail = sorted(fp for fp, k in rows.items() if k == STABLE_FAIL)

    L: list[str] = []
    L.append(f"# Consistency across {n} seed(s)")
    L.append("")
    L.append(f"Runs: {', '.join(f'`{c}`' for c in campaigns)}")
    L.append("")
    if n < MIN_SEEDS:
        L.append(
            f"> **{n} seed(s) is below the {MIN_SEEDS} the release gate asks for.** These "
            "results narrow the question; they do not settle it. A scenario that passed "
            f"{n}/{n} here can still be flaky at a rate this sample cannot see."
        )
        L.append("")

    L.append("| finding | " + " | ".join(f"`{c}`" for c in campaigns) + " | rate | verdict |")
    L.append("|---" * (n + 3) + "|")
    for fp in sorted(obs, key=lambda k: (rows[k] != FLAKY, rows[k] != STABLE_FAIL, k)):
        cells = []
        for c in campaigns:
            got = obs[fp].get(c)
            cells.append("—" if got is None else ("PASS" if got else "**FAIL**"))
        rate = pass_rate(obs[fp])
        L.append(f"| `{fp}` | " + " | ".join(cells) + f" | {rate * 100:.0f}% | {rows[fp]} |")
    L.append("")

    if flaky:
        L.append("## Flaky — the category a single run cannot see")
        L.append("")
        L.append(
            "These behave differently under different seeds. A green round proves nothing "
            "about them, and neither does a red one."
        )
        L.append("")
        for fp in flaky:
            L.append(f"- `{fp}` — {pass_rate(obs[fp]) * 100:.0f}% pass")
        L.append("")
    if stable_fail:
        L.append("## Stable failures — reproduce and fix")
        L.append("")
        for fp in stable_fail:
            L.append(f"- `{fp}` — failed under every seed")
        L.append("")
    return "\n".join(L)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--campaigns", required=True, help="comma-separated campaign ids, one per seed")
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    campaigns = [c.strip() for c in args.campaigns.split(",") if c.strip()]
    obs = observations(campaigns)
    body = render(campaigns, obs)

    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(body, encoding="utf-8")
        print(f"wrote {args.out}")
    else:
        print(body)

    rows = {fp: classify(r) for fp, r in obs.items()}
    n_flaky = sum(1 for k in rows.values() if k == FLAKY)
    n_fail = sum(1 for k in rows.values() if k == STABLE_FAIL)
    print(f"\n{len(rows)} finding(s): {n_fail} stable failure(s), {n_flaky} flaky", file=sys.stderr)
    if len(campaigns) < MIN_SEEDS:
        print(
            f"WARNING: {len(campaigns)} seeds < {MIN_SEEDS} required by the gate", file=sys.stderr
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
