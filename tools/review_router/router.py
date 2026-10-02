#!/usr/bin/env python3
"""Cost-aware routing for the Codex adversarial review lane.

The review ladder (docs/review-cost-ladder.md):
  A. deterministic, $0: lint + tests on the PR's changed files, plus the
     finding->test rule. A known-detectable failure never reaches an LLM.
  B. free pre-filter, $0: tools/gate7_review.py (free cascade), scoped per file.
  C. the trusted Codex lane (scripts/adversarial-review-trusted.sh), unchanged,
     on a model chosen by risk tier, escalated only on evidence, inside a
     dollar budget. Usage is captured by codex_shim.sh and priced from
     prices.json.

This module never weakens the gate: GREEN still comes only from the trusted
Codex lane, and critical paths always use the strongest lane at today's
default settings. Stdlib only, so it runs on a clean CI runner.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _checkout_root() -> Path:
    """The checkout being reviewed is the one you run from (it must be at the
    PR head), not the one this file lives in."""
    out = subprocess.run(["git", "rev-parse", "--show-toplevel"], text=True, capture_output=True)
    return (
        Path(out.stdout.strip())
        if out.returncode == 0 and out.stdout.strip()
        else HERE.parent.parent
    )


REPO = _checkout_root()
PRICES = json.loads((HERE / "prices.json").read_text())["usd_per_mtok"]

TIERS = ("low", "standard", "critical")

# Failure here can mean a safety, security, data-loss or gate-integrity defect:
# always the strongest lane, never a cheaper one.
CRITICAL_GLOBS = (
    "mira-bots/shared/engine.py",
    "mira-bots/shared/guardrails.py",
    "mira-bots/shared/inference/*",
    "mira-bots/shared/citation_compliance.py",
    "mira-hub/src/capabilities/answer-validation*",
    "mira-hub/src/capabilities/hazard-*",
    "mira-hub/src/capabilities/step-energy*",
    "mira-hub/src/lib/session*",
    "mira-hub/src/middleware*",
    "*migrations/*",
    "*auth*",
    "*security*",
    "*safety*",
    "*secret*",
    "scripts/adversarial-review*",
    "tools/review_router/*",
    "tools/hooks/*",
    "tools/ui_surface_lifecycle_guard.py",
    ".github/workflows/*",
    "mira-relay/*",
    "plc/*",
)
# Only these may ride the cheapest lane: nothing here ships to a technician.
LOW_GLOBS = (
    "tests/*",
    "*/tests/*",
    "*/__tests__/*",
    "*.test.*",
    "docs/*",
    "wiki/*",
    "*.md",
    "tools/qa/*",
)
TEST_GLOBS = ("tests/*", "*/tests/*", "*/__tests__/*", "*.test.*", "test_*.py", "*/test_*.py")

# (model, reasoning effort). None = do not override: the critical lane keeps
# exactly today's behaviour (default model + default effort).
ROUTES: dict[str, tuple[str, str | None]] = {
    "low": ("gpt-5.4-mini", "low"),
    "standard": ("gpt-6.1-sol", "medium"),
    "critical": ("gpt-6-astra", None),
}

# Calibration: PR #4182 round 7 on gpt-6-astra cost ~$2.80 (account balance
# delta 24.92 -> 22.10, minus two sub-cent probes) for a 236,205-char diff.
_ASTRA_USD_PER_DIFF_CHAR = 2.80 / 236_205
_ESTIMATE_SAFETY = 1.5
_ESTIMATE_FLOOR_USD = 0.05
CROSS_MODULE_THRESHOLD = 3  # distinct top-level dirs of non-test changes


def _match(path: str, globs: tuple[str, ...]) -> bool:
    return any(fnmatch.fnmatch(path, g) for g in globs)


def classify(paths: list[str]) -> str:
    """Risk tier of a change set. Empty is treated as standard (fail closed)."""
    if not paths:
        return "standard"
    if any(_match(p, CRITICAL_GLOBS) for p in paths):
        return "critical"
    if all(_match(p, LOW_GLOBS) for p in paths):
        return "low"
    return "standard"


def cross_module(paths: list[str]) -> bool:
    tops = {p.split("/", 1)[0] for p in paths if not _match(p, TEST_GLOBS)}
    return len(tops) >= CROSS_MODULE_THRESHOLD


def escalate(
    tier: str,
    *,
    speculative: int = 0,
    disagreement: bool = False,
    cross_module_change: bool = False,
) -> tuple[str, list[str]]:
    """Step up ONE tier when the evidence says the cheap lane may miss things.
    Never steps down."""
    reasons = []
    if speculative:
        reasons.append(f"prior round had {speculative} speculative finding(s)")
    if disagreement:
        reasons.append("cheap and deterministic/pre-filter reviewers disagree")
    if cross_module_change:
        reasons.append("change spans several top-level modules")
    if reasons and tier != "critical":
        tier = TIERS[TIERS.index(tier) + 1]
    return tier, reasons


def route(tier: str) -> tuple[str, str | None]:
    model, effort = ROUTES[tier]
    if model not in PRICES:
        raise KeyError(f"no price for {model!r} in prices.json; refusing a cost-invisible run")
    return model, effort


def usage_from_events(text: str) -> dict[str, int]:
    """Sum turn.completed usage across a codex --json event stream."""
    total = {
        "input_tokens": 0,
        "cached_input_tokens": 0,
        "output_tokens": 0,
        "reasoning_output_tokens": 0,
    }
    for line in text.splitlines():
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if isinstance(ev, dict) and ev.get("type") == "turn.completed":
            for k in total:
                total[k] += int((ev.get("usage") or {}).get(k) or 0)
    return total


def cost_usd(model: str, usage: dict[str, int]) -> float:
    """Reasoning tokens are billed as output. They are ADDED to output_tokens
    in case codex reports them separately: an over-count, never an under-count."""
    p = PRICES[model]
    inp = usage.get("input_tokens", 0)
    cached = min(usage.get("cached_input_tokens", 0), inp)
    out = usage.get("output_tokens", 0) + usage.get("reasoning_output_tokens", 0)
    return ((inp - cached) * p["input"] + cached * p["cached_input"] + out * p["output"]) / 1e6


def _price_ratio(model: str) -> float:
    a, m = PRICES["gpt-6-astra"], PRICES[model]
    return max(m[k] / a[k] for k in ("input", "cached_input", "output"))


def estimate_usd(model: str, diff_chars: int, ledger: list[dict]) -> float:
    """Pre-run worst-case estimate. Uses this model's own observed $/diff-char
    (worst seen) once the ledger has one; else the astra calibration scaled by
    the most expensive price ratio. Always padded by a safety factor."""
    seen = [
        r["cost_usd"] / r["diff_chars"]
        for r in ledger
        if r.get("model") == model and r.get("diff_chars")
    ]
    per_char = max(seen) if seen else _ASTRA_USD_PER_DIFF_CHAR * _price_ratio(model)
    return max(_ESTIMATE_FLOOR_USD, per_char * diff_chars * _ESTIMATE_SAFETY)


def read_ledger(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def check_budget(
    estimate: float, ledger: list[dict], budget_usd: float, round_ceiling_usd: float
) -> tuple[bool, str]:
    spent = sum(r.get("cost_usd", 0.0) for r in ledger)
    if estimate > round_ceiling_usd:
        return (
            False,
            f"estimate ${estimate:.2f} exceeds the per-round ceiling ${round_ceiling_usd:.2f}",
        )
    if spent + estimate > budget_usd:
        return (
            False,
            f"spent ${spent:.2f} + estimate ${estimate:.2f} exceeds the budget ${budget_usd:.2f}",
        )
    return True, f"ok: spent ${spent:.2f}, estimate ${estimate:.2f}, budget ${budget_usd:.2f}"


def needs_regression_test(prior_status: str | None, changed_since_prior: list[str]) -> bool:
    """Finding->invariant rule: after a round that found issues, the fix must
    add or change a test before another PAID round is spent on it."""
    if prior_status != "ISSUES_FOUND":
        return False
    return not any(_match(p, TEST_GLOBS) for p in changed_since_prior)


# ---------------------------------------------------------------------------
# Thin process layer (no logic worth testing lives below the dataclass line)


def _run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, text=True, capture_output=True, **kw)


def pr_facts(pr: int) -> dict:
    j = json.loads(
        _run(
            ["gh", "pr", "view", str(pr), "--json", "headRefOid,baseRefName,files"], check=True
        ).stdout
    )
    base = _run(
        ["git", "merge-base", f"origin/{j['baseRefName']}", j["headRefOid"]], check=True
    ).stdout.strip()
    diff_chars = len(_run(["git", "diff", f"{base}..{j['headRefOid']}"], check=True).stdout)
    return {
        "head": j["headRefOid"],
        "merge_base": base,
        "paths": [f["path"] for f in j["files"]],
        "diff_chars": diff_chars,
    }


def prior_round(pr: int) -> dict:
    """The newest Codex review comment: status, reviewed sha, speculative count."""
    bodies = _run(
        [
            "gh",
            "api",
            f"repos/{{owner}}/{{repo}}/issues/{pr}/comments",
            "--paginate",
            "--jq",
            '.[] | select(.body|startswith("[CODEX-ADVERSARIAL-REVIEW]")) | .body | @json',
        ],
        check=True,
    ).stdout.splitlines()
    if not bodies:
        return {}
    body = json.loads(bodies[-1])

    def field(key: str) -> str | None:
        prefix = key + ":"
        return next(
            (ln.split(":", 1)[1].strip() for ln in body.splitlines() if ln.startswith(prefix)), None
        )

    return {
        "status": field("status"),
        "reviewed_sha": field("reviewed_sha"),
        "speculative": body.count("**Confidence:** speculative"),
    }


def deterministic_stage(paths: list[str]) -> list[str]:
    """Stage A on the changed Python files. Returns failures (empty = pass).
    The caller must be checked out at the PR head."""
    py = [p for p in paths if p.endswith(".py") and (REPO / p).exists()]
    failures = []
    if py:
        for cmd in (["ruff", "check", *py], ["ruff", "format", "--check", *py]):
            if _run(cmd, cwd=REPO).returncode:
                failures.append(" ".join(cmd[:2]))
        tests = [p for p in py if _match(p, TEST_GLOBS)]
        if tests and _run([sys.executable, "-m", "pytest", "-q", *tests], cwd=REPO).returncode:
            failures.append("pytest " + " ".join(tests))
    return failures


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("pr", type=int)
    ap.add_argument(
        "--plan", action="store_true", help="print the route and estimate; spend nothing"
    )
    ap.add_argument("--budget-usd", type=float, default=float(os.getenv("REVIEW_BUDGET_USD", "20")))
    ap.add_argument(
        "--round-ceiling-usd", type=float, default=float(os.getenv("REVIEW_ROUND_CEILING_USD", "3"))
    )
    ap.add_argument(
        "--ledger",
        type=Path,
        default=Path(os.getenv("REVIEW_COST_LEDGER", REPO / ".planning/review-costs.jsonl")),
    )
    ap.add_argument(
        "--disagreement",
        action="store_true",
        help="pre-filter and prior verdict conflict: escalate",
    )
    ap.add_argument(
        "--authorized", action="store_true", help="post-cap round the owner explicitly authorized"
    )
    args = ap.parse_args(argv)

    facts, prior = pr_facts(args.pr), prior_round(args.pr)
    tier, reasons = escalate(
        classify(facts["paths"]),
        speculative=prior.get("speculative", 0),
        disagreement=args.disagreement,
        cross_module_change=cross_module(facts["paths"]),
    )
    model, effort = route(tier)
    ledger = read_ledger(args.ledger)
    est = estimate_usd(model, facts["diff_chars"], ledger)
    ok, why = check_budget(est, ledger, args.budget_usd, args.round_ceiling_usd)
    print(
        json.dumps(
            {
                "pr": args.pr,
                "head": facts["head"][:9],
                "tier": tier,
                "escalation": reasons,
                "model": model,
                "effort": effort or "default",
                "diff_chars": facts["diff_chars"],
                "estimate_usd": round(est, 2),
                "budget": why,
            }
        )
    )
    if args.plan:
        return 0
    if not ok:
        print("REFUSED: " + why, file=sys.stderr)
        return 3

    head_now = _run(["git", "rev-parse", "HEAD"], cwd=REPO).stdout.strip()
    if head_now != facts["head"]:
        print(
            f"REFUSED: checkout is at {head_now[:9]}, PR head is {facts['head'][:9]}",
            file=sys.stderr,
        )
        return 3
    if fails := deterministic_stage(facts["paths"]):
        print(
            "REFUSED: deterministic stage failed (fix these for $0 first): " + "; ".join(fails),
            file=sys.stderr,
        )
        return 3
    if prior.get("reviewed_sha") and prior["reviewed_sha"] != facts["head"]:
        since = _run(
            ["git", "diff", "--name-only", f"{prior['reviewed_sha']}..{facts['head']}"], cwd=REPO
        ).stdout.split()
        if needs_regression_test(prior.get("status"), since):
            print(
                "REFUSED: the previous round found issues and no test changed since; "
                "turn each fixed finding into a regression test first",
                file=sys.stderr,
            )
            return 3

    usage_file = (
        args.ledger.parent / f"usage-{args.pr}-{facts['head'][:9]}-{int(time.time())}.jsonl"
    )
    usage_file.parent.mkdir(parents=True, exist_ok=True)
    env = dict(
        os.environ,
        CODEX_BIN=str(HERE / "codex_shim.sh"),
        CODEX_MODEL=model,
        REVIEW_USAGE_FILE=str(usage_file),
        REVIEW_EFFORT=effort or "",
    )
    if args.authorized:
        env["ADV_REVIEW_HUMAN_AUTHORIZED"] = "1"
    trusted = _run(
        ["git", "show", "origin/main:scripts/adversarial-review-trusted.sh"], cwd=REPO, check=True
    ).stdout
    rc = subprocess.run(
        ["bash", "-s", "--", str(args.pr), "--review-only"],
        input=trusted,
        text=True,
        env=env,
        cwd=REPO,
    ).returncode

    usage = usage_from_events(usage_file.read_text() if usage_file.exists() else "")
    record = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "pr": args.pr,
        "head": facts["head"],
        "tier": tier,
        "model": model,
        "effort": effort or "default",
        "diff_chars": facts["diff_chars"],
        **usage,
        "estimate_usd": round(est, 4),
        "cost_usd": round(cost_usd(model, usage), 4),
        "review_rc": rc,
    }
    with args.ledger.open("a") as f:
        f.write(json.dumps(record) + "\n")
    print(
        json.dumps(
            {
                k: record[k]
                for k in (
                    "model",
                    "input_tokens",
                    "cached_input_tokens",
                    "output_tokens",
                    "reasoning_output_tokens",
                    "cost_usd",
                )
            }
        )
    )
    return rc


if __name__ == "__main__":
    sys.exit(main())
