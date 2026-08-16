#!/usr/bin/env python3
"""Gate 7 — independent adversarial review lane (convergence doctrine §Gate 7).

The implementation agent does not perform final review. This runs a *separate*
model, on a *fresh* context, briefed to **disprove** the change — and emits the
findings shape a `units/CU-*.md` record cites.

    py tools/gate7_review.py 3261                  # auto-detect effort
    py tools/gate7_review.py 3261 --xhigh          # force xhigh
    py tools/gate7_review.py 3261 -o gate7.md      # write the report

Provider — owner decision 2026-08-16: **no OpenAI.** The doctrine's original
"GPT-5.6 Sol / Codex" default is dropped; this runs on the free-tier
Groq -> Cerebras -> Together cascade already proven in
`.github/workflows/code-review.yml`. That name had no configuration, credential,
or vendor identity anywhere in the repo, so wiring it would have failed on first
use.

**What "independent" does and does not mean here.** It means a different vendor
and model from the implementing agent, on a fresh context, with an adversarial
brief. It does NOT mean a second *human*, and it does not mean the reviewer ran
the tests. Gate 7 is one check among eleven; a PASS is evidence, not proof. Say
that plainly in the unit record rather than implying more.

Exit codes: 0 = review produced (PASS or BLOCK — read the verdict), 2 = the
whole cascade failed (advisory: fall back to a substitute panel and record the
deviation, exactly as CU-P1 and CU-02 did), 1 = usage/fetch error.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from typing import Optional

# --- Gate 7 auto-escalation ------------------------------------------------
#
# The doctrine lists fifteen categories that force xhigh. That list is stable
# reasoning, so it is a deterministic artifact rather than something a model
# re-derives per run (`.claude/rules/zero-token-architecture.md`). Each trigger
# is (label, path-regex, diff/title-keyword-regex); either match fires it.

Trigger = tuple[str, Optional[str], Optional[str]]

XHIGH_TRIGGERS: list[Trigger] = [
    (
        "database/schema",
        r"(^|/)(migrations?|db)/|\.sql$",
        r"\b(ALTER|CREATE) TABLE\b|\bmigration\b",
    ),
    ("ISA-95/UNS", r"uns[_-]|/uns\.py$", r"\buns_path\b|\bISA-?95\b|\bltree\b"),
    (
        "canonical asset identity",
        r"asset[_-]?tag|asset[_-]?identity",
        r"\b(equipment_entity_id|equipment_number|cmms_equipment\.id)\b",
    ),
    (
        "authentication",
        r"(^|/)auth/|session\.(ts|py)$",
        r"\b(NextAuth|signin|magic[- ]link|bearer token)\b",
    ),
    ("authorization", None, r"\b(RLS|row.level security|GRANT|approval_state|is_admin)\b"),
    ("tenant scoping", r"tenan(t|cy)", r"\btenant_id\b|\bwithTenantContext\b|\bis_private\b"),
    (
        "security boundaries",
        r"guardrails|security|secret",
        r"\b(gitleaks|doppler|hardcoded|sanitize)\b",
    ),
    (
        "cross-repository contract",
        r"docs/contracts/|ingest_contract",
        r"\bcross-repo\b|\bcontract\b",
    ),
    (
        "production deployment",
        r"deploy.*\.ya?ml$|docker-compose.*\.ya?ml$",
        r"\bdeploy-vps\b|\bprod-guard\b",
    ),
    ("deletion/destructive", None, r"\b(DROP|TRUNCATE|DELETE FROM|rm -rf|--force)\b"),
    (
        "concurrency/idempotency/state",
        r"fsm|state_machine",
        r"\b(idempoten|race condition|concurren|client_key)\w*\b",
    ),
]

# Broad multi-module change is a count, not a pattern.
BROAD_MODULE_THRESHOLD = 5


def _top_module(path: str) -> str:
    return path.split("/", 1)[0] if "/" in path else path


def escalation(changed_paths: list[str], haystack: str = "") -> tuple[str, list[str]]:
    """Return ("high"|"xhigh", [reasons]) per the §Gate 7 auto-escalation list.

    Pure. `haystack` is title + body + diff, lowercased internally.
    """
    reasons: list[str] = []
    joined_paths = "\n".join(changed_paths)
    hay = haystack or ""

    for label, path_re, kw_re in XHIGH_TRIGGERS:
        if path_re and re.search(path_re, joined_paths, re.I | re.M):
            reasons.append(label)
            continue
        if kw_re and re.search(kw_re, hay, re.I):
            reasons.append(label)

    modules = {_top_module(p) for p in changed_paths if p}
    if len(modules) >= BROAD_MODULE_THRESHOLD:
        reasons.append(f"broad multi-module ({len(modules)} top-level dirs)")

    # Preserve doctrine order, drop dupes.
    seen: set[str] = set()
    ordered = [r for r in reasons if not (r in seen or seen.add(r))]
    return ("xhigh" if ordered else "high", ordered)


# --- The adversarial brief -------------------------------------------------

DISPROVE_LIST = """hidden coupling; behavioral regression; architecture violations; security
failures; tenant leakage; data corruption; invalid rollback; irreversible migration;
false-green tests; duplicated logic; scope creep; documentation drift; observability gaps;
premature deletion"""


def build_prompt(title: str, body: str, diff: str, level: str, reasons: list[str]) -> str:
    """Assemble the Gate 7 brief. Pure — no I/O."""
    escalation_note = (
        f"\nThis review is **{level.upper()}** effort. Auto-escalation triggers that fired: "
        f"{', '.join(reasons)}.\nTreat those areas as the primary attack surface.\n"
        if reasons
        else f"\nThis review is **{level.upper()}** effort (no auto-escalation trigger fired).\n"
    )
    return f"""You are the Gate 7 independent adversarial reviewer for the MIRA industrial
maintenance platform. You did NOT write this change and you have no stake in it landing.

**Your job is to DISPROVE it, not to approve it.** A reviewer who says "looks good"
has added nothing. The value of this gate is finding what the implementing agent's own
tests and fuzzing were structurally blind to. On the last unit, this gate caught a
case-sensitivity defect that the author's own corpus AND fuzz generator both missed.
Assume a defect of that shape is present and go find it.
{escalation_note}
Attempt to disprove the implementation, specifically looking for:
{DISPROVE_LIST}.

PR title: {title}

PR description:
{body[:3000]}

Diff:
```diff
{diff[:40000]}
```

Output STRICT markdown in exactly this shape, no preamble:

## VERDICT
PASS or BLOCK

(BLOCK if any finding is severity high. A finding you are unsure about is still worth
reporting at medium — say what evidence would settle it.)

## FINDINGS
For each, exactly:
- **[severity: high|medium|low] Title** — what breaks, the concrete input/state that
  triggers it, and `file:line` evidence. If you cannot cite a location, say so and
  lower the severity.

If you genuinely find nothing, write "None found" and then answer:
what class of defect would this diff's own tests be structurally unable to catch?

## NOT REVIEWED
What you could not check from the diff alone (tests you did not run, runtime behavior,
data state). Be explicit — an unstated gap reads as a clean bill of health."""


# --- Findings parsing ------------------------------------------------------


@dataclass
class Finding:
    severity: str
    title: str
    detail: str = ""


@dataclass
class Review:
    verdict: str
    findings: list[Finding] = field(default_factory=list)
    provider: str = ""
    raw: str = ""
    attempts: list[str] = field(default_factory=list)


_FINDING_RE = re.compile(
    r"^\s*[-*]\s*\*\*\[severity:\s*(high|medium|low)\]\s*(.+?)\*\*\s*(?:[—–-]\s*)?(.*)$",
    re.I,
)


def parse_findings(text: str) -> list[Finding]:
    """Pure. Extract findings from the model's markdown."""
    out: list[Finding] = []
    for line in text.splitlines():
        m = _FINDING_RE.match(line)
        if m:
            out.append(Finding(m.group(1).lower(), m.group(2).strip(), m.group(3).strip()))
    return out


def verdict_of(text: str, findings: list[Finding]) -> str:
    """Pure. The model states a verdict, but a high finding overrides a stated PASS.

    A reviewer that lists a high-severity defect and then says PASS is contradicting
    itself; the finding is the evidence, so the finding wins.
    """
    if any(f.severity == "high" for f in findings):
        return "BLOCK"
    m = re.search(r"^\s*##\s*VERDICT\s*\n+\s*(PASS|BLOCK)", text, re.I | re.M)
    if m:
        return m.group(1).upper()
    return "UNKNOWN"


# --- I/O -------------------------------------------------------------------

PROVIDERS = [
    (
        "groq",
        "GROQ_API_KEY",
        "https://api.groq.com/openai/v1/chat/completions",
        "openai/gpt-oss-120b",
    ),
    ("cerebras", "CEREBRAS_API_KEY", "https://api.cerebras.ai/v1/chat/completions", "gpt-oss-120b"),
    (
        "together",
        "TOGETHERAI_API_KEY",
        "https://api.together.xyz/v1/chat/completions",
        "Qwen/Qwen2.5-72B-Instruct-Turbo",
    ),
]


def _gh_json(args: list[str]) -> dict:
    out = subprocess.run(["gh", *args], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def fetch_pr(number: int) -> tuple[str, str, list[str], str]:
    meta = _gh_json(["pr", "view", str(number), "--json", "title,body,files"])
    paths = [f["path"] for f in meta.get("files", [])]
    diff = subprocess.run(
        ["gh", "pr", "diff", str(number)], capture_output=True, text=True, check=True
    ).stdout
    return meta.get("title", ""), meta.get("body") or "", paths, diff


def call_cascade(prompt: str, max_tokens: int = 3000) -> tuple[Optional[str], str, list[str]]:
    """Try each free provider in order. Returns (text|None, provider, attempts)."""
    import httpx

    attempts: list[str] = []
    for name, env, url, model in PROVIDERS:
        key = os.environ.get(env, "")
        if not key:
            attempts.append(f"{name}: skipped (no {env})")
            continue
        try:
            r = httpx.post(
                url,
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "max_tokens": max_tokens,
                    "messages": [{"role": "user", "content": prompt}],
                },
                timeout=120.0,
            )
            r.raise_for_status()
            attempts.append(f"{name}: ok")
            return r.json()["choices"][0]["message"]["content"], f"{name} ({model})", attempts
        except Exception as e:  # noqa: BLE001 — any provider failure falls through
            attempts.append(f"{name}: {type(e).__name__} — {str(e)[:120]}")
    return None, "", attempts


def render(review: Review, number: int, level: str, reasons: list[str]) -> str:
    """The evidence shape a units/CU-*.md record cites."""
    lines = [
        f"# Gate 7 adversarial review — PR #{number}",
        "",
        f"**Verdict:** {review.verdict} · **Effort:** {level} · **Reviewer:** {review.provider or 'none'}",
        f"**Escalation triggers:** {', '.join(reasons) if reasons else 'none (High default)'}",
        "",
        "> Independent = different vendor + fresh context + a brief to disprove. NOT a second",
        "> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.",
        "",
        "## Findings",
        "",
    ]
    if review.findings:
        for f in review.findings:
            lines.append(f"- **[{f.severity}] {f.title}** — {f.detail}")
    else:
        lines.append("_No structured findings parsed — see the raw review below._")
    lines += ["", "## Raw review", "", review.raw, "", "## Cascade attempts", ""]
    lines += [f"- `{a}`" for a in review.attempts]
    return "\n".join(lines) + "\n"


def main(argv: Optional[list[str]] = None) -> int:
    p = argparse.ArgumentParser(description="Gate 7 independent adversarial review")
    p.add_argument("pr", type=int, help="PR number")
    p.add_argument("--xhigh", action="store_true", help="force xhigh effort")
    p.add_argument("-o", "--out", help="write the report here")
    a = p.parse_args(argv)

    try:
        title, body, paths, diff = fetch_pr(a.pr)
    except (subprocess.CalledProcessError, json.JSONDecodeError) as e:
        print(f"error: could not fetch PR #{a.pr}: {e}", file=sys.stderr)
        return 1

    level, reasons = escalation(paths, f"{title}\n{body}\n{diff}")
    if a.xhigh:
        level = "xhigh"
        if "forced by --xhigh" not in reasons:
            reasons = [*reasons, "forced by --xhigh"]

    print(f"Gate 7: PR #{a.pr} · effort={level} · triggers={reasons or 'none'}", file=sys.stderr)

    text, provider, attempts = call_cascade(
        build_prompt(title, body, diff, level, reasons),
        max_tokens=4000 if level == "xhigh" else 3000,
    )
    if text is None:
        print("Gate 7: ENTIRE CASCADE FAILED — no review produced.", file=sys.stderr)
        for at in attempts:
            print(f"  · {at}", file=sys.stderr)
        print("Fall back to a substitute panel and RECORD THE DEVIATION.", file=sys.stderr)
        return 2

    findings = parse_findings(text)
    review = Review(verdict_of(text, findings), findings, provider, text, attempts)
    report = render(review, a.pr, level, reasons)

    if a.out:
        with open(a.out, "w", encoding="utf-8") as fh:
            fh.write(report)
        print(f"Gate 7: {review.verdict} — written to {a.out}", file=sys.stderr)
    else:
        sys.stdout.write(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
