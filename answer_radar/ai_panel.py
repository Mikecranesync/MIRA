"""AI-visibility panel: ask the major AI assistants the 20 panel questions, grade every
answer (MIRA's included) and report whether FactoryLM is mentioned or cited.

Questions + answer keys: ``answer_radar/ai_panel_questions.json``. Plan and the manual
first run: ``.planning/2026-11-22-measurement-plan.md``.

An API answer with web search on is a PROXY for the consumer app, not the same thing:
the apps add personalization, their own system prompts and different models. Every
report says so.

Spend law (``.claude/rules/zero-token-architecture.md``): one shared hard budget, the
worst case of each call reserved BEFORE it is sent, real usage settled after. Stored
answers are never re-asked. Grading is deterministic (regex answer keys) — no judge spend.

Run (one run = Mike's approval at the declared cap):
    doppler run -p factorylm -c dev -- .venv/bin/python -m answer_radar.ai_panel \
        --out .planning/ai-panel/<date> --budget-usd 6
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import httpx

QUESTIONS_FILE = Path(__file__).with_name("ai_panel_questions.json")
FACTORYLM_RE = re.compile(r"factorylm", re.I)
SAFETY_RE = re.compile(
    r"lock\s*-?\s*out|LOTO|de-?energi[sz]|isolate (?:the )?power|disconnect (?:all )?power|qualified (?:electrician|technician|person)",
    re.I,
)
FOLLOWUP_RE = re.compile(r"\?\s*$|\?\s*\n", re.M)

#: USD per 1M tokens (input, output) and per web search. Upper bounds where the
#: provider's live price was not confirmed in-repo; a provider without a price
#: here refuses to run (no cost-invisible spend).
PRICES: dict[str, dict[str, float]] = {
    # tools/review_router/prices.json; web search $10/1k calls + up to 8k search tokens billed as input.
    "openai": {"in": 0.75, "out": 4.5, "search": 0.01, "search_tokens": 8000},
    # claude-api skill price table (2026-11-03): Opus 5.5 $4/$20; web search $10/1k.
    "anthropic": {"in": 4.0, "out": 20.0, "search": 0.01, "search_tokens": 0},
    # NOT confirmed: deliberately high upper bound for gemini flash + $0.035 per grounded prompt.
    "gemini": {"in": 1.0, "out": 6.0, "search": 0.035, "search_tokens": 0},
    # MIRA on staging: no metered call from this script (the Hub's own provider spend is
    # outside this budget and is reported separately).
    "mira": {"in": 0.0, "out": 0.0, "search": 0.0, "search_tokens": 0},
}
MODELS = {
    "openai": "gpt-5.4-mini",
    "anthropic": "claude-opus-5-5",
    "gemini": "gemini-3.5-flash",
    "mira": "staging-hub-new-chat",
}
MAX_OUT = 8000
MAX_IN_GUESS = 2000  # question + framing, before search tokens
MAX_SEARCHES = 3


def redact(msg: str) -> str:
    """Never let a key reach a log line, whatever the provider echoes back."""
    for name in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"):
        v = os.environ.get(name)
        if v:
            msg = msg.replace(v, "[REDACTED]")
    return re.sub(r"(key=)[^&\s']+", r"\1[REDACTED]", msg)


class BudgetExceeded(RuntimeError):
    pass


@dataclass
class Budget:
    cap_usd: float
    spent_usd: float = 0.0

    def worst_case(self, provider: str) -> float:
        p = PRICES[provider]
        tin = MAX_IN_GUESS + MAX_SEARCHES * (p["search_tokens"] or 20000)
        return tin / 1e6 * p["in"] + MAX_OUT / 1e6 * p["out"] + MAX_SEARCHES * p["search"]

    def reserve(self, provider: str) -> None:
        if self.spent_usd + self.worst_case(provider) > self.cap_usd:
            raise BudgetExceeded(
                f"next {provider} call could pass the ${self.cap_usd:.2f} cap (spent ${self.spent_usd:.4f})"
            )

    def settle(self, provider: str, tokens_in: int, tokens_out: int, searches: int) -> float:
        p = PRICES[provider]
        cost = (
            tokens_in / 1e6 * p["in"]
            + tokens_out / 1e6 * p["out"]
            + searches * (p["search"] + p["search_tokens"] / 1e6 * p["in"])
        )
        self.spent_usd += cost
        return cost


SYSTEM = None  # no system prompt: closest to a fresh consumer chat


def ask_openai(client: httpx.Client, q: str) -> dict[str, Any]:
    r = client.post(
        "https://api.openai.com/v1/responses",
        headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"},
        json={
            "model": MODELS["openai"],
            "input": q,
            "tools": [{"type": "web_search"}],
            "reasoning": {"effort": "low"},
            "max_output_tokens": MAX_OUT,
        },
        timeout=180,
    )
    r.raise_for_status()
    d = r.json()
    text, urls, searches = [], [], 0
    for item in d.get("output", []):
        if item.get("type") == "web_search_call":
            searches += 1
        for c in item.get("content", []) or []:
            if c.get("type") == "output_text":
                text.append(c.get("text", ""))
                urls += [
                    a["url"]
                    for a in c.get("annotations", [])
                    if a.get("type") == "url_citation" and a.get("url")
                ]
    u = d.get("usage", {})
    return {
        "answer": "\n".join(text),
        "urls": urls,
        "tokens_in": u.get("input_tokens", 0),
        "tokens_out": u.get("output_tokens", 0),
        "searches": searches,
        "finished": d.get("status") == "completed",
    }


def ask_anthropic(_client: httpx.Client, q: str) -> dict[str, Any]:
    import anthropic

    resp = anthropic.Anthropic().messages.create(
        model=MODELS["anthropic"],
        max_tokens=MAX_OUT,
        output_config={"effort": "low"},
        tools=[{"type": "web_search_20260209", "name": "web_search", "max_uses": MAX_SEARCHES}],
        messages=[{"role": "user", "content": q}],
    )
    text, urls = [], []
    for b in resp.content:
        if b.type == "web_search_tool_result" and isinstance(b.content, list):
            urls += [u for r in b.content if (u := getattr(r, "url", None))]
        if b.type == "text":
            text.append(b.text)
            urls += [u for c in (b.citations or []) if (u := getattr(c, "url", None))]
    stu = getattr(resp.usage, "server_tool_use", None)
    searches = getattr(stu, "web_search_requests", 0) or 0
    return {
        "answer": "".join(text),
        "urls": urls,
        "tokens_in": resp.usage.input_tokens,
        "tokens_out": resp.usage.output_tokens,
        "searches": searches,
        "stop_reason": resp.stop_reason,
        "finished": resp.stop_reason == "end_turn",
    }


def ask_gemini(client: httpx.Client, q: str) -> dict[str, Any]:
    r = client.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{MODELS['gemini']}:generateContent",
        headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]},
        json={
            "contents": [{"parts": [{"text": q}]}],
            "tools": [{"google_search": {}}],
            "generationConfig": {"maxOutputTokens": MAX_OUT},
        },
        timeout=180,
    )
    r.raise_for_status()
    d = r.json()
    cand = (d.get("candidates") or [{}])[0]
    text = "".join(p.get("text", "") for p in (cand.get("content") or {}).get("parts", []))
    gm = cand.get("groundingMetadata") or {}
    # groundingChunks carry a redirect uri; the title is the real source domain.
    urls = [
        c["web"].get("title") or c["web"].get("uri")
        for c in gm.get("groundingChunks", [])
        if c.get("web")
    ]
    u = d.get("usageMetadata", {})
    out = u.get("candidatesTokenCount", 0) + u.get("thoughtsTokenCount", 0)
    return {
        "answer": text,
        "urls": urls,
        "tokens_in": u.get("promptTokenCount", 0),
        "tokens_out": out,
        "searches": 1 if gm else 0,
        "finished": cand.get("finishReason") == "STOP",
    }


STAGING = "https://app-staging.factorylm.com"
_HUB: dict[str, Any] = {}


def _provision(*extra: str) -> str:
    """mira-hub/scripts/provision-beta-gate.ts against staging, with only the env it needs.
    The cookie stays in memory; it is never printed or written."""
    import subprocess

    env = {k: os.environ[k] for k in ("PATH", "HOME") if k in os.environ} | {"HUB_BASE": STAGING}
    cmd = [
        "doppler",
        "run",
        "-p",
        "factorylm",
        "-c",
        "stg",
        "--only-secrets",
        "NEON_DATABASE_URL",
        "--",
        "bun",
        "run",
        "scripts/provision-beta-gate.ts",
        *extra,
    ]
    hub_dir = Path(
        os.environ.get("AI_PANEL_HUB_DIR") or Path(__file__).resolve().parents[1] / "mira-hub"
    )
    r = subprocess.run(cmd, cwd=hub_dir, env=env, capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        raise RuntimeError(f"provision {extra or ''} failed: {redact(r.stderr)[-300:]}")
    return r.stdout


def ask_mira(_client: httpx.Client, q: str) -> dict[str, Any]:
    """MIRA as a stranger meets it: a fresh staging account, a new chat, no machine picked."""
    from answer_radar.hub_runner import (
        assert_staging,
        deployed_sha,
        load_hub_client,
        run_question_hub,
    )
    from answer_radar.schema import QuestionRecord

    if "hub" not in _HUB:
        assert_staging(STAGING)
        out = _provision()
        env = dict(line[4:].split("=", 1) for line in out.splitlines() if line.startswith("ENV:"))
        _HUB["tenant"] = env["BETA_GATE_TENANT"]
        _HUB["hub"] = load_hub_client()(STAGING, env["BETA_GATE_COOKIE"])
        _HUB["sha"] = deployed_sha(_HUB["hub"])
    rec, summary = run_question_hub(
        QuestionRecord(question_id="AI-PANEL", normalized_question=q, source_platform="ai_panel"),
        _HUB["hub"],
        condition="new_chat",
        mira_version=_HUB["sha"],
        stamp="ai-panel",
    )
    return {
        "answer": rec.answer_text,
        "urls": list(rec.citations),
        "tokens_in": 0,
        "tokens_out": 0,
        "searches": 0,
        "staging_sha": _HUB["sha"],
        "turn": summary.get("turn_status"),
        "finished": summary.get("http") == 200,
    }


def cleanup_mira() -> None:
    """Delete the throwaway staging account. Runs on every exit path of main()."""
    tenant = _HUB.pop("tenant", None)
    _HUB.clear()
    if tenant:
        _provision("--cleanup", tenant)


ASKERS: dict[str, Callable[[httpx.Client, str], dict[str, Any]]] = {
    "openai": ask_openai,
    "anthropic": ask_anthropic,
    "gemini": ask_gemini,
    "mira": ask_mira,
}


def grade(q: dict[str, Any], answer: str, urls: list[str]) -> dict[str, Any]:
    """Deterministic grade. `correct` is None when the question has no answer key."""
    blob = answer + "\n" + "\n".join(urls)
    key = q.get("answer_key")
    correct = None
    if key:
        correct = bool(re.search(key["must"], answer, re.I)) and not (
            key.get("must_not") and re.search(key["must_not"], answer, re.I)
        )
    tools = (
        sorted(
            {t for t in q.get("tool_names", []) if re.search(rf"\b{re.escape(t)}\b", answer, re.I)}
        )
        if q.get("tool_names")
        else []
    )
    return {
        # Q18/Q19 name the brand in the question, so a mention there is an echo, not a win.
        "mentions_factorylm": None if q.get("brand_query") else bool(FACTORYLM_RE.search(answer)),
        "cites_factorylm": any(FACTORYLM_RE.search(u) for u in urls),
        "cites_any_source": bool(urls),
        "correct": correct,
        "safety_warning": bool(SAFETY_RE.search(answer)) if q.get("safety_relevant") else None,
        "asks_followup": bool(FOLLOWUP_RE.search(answer.strip()[-400:])),
        "tools_named": tools,
        "factorylm_in_blob": bool(FACTORYLM_RE.search(blob)),
    }


def load_questions() -> list[dict[str, Any]]:
    qs = json.loads(QUESTIONS_FILE.read_text())["questions"]
    if len(qs) != 20 or [q["n"] for q in qs] != list(range(1, 21)):
        raise SystemExit("ai_panel_questions.json must hold questions 1..20 in order")
    return qs


def run(
    out: Path, providers: list[str], budget: Budget, questions: list[dict[str, Any]]
) -> list[str]:
    log = []
    for prov in providers:
        if prov not in PRICES:
            raise SystemExit(f"no price for {prov}; refusing a cost-invisible run")
    with httpx.Client() as client:
        for prov in providers:
            errors = 0
            for q in questions:
                if errors >= 2:
                    log.append(f"{prov} SKIPPED rest after 2 consecutive errors")
                    break
                path = out / prov / f"q{q['n']:02d}.json"
                if path.exists():
                    continue  # never re-ask a stored answer
                try:
                    budget.reserve(prov)
                except BudgetExceeded as e:
                    log.append(f"STOP {e}")
                    return log
                try:
                    res = ASKERS[prov](client, q["text"])
                except Exception as e:  # recorded, not retried: the next run resumes it
                    body = getattr(getattr(e, "response", None), "text", "") or ""
                    log.append(
                        f"{prov} q{q['n']} ERROR {type(e).__name__}: {redact(str(e) + ' ' + body)[:400]}"
                    )
                    errors += 1
                    continue
                errors = 0
                cost = budget.settle(prov, res["tokens_in"], res["tokens_out"], res["searches"])
                if not res.get("finished"):
                    # Paid for, but never stored: a cut-off answer must not be graded forever.
                    log.append(f"{prov} q{q['n']} UNFINISHED ${cost:.4f} (not stored)")
                    (out / prov).mkdir(parents=True, exist_ok=True)
                    with open(out / prov / "unfinished_cost.jsonl", "a") as f:
                        f.write(json.dumps({"n": q["n"], "cost_usd": cost}) + "\n")
                    continue
                rec = {
                    "provider": prov,
                    "model": MODELS[prov],
                    "n": q["n"],
                    "question": q["text"],
                    **res,
                    "cost_usd": round(cost, 5),
                    "grade": grade(q, res["answer"], res["urls"]),
                }
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(rec, indent=1))
                log.append(f"{prov} q{q['n']} ${cost:.4f} total ${budget.spent_usd:.4f}")
    return log


def spent_so_far(out: Path) -> float:
    """Spend is recomputed from what is on disk, so a killed run never loses its total."""
    total = 0.0
    for f in out.glob("*/q*.json"):
        total += json.loads(f.read_text()).get("cost_usd", 0.0)
    for f in out.glob("*/unfinished_cost.jsonl"):
        total += sum(json.loads(line)["cost_usd"] for line in f.read_text().splitlines() if line)
    return total


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--budget-usd", type=float, required=True)
    ap.add_argument("--providers", default="openai,anthropic,gemini")
    ap.add_argument(
        "--questions", default="", help="comma list of question numbers (default: all 20)"
    )
    a = ap.parse_args(argv)
    out = Path(a.out)
    budget = Budget(cap_usd=a.budget_usd, spent_usd=spent_so_far(out))
    qs = load_questions()
    if a.questions:
        keep = {int(x) for x in a.questions.split(",")}
        qs = [x for x in qs if x["n"] in keep]
    try:
        log = run(out, a.providers.split(","), budget, qs)
    finally:
        cleanup_mira()
    print("\n".join(log))
    print(f"SPENT ${budget.spent_usd:.4f} of ${a.budget_usd:.2f} cap")
    return 0


if __name__ == "__main__":
    sys.exit(main())
