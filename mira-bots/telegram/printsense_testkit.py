"""PrintSense Phase-2 test surface (testing-program Phase 2).

Drives the REAL single-photo production rung (`bot._try_print_translator_reply`)
— never a parallel implementation — in two admin-only ways:

* ``run_phase2(...)`` — the bounded single-photo benchmark behind
  ``/printsense_test phase2``: renders the frozen synthetic pages, sends each
  canonical question through the rung with a capture update, grades the answer
  with the deterministic Phase-2 grader, and records latency + provider +
  estimated cost. Case count and spend are hard-bounded.
* ``try_printsense_grade_reply(...)`` — the ``/printsense_grade <question>``
  photo-caption mode: the attached image goes through the normal production
  path; the admin gets the technician-facing answer PLUS a truth-free
  diagnostic report (tag grounding, state-claim scan, refusal/safety markers,
  latency). Ordinary users never see grading internals.

No business logic here; grading lives in printsense.benchmarks. Fail closed
everywhere: non-admins are refused, artifacts are self-audited before send,
errors reply with the exception class name only.
"""

from __future__ import annotations

import io
import logging
import time

from printsense.benchmarks import single_photo_cases as _cases
from printsense.benchmarks import single_photo_grader as _grader

logger = logging.getLogger("mira.telegram.printsense_testkit")

PHASE2_MAX_CASES = 8
PHASE2_COST_CEILING_USD = 1.50

_ACK_MARKER = "Reading your electrical print"


class _CaptureMessage:
    """Duck-typed Telegram message that collects replies instead of sending."""

    def __init__(self) -> None:
        self.texts: list[str] = []

    async def reply_text(self, text, *args, **kwargs):
        self.texts.append(str(text))


class _CaptureUpdate:
    def __init__(self, chat_id) -> None:
        self.message = _CaptureMessage()
        self.effective_chat = type("C", (), {"id": chat_id})()
        self.effective_user = type("U", (), {"id": chat_id})()


class RouterUsageSpy:
    """Read-only instrumentation: records the usage dict the inference router
    returns, without changing behavior. Installed only for the duration of a
    benchmark run."""

    def __init__(self) -> None:
        self.last: dict | None = None
        self._orig = None
        self._router = None

    def install(self, router) -> None:
        self._router = router
        self._orig = router.complete

        async def _spy(*args, **kwargs):
            out = await self._orig(*args, **kwargs)
            if isinstance(out, tuple) and len(out) == 2 and isinstance(out[1], dict):
                self.last = out[1]
            return out

        router.complete = _spy

    def restore(self) -> None:
        if self._router is not None and self._orig is not None:
            self._router.complete = self._orig

    def pop(self) -> dict | None:
        u, self.last = self.last, None
        return u


def _answer_from(texts: list[str]) -> str:
    """The technician-facing answer = the last non-ack reply."""
    real = [t for t in texts if _ACK_MARKER not in t]
    return real[-1] if real else ""


async def run_phase2(
    rung,
    context,
    chat_id,
    mode: str = "live",
    cases: list[dict] | None = None,
    usage_spy: RouterUsageSpy | None = None,
) -> dict:
    """Run the bounded Phase-2 benchmark through the REAL rung."""
    cases = (cases if cases is not None else _cases.CASES)[:PHASE2_MAX_CASES]
    results = []
    spent = 0.0
    for case in cases:
        if spent >= PHASE2_COST_CEILING_USD:
            results.append(
                {
                    "case_id": case["case_id"],
                    "question": case["question"],
                    "status": "budget_stop",
                    "lanes": {},
                    "hard_failures": [],
                    "latency_s": None,
                    "provider": None,
                    "model": None,
                    "estimated_cost_usd": 0.0,
                }
            )
            continue
        png = _cases.render_case_png(case)
        capture = _CaptureUpdate(chat_id)
        t0 = time.monotonic()
        claimed = await rung(png, png, case["question"], capture, context)
        latency = time.monotonic() - t0
        usage = usage_spy.pop() if usage_spy else None
        answer = _answer_from(capture.message.texts)
        result = _grader.grade_answer(case, bool(claimed), answer, latency_s=latency, usage=usage)
        spent += result.get("estimated_cost_usd") or 0.0
        results.append(result)
    return _grader.build_envelope(results, mode=mode)


async def run_phase2_live(update, context) -> None:
    """The /printsense_test phase2 body: real rung, real providers, bounded."""
    import bot as _bot  # lazy: bot imports this module at startup

    spy = RouterUsageSpy()
    spy.install(_bot.engine.router)
    try:
        env = await run_phase2(
            _bot._try_print_translator_reply,
            context,
            update.effective_chat.id,
            mode="live",
            usage_spy=spy,
        )
    finally:
        spy.restore()
    await _deliver(env, update, context)


async def _deliver(env: dict, update, context) -> None:
    report_md = _grader.render_report(env)
    report_json = _grader.stable_envelope_json(env)
    for artifact in (report_md, report_json):
        violations = _grader.audit_artifact(artifact)
        if violations:
            logger.warning("phase2 artifact audit failed: %s", violations)
            await update.message.reply_text(
                "PrintSense phase2 artifact failed its privacy self-audit — not sent."
            )
            return
    await update.message.reply_text(_grader.phone_summary(env))
    chat_id = update.effective_chat.id
    await context.bot.send_document(
        chat_id=chat_id,
        document=io.BytesIO(report_json.encode("utf-8")),
        filename="printsense_phase2.json",
    )
    await context.bot.send_document(
        chat_id=chat_id,
        document=io.BytesIO(report_md.encode("utf-8")),
        filename="printsense_phase2.md",
    )


class _TeeMessage:
    """Forwards replies to the real chat AND records them for grading."""

    def __init__(self, real_message) -> None:
        self._real = real_message
        self.texts: list[str] = []

    async def reply_text(self, text, *args, **kwargs):
        self.texts.append(str(text))
        return await self._real.reply_text(text, *args, **kwargs)

    def __getattr__(self, name):
        return getattr(self._real, name)


class _TeeUpdate:
    def __init__(self, real_update) -> None:
        self.message = _TeeMessage(real_update.message)
        self._real = real_update

    def __getattr__(self, name):
        return getattr(self._real, name)


async def try_printsense_grade_reply(raw_bytes, vision_bytes, caption, update, context) -> bool:
    """/printsense_grade <question> as a photo caption (admin test mode).

    Claims the turn for any caption starting with the command (so an admin
    probe never leaks into customer flows); non-admins are refused. The photo
    runs through the NORMAL production rung; the admin receives the
    technician-facing answer plus a truth-free diagnostic report.
    """
    prefix = "/printsense_grade"
    if not caption or not caption.strip().lower().startswith(prefix):
        return False
    from printsense_commercial import _is_reviewer

    if not _is_reviewer(update):
        await update.message.reply_text("Not authorized.")
        return True
    question = caption.strip()[len(prefix) :].strip() or "What does this circuit do?"
    try:
        import bot as _bot

        spy = RouterUsageSpy()
        spy.install(_bot.engine.router)
        tee = _TeeUpdate(update)
        t0 = time.monotonic()
        try:
            claimed = await _bot._try_print_translator_reply(
                raw_bytes, vision_bytes, question, tee, context
            )
        finally:
            spy.restore()
        latency = round(time.monotonic() - t0, 3)
        if not claimed:
            await update.message.reply_text(
                "Not graded: the print rung fell through (not classified as an "
                "electrical print, or not recognized as a print question)."
            )
            return True
        answer = _answer_from(tee.message.texts)
        report = _diagnostic_report(question, answer, latency, spy_usage=None)
        violations = _grader.audit_artifact(report)
        if violations:
            await update.message.reply_text(
                "Grading report failed its privacy self-audit — not sent."
            )
            return True
        await context.bot.send_document(
            chat_id=update.effective_chat.id,
            document=io.BytesIO(report.encode("utf-8")),
            filename="printsense_grade.md",
        )
        return True
    except Exception as exc:  # fail closed
        logger.warning("printsense_grade failed: %s", type(exc).__name__)
        await update.message.reply_text(f"PrintSense grade failed: {type(exc).__name__}")
        return True


def _diagnostic_report(question: str, answer: str, latency_s: float, spy_usage: dict | None) -> str:
    """Truth-free diagnostics for an arbitrary admin photo: no golden truth
    exists, so report the deterministic invariants only."""
    tags = sorted(_grader.extract_prose_tags(answer))
    state = _grader._STATE_CLAIM_RE.search(answer or "")
    low = (answer or "").lower()
    safety = any(m in low for m in _grader._SAFETY_MARKERS)
    refusal = any(m in low for m in _grader._REFUSAL_MARKERS)
    L = [
        "# PrintSense grade — single photo (truth-free diagnostics)",
        "",
        f"**Question:** {question}",
        f"**Latency:** {latency_s}s",
        "",
        "## Deterministic checks",
        f"- tag-shaped claims in answer: {', '.join(tags) or '(none)'}",
        "  (no golden truth for an ad-hoc photo — confirm each against the drawing)",
        f"- unsupported energization/state claim: "
        f"{'FLAGGED: ' + repr(state.group(0)) if state else 'none detected'}",
        f"- safety/uncertainty language present: {safety}",
        f"- refusal language present: {refusal}",
        "",
        "## Technician-facing answer (as delivered)",
        "",
        answer or "(empty)",
        "",
    ]
    return "\n".join(L)
