"""Auto-scorer / labeler for ``conversation_eval`` — Phase 2 of the answer-
distillation flywheel (``.claude/plans/use-avail-skills-to-functional-wave.md``).

Two paths, one queue (the ``idx_conversation_eval_unscored`` partial index,
``WHERE auto_score IS NULL``):

- **Drive-pack turns self-label deterministically — no LLM.** A matched pack
  answer is grounded-by-construction (cited, ``matched=true``) → top score. An
  unmatched turn is the bot correctly declining an undocumented question
  (no-guess intact) → a middling "correct decline" score; the *gap* itself is
  read from ``meta.matched=false`` by the Phase 3 gap report, not from this score.
- **Engine / LLM turns are judged** by ``InferenceRouter.complete()`` — cascade
  Groq → Cerebras → Together (the spec's "Gemini" is stale; Anthropic is banned,
  PRD §4) — against the 5-criterion rubric in ``shared.eval_score_rubric``.

Fail-open: a scoring failure (no provider, unparseable judge output, DB hiccup)
leaves the row unscored so a later run retries it — it never raises into the
Celery worker or blocks other rows. Mirrors the ``conversation_logger`` contract.

The task ships here so the existing crawler Celery worker discovers it. Wiring
the VPS beat schedule (``mira_eval.score_conversation_eval`` at 03:00 UTC) is a
deploy step, not this file — see ``docs/specs/bot-eval-loop-spec.md`` § "Schedule".
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Optional

# --- Path bootstrap: make ``shared.*`` importable whether run as
# ``mira_crawler.tasks.eval_scorer`` or standalone. Mirrors
# ``full_ingest_pipeline.py`` — the established cross-package pattern
# (see ``mira-crawler/ingest/extractors/tag_classifier.py``).
_HERE = Path(__file__).parent.resolve()
_CRAWLER_ROOT = _HERE.parent
_REPO_ROOT = _CRAWLER_ROOT.parent
_BOTS_ROOT = _REPO_ROOT / "mira-bots"
for _p in (str(_CRAWLER_ROOT), str(_BOTS_ROOT)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

logger = logging.getLogger("mira-crawler.tasks.eval_scorer")

# Optional Celery registration — importable/testable without a broker.
try:
    from mira_crawler.celery_app import app  # type: ignore
except Exception:  # noqa: BLE001 - standalone / test import
    try:
        from celery_app import app  # type: ignore
    except Exception:  # noqa: BLE001
        app = None  # type: ignore

_DEFAULT_BATCH = int(os.getenv("EVAL_SCORER_BATCH", "200"))
_DETERMINISTIC_MODEL = "deterministic"

# Deterministic drive-pack labels. ``matched`` answers are grounded-by-
# construction; unmatched answers are a *correct decline* (no fabrication) whose
# knowledge-gap signal lives in ``meta.matched=false`` for the gap report.
_MATCHED_BREAKDOWN = {
    "answered_question": 5,
    "no_hallucination": 5,
    "no_redundant_questions": 5,
    "cited_sources_when_claimed": 5,
    "appropriate_tone": 5,
}
_UNMATCHED_BREAKDOWN = {
    "answered_question": 2,  # did not resolve the question (pack lacks it)
    "no_hallucination": 5,  # ...but did NOT fabricate an answer (no-guess intact)
    "no_redundant_questions": 5,
    "cited_sources_when_claimed": 5,
    "appropriate_tone": 4,
}
_MATCHED_SCORE = 5
_UNMATCHED_SCORE = 3


# ---------------------------------------------------------------------------
# Pure scoring — no DB, no network
# ---------------------------------------------------------------------------


def is_drive_pack(meta: Optional[dict[str, Any]]) -> bool:
    """True when a captured row carries drive-pack labels (Phase 1 ``meta``)."""
    return bool(meta) and meta.get("surface") == "drive_pack"


def label_drive_pack_row(meta: dict[str, Any]) -> dict[str, Any]:
    """Deterministically label a drive-pack turn. No LLM call.

    Returns the score dict: ``{auto_score, breakdown, reasoning, model}``.
    """
    pack_id = meta.get("pack_id") or "unknown"
    matched = bool(meta.get("matched"))
    if matched:
        return {
            "auto_score": _MATCHED_SCORE,
            "breakdown": dict(_MATCHED_BREAKDOWN),
            "reasoning": (
                f"Drive-pack match on '{pack_id}' "
                f"(kind={meta.get('matched_kind')}, source={meta.get('answer_source')}): "
                "grounded-by-construction, cited."
            ),
            "model": _DETERMINISTIC_MODEL,
        }
    return {
        "auto_score": _UNMATCHED_SCORE,
        "breakdown": dict(_UNMATCHED_BREAKDOWN),
        "reasoning": (
            f"Drive-pack gap on '{pack_id}': no documented answer for this question "
            "(matched=false). Bot correctly declined without fabricating — "
            "knowledge-gap signal for the gap report."
        ),
        "model": _DETERMINISTIC_MODEL,
    }


async def _judge_engine_row(router: Any, row: dict[str, Any]) -> Optional[dict[str, Any]]:
    """LLM-judge one engine/LLM turn via the router cascade. None on failure."""
    from shared.eval_score_rubric import build_messages, parse_score

    if not getattr(router, "enabled", False):
        logger.warning("eval scorer: InferenceRouter disabled — leaving row unscored")
        return None

    messages = build_messages(
        user_message=row.get("user_message", "") or "",
        bot_response=row.get("bot_response", "") or "",
        intent=row.get("intent"),
        has_citations=bool(row.get("has_citations")),
    )
    content, usage = await router.complete(
        messages,
        max_tokens=400,
        session_id=f"eval_scorer_{row.get('id', 'unknown')}",
    )
    if not content:
        logger.warning("eval scorer: cascade returned empty — leaving row unscored")
        return None

    parsed = parse_score(content)
    if parsed is None:
        logger.warning("eval scorer: unparseable judge output — leaving row unscored")
        return None

    return {
        "auto_score": parsed["overall"],
        "breakdown": parsed["breakdown"],
        "reasoning": parsed["reasoning"],
        "model": (usage or {}).get("provider") or "cloud",
    }


def score_row(row: dict[str, Any], router: Any = None) -> Optional[dict[str, Any]]:
    """Score one captured row. Drive-pack → deterministic; else → LLM judge.

    ``row`` needs ``user_message``, ``bot_response``, ``intent``,
    ``has_citations``, ``meta`` (dict | None). Returns the score dict
    (``auto_score, breakdown, reasoning, model``) or None if it can't be scored
    now (fail-open — a later run retries).
    """
    meta = _coerce_meta(row.get("meta"))
    if is_drive_pack(meta):
        return label_drive_pack_row(meta)  # type: ignore[arg-type]

    if router is None:
        return None
    try:
        return asyncio.run(_judge_engine_row(router, row))
    except Exception as exc:  # noqa: BLE001 - fail-open, never break the batch
        logger.warning("eval scorer: judge raised, leaving row unscored: %s", exc)
        return None


def _coerce_meta(meta: Any) -> Optional[dict[str, Any]]:
    """JSONB comes back as dict (psycopg2) but tolerate a JSON string too."""
    if meta is None or isinstance(meta, dict):
        return meta
    if isinstance(meta, str):
        try:
            obj = json.loads(meta)
            return obj if isinstance(obj, dict) else None
        except json.JSONDecodeError:
            return None
    return None


# ---------------------------------------------------------------------------
# DB loop — reads the unscored queue, writes scores back
# ---------------------------------------------------------------------------

_SELECT_UNSCORED = """
SELECT id, user_message, bot_response, intent, has_citations, meta
FROM conversation_eval
WHERE auto_score IS NULL
ORDER BY created_at
LIMIT :limit
"""

_UPDATE_SCORE = """
UPDATE conversation_eval
SET auto_score = :auto_score,
    auto_score_breakdown = CAST(:breakdown AS JSONB),
    scorer_reasoning = :reasoning,
    scorer_model = :model,
    scored_at = now()
WHERE id = :id
"""


def _neon_engine():
    """SQLAlchemy engine for NeonDB — NullPool (PgBouncer pools server-side)."""
    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        return None
    from sqlalchemy import create_engine
    from sqlalchemy.pool import NullPool

    return create_engine(
        url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )


def score_unscored_rows(limit: int = _DEFAULT_BATCH, router: Any = None) -> dict[str, int]:
    """Score up to ``limit`` unscored rows. Returns per-path counts.

    Fail-open: any single-row failure leaves that row unscored and continues.
    A missing ``NEON_DATABASE_URL`` or DB error returns zeros without raising.
    """
    stats = {"scored": 0, "skipped": 0, "drive_pack": 0, "llm": 0}
    engine = _neon_engine()
    if engine is None:
        logger.warning("eval scorer: NEON_DATABASE_URL unset — nothing to score")
        return stats

    if router is None:
        try:
            from shared.inference.router import InferenceRouter

            router = InferenceRouter()
        except Exception as exc:  # noqa: BLE001 - drive-pack rows still score
            logger.warning("eval scorer: could not build InferenceRouter: %s", exc)
            router = None

    from sqlalchemy import text as sql_text

    try:
        with engine.connect() as conn:
            rows = conn.execute(sql_text(_SELECT_UNSCORED), {"limit": limit}).mappings().all()
            for row in rows:
                row = dict(row)
                is_dp = is_drive_pack(_coerce_meta(row.get("meta")))
                score = score_row(row, router=router)
                if score is None:
                    stats["skipped"] += 1
                    continue
                conn.execute(
                    sql_text(_UPDATE_SCORE),
                    {
                        "auto_score": score["auto_score"],
                        "breakdown": json.dumps(score["breakdown"]),
                        "reasoning": score["reasoning"],
                        "model": score["model"],
                        "id": row["id"],
                    },
                )
                conn.commit()
                stats["scored"] += 1
                stats["drive_pack" if is_dp else "llm"] += 1
    except Exception as exc:  # noqa: BLE001 - fail-open at the batch level too
        logger.warning("eval scorer: batch aborted (partial results kept): %s", exc)

    logger.info(
        "eval scorer: scored=%d skipped=%d (drive_pack=%d llm=%d)",
        stats["scored"],
        stats["skipped"],
        stats["drive_pack"],
        stats["llm"],
    )
    return stats


if app is not None:

    @app.task(name="mira_eval.score_conversation_eval")
    def score_conversation_eval(limit: int = _DEFAULT_BATCH) -> dict[str, int]:  # noqa: D401
        """Celery entry point — score the unscored ``conversation_eval`` queue."""
        return score_unscored_rows(limit=limit)
