#!/usr/bin/env python3
"""Gate 7 independent adversarial-review lane (convergence unit CU-11).

Reviews a diff with a brief to DISPROVE it, on the free-tier
Groq -> Cerebras -> Together cascade (PRD 4-compliant; owner decision in
PR #3261: no OpenAI/"GPT-5.6 Sol"). Emits a structured evidence block a
convergence unit record cites, with an explicit PASS/BLOCK verdict.

Honesty (doctrine Gate 7, amended by CU-11): without a dedicated second
frontier vendor, "independent" means fresh context (each provider call is
stateless and sees only the disprove brief + the diff), an isolated worktree
when the reviewer is an agent, and a brief to disprove -- NOT vendor
independence. This script's evidence block states which providers ran so a
unit record cannot imply a check that did not happen.

Unlike code-review.yml (advisory; soft-skips when providers fail), this is a
GATE: provider failure exits non-zero. No silent pass.

Usage:
  py tools/gate7_review.py --pr 3270 [--unit docs/architecture/convergence/units/CU-XX.md]
  py tools/gate7_review.py --base origin/main [--effort xhigh] [--round 2] [--out FILE]

Effort:
  high  (default) -- first available provider reviews.
  xhigh           -- EVERY available provider reviews (min 2); all must PASS.

Env (Doppler factorylm/dev locally, repo secrets in CI):
  GROQ_API_KEY, CEREBRAS_API_KEY, TOGETHERAI_API_KEY
  (model overrides: GROQ_MODEL, CEREBRAS_MODEL, TOGETHER_MODEL)

Exit codes: 0 PASS | 1 BLOCK | 2 indeterminate verdict | 3 lane unavailable.
"""

from __future__ import annotations

import argparse
import datetime
import logging
import os
import re
import subprocess
import sys

import httpx

# Windows consoles default to cp1252; the diff/prompt/evidence are UTF-8.
# Reconfigure BOTH streams (gen_container_map.py's stdout-only version left
# stderr broken -- CU-06 record, finding 4).
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("gate7-review")

# Keep the brief inside free-tier context/TPM budgets (gpt-oss reasoning cost
# scales with input length -- see reference_gpt_oss_groq_migration_traps).
DIFF_CHAR_CAP = 24_000
UNIT_CHAR_CAP = 8_000
MAX_TOKENS = 4_096

PROVIDERS: list[tuple[str, str, str, str]] = [
    (
        "groq",
        "GROQ_API_KEY",
        "https://api.groq.com/openai/v1/chat/completions",
        os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b"),
    ),
    (
        "cerebras",
        "CEREBRAS_API_KEY",
        "https://api.cerebras.ai/v1/chat/completions",
        os.environ.get("CEREBRAS_MODEL", "gpt-oss-120b"),
    ),
    (
        "together",
        "TOGETHERAI_API_KEY",
        "https://api.together.xyz/v1/chat/completions",
        os.environ.get("TOGETHER_MODEL", "openai/gpt-oss-120b"),
    ),
]

# The doctrine's Gate 7 refutation axes, verbatim intent.
DISPROVE_AXES = (
    "hidden coupling; behavioral regression; architecture violations; "
    "security failures; tenant leakage; data corruption; invalid rollback; "
    "irreversible migration; false-green tests; duplicated logic; scope creep; "
    "documentation drift; observability gaps; premature deletion"
)

PROMPT_TEMPLATE = """You are the Gate 7 INDEPENDENT ADVERSARIAL REVIEWER for the FactoryLM/MIRA \
architecture-convergence program. You have fresh context: you see ONLY this brief and the diff. \
Your job is to DISPROVE the change -- assume it is wrong and hunt for the evidence. \
Do not be polite; do not summarize the change; attack it.

Attack along these axes: {axes}.

Also verify the unit record (if provided) is honest: claims match the diff, deviations are \
recorded, nothing implies evidence that is not present.

RULES:
- Every finding must cite concrete evidence from the diff (file + hunk). No speculative style nits.
- Severity: blocking (must fix before merge), important (fix or record-accept with reason), minor.
- If you genuinely cannot disprove it, say so -- a PASS must mean your refutation attempts failed, \
not that you skimmed.

OUTPUT FORMAT (exactly this shape, nothing else after the Findings section):
Verdict: PASS or Verdict: BLOCK   (BLOCK iff at least one blocking finding)
### Findings
- [blocking|important|minor] <claim> -- <evidence: file, hunk, reasoning>
(or "- none -- refutation attempts failed" if no findings)

## Unit record (may be absent)
{unit}

## Diff under review ({diff_lines} lines total{truncated_note})
```diff
{diff}
```"""


def run(cmd: list[str]) -> str:
    """Run a command, return stdout; raise with stderr context on failure."""
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)} failed: {proc.stderr.strip()[:500]}")
    return proc.stdout


def gather_diff(pr: str | None, base: str | None) -> str:
    if pr:
        return run(["gh", "pr", "diff", pr])
    return run(["git", "diff", f"{base}...HEAD"])


def build_prompt(diff: str, unit_text: str) -> str:
    diff_lines = diff.count("\n")
    truncated = len(diff) > DIFF_CHAR_CAP
    return PROMPT_TEMPLATE.format(
        axes=DISPROVE_AXES,
        unit=unit_text[:UNIT_CHAR_CAP] if unit_text else "(no unit record supplied)",
        diff_lines=diff_lines,
        truncated_note=", TRUNCATED -- flag if the cut looks load-bearing" if truncated else "",
        diff=diff[:DIFF_CHAR_CAP],
    )


def call_provider(name: str, key: str, url: str, model: str, prompt: str) -> str:
    resp = httpx.post(
        url,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={
            "model": model,
            "max_tokens": MAX_TOKENS,
            "messages": [{"role": "user", "content": prompt}],
        },
        timeout=120.0,
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    if not content or not content.strip():
        raise RuntimeError(f"{name} returned an empty completion")
    return content


def parse_verdict(text: str) -> str:
    """Return PASS, BLOCK, or INDETERMINATE from a review text."""
    verdicts = re.findall(r"^\s*Verdict:\s*(PASS|BLOCK)\b", text, re.IGNORECASE | re.MULTILINE)
    if not verdicts:
        return "INDETERMINATE"
    # A reviewer that emits both is indeterminate; take a single unambiguous verdict.
    unique = {v.upper() for v in verdicts}
    return unique.pop() if len(unique) == 1 else "INDETERMINATE"


def main() -> int:
    ap = argparse.ArgumentParser(description="Gate 7 adversarial-review lane (CU-11)")
    target = ap.add_mutually_exclusive_group(required=True)
    target.add_argument("--pr", help="PR number to review (uses `gh pr diff`)")
    target.add_argument("--base", help="git base ref (reviews base...HEAD)")
    ap.add_argument("--unit", help="path to the convergence unit record to include")
    ap.add_argument("--effort", choices=["high", "xhigh"], default="high")
    ap.add_argument("--round", dest="round_n", type=int, default=1)
    ap.add_argument("--out", help="also write the evidence block to this file")
    ap.add_argument(
        "--dry-run", action="store_true", help="print the prompt and exit (no provider calls)"
    )
    args = ap.parse_args()

    diff = gather_diff(args.pr, args.base)
    if not diff.strip():
        logger.error("empty diff -- nothing to review")
        return 3

    unit_text = ""
    if args.unit:
        with open(args.unit, encoding="utf-8", errors="replace") as f:
            unit_text = f.read()

    prompt = build_prompt(diff, unit_text)
    if args.dry_run:
        print(prompt)
        return 0

    available = [(n, os.environ.get(k, ""), u, m) for n, k, u, m in PROVIDERS]
    available = [(n, k, u, m) for n, k, u, m in available if k]
    if not available:
        logger.error("no provider keys set (GROQ_API_KEY / CEREBRAS_API_KEY / TOGETHERAI_API_KEY)")
        return 3
    if args.effort == "xhigh" and len(available) < 2:
        logger.error("xhigh requires >=2 available providers; only %d keyed", len(available))
        return 3

    reviews: list[tuple[str, str, str]] = []  # (provider(model), verdict, text)
    attempts: list[str] = []
    for name, key, url, model in available:
        try:
            text = call_provider(name, key, url, model, prompt)
            verdict = parse_verdict(text)
            reviews.append((f"{name} ({model})", verdict, text))
            attempts.append(f"{name}: ok ({verdict})")
            logger.info("%s -> %s", name, verdict)
            if args.effort == "high":
                break  # first successful provider decides
        except Exception as e:  # noqa: BLE001 -- any provider error falls through
            attempts.append(f"{name}: {type(e).__name__} -- {str(e)[:160]}")
            logger.warning("%s failed: %s", name, e)

    if not reviews:
        logger.error("all providers failed -- Gate 7 lane unavailable (this is NOT a pass)")
        for a in attempts:
            logger.error("  - %s", a)
        return 3

    verdicts = {v for _, v, _ in reviews}
    if "INDETERMINATE" in verdicts:
        overall = "INDETERMINATE"
    elif "BLOCK" in verdicts:
        overall = "BLOCK"
    else:
        overall = "PASS"

    target_desc = f"PR #{args.pr}" if args.pr else f"{args.base}...HEAD"
    today = datetime.date.today().isoformat()
    lines = [
        f"## Gate 7 adversarial review — round {args.round_n} ({today})",
        f"- Target: {target_desc}",
        f"- Lane: `tools/gate7_review.py` — Groq → Cerebras → Together cascade "
        f"(effort {args.effort}; {'all available providers must pass' if args.effort == 'xhigh' else 'first available provider'})",
        "- Independence basis: fresh context by construction (stateless call; the reviewer "
        "sees only the disprove brief + diff). NOT a cross-frontier-vendor check (owner "
        "decision, PR #3261).",
        f"- Providers: {', '.join(a for a in attempts)}",
        f"- **Overall verdict: {overall}**",
        "",
    ]
    for ident, verdict, text in reviews:
        lines += [f"### Reviewer: {ident} — {verdict}", "", text.strip(), ""]
    evidence = "\n".join(lines)

    print(evidence)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(evidence)
        logger.info("evidence written to %s", args.out)

    return {"PASS": 0, "BLOCK": 1, "INDETERMINATE": 2}[overall]


if __name__ == "__main__":
    sys.exit(main())
