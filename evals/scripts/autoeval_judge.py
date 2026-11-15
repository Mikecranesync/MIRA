"""Verdict cache and the release-gate judge runner for autoeval.

The repo's `evals/scripts/judge_baseline.py` is imported UNMODIFIED, fresh per run; its
`_groq_json` seam is replaced by `judge_call` (recall, or one metered call in paid mode).

Cache key = sha256 of canonical JSON {prompt, model, max_tokens, params}; the rubric has no
version id, so the RENDERED PROMPT is the key. Invalidation triggers: rubric, case or answer
text (prompt changes); model, max_tokens, params. Post-processing changes: bump VERSION.
A truncated or unparseable paid verdict is stored and recalls as an error: never re-billed.
"""

from __future__ import annotations

import asyncio
import contextvars
import hashlib
import importlib.util
import json
import os
import shutil
import sys
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import autoeval_budget as ab
import httpx

REPO_ROOT = Path(__file__).resolve().parents[2]
JUDGE_PATH = REPO_ROOT / "evals" / "scripts" / "judge_baseline.py"
CAS_PATH = REPO_ROOT / "printsense" / "cas.py"
CACHE_STAGE = "autoeval-verdict"
VERSION = "1"


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def cache_key(prompt: str, model: str, max_tokens: int, params: dict[str, Any]) -> str:
    body = {"prompt": prompt, "model": model, "max_tokens": max_tokens, "params": params}
    return sha256_text(json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False))


def _load_by_path(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load_cas(path: Path = CAS_PATH):
    """Load printsense/cas.py by file path: importing the package pulls in pydantic."""
    return _load_by_path("autoeval_cas", path)


class VerdictCache:
    """Content-addressed verdict store. `put` refuses to rewrite an existing key."""

    def __init__(self, cas) -> None:
        self.cas = cas

    def get(self, key: str) -> dict | None:
        return self.cas.cache_get(key, CACHE_STAGE, VERSION)

    def put(self, key: str, payload: dict) -> bool:
        if self.get(key) is not None:
            return False
        self.cas.cache_put(key, CACHE_STAGE, VERSION, payload)
        return True


@dataclass(frozen=True)
class CaseCtx:
    case_id: str
    set_id: str
    answer_sha256: str
    transcript_sha: str
    base_url: str


NO_CASE = CaseCtx("", "", "", "", "")
CASE: contextvars.ContextVar[CaseCtx] = contextvars.ContextVar("autoeval_case", default=NO_CASE)


@dataclass
class JudgeEnv:
    mode: str  # "dry" | "paid" | "seed"
    model: str
    cache: VerdictCache
    cfg: ab.BudgetConfig
    ledger: ab.Ledger
    key_provider: Callable[[], str]
    runner_sha: str
    client: httpx.Client | None = None
    clock: Callable[[], float] = time.time
    sleep: Callable[[float], None] = time.sleep
    recorded: dict[str, dict] = field(default_factory=dict)
    counts: dict[str, int] = field(default_factory=dict)
    paid_required_usd: float = 0.0
    trace: list[tuple[str, str, str]] = field(default_factory=list)  # (case_id, reason, key)


def _payload(env: JudgeEnv, ctx: CaseCtx, prompt: str, origin: str, verdict: str, **extra: Any):
    return {
        "verdict": verdict,
        "origin": origin,
        "model": env.model,
        "prompt_sha256": sha256_text(prompt),
        "answer_sha256": ctx.answer_sha256,
        "case_id": ctx.case_id,
        "set": ctx.set_id,
        "sha": ctx.transcript_sha,
        "base_url": ctx.base_url,
        "runner_sha": env.runner_sha,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(env.clock())),
        **extra,
    }


def judge_call(prompt: str, env: JudgeEnv) -> tuple[str | None, str, str]:
    """Return (verdict_text | None, reason, cache_key). Never a request in dry or seed mode."""
    ctx = CASE.get()
    price = env.cfg.prices.get(env.model)
    if price is None:
        raise ab.BudgetStop(f"STOP: no pinned price for model {env.model!r}")
    key = cache_key(prompt, env.model, price.max_tokens, price.params)
    hit = env.cache.get(key)
    if hit is not None:
        if "error" in hit:
            return None, "recall_error", key
        return hit["verdict"], "recall_hit", key
    if env.mode == "dry":
        env.paid_required_usd += ab.worst_case(price, prompt)
        return None, "paid_required", key
    if env.mode == "seed":
        judge = env.recorded.get(ctx.case_id)
        if judge is None:
            return None, "seed_miss", key
        verdict = json.dumps(judge, sort_keys=True)
        env.cache.put(
            key,
            _payload(
                env, ctx, prompt, "seeded", verdict, tokens_in=None, tokens_out=None, usd=None
            ),
        )
        return verdict, "seed_hit", key
    reply = ab.claude_text(
        prompt,
        env.model,
        cfg=env.cfg,
        ledger=env.ledger,
        key_provider=env.key_provider,
        client=env.client,
        lane=f"autoeval:{ctx.set_id}",
        sleep=env.sleep,
    )
    paid = {
        "tokens_in": reply.tok_in,
        "tokens_out": reply.tok_out,
        "usd": reply.usd,
        "request_id": reply.request_id,
        "org": reply.org,
        "stop_reason": reply.stop_reason,
    }
    if reply.stop_reason == "max_tokens":
        env.cache.put(key, _payload(env, ctx, prompt, "api", "", error="truncated", **paid))
        return None, "truncated", key
    env.cache.put(key, _payload(env, ctx, prompt, "api", reply.text, **paid))
    return reply.text, "api", key


def parse_json(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else ""
        cleaned = cleaned.rsplit("```", 1)[0]
    parsed = json.loads(cleaned.strip())
    if not isinstance(parsed, dict):
        raise ValueError("judge output is not a JSON object")
    return parsed


def _case_ctx(result: dict, set_id: str, base: dict) -> CaseCtx:
    turns = result.get("turns") or [{}]
    answer = (turns[-1] or {}).get("answer", "") or ""
    return CaseCtx(
        str(result.get("case_id", "")),
        set_id,
        sha256_text(answer),
        str(base.get("sha") or ""),
        str(base.get("base_url") or ""),
    )


def _score_rows(out_dir: Path) -> list[dict]:
    keep = ("case_id", "case_type", "case_score", "dangerous", "missing_framing", "infra_fail")
    rows = []
    for p in sorted((out_dir / "scores").glob("*.json")):
        if p.name.startswith("_"):
            continue
        rec = json.loads(p.read_text())
        rows.append({k: rec[k] for k in keep if k in rec})
    return rows


@dataclass
class SetRun:
    set_id: str
    model: str
    rc: int
    summary: dict
    rows: list[dict]
    counts: dict[str, int]
    paid_required_usd: float
    trace: list[tuple[str, str, str]] = field(default_factory=list)


def run_set(
    results_dir: Path, out_dir: Path, env: JudgeEnv, judge_path: Path = JUDGE_PATH
) -> SetRun:
    """Drive the unmodified judge_baseline over a copy of one transcript set's technician/."""
    results_dir, out_dir = Path(results_dir), Path(out_dir)
    manifest = json.loads((results_dir / "technician" / "_manifest.json").read_text())
    base = {"sha": manifest.get("sha"), "base_url": manifest.get("base_url")}
    set_id = results_dir.name
    shutil.rmtree(out_dir, ignore_errors=True)
    shutil.copytree(results_dir / "technician", out_dir / "technician")
    jb = _load_by_path(f"judge_baseline_{uuid.uuid4().hex[:8]}", judge_path)  # fresh per run

    async def seam(_client, _key, _model, prompt):
        text, reason, key = judge_call(prompt, env)
        env.counts[reason] = env.counts.get(reason, 0) + 1
        env.trace.append((CASE.get().case_id, reason, key))
        if text is None:
            return {"_error": reason}
        try:
            return parse_json(text)
        except ValueError as e:
            return {"_error": f"unparseable: {e}"}

    def wrap(orig):
        async def inner(client, key, model, result, case):
            token = CASE.set(_case_ctx(result, set_id, base))
            try:
                return await orig(client, key, model, result, case)
            finally:
                CASE.reset(token)

        return inner

    jb._groq_json = seam
    jb.judge_technician = wrap(jb.judge_technician)
    jb.judge_safety = wrap(jb.judge_safety)
    saved_env = {k: os.environ.get(k) for k in ("GROQ_API_KEY", "GROQ_MODEL")}
    saved_argv = list(sys.argv)
    os.environ["GROQ_API_KEY"] = "unused-the-judge-is-the-autoeval-seam"
    os.environ["GROQ_MODEL"] = env.model
    sys.argv = ["judge_baseline.py", str(out_dir)]
    try:
        rc = asyncio.run(jb.main())
    finally:
        sys.argv = saved_argv
        for k, v in saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    summary_file = out_dir / "scores" / "_summary.json"
    summary = json.loads(summary_file.read_text()) if summary_file.exists() else {}
    return SetRun(
        set_id,
        env.model,
        rc,
        summary,
        _score_rows(out_dir),
        dict(env.counts),
        env.paid_required_usd,
        list(env.trace),
    )


def seed_from_recorded(
    recorded_scores_dir: Path, inputs_dir: Path, out_dir: Path, env: JudgeEnv
) -> SetRun:
    """Replay recorded verdicts (a judge_baseline scores dir) into the cache through the same path."""
    recorded: dict[str, dict] = {}
    for p in sorted(Path(recorded_scores_dir).glob("*.json")):
        if p.name.startswith("_"):
            continue
        rec = json.loads(p.read_text())
        if isinstance(rec.get("judge"), dict):
            recorded[str(rec.get("case_id", p.stem))] = rec["judge"]
    env.recorded = recorded
    return run_set(Path(inputs_dir), out_dir, env)
