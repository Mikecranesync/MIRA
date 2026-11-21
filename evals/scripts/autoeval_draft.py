"""Metered drafting of candidate eval cases from source passages.

One paid Messages call per drafting request, through the same metered seam as the judge
(autoeval_budget.claude_text), with lane label draft:<category>. The cache key is the same
content-addressed scheme as the verdict cache (autoeval_judge.cache_key over the rendered
prompt, model, max_tokens and params) but lives in its own CAS stage, so a draft and a verdict
can never collide. Dry by default: a miss is recorded as paid_required and no request is made.

Refused before any cache lookup, metered call or key fetch: any passage that is not marked
`is_private: false` (a missing flag counts as private). Output candidates always carry
status = pending_review. Nothing here accepts a case; autoeval_verify_cases.py does the quote
check, and a human approves.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import autoeval_budget as ab
import autoeval_judge as jd

DRAFT_STAGE = "autoeval-draft"
DRAFT_VERSION = "1"
PASSAGE_KEYS = ("doc_id", "page", "text")


class DraftRefused(ValueError):
    """A passage is unacceptable for drafting. Raised before any request or key fetch."""


def check_passages(passages: Any) -> None:
    if not isinstance(passages, list):
        raise DraftRefused("passages must be a JSON array")
    for i, p in enumerate(passages):
        if not isinstance(p, dict):
            raise DraftRefused(f"passage {i} is not a JSON object")
        if p.get("is_private") is not False:
            raise DraftRefused(
                f"passage {i} ({p.get('doc_id')!r} p.{p.get('page')}) is not marked "
                "is_private: false; private passages never reach a model"
            )
        for key in PASSAGE_KEYS:
            if key not in p:
                raise DraftRefused(f"passage {i} is missing {key!r}")


def build_prompt(instructions: str, passages: list[dict]) -> str:
    blocks = [f"--- doc={p['doc_id']} page={p['page']} ---\n{p['text']}" for p in passages]
    return (
        instructions.rstrip()
        + "\n\nSOURCE PASSAGES (verbatim; source_quote must be copied from these only):\n\n"
        + "\n\n".join(blocks)
        + "\n"
    )


def parse_candidates(text: str) -> list[dict]:
    """A JSON array (or {"cases": [...]}), else one JSON object per line. Non-objects are dropped."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else ""
        cleaned = cleaned.rsplit("```", 1)[0].strip()
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        data = [json.loads(ln) for ln in cleaned.splitlines() if ln.strip()]
    if isinstance(data, dict):
        data = data.get("cases", [])
    if not isinstance(data, list):
        raise ValueError("drafted output is neither a JSON array nor JSONL")
    return [c for c in data if isinstance(c, dict)]


class DraftCache:
    """Content-addressed draft store. `put` refuses to rewrite an existing key."""

    def __init__(self, cas) -> None:
        self.cas = cas

    def get(self, key: str) -> dict | None:
        return self.cas.cache_get(key, DRAFT_STAGE, DRAFT_VERSION)

    def put(self, key: str, payload: dict) -> bool:
        if self.get(key) is not None:
            return False
        self.cas.cache_put(key, DRAFT_STAGE, DRAFT_VERSION, payload)
        return True


@dataclass
class DraftEnv:
    mode: str  # "dry" | "paid"
    model: str
    cache: DraftCache
    cfg: ab.BudgetConfig
    ledger: ab.Ledger
    key_provider: Callable[[], str]
    client: Any = None
    sleep: Callable[[float], None] = lambda s: None


@dataclass
class DraftResult:
    reason: str  # recall_hit | recall_error | paid_required | api | truncated | unparseable
    candidates: list[dict] = field(default_factory=list)
    paid_required_usd: float = 0.0
    key: str = ""


def draft(instructions: str, passages: list[dict], *, category: str, env: DraftEnv) -> DraftResult:
    check_passages(passages)  # before the cache, the ledger or any key is touched
    prompt = build_prompt(instructions, passages)
    price = env.cfg.prices.get(env.model)
    if price is None:
        raise ab.BudgetStop(f"STOP: no pinned price for model {env.model!r}")
    key = jd.cache_key(prompt, env.model, price.max_tokens, price.params)
    hit = env.cache.get(key)
    if hit is not None:
        if "error" in hit:
            return DraftResult("recall_error", key=key)
        text, reason = hit["text"], "recall_hit"
    elif env.mode == "dry":
        return DraftResult("paid_required", paid_required_usd=ab.worst_case(price, prompt), key=key)
    else:
        reply = ab.claude_text(
            prompt,
            env.model,
            cfg=env.cfg,
            ledger=env.ledger,
            key_provider=env.key_provider,
            client=env.client,
            lane=f"draft:{category}",
            sleep=env.sleep,
        )
        if reply.stop_reason == "max_tokens":
            env.cache.put(key, {"error": "truncated", "model": env.model, "usd": reply.usd})
            return DraftResult("truncated", key=key)
        env.cache.put(key, {"text": reply.text, "model": env.model, "usd": reply.usd})
        text, reason = reply.text, "api"
    try:
        candidates = parse_candidates(text)
    except (ValueError, IndexError):
        return DraftResult("unparseable", key=key)  # the text stays cached: never re-billed
    rows = [
        {
            **c,
            "status": "pending_review",
            "category": category,
            "draft_model": env.model,
            "draft_prompt_sha256": jd.sha256_text(prompt),
            "source_quote": c.get("source_quote"),
            "source_doc": c.get("source_doc"),
            "source_page": c.get("source_page"),
        }
        for c in candidates
    ]
    return DraftResult(reason, candidates=rows, key=key)


def write_candidates(path: Path, rows: list[dict]) -> None:
    body = "".join(json.dumps(r, sort_keys=True, ensure_ascii=False) + "\n" for r in rows)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body)
