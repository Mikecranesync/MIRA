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

import asyncio
import base64
import io
import logging
import os
import time

from printsense import interpret as _interpret
from printsense.benchmarks import single_photo_cases as _cases
from printsense.benchmarks import single_photo_grader as _grader

logger = logging.getLogger("mira.telegram.printsense_testkit")

PHASE2_MAX_CASES = 8
BENCH_BUDGET_DEFAULT_USD = 1.50


def bench_budget_usd() -> float:
    """One paid-lane dollar budget for every phase (ZTA-2 spend law): metered
    spend hard-stops at this ceiling. Env-tunable per run, never unbounded."""
    raw = os.getenv("PRINT_BENCH_BUDGET_USD", "")
    try:
        return float(raw) if raw else BENCH_BUDGET_DEFAULT_USD
    except ValueError:
        logger.warning("PRINT_BENCH_BUDGET_USD=%r not a number; using default", raw)
        return BENCH_BUDGET_DEFAULT_USD


def _paid_usage(usage_spy: RouterUsageSpy | None) -> dict | None:
    """Per-call usage for the cost meter (ZTA-1). The paid interpreter bypasses
    the router, so its snapshot wins when present (it IS the metered spend);
    the router spy covers the free-cascade fallback. Both are popped so stale
    values never bleed into the next case. Reporting-only, never grading truth."""
    interpreter_usage = _interpret.pop_last_usage()
    spy_usage = usage_spy.pop() if usage_spy else None
    return interpreter_usage or spy_usage


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
    budget = bench_budget_usd()
    spent = 0.0
    _interpret.pop_last_usage()  # drop any stale snapshot from a prior run
    for case in cases:
        if spent >= budget:
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
        usage = _paid_usage(usage_spy)
        answer = _answer_from(capture.message.texts)
        result = _grader.grade_answer(case, bool(claimed), answer, latency_s=latency, usage=usage)
        spent += result.get("estimated_cost_usd") or 0.0
        logger.info(
            "PRINT_BENCH_SPEND lane=phase2 case=%s cost=$%.4f total=$%.4f budget=$%.2f",
            case["case_id"],
            result.get("estimated_cost_usd") or 0.0,
            spent,
            budget,
        )
        results.append(result)
    env = _grader.build_envelope(results, mode=mode)
    env["budget"] = {
        "budget_usd": budget,
        "spent_usd": round(spent, 6),
        "budget_stopped": any(r.get("status") == "budget_stop" for r in results),
    }
    return env


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


# ── Phase 3: multi-photo sessions + live session grading ─────────────────────
from printsense.benchmarks import session_cases as _s_cases  # noqa: E402
from printsense.benchmarks import session_grader as _s_grader  # noqa: E402

PHASE3_LIVE_SESSION_IDS = _s_cases.PHASE3_LIVE_SESSION_IDS


def _batch_record(caption: str, pages_b64: list[str]):
    """A real PhotoBatchRecord shaped exactly like the worker dequeues."""
    from shared.photo_batch_queue import PhotoBatchRecord

    return PhotoBatchRecord(
        id=0,
        chat_id="0",
        platform="printsense-test",
        caption=caption,
        photos_b64=pages_b64,
        ack_message_id=None,
        created_at=0.0,
        raw_photos_b64=list(pages_b64),
    )


async def run_phase3(
    album_rung,
    mode: str = "live",
    sessions: list[dict] | None = None,
    usage_spy: RouterUsageSpy | None = None,
) -> dict:
    """Run session benchmarks through the REAL album rung
    (``bot._try_multi_photo_printsense_reply``): per turn, build a real
    ``PhotoBatchRecord`` from the session pages and grade the package reply
    (or refusal) against the frozen expectations. Facts pinned by earlier
    turns (``facts_keep``) carry forward as evidence-accumulation checks."""
    chosen = sessions if sessions is not None else _s_cases.SESSIONS
    session_results = []
    answers: list[str] = []
    budget = bench_budget_usd()
    spent = 0.0
    budget_stopped = False
    _interpret.pop_last_usage()  # drop any stale snapshot from a prior run
    for session in chosen:
        if budget_stopped:
            break
        kept: list[str] = []
        turn_results = []
        for turn in session["turns"]:
            if spent >= budget:
                budget_stopped = True
                logger.warning(
                    "PRINT_BENCH_SPEND lane=phase3 BUDGET_STOP session=%s total=$%.4f budget=$%.2f",
                    session["session_id"],
                    spent,
                    budget,
                )
                break
            pages_b64 = [
                base64.b64encode(_s_cases.render_page_png(k)).decode() for k in turn["pages"]
            ]
            rec = _batch_record(turn["caption"], pages_b64)
            t0 = time.monotonic()
            reply = await album_rung(rec)
            latency = time.monotonic() - t0
            usage = _paid_usage(usage_spy)
            claimed = reply is not None
            answers.append(reply or "")
            turn_results.append(
                _s_grader.grade_turn(
                    turn,
                    claimed,
                    reply or "",
                    kept_facts=kept,
                    latency_s=latency,
                    usage=usage,
                )
            )
            spent += turn_results[-1].get("estimated_cost_usd") or 0.0
            logger.info(
                "PRINT_BENCH_SPEND lane=phase3 session=%s cost=$%.4f total=$%.4f budget=$%.2f",
                session["session_id"],
                turn_results[-1].get("estimated_cost_usd") or 0.0,
                spent,
                budget,
            )
            kept.extend(f for f in turn["expect"].get("facts_keep", []) if f not in kept)
        if turn_results:
            session_results.append(_s_grader.build_session_result(session, turn_results))
    durability = await run_durability_probe()
    dur_result = _s_grader.grade_durability(durability)
    session_results.append(
        _s_grader.build_session_result(
            {"session_id": "s7_durability", "about": "restart survival (real queue)"},
            [dur_result],
        )
    )
    env = _s_grader.build_envelope(
        session_results, mode=mode, durability=durability, answers=answers
    )
    env["budget"] = {
        "budget_usd": budget,
        "spent_usd": round(spent, 6),
        "budget_stopped": budget_stopped,
    }
    return env


async def run_durability_probe() -> dict:
    """Production durability promise, probed against the REAL PhotoBatchQueue:
    add a burst -> close the queue object -> reopen the same SQLite file (a
    restart) -> recover_orphans -> dequeue -> the batch must be intact
    (caption + crushed AND original full-res bytes)."""
    import tempfile
    from pathlib import Path as _P

    from shared.photo_batch_queue import PhotoBatchQueue

    tmp = _P(tempfile.mkdtemp(prefix="ps3_dur_")) / "queue.db"
    probe = {"survived_restart": False, "raw_preserved": False, "caption_preserved": False}
    try:
        q1 = PhotoBatchQueue(str(tmp))
        batch_id, _n = await q1.add_photo_to_burst(
            chat_id="dur-chat",
            platform="printsense-test",
            caption="durability probe",
            photo_b64="crushed-bytes",
            raw_photo_b64="original-full-res-bytes",
        )
        await q1.close_burst(batch_id)
        q1.close()  # simulated crash/restart: the process object is gone
        q2 = PhotoBatchQueue(str(tmp))
        await q2.recover_orphans()
        rec = await asyncio.wait_for(q2.dequeue(), timeout=5.0)
        probe["survived_restart"] = rec.photos_b64 == ["crushed-bytes"]
        probe["raw_preserved"] = rec.raw_photos_b64 == ["original-full-res-bytes"]
        probe["caption_preserved"] = rec.caption == "durability probe"
        q2.close()
    except Exception as exc:  # noqa: BLE001 — a broken probe IS the finding
        probe["error"] = type(exc).__name__
    return probe


async def run_phase3_live(update, context) -> None:
    """The ``/printsense_test phase3`` body: REAL album rung, real paid
    interpreter, bounded to ``PHASE3_LIVE_SESSION_IDS`` (each batch turn is a
    1-4 min package interpretation)."""
    import bot as _bot

    live_sessions = [s for s in _s_cases.SESSIONS if s["session_id"] in PHASE3_LIVE_SESSION_IDS]
    spy = RouterUsageSpy()
    spy.install(_bot.engine.router)
    try:
        env = await run_phase3(
            _bot._try_multi_photo_printsense_reply,
            mode="live",
            sessions=live_sessions,
            usage_spy=spy,
        )
    finally:
        spy.restore()
    report_md = _s_grader.render_report(env)
    report_json = _s_grader.stable_envelope_json(env)
    for artifact in (report_md, report_json):
        violations = _s_grader.audit_artifact(artifact)
        if violations:
            logger.warning("phase3 artifact audit failed: %s", violations)
            await update.message.reply_text(
                "PrintSense phase3 artifact failed its privacy self-audit — not sent."
            )
            return
    await update.message.reply_text(_s_grader.phone_summary(env))
    chat_id = update.effective_chat.id
    await context.bot.send_document(
        chat_id=chat_id,
        document=io.BytesIO(report_json.encode("utf-8")),
        filename="printsense_phase3.json",
    )
    await context.bot.send_document(
        chat_id=chat_id,
        document=io.BytesIO(report_md.encode("utf-8")),
        filename="printsense_phase3.md",
    )


# ── /printsense_grade_session — live session markers + truth-free grading ────
_MARKER_SCHEMA = """
CREATE TABLE IF NOT EXISTS printsense_session_markers (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    kind    TEXT NOT NULL,
    ts      REAL NOT NULL
);
"""


def _marker_conn():
    """Markers live in the SAME durable SQLite file as the photo queue, in a
    testkit-owned table — surviving restarts exactly like the batches do."""
    import sqlite3

    import bot as _bot

    conn = sqlite3.connect(_bot._PHOTO_QUEUE_DB_PATH, isolation_level=None)
    conn.executescript(_MARKER_SCHEMA)
    return conn


async def printsense_grade_session_command(update, context) -> None:
    """``/printsense_grade_session start|finish`` (admin): between the markers
    the reviewer uses the bot NORMALLY (photos + captions). ``finish`` reads
    the durable queue's completed batches for this chat in the window and
    returns a truth-free deterministic report: per-batch latency, reply
    presence, tags the answer asserted, unsupported state claims, honesty
    markers, recommended missing pages. No frozen truth exists for live
    photos, so violations are OBSERVATIONS for the reviewer — a judge may
    explain, never clear."""
    args = [a.lower() for a in (getattr(context, "args", None) or [])]
    action = args[0] if args else ""
    chat_id = str(update.effective_chat.id)
    if action not in ("start", "finish"):
        await update.message.reply_text("Usage: /printsense_grade_session start|finish")
        return
    conn = _marker_conn()
    try:
        if action == "start":
            conn.execute(
                "INSERT INTO printsense_session_markers (chat_id, kind, ts) VALUES (?,?,?)",
                (chat_id, "start", time.time()),
            )
            await update.message.reply_text(
                "Session recording started. Send prints + questions normally; "
                "finish with /printsense_grade_session finish"
            )
            return
        row = conn.execute(
            "SELECT ts FROM printsense_session_markers WHERE chat_id=? AND kind='start' "
            "ORDER BY ts DESC LIMIT 1",
            (chat_id,),
        ).fetchone()
        if not row:
            await update.message.reply_text(
                "No open session — /printsense_grade_session start first."
            )
            return
        start_ts = row[0]
        conn.execute(
            "INSERT INTO printsense_session_markers (chat_id, kind, ts) VALUES (?,?,?)",
            (chat_id, "finish", time.time()),
        )
        batches = conn.execute(
            "SELECT id, caption, photo_count, started_at, completed_at, reply_text, "
            "error_message, status FROM photo_batches WHERE chat_id=? AND created_at>=? "
            "ORDER BY created_at",
            (chat_id, start_ts),
        ).fetchall()
        report = _session_report(batches)
        violations = _grader.audit_artifact(report)
        if violations:
            await update.message.reply_text(
                "Session report failed its privacy self-audit — not sent."
            )
            return
        n_done = sum(1 for b in batches if b[7] == "done")
        await update.message.reply_text(
            f"Session graded: {len(batches)} batch(es), {n_done} completed. Report attached."
        )
        await context.bot.send_document(
            chat_id=update.effective_chat.id,
            document=io.BytesIO(report.encode("utf-8")),
            filename="printsense_session.md",
        )
    finally:
        conn.close()


def _session_report(batches) -> str:
    L = [
        "# PrintSense live session — truth-free deterministic report",
        "",
        "No frozen truth exists for live photos: every line below is a",
        "deterministic OBSERVATION for the reviewer (a judge may explain a",
        "failure, never clear one).",
        "",
    ]
    answers = []
    for bid, caption, n, started, completed, reply, err, status in batches:
        latency = round(completed - started, 1) if (started and completed) else None
        L.append(f"## batch {bid} — {n} photo(s), status={status}, latency={latency}s")
        L.append(f"- caption: {caption!r}")
        if err:
            L.append(f"- error: {err}")
        if reply:
            answers.append(reply)
            tags = sorted(_grader.extract_prose_tags(reply))
            L.append(f"- tags asserted: {', '.join(tags) or 'none'}")
            m = _grader._STATE_CLAIM_RE.search(reply)
            L.append(
                "- unsupported state claim: " + (f"YES — {m.group(0)!r}" if m else "none detected")
            )
            low = reply.lower()
            honesty = [
                w
                for w in ("not in view", "not visible", "unreadable", "cannot", "can't", "verify")
                if w in low
            ]
            L.append(f"- honesty/verification language: {', '.join(honesty) or 'none detected'}")
        else:
            L.append("- reply: (none)")
        L.append("")
    from printsense.benchmarks import session_grader as _sg

    refs = _sg.recommended_missing_pages(answers)
    L.append(f"recommended missing pages (from answers): {', '.join(refs) or 'none'}")
    L.append("")
    return "\n".join(L)


# ── Phase 4: image-robustness matrix + /printsense_compare ───────────────────
from printsense.benchmarks import robustness_grader as _r_grader  # noqa: E402
from printsense.benchmarks import robustness_transforms as _r_tx  # noqa: E402

# Live Lane-A bound: paid answer lane only runs these conditions per invocation
# (one interpreter call each); Lane R (classification) is free and runs ALL.
PHASE4_LIVE_ANSWER_CONDITIONS = ("rot90", "blur", "crop_partial", "glare")


async def run_phase4(
    *,
    vision_process,
    single_rung,
    context,
    mode: str = "live",
    answer_conditions: tuple[str, ...] | None = None,
) -> dict:
    """Robustness matrix over the transformed parent page.

    Lane R (every condition, free): the transformed image through the REAL
    vision classify path — routed = classification says ELECTRICAL_PRINT.
    Lane A (bounded subset): the transformed image through the REAL single-
    photo rung; the metamorphic grader assigns full / degraded_honest /
    hard_fail. The provider field is reported honestly — when the paid
    interpreter falls back (e.g. quota), rows say so instead of pretending.
    """
    parent = _r_grader.parent_case()
    base_png = _cases.render_case_png(parent)
    question = parent["question"]
    chosen = answer_conditions if answer_conditions is not None else PHASE4_LIVE_ANSWER_CONDITIONS
    rows: list[dict] = []
    budget = bench_budget_usd()
    spent = 0.0
    budget_stopped = False
    _interpret.pop_last_usage()  # drop any stale snapshot from a prior run
    for condition, family in _r_grader.CONDITIONS.items():
        img = _r_tx.ALL_TRANSFORMS[condition](base_png)
        b64 = base64.b64encode(img).decode()
        routed = False
        classification = "(error)"
        try:
            vd = await vision_process(b64, question)
            classification = (vd or {}).get("classification") or "(none)"
            routed = classification == "ELECTRICAL_PRINT"
        except Exception as exc:  # noqa: BLE001 — a classify crash is a finding
            classification = f"(classify error: {type(exc).__name__})"
        row: dict = {
            "condition": condition,
            "family": family,
            "routed": routed,
            "classification": classification,
        }
        if condition in chosen:
            if spent >= budget:
                budget_stopped = True
                row["budget_stopped"] = True
                logger.warning(
                    "PRINT_BENCH_SPEND lane=phase4 BUDGET_STOP condition=%s total=$%.4f budget=$%.2f",
                    condition,
                    spent,
                    budget,
                )
                rows.append(row)
                continue
            cap = _CaptureUpdate(0)
            t0 = time.monotonic()
            try:
                claimed = await single_rung(img, img, question, cap, context)
            except Exception as exc:  # noqa: BLE001 — rung crash is a finding
                claimed = False
                cap.message.texts.append(f"(rung error: {type(exc).__name__})")
            answer = _answer_from(cap.message.texts)
            row.update(_r_grader.grade_answer_lane(condition, bool(claimed), answer))
            row["latency_s"] = round(time.monotonic() - t0, 1)
            usage = _interpret.pop_last_usage()
            if usage:
                # Real attribution + real dollars (ZTA-1) when the paid
                # interpreter actually ran; the format heuristic below is the
                # reporting-only fallback for the free-cascade path.
                row["provider"] = usage["provider"]
                row["estimated_cost_usd"] = _grader.estimate_cost_usd(usage)
                spent += row["estimated_cost_usd"]
            else:
                low = (answer or "").lower()
                row["provider"] = (
                    "paid-interpreter"
                    if (
                        "according to" not in low
                        and claimed
                        and len(answer) > 0
                        and _looks_interpreted(answer)
                    )
                    else ("fallback-cascade" if claimed else None)
                )
            logger.info(
                "PRINT_BENCH_SPEND lane=phase4 condition=%s cost=$%.4f total=$%.4f budget=$%.2f",
                condition,
                row.get("estimated_cost_usd") or 0.0,
                spent,
                budget,
            )
        rows.append(row)
    env = _r_grader.build_matrix(rows, mode=mode)
    env["budget"] = {
        "budget_usd": budget,
        "spent_usd": round(spent, 6),
        "budget_stopped": budget_stopped,
    }
    return env


def _looks_interpreted(answer: str) -> bool:
    """Heuristic provider attribution for reporting ONLY (never grading): the
    six-section cascade format means the free path answered; its absence on a
    claimed turn means the paid interpreter's renderer did."""
    return "what this appears to be" not in (answer or "").lower()


async def run_phase4_live(update, context) -> None:
    """The ``/printsense_test phase4`` body."""
    import bot as _bot

    env = await run_phase4(
        vision_process=_bot.engine.vision.process,
        single_rung=_bot._try_print_translator_reply,
        context=context,
        mode="live",
    )
    report_md = _r_grader.render_report(env)
    report_json = _r_grader.stable_json(env)
    for artifact in (report_md, report_json):
        violations = _r_grader.audit_artifact(artifact)
        if violations:
            logger.warning("phase4 artifact audit failed: %s", violations)
            await update.message.reply_text(
                "PrintSense phase4 artifact failed its privacy self-audit — not sent."
            )
            return
    await update.message.reply_text(_r_grader.phone_summary(env))
    chat_id = update.effective_chat.id
    await context.bot.send_document(
        chat_id=chat_id,
        document=io.BytesIO(report_json.encode("utf-8")),
        filename="printsense_phase4.json",
    )
    await context.bot.send_document(
        chat_id=chat_id,
        document=io.BytesIO(report_md.encode("utf-8")),
        filename="printsense_phase4.md",
    )


async def printsense_compare_command(update, context) -> None:
    """``/printsense_compare`` (admin): grade the chat's most recent COMPLETED
    2-photo batch as an original-vs-degraded pair. Runs the REAL single-photo
    rung on each image separately and reports deterministic differences —
    tags lost / newly claimed, state claims, honesty language, length drift.
    Truth-free observations (live photos have no frozen truth)."""
    import bot as _bot

    chat_id = str(update.effective_chat.id)
    conn = _marker_conn()
    try:
        row = conn.execute(
            "SELECT id, caption, photos_json, raw_photos_json FROM photo_batches "
            "WHERE chat_id=? AND status='done' AND photo_count=2 "
            "ORDER BY completed_at DESC LIMIT 1",
            (chat_id,),
        ).fetchone()
    finally:
        conn.close()
    if not row:
        await update.message.reply_text(
            "No completed 2-photo batch found for this chat — send the original "
            "and the degraded photo as ONE album first, then /printsense_compare."
        )
        return
    import json as _json

    bid, caption, photos_json, raw_json = row
    raws = _json.loads(raw_json or "[]") or _json.loads(photos_json)
    question = caption or "What does this circuit do?"
    answers = []
    for b64 in raws[:2]:
        img = base64.b64decode(b64)
        cap = _CaptureUpdate(0)
        try:
            claimed = await _bot._try_print_translator_reply(img, img, question, cap, context)
        except Exception:  # noqa: BLE001 — fail closed per side
            claimed = False
        answers.append(_answer_from(cap.message.texts) if claimed else "")
    a, b = answers
    tags_a, tags_b = _grader.extract_prose_tags(a), _grader.extract_prose_tags(b)
    sa, sb = _grader._STATE_CLAIM_RE.search(a or ""), _grader._STATE_CLAIM_RE.search(b or "")
    L = [
        f"# /printsense_compare — batch {bid} (photo 1 = original, photo 2 = degraded)",
        "",
        f"- answered: photo1={'yes' if a else 'no'}, photo2={'yes' if b else 'no'}",
        f"- tags lost on degraded: {', '.join(sorted(tags_a - tags_b)) or 'none'}",
        f"- tags NEWLY CLAIMED on degraded (never-rule!): {', '.join(sorted(tags_b - tags_a)) or 'none'}",
        f"- state claims: photo1={'YES ' + repr(sa.group(0)) if sa else 'none'}, "
        f"photo2={'YES ' + repr(sb.group(0)) if sb else 'none'}",
        f"- better-image request on degraded: "
        f"{'yes' if _r_grader.BETTER_IMAGE_RE.search(b or '') else 'no'}",
        f"- answer length: {len(a)} -> {len(b)}",
        "",
        "Truth-free observations — a judge may explain, never clear.",
    ]
    report = "\n".join(L)
    if _grader.audit_artifact(report):
        await update.message.reply_text("Compare report failed its privacy self-audit — not sent.")
        return
    await update.message.reply_text(f"Compared batch {bid}. Report attached.")
    await context.bot.send_document(
        chat_id=update.effective_chat.id,
        document=io.BytesIO(report.encode("utf-8")),
        filename="printsense_compare.md",
    )


# ── UNSEEN generalization lane (UNSEEN-5) ────────────────────────────────────
# Frozen novel-content probe (printsense/benchmarks/unseen_lane/) run through
# the REAL single-photo rung on the FREE path. Scores are tracked separately
# from every seen/calibration lane — the seen-vs-unseen delta is the overfit
# metric. Zero paid inference: the scheduled runner disables the paid provider
# structurally, and the PRINT_BENCH_BUDGET_USD hard-stop applies regardless.

# Promoted to printsense/benchmarks/single_photo_grader.py (2026-07-18) so the
# per-turn autoeval (shared/print_autoeval.py) can use them without importing a
# telegram module. Aliases keep every existing caller and test working.
_UNSEEN_TAGISH_RE = _grader._UNSEEN_TAGISH_RE
_unseen_tagish = _grader._unseen_tagish
_lev1 = _grader._lev1
_detect_identifier_drift = _grader.detect_identifier_drift


def _classify_unseen_failures(results: list[dict], drift_total: int) -> dict:
    by_class: dict[str, int] = {}
    for r in results:
        for h in r["hard_failures"]:
            by_class[h["class"]] = by_class.get(h["class"], 0) + 1
    honesty_markers = ("cannot", "can not", "does not show", "not show", "whether")
    suspects = [
        r["case_id"]
        for r in results
        if any(h["class"] == "unsupported_state_claim" for h in r["hard_failures"])
        and any(m in (r.get("answer_excerpt") or "").lower() for m in honesty_markers)
    ]
    return {
        "safety_critical": by_class.get("wrong_contact_verdict", 0)
        + by_class.get("unsupported_state_claim", 0),
        "invented_tags": by_class.get("prose_tag_invention", 0),
        "routing_misses": by_class.get("path_wiring", 0),
        "ocr_identifier_drift": drift_total,
        "missing_caveats": by_class.get("missing_safety_language", 0),
        "extraction_misses": by_class.get("missing_required_mention", 0),
        "honesty_misses": by_class.get("missing_refusal_honesty", 0)
        + by_class.get("refusal_violated", 0),
        "grader_false_positive_suspects": suspects,
    }


async def run_unseen_lane(
    rung,
    context,
    chat_id,
    mode: str = "live",
    usage_spy: RouterUsageSpy | None = None,
) -> dict:
    """Run the frozen UNSEEN corpus through the REAL rung; classify failures."""
    from printsense.benchmarks.unseen_lane import cases as _u

    png = _u.render_unseen_png()
    budget = bench_budget_usd()
    spent = 0.0
    results: list[dict] = []
    drift_records: list[dict] = []
    deterministic = 0
    providers: dict[str, int] = {}
    _interpret.pop_last_usage()  # drop any stale snapshot from a prior run
    for case in _u.UNSEEN_CASES:
        if spent >= budget:
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
        capture = _CaptureUpdate(chat_id)
        t0 = time.monotonic()
        try:
            claimed = await rung(png, png, case["question"], capture, context)
        except Exception as exc:  # noqa: BLE001 — a rung crash is a lane finding
            claimed = False
            capture.message.texts.append(f"(rung error: {type(exc).__name__})")
        latency = round(time.monotonic() - t0, 1)
        usage = _paid_usage(usage_spy)
        answer = _answer_from(capture.message.texts)
        result = _grader.grade_answer(case, bool(claimed), answer, latency_s=latency, usage=usage)
        result["answer_excerpt"] = (answer or "")[:400]
        if claimed and answer and usage is None:
            deterministic += 1
            result["provider"] = "deterministic"
        provider = result.get("provider") or ("(fell_through)" if not claimed else "(unknown)")
        providers[provider] = providers.get(provider, 0) + 1
        case_drift = _detect_identifier_drift(answer, _u.PAGE_TRUTH_TOKENS)
        if case_drift:
            drift_records.append({"case_id": case["case_id"], "drift": case_drift})
        spent += result.get("estimated_cost_usd") or 0.0
        logger.info(
            "PRINT_BENCH_SPEND lane=unseen case=%s cost=$%.4f total=$%.4f budget=$%.2f",
            case["case_id"],
            result.get("estimated_cost_usd") or 0.0,
            spent,
            budget,
        )
        results.append(result)
    hard = [{**h, "case_id": r["case_id"]} for r in results for h in r["hard_failures"]]
    if not _u.expectations_frozen_ok():
        hard.append(
            {
                "case_id": "(corpus)",
                "class": "expectations_tampered",
                "detail": "unseen-lane expectations do not match unseen_lane.sha256",
            }
        )
    drift_total = sum(len(d["drift"]) for d in drift_records)
    passed = sum(1 for r in results if r["status"] == "pass")
    latencies = [r["latency_s"] for r in results if r.get("latency_s") is not None]
    return {
        "lane": "unseen_generalization",
        "cases_version": _u.UNSEEN_VERSION,
        "grader_version": _grader.GRADER_VERSION,
        "mode": mode,
        "digest_ok": _u.expectations_frozen_ok(),
        "cases_total": len(results),
        "cases_passed": passed,
        "cases_failed": len(results) - passed,
        "deterministic_fastpath_answers": deterministic,
        "provider_histogram": providers,
        "failure_classes": _classify_unseen_failures(results, drift_total),
        "drift_records": drift_records,
        "hard_failures": hard,
        "latency_max_s": max(latencies) if latencies else None,
        "estimated_cost_usd": round(sum(r.get("estimated_cost_usd") or 0 for r in results), 6),
        "budget": {"budget_usd": budget, "spent_usd": round(spent, 6)},
        "baseline": "none_approved (unseen lane; Phase 5 owns baselines)",
        "results": results,
    }


def unseen_phone_summary(env: dict) -> str:
    fc = env["failure_classes"]
    return (
        f"PrintSense UNSEEN lane ({env['mode']}): "
        f"{env['cases_passed']}/{env['cases_total']} passed | "
        f"deterministic fast-path: {env['deterministic_fastpath_answers']} | "
        f"est ${env['estimated_cost_usd']}\n"
        f"classes — safety:{fc['safety_critical']} invented:{fc['invented_tags']} "
        f"routing:{fc['routing_misses']} drift:{fc['ocr_identifier_drift']} "
        f"caveats:{fc['missing_caveats']} extraction:{fc['extraction_misses']} "
        f"graderFP:{len(fc['grader_false_positive_suspects'])}\n"
        f"providers: {env['provider_histogram']}\n{env['baseline']}"
    )


async def run_unseen_lane_live(update, context) -> None:
    """The ``/printsense_test unseen`` body: REAL rung, free path, $0."""
    import json as _json

    import bot as _bot

    spy = RouterUsageSpy()
    spy.install(_bot.engine.router)
    try:
        env = await run_unseen_lane(
            _bot._try_print_translator_reply,
            context,
            update.effective_chat.id,
            mode="live",
            usage_spy=spy,
        )
    finally:
        spy.restore()
    report_json = _json.dumps(env, sort_keys=True, indent=1, default=str)
    violations = _grader.audit_artifact(report_json)
    if violations:
        logger.warning("unseen lane artifact audit failed: %s", violations)
        await update.message.reply_text(
            "PrintSense unseen-lane artifact failed its privacy self-audit — not sent."
        )
        return
    await update.message.reply_text(unseen_phone_summary(env))
    await context.bot.send_document(
        chat_id=update.effective_chat.id,
        document=io.BytesIO(report_json.encode("utf-8")),
        filename="printsense_unseen_lane.json",
    )


# ── Boot-time OCR lane self-check (`/printsense_test ocr`) ───────────────────


def ocr_phone_summary(report: dict) -> str:
    """Render ``vision_worker.ocr_lane_report()`` as a one-line phone summary,
    verdict first — mirrors ``unseen_phone_summary``'s formatting convention."""
    t = report["tesseract"]
    tesseract_part = f"tesseract {t['version']}" if t["available"] else "tesseract unavailable"
    model_part = f"model lane {report['model_lane']}"
    floor_part = "floor expected" if report["expected_floor"] else "floor optional"
    return f"OCR: {report['verdict']} — {tesseract_part}, {model_part}, {floor_part}"


async def run_ocr_report_live(update, context) -> None:
    """The ``/printsense_test ocr`` body: one-shot health report for every OCR
    lane (``shared.workers.vision_worker.ocr_lane_report``) — read-only, no
    state changes, no documents; a single phone-readable line."""
    from shared.workers.vision_worker import ocr_lane_report

    await update.message.reply_text(ocr_phone_summary(ocr_lane_report()))
