"""Async runner for MIRA synthetic user evaluation.

Fires synthetic questions at both MIRA inference paths:
  - Bot path  (via Supervisor) — sequential (SQLite limit)
  - Sidecar path (via httpx POST /rag) — parallel with asyncio.Semaphore

Usage:
    from tests.synthetic_user.runner import RunConfig, run_synthetic_user
    results = await run_synthetic_user(RunConfig(count=50, mode="dry-run"))
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
import uuid
from dataclasses import dataclass, field

import httpx

from tests.synthetic_user.evaluator import QuestionResult
from tests.synthetic_user.templates import SyntheticQuestion

logger = logging.getLogger("mira-synthetic-runner")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass
class RunConfig:
    """Configuration for a synthetic user run."""

    count: int = 100
    concurrency: int = 5
    mode: str = "dry-run"  # dry-run | bot-only | sidecar-only | both
    sidecar_url: str = "http://localhost:5000"
    db_path: str = ""
    openwebui_url: str = ""
    openwebui_api_key: str = ""
    collection_id: str = ""
    seed: int | None = None
    topics: list[str] | None = None
    personas: list[str] | None = None
    adversarial_categories: list[str] | None = None
    adversarial_ratio: float = 0.3
    # Telethon mode settings
    bot_username: str = ""
    max_turns: int = 4
    telethon_timeout: int = 60
    # Internal run ID — set automatically if empty.
    run_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])


# ---------------------------------------------------------------------------
# Dry-run mock responses
# ---------------------------------------------------------------------------

_MAINTENANCE_MOCK = (
    "Based on the symptoms you described, the most likely cause is a failed component "
    "in the drive circuit. Check the DC bus voltage first, then inspect the IGBT module "
    "for signs of thermal damage. Replace any failed components before restarting. "
    "Always de-energize and lockout/tagout before opening the panel."
)

_INTENT_BYPASS_MOCK = "Hey -- I'm MIRA, your AI maintenance co-pilot. How can I help you today?"

# A deliberately confident-sounding answer for an out-of-KB question
# (no honesty signals — this is what hallucination looks like).
_OUT_OF_KB_HALLUCINATION_MOCK = (
    "The Danfoss FC-302 fault code E36 typically indicates an overcurrent condition on "
    "the output phase. This is usually caused by a short circuit in the motor cable or "
    "a failed IGBT. Replace the output stage and verify cable insulation resistance."
)


def _dry_run_reply(question: SyntheticQuestion) -> tuple[str, str, str | None]:
    """Return (reply, confidence, next_state) for dry-run mode."""
    cat = question.adversarial_category

    if cat == "intent_bypass":
        return _INTENT_BYPASS_MOCK, "none", "IDLE"

    if cat == "out_of_kb":
        # Return a hallucinated answer (no honesty signals) to exercise the
        # out_of_kb_hallucination weakness detector in the evaluator.
        return _OUT_OF_KB_HALLUCINATION_MOCK, "low", "DIAGNOSIS"

    # Normal / other adversarial categories — plausible maintenance answer.
    return _MAINTENANCE_MOCK, "high", "DIAGNOSIS"


# ---------------------------------------------------------------------------
# Question generation helpers
# ---------------------------------------------------------------------------


def _build_adversarial_questions(
    count: int,
    seed: int | None,
    topics: list[str] | None,
    personas: list[str] | None,
    categories: list[str] | None,
) -> list[SyntheticQuestion]:
    """Generate adversarial questions.

    We reuse the normal generator but patch adversarial_category onto each
    question.  The categories cycle so the distribution is even.
    """
    from tests.synthetic_user.templates import generate_questions

    _ADVERSARIAL_CATEGORIES = [
        "intent_bypass",
        "out_of_kb",
        "misspelled",
        "multi_turn_vague",
    ]

    active_cats = categories if categories else _ADVERSARIAL_CATEGORIES

    questions = generate_questions(count=count, seed=seed, topics=topics, personas=personas)

    for i, q in enumerate(questions):
        cat = active_cats[i % len(active_cats)]
        # Patch the adversarial_category and difficulty onto the frozen-ish dataclass.
        object.__setattr__(q, "adversarial_category", cat) if hasattr(
            type(q), "__dataclass_fields__"
        ) else None
        # SyntheticQuestion is a plain dataclass (not frozen), so direct assignment works.
        q.adversarial_category = cat  # type: ignore[misc]
        q.difficulty = "adversarial"  # type: ignore[misc]

        # For multi_turn_vague: inject a vague opener + follow-up into ground_truth.
        if cat == "multi_turn_vague":
            q.ground_truth = {
                "initial_text": f"Something is wrong with the {q.equipment_type}.",
                "follow_up": q.text,
                "keywords": [],
            }
            q.text = f"Something is wrong with the {q.equipment_type}."  # type: ignore[misc]

    return questions


def _build_question_batch(config: RunConfig) -> list[SyntheticQuestion]:
    """Build a mixed batch of normal + adversarial questions per config."""
    from tests.synthetic_user.templates import generate_questions

    total = config.count
    n_adversarial = max(0, round(total * config.adversarial_ratio))
    n_normal = total - n_adversarial

    normal_qs: list[SyntheticQuestion] = []
    if n_normal > 0:
        normal_qs = generate_questions(
            count=n_normal,
            seed=config.seed,
            topics=config.topics,
            personas=config.personas,
        )

    adversarial_qs: list[SyntheticQuestion] = []
    if n_adversarial > 0:
        adv_seed = (config.seed + 1) if config.seed is not None else None
        adversarial_qs = _build_adversarial_questions(
            count=n_adversarial,
            seed=adv_seed,
            topics=config.topics,
            personas=config.personas,
            categories=config.adversarial_categories,
        )

    # Interleave so adversarial questions are spread throughout the run.
    import random

    rng = random.Random(config.seed)
    combined = normal_qs + adversarial_qs
    rng.shuffle(combined)
    return combined


# ---------------------------------------------------------------------------
# Bot path (sequential)
# ---------------------------------------------------------------------------


def _get_supervisor(config: RunConfig):
    """Lazily import and instantiate Supervisor from mira-bots.

    mira-bots is NOT on sys.path in normal test runs — we insert it here only
    when actually needed (bot-only or both mode).
    """
    _REPO = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )
    bots_path = os.path.join(_REPO, "mira-bots")
    if bots_path not in sys.path:
        sys.path.insert(0, bots_path)

    from shared.engine import Supervisor  # type: ignore[import]

    db = config.db_path or os.getenv("MIRA_DB_PATH", "/tmp/synth-test.db")
    url = config.openwebui_url or os.getenv("OPENWEBUI_BASE_URL", "")
    api_key = config.openwebui_api_key or os.getenv("OPENWEBUI_API_KEY", "")
    coll = config.collection_id or os.getenv("KNOWLEDGE_COLLECTION_ID", "")

    return Supervisor(
        db_path=db,
        openwebui_url=url,
        api_key=api_key,
        collection_id=coll,
    )


async def _run_bot_question(
    question: SyntheticQuestion,
    supervisor,
    run_id: str,
) -> QuestionResult:
    """Run one question through the bot (Supervisor) path."""
    chat_id = f"synth-{run_id}-{question.id[:8]}"
    t0 = time.monotonic()
    reply = ""
    confidence = "none"
    next_state = None
    error = None

    try:
        # Multi-turn: send vague opener first, then follow up.
        if (
            question.adversarial_category == "multi_turn_vague"
            and question.ground_truth
            and "follow_up" in question.ground_truth
        ):
            initial_text = question.ground_truth.get("initial_text", question.text)
            await supervisor.process_full(chat_id, initial_text)
            follow_up = question.ground_truth["follow_up"]
            result = await supervisor.process_full(chat_id, follow_up)
        else:
            result = await supervisor.process_full(chat_id, question.text)

        reply = result.get("reply", "")
        confidence = result.get("confidence", "none")
        next_state = result.get("next_state")

    except Exception as exc:
        logger.error(
            "Bot path error for question %s: %s",
            question.id[:8],
            exc,
        )
        error = str(exc)
    finally:
        try:
            supervisor.reset(chat_id)
        except Exception:
            pass

    latency_ms = int((time.monotonic() - t0) * 1000)

    return QuestionResult(
        question_id=question.id,
        question_text=question.text,
        persona_id=question.persona_id,
        topic_category=question.topic_category,
        adversarial_category=question.adversarial_category,
        equipment_type=question.equipment_type,
        vendor=question.vendor,
        expected_intent=question.expected_intent,
        expected_weakness=question.expected_weakness,
        ground_truth=question.ground_truth,
        path="bot",
        reply=reply,
        confidence=confidence,
        next_state=next_state,
        sources=None,
        latency_ms=latency_ms,
        error=error,
    )


async def _run_bot_path(
    questions: list[SyntheticQuestion],
    config: RunConfig,
) -> list[QuestionResult]:
    """Run all questions through the bot path sequentially."""
    supervisor = _get_supervisor(config)
    results: list[QuestionResult] = []

    for i, question in enumerate(questions):
        logger.info(
            "Bot path: question %d/%d id=%s persona=%s",
            i + 1,
            len(questions),
            question.id[:8],
            question.persona_id,
        )
        result = await _run_bot_question(question, supervisor, config.run_id)
        results.append(result)

    return results


# ---------------------------------------------------------------------------
# Sidecar path (parallel)
# ---------------------------------------------------------------------------


async def _run_sidecar_question(
    question: SyntheticQuestion,
    client: httpx.AsyncClient,
    sidecar_url: str,
    sem: asyncio.Semaphore,
) -> QuestionResult:
    """Run one question through the sidecar RAG path."""
    t0 = time.monotonic()
    reply = ""
    sources: list[dict] | None = None
    error = None

    async with sem:
        try:
            resp = await client.post(
                f"{sidecar_url}/rag",
                json={
                    "query": question.text,
                    "asset_id": "synth-test",
                    "tag_snapshot": {},
                },
            )
            resp.raise_for_status()
            data = resp.json()
            reply = data.get("answer", "")
            sources = data.get("sources", [])

        except httpx.HTTPStatusError as exc:
            logger.error(
                "Sidecar HTTP %s for question %s: %s",
                exc.response.status_code,
                question.id[:8],
                exc.response.text[:200],
            )
            error = f"HTTP {exc.response.status_code}: {exc.response.text[:200]}"
        except Exception as exc:
            logger.error(
                "Sidecar error for question %s: %s",
                question.id[:8],
                exc,
            )
            error = str(exc)

    latency_ms = int((time.monotonic() - t0) * 1000)

    return QuestionResult(
        question_id=question.id,
        question_text=question.text,
        persona_id=question.persona_id,
        topic_category=question.topic_category,
        adversarial_category=question.adversarial_category,
        equipment_type=question.equipment_type,
        vendor=question.vendor,
        expected_intent=question.expected_intent,
        expected_weakness=question.expected_weakness,
        ground_truth=question.ground_truth,
        path="sidecar",
        reply=reply,
        confidence="none",  # sidecar does not return a confidence signal
        next_state=None,
        sources=sources,
        latency_ms=latency_ms,
        error=error,
    )


async def _run_sidecar_path(
    questions: list[SyntheticQuestion],
    config: RunConfig,
) -> list[QuestionResult]:
    """Run all questions through the sidecar path in parallel."""
    sem = asyncio.Semaphore(config.concurrency)

    async with httpx.AsyncClient(timeout=60.0) as client:
        tasks = [
            _run_sidecar_question(q, client, config.sidecar_url, sem)
            for q in questions
        ]
        results = await asyncio.gather(*tasks, return_exceptions=False)

    return list(results)


# ---------------------------------------------------------------------------
# Dry-run path
# ---------------------------------------------------------------------------


def _run_dry_run_question(
    question: SyntheticQuestion,
    path: str,
    run_id: str,
) -> QuestionResult:
    """Return a mock QuestionResult without calling any endpoint."""
    reply, confidence, next_state = _dry_run_reply(question)
    sources: list[dict] | None = None

    if path == "sidecar":
        # Sidecar returns sources; bot path does not.
        confidence = "none"
        next_state = None
        if question.adversarial_category != "out_of_kb":
            sources = [
                {
                    "file": f"{question.vendor.lower().replace('-', '_')}_manual.pdf",
                    "page": 42,
                    "excerpt": reply[:80],
                    "brain": "shared_oem",
                }
            ]

    return QuestionResult(
        question_id=question.id,
        question_text=question.text,
        persona_id=question.persona_id,
        topic_category=question.topic_category,
        adversarial_category=question.adversarial_category,
        equipment_type=question.equipment_type,
        vendor=question.vendor,
        expected_intent=question.expected_intent,
        expected_weakness=question.expected_weakness,
        ground_truth=question.ground_truth,
        path=path,
        reply=reply,
        confidence=confidence,
        next_state=next_state,
        sources=sources,
        latency_ms=0,
        error=None,
    )


async def _run_dry_run(
    questions: list[SyntheticQuestion],
    mode: str,
) -> list[QuestionResult]:
    """Return mock responses for all questions in dry-run mode."""
    # Decide which logical path to label each result with.
    paths: list[str]
    if mode == "dry-run":
        # Alternate bot/sidecar so both evaluator branches are exercised.
        paths = ["bot" if i % 2 == 0 else "sidecar" for i in range(len(questions))]
    else:
        paths = ["bot"] * len(questions)

    return [_run_dry_run_question(q, paths[i], "dry") for i, q in enumerate(questions)]


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


async def run_synthetic_user(config: RunConfig) -> list[QuestionResult]:
    """Run a synthetic user evaluation and return QuestionResult list.

    Args:
        config: RunConfig controlling mode, count, concurrency, etc.

    Returns:
        List of QuestionResult — one per question per path attempted.
    """
    logger.info(
        "Starting synthetic user run: mode=%s count=%d concurrency=%d seed=%s",
        config.mode,
        config.count,
        config.concurrency,
        config.seed,
    )

    questions = _build_question_batch(config)
    logger.info("Generated %d questions (%d adversarial)", len(questions), sum(
        1 for q in questions if q.adversarial_category is not None
    ))

    results: list[QuestionResult] = []

    # ── Dry-run ──────────────────────────────────────────────────────────────
    if config.mode == "dry-run":
        return await _run_dry_run(questions, config.mode)

    # ── Bot-only ─────────────────────────────────────────────────────────────
    if config.mode == "bot-only":
        for question in questions:
            try:
                supervisor = _get_supervisor(config)
                result = await _run_bot_question(question, supervisor, config.run_id)
                results.append(result)
            except Exception as exc:
                logger.error("Bot path fatal error for %s: %s", question.id[:8], exc)
                results.append(
                    QuestionResult(
                        question_id=question.id,
                        question_text=question.text,
                        persona_id=question.persona_id,
                        topic_category=question.topic_category,
                        adversarial_category=question.adversarial_category,
                        equipment_type=question.equipment_type,
                        vendor=question.vendor,
                        expected_intent=question.expected_intent,
                        expected_weakness=question.expected_weakness,
                        ground_truth=question.ground_truth,
                        path="bot",
                        reply="",
                        confidence="none",
                        next_state=None,
                        sources=None,
                        latency_ms=0,
                        error=str(exc),
                    )
                )
        return results

    # ── Sidecar-only ─────────────────────────────────────────────────────────
    if config.mode == "sidecar-only":
        return await _run_sidecar_path(questions, config)

    # ── Both ─────────────────────────────────────────────────────────────────
    if config.mode == "both":
        # Bot path first (sequential due to SQLite), then sidecar (parallel).
        bot_results = await _run_bot_path(questions, config)
        sidecar_results = await _run_sidecar_path(questions, config)
        return bot_results + sidecar_results

    # ── Telethon (real Telegram bot via Telethon) ───────────────────────────
    if config.mode == "telethon":
        from tests.synthetic_user.telegram_bridge import TelegramBridge

        if not config.bot_username:
            logger.error("Telethon mode requires --bot-username")
            return []
        bridge = TelegramBridge(
            bot_username=config.bot_username,
            max_turns=config.max_turns,
            timeout=config.telethon_timeout,
        )
        for question in questions:
            try:
                result = await bridge.run_conversation(question)
                results.append(result)
            except Exception as exc:
                logger.error("Telethon error for %s: %s", question.id[:8], exc)
                results.append(
                    QuestionResult(
                        question_id=question.id,
                        question_text=question.text,
                        persona_id=question.persona_id,
                        topic_category=question.topic_category,
                        adversarial_category=question.adversarial_category,
                        equipment_type=question.equipment_type,
                        vendor=question.vendor,
                        expected_intent=question.expected_intent,
                        expected_weakness=question.expected_weakness,
                        ground_truth=question.ground_truth,
                        path="telethon",
                        reply="",
                        confidence="none",
                        next_state=None,
                        sources=None,
                        latency_ms=0,
                        error=str(exc),
                    )
                )
            await asyncio.sleep(3)  # rate limit between conversations
        return results

    logger.error("Unknown mode: %s — returning empty results", config.mode)
    return []
