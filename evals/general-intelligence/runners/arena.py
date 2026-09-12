#!/usr/bin/env python3
"""MIRA General Intelligence Arena — runner (GI-1).

Two systems, one corpus, one report:

  raw   — the configured frontier model, OpenAI-compatible chat completions,
          same prompt + images, NO FactoryLM tools (Baseline A, plan §12.1)
  mira  — the current MIRA conversation engine through its public API
          (notebook chat, general mode; the phone's real door)

Modes:
  --dry-run   no network: deterministic canned answers so the harness, the
              judges, the report, and CI stay reproducible for $0
  live        REQUIRES --budget-usd (zero-token law: paid inference is a
              declared validation instrument, never a dev loop) and stops at
              the budget; every call's cost is estimated and recorded

Configuration (never hard-code a model name):
  GI_FRONTIER_BASE_URL   OpenAI-compatible base (e.g. https://api.openai.com/v1)
  GI_FRONTIER_API_KEY
  GI_FRONTIER_MODEL      the frontier alias under test (multimodal)
  GI_MIRA_HUB_BASE       Hub base for the MIRA system
  GI_MIRA_COOKIE         next-auth session for an isolated eval tenant
  GI_MIRA_NOTEBOOK_ID    a notebook with NO sources (general mode is the door)
  GI_JUDGE_MODEL / GI_JUDGE_BASE_URL / GI_JUDGE_API_KEY  (optional; defaults to frontier)

Outputs (evals/general-intelligence/reports/<run-id>/):
  results.jsonl   one row per (case, system, turn) with answer, latency, cost
  verdicts.json   deterministic verdicts + (optional) model-judge scores
  report.md       W/T/L per category + wrapper-degradation list

Baseline B (the ChatGPT product) is a HUMAN-run protocol — see README; this
runner only ingests those captures (`--import-chatgpt <dir>`) for blind scoring.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import mimetypes
import os
import sys
import time
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from judges.rubric import (  # noqa: E402
    RUBRIC_DIMENSIONS,
    blind_pair,
    judge_deterministic,
    judge_prompt,
    parse_judge_json,
    verdict_for,
    weighted_score,
)

CASES_DIR = ROOT / "cases"
SCHEMA_PATH = ROOT / "schemas" / "case.schema.json"
REPORTS_DIR = ROOT / "reports"

# Rough $/1M tokens for the cost ledger; unknown models are priced at the max so
# an unlisted model can only OVER-estimate spend (never silently burn).
_COST_PER_MTOK: dict[str, tuple[float, float]] = {
    "gpt-oss-120b": (0.15, 0.60),
    "openai/gpt-oss-120b": (0.15, 0.60),
    "meta-llama/Llama-3.3-70B-Instruct-Turbo": (0.88, 0.88),
    "MiniMaxAI/MiniMax-M3": (0.30, 1.20),
}
_COST_UNKNOWN = (15.0, 60.0)


def estimate_cost_usd(model: str, in_tok: int, out_tok: int) -> float:
    i, o = _COST_PER_MTOK.get(model, _COST_UNKNOWN)
    return round((in_tok * i + out_tok * o) / 1_000_000, 6)


# ── corpus ───────────────────────────────────────────────────────────────────


def load_cases(cases_dir: Path = CASES_DIR) -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    for f in sorted(cases_dir.glob("*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        cases.extend(data if isinstance(data, list) else [data])
    ids = [c["id"] for c in cases]
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        raise ValueError(f"duplicate case ids: {sorted(dupes)}")
    return cases


def validate_cases(cases: list[dict[str, Any]], schema_path: Path = SCHEMA_PATH) -> list[str]:
    """Structural validation without a jsonschema dependency: required keys,
    enums, id pattern, weights sum, fixture references."""
    import re

    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    errors: list[str] = []
    cats = set(schema["properties"]["category"]["enum"])
    id_re = re.compile(schema["properties"]["id"]["pattern"])
    for c in cases:
        cid = c.get("id", "<no id>")
        for k in schema["required"]:
            if k not in c:
                errors.append(f"{cid}: missing {k}")
        if not id_re.match(str(c.get("id", ""))):
            errors.append(f"{cid}: bad id")
        if c.get("category") not in cats:
            errors.append(f"{cid}: bad category {c.get('category')!r}")
        w = (c.get("rubric") or {}).get("weights") or {}
        if set(w) != set(RUBRIC_DIMENSIONS):
            errors.append(f"{cid}: rubric weights must name exactly {RUBRIC_DIMENSIONS}")
        elif abs(sum(w.values()) - 100) > 1e-6:
            errors.append(f"{cid}: rubric weights sum to {sum(w.values())}, expected 100")
        turns = c.get("turns") or []
        if not turns or turns[0].get("role") != "user":
            errors.append(f"{cid}: first turn must be the user")
        for t in turns:
            for img in t.get("images", []) or []:
                if not img.startswith("fixtures/"):
                    errors.append(f"{cid}: image ref must live under fixtures/: {img}")
        exp = c.get("expected") or {}
        if "must_answer" not in exp or "tools_allowed" not in exp:
            errors.append(f"{cid}: expected.must_answer and expected.tools_allowed are required")
        if c.get("category") != "private_data" and c.get("private_context"):
            errors.append(f"{cid}: only private_data cases may carry private_context")
    return errors


# ── systems ──────────────────────────────────────────────────────────────────


@dataclass
class TurnResult:
    case_id: str
    system: str
    turn_index: int
    answer: str
    latency_ms: int
    model: str
    input_tokens: int | None
    output_tokens: int | None
    cost_usd: float
    tool_calls: list[str]
    error: str | None = None
    fixture_missing: list[str] | None = None


def _image_data_url(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def _canned(case: dict[str, Any], system: str, turn_index: int) -> str:
    """Deterministic dry-run answer: reproducible bytes keyed on case+system.
    The raw canned answer always answers; the mira canned answer mimics
    today's general-mode behaviour, INCLUDING the known degradation on
    image-only turns (the model never sees pixels), so a dry run shows the
    harness catching the failure class it exists for."""
    turn = case["turns"][turn_index]
    seed = hashlib.sha256(f"{case['id']}|{system}|{turn_index}".encode()).hexdigest()[:8]
    facts = ", ".join(case.get("expected", {}).get("critical_facts", [])) or "the visible evidence"
    if system == "raw":
        return (
            f"[dry-run raw {seed}] Looking at what you sent: this is most consistent with {facts}. "
            f"Here is what I can tell, what I can't verify from the photo alone, and what to check first. "
            f"(Answering: {turn['text']!r})"
        )
    if turn.get("images"):
        return "I couldn't find that in the selected sources."
    return (
        f"[dry-run mira {seed}] From general electrical and mechanical knowledge: {facts}. "
        f"I can't verify whether that occurred on any specific machine because I don't have machine history for it. "
        f"(Answering: {turn['text']!r})"
    )


class RawFrontier:
    name = "raw"

    def __init__(
        self, base_url: str, api_key: str, model: str, http: Callable[..., Any] | None = None
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self._http = http

    def ask(
        self,
        case: dict[str, Any],
        history: list[dict[str, Any]],
        turn: dict[str, Any],
        images: list[Path],
    ) -> tuple[str, dict[str, Any]]:
        import httpx

        content: list[dict[str, Any]] = [{"type": "text", "text": turn["text"]}]
        for p in images:
            content.append({"type": "image_url", "image_url": {"url": _image_data_url(p)}})
        messages = [
            {
                "role": "system",
                "content": "You are a helpful expert assistant for real-world troubleshooting. Be direct, honest about uncertainty, and cite sources when you use them.",
            },
            *history,
            {"role": "user", "content": content},
        ]
        body = {"model": self.model, "messages": messages, "temperature": 0.3, "max_tokens": 900}
        client = self._http or httpx.Client(timeout=120)
        r = client.post(
            f"{self.base_url}/chat/completions",
            json=body,
            headers={"Authorization": f"Bearer {self.api_key}"},
        )
        r.raise_for_status()
        data = r.json()
        text = data["choices"][0]["message"]["content"]
        usage = data.get("usage") or {}
        return text, {
            "input_tokens": usage.get("prompt_tokens"),
            "output_tokens": usage.get("completion_tokens"),
        }


class MiraNotebookGeneral:
    """Today's MIRA door: notebook chat, general mode (no sources). Images are
    NOT sent — the current engine has no multimodal input; the harness records
    that honestly (fixture listed, model=… , answer as returned)."""

    name = "mira"

    def __init__(
        self, hub_base: str, cookie: str, notebook_id: str, http: Callable[..., Any] | None = None
    ):
        self.hub_base = hub_base.rstrip("/")
        self.cookie = cookie
        self.notebook_id = notebook_id
        self._http = http

    def ask(
        self,
        case: dict[str, Any],
        history: list[dict[str, Any]],
        turn: dict[str, Any],
        images: list[Path],
    ) -> tuple[str, dict[str, Any]]:
        import httpx

        client = self._http or httpx.Client(timeout=120, follow_redirects=True)
        body = {
            "message": turn["text"],
            "mode": "general",
            "history": [
                {
                    "role": h["role"],
                    "content": h["content"]
                    if isinstance(h["content"], str)
                    else h["content"][0]["text"],
                }
                for h in history
            ],
        }
        r = client.post(
            f"{self.hub_base}/api/equipment-notebooks/{self.notebook_id}/chat/",
            json=body,
            headers={"Cookie": self.cookie},
        )
        if r.status_code != 200:
            try:
                err = r.json()
            except ValueError:
                err = {"error": r.text[:200]}
            return f"{err.get('error', '')} [{err.get('code', r.status_code)}]", {
                "input_tokens": None,
                "output_tokens": None,
                "http": r.status_code,
            }
        parts: list[str] = []
        usage: dict[str, Any] = {}
        for line in r.text.splitlines():
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if not payload or payload == "[DONE]":
                continue
            try:
                obj = json.loads(payload)
            except ValueError:
                continue
            if obj.get("kind") == "content":
                parts.append(obj.get("content", ""))
            elif obj.get("kind") == "usage":
                usage = {
                    "input_tokens": obj.get("inputTokens"),
                    "output_tokens": obj.get("outputTokens"),
                    "model": obj.get("model"),
                }
        return "".join(parts), usage


# ── run ──────────────────────────────────────────────────────────────────────


@dataclass
class Budget:
    limit_usd: float | None
    spent_usd: float = 0.0

    def charge(self, cost: float) -> None:
        self.spent_usd = round(self.spent_usd + cost, 6)
        if self.limit_usd is not None and self.spent_usd > self.limit_usd:
            raise BudgetExceeded(f"budget {self.limit_usd} USD exceeded at {self.spent_usd}")


class BudgetExceeded(RuntimeError):
    pass


def run_system(
    system: Any, cases: list[dict[str, Any]], *, dry_run: bool, budget: Budget, fixtures_root: Path
) -> list[TurnResult]:
    results: list[TurnResult] = []
    for case in cases:
        history: list[dict[str, Any]] = []
        for i, turn in enumerate(case["turns"]):
            if turn["role"] != "user":
                continue
            images = [fixtures_root.parent / p for p in turn.get("images", [])]
            missing = [p.relative_to(ROOT).as_posix() for p in images if not p.exists()]
            t0 = time.monotonic()
            err: str | None = None
            meta: dict[str, Any] = {}
            if dry_run:
                answer = _canned(case, system.name, i)
                model = f"dry-run:{system.name}"
                cost = 0.0
            else:
                model = getattr(system, "model", None) or "mira"
                try:
                    answer, meta = system.ask(
                        case, history, turn, [p for p in images if p.exists()]
                    )
                except Exception as exc:  # noqa: BLE001 — record, never crash the arena
                    answer, err = "", f"{type(exc).__name__}: {str(exc)[:200]}"
                cost = estimate_cost_usd(
                    str(meta.get("model") or model),
                    int(meta.get("input_tokens") or 0),
                    int(meta.get("output_tokens") or 0),
                )
                budget.charge(cost)
            results.append(
                TurnResult(
                    case_id=case["id"],
                    system=system.name,
                    turn_index=i,
                    answer=answer,
                    latency_ms=int((time.monotonic() - t0) * 1000),
                    model=str(meta.get("model") or model),
                    input_tokens=meta.get("input_tokens"),
                    output_tokens=meta.get("output_tokens"),
                    cost_usd=cost,
                    tool_calls=[],
                    error=err,
                    fixture_missing=missing or None,
                )
            )
            history.append({"role": "user", "content": turn["text"]})
            history.append({"role": "assistant", "content": answer})
    return results


def final_answers(results: list[TurnResult]) -> dict[tuple[str, str], str]:
    """The LAST assistant answer per (case, system) — conversation, not first turn."""
    out: dict[tuple[str, str], str] = {}
    for r in results:
        out[(r.case_id, r.system)] = r.answer
    return out


def build_report(
    cases: list[dict[str, Any]],
    results: list[TurnResult],
    judge_scores: dict[str, dict[str, dict[str, float]]] | None,
) -> dict[str, Any]:
    answers = final_answers(results)
    verdicts: list[dict[str, Any]] = []
    tally: dict[str, dict[str, int]] = {}
    degraded: list[str] = []
    for case in cases:
        cat = case["category"]
        tally.setdefault(cat, {"MIRA wins": 0, "Tie": 0, "Baseline wins": 0})
        det = {
            s: judge_deterministic(case, s, answers.get((case["id"], s), ""))
            for s in ("raw", "mira")
        }
        if det["mira"].degraded:
            degraded.append(case["id"])
        row: dict[str, Any] = {
            "case_id": case["id"],
            "category": cat,
            "deterministic": {s: v.to_dict() for s, v in det.items()},
        }
        if judge_scores and case["id"] in judge_scores:
            w = case["rubric"]["weights"]
            m = weighted_score(judge_scores[case["id"]].get("mira", {}), w)
            b = weighted_score(judge_scores[case["id"]].get("raw", {}), w)
            # a hard deterministic fail caps the score: a refusal is never a win
            if det["mira"].hard_fail:
                m = min(m, 10.0)
            if det["raw"].hard_fail:
                b = min(b, 10.0)
            row["scores"] = {"mira": m, "raw": b}
            row["verdict"] = verdict_for(m, b)
        else:
            # no model judge: verdict from deterministic outcomes only
            hf_m, hf_r = det["mira"].hard_fail, det["raw"].hard_fail
            row["verdict"] = "Tie" if hf_m == hf_r else ("Baseline wins" if hf_m else "MIRA wins")
        tally[cat][row["verdict"]] += 1
        verdicts.append(row)
    spent = round(sum(r.cost_usd for r in results), 6)
    scored = [v for v in verdicts if "scores" in v]
    parity = None
    if scored:
        ms = sum(v["scores"]["mira"] for v in scored)
        rs = sum(v["scores"]["raw"] for v in scored)
        parity = round(100.0 * ms / rs, 1) if rs else None
    return {
        "tally": tally,
        "verdicts": verdicts,
        "wrapper_degradation": degraded,
        "spent_usd": spent,
        "parity_pct": parity,
        "cases": len(cases),
    }


def render_markdown(report: dict[str, Any], run_id: str) -> str:
    lines = [f"# General Intelligence Arena — run `{run_id}`", ""]
    lines.append(
        f"Cases: {report['cases']} · spent: ${report['spent_usd']:.4f} · MIRA/raw parity: {report['parity_pct'] if report['parity_pct'] is not None else 'n/a (no model judge)'}%"
    )
    lines.append("")
    lines.append("| Category | MIRA wins | Tie | Baseline wins |")
    lines.append("|---|---:|---:|---:|")
    for cat, t in sorted(report["tally"].items()):
        lines.append(f"| {cat} | {t['MIRA wins']} | {t['Tie']} | {t['Baseline wins']} |")
    lines.append("")
    if report["wrapper_degradation"]:
        lines.append("## Wrapper degradation (MIRA refused an answerable case)")
        for cid in report["wrapper_degradation"]:
            lines.append(f"- `{cid}`")
    else:
        lines.append("No wrapper degradation detected.")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None, env: dict[str, str] | None = None) -> int:
    env = dict(os.environ) if env is None else env
    ap = argparse.ArgumentParser(description="MIRA General Intelligence Arena")
    ap.add_argument(
        "--dry-run", action="store_true", help="no network; deterministic canned answers"
    )
    ap.add_argument(
        "--budget-usd", type=float, default=None, help="REQUIRED for a live run; hard stop"
    )
    ap.add_argument("--systems", default="raw,mira")
    ap.add_argument("--judge", action="store_true", help="blind model judge (needs budget)")
    ap.add_argument("--case", action="append", default=[], help="run only these case ids")
    ap.add_argument("--out", default=None, help="report dir (default reports/<run-id>)")
    ap.add_argument("--validate-only", action="store_true")
    args = ap.parse_args(argv)

    cases = load_cases()
    errors = validate_cases(cases)
    if errors:
        print("\n".join(f"INVALID: {e}" for e in errors))
        return 2
    if args.validate_only:
        print(f"OK: {len(cases)} cases valid")
        return 0
    if args.case:
        cases = [c for c in cases if c["id"] in set(args.case)]
    if not args.dry_run and args.budget_usd is None:
        print(
            "REFUSED: a live arena run needs --budget-usd (paid inference is a declared validation instrument)",
            file=sys.stderr,
        )
        return 2

    run_id = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
    out = Path(args.out) if args.out else REPORTS_DIR / run_id
    out.mkdir(parents=True, exist_ok=True)
    budget = Budget(args.budget_usd)
    systems: list[Any] = []
    for name in args.systems.split(","):
        name = name.strip()
        if name == "raw":
            if args.dry_run:
                systems.append(type("Raw", (), {"name": "raw", "model": "dry-run"})())
            else:
                systems.append(
                    RawFrontier(
                        env.get("GI_FRONTIER_BASE_URL", ""),
                        env.get("GI_FRONTIER_API_KEY", ""),
                        env.get("GI_FRONTIER_MODEL", ""),
                    )
                )
        elif name == "mira":
            if args.dry_run:
                systems.append(type("Mira", (), {"name": "mira", "model": "dry-run"})())
            else:
                systems.append(
                    MiraNotebookGeneral(
                        env.get("GI_MIRA_HUB_BASE", ""),
                        env.get("GI_MIRA_COOKIE", ""),
                        env.get("GI_MIRA_NOTEBOOK_ID", ""),
                    )
                )
    results: list[TurnResult] = []
    try:
        for s in systems:
            results.extend(
                run_system(
                    s, cases, dry_run=args.dry_run, budget=budget, fixtures_root=ROOT / "fixtures"
                )
            )
    except BudgetExceeded as exc:
        print(f"STOPPED: {exc}", file=sys.stderr)
    with (out / "results.jsonl").open("w", encoding="utf-8") as fh:
        for r in results:
            fh.write(json.dumps(asdict(r)) + "\n")

    judge_scores: dict[str, dict[str, dict[str, float]]] | None = None
    if args.judge and not args.dry_run:
        judge_scores = {}
        import httpx

        jm = env.get("GI_JUDGE_MODEL") or env.get("GI_FRONTIER_MODEL", "")
        jb = (env.get("GI_JUDGE_BASE_URL") or env.get("GI_FRONTIER_BASE_URL", "")).rstrip("/")
        jk = env.get("GI_JUDGE_API_KEY") or env.get("GI_FRONTIER_API_KEY", "")
        answers = final_answers(results)
        client = httpx.Client(timeout=120)
        for case in cases:
            pair = blind_pair(
                case,
                {
                    "raw": answers.get((case["id"], "raw"), ""),
                    "mira": answers.get((case["id"], "mira"), ""),
                },
                seed=7,
            )
            r = client.post(
                f"{jb}/chat/completions",
                json={
                    "model": jm,
                    "messages": judge_prompt(case, pair),
                    "temperature": 0,
                    "max_tokens": 600,
                },
                headers={"Authorization": f"Bearer {jk}"},
            )
            r.raise_for_status()
            data = r.json()
            u = data.get("usage") or {}
            try:
                budget.charge(
                    estimate_cost_usd(
                        jm, int(u.get("prompt_tokens") or 0), int(u.get("completion_tokens") or 0)
                    )
                )
            except BudgetExceeded as exc:
                print(f"STOPPED (judge): {exc}", file=sys.stderr)
                break
            parsed = parse_judge_json(data["choices"][0]["message"]["content"])
            if parsed:
                judge_scores[case["id"]] = {
                    pair["mapping"]["A"]: parsed["A"],
                    pair["mapping"]["B"]: parsed["B"],
                }

    report = build_report(cases, results, judge_scores)
    (out / "verdicts.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    md = render_markdown(report, run_id)
    (out / "report.md").write_text(md, encoding="utf-8")
    print(md)
    print(f"spent: ${budget.spent_usd:.4f} (limit {budget.limit_usd})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
