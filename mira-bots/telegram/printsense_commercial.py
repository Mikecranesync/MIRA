"""Telegram commercial PrintSense concierge (platform program PR-B).

Thin adapter over ``printsense.commercial_service`` — NO business logic
here. Explicit-intent only: a technician opts in via /printsense (or an
"analyze print" caption); ordinary photos, Drive Commander, wiring intake,
print-translator, and generic chat paths are untouched (this handler
returns False for anything not explicitly ours). Flow: capture question →
mandatory consent tap → intake → deterministic in-container processing
(OCR + xref extractor + tag-pattern device candidates) → needs_review →
reviewer (admin commands, beta reviewer surface) → APPROVED report
delivered as a concise message + Markdown file → 5-question survey →
pilot CTA when qualification passes.
"""

from __future__ import annotations

import io
import logging
import os
import re

from printsense import xref_extractor
from printsense.commercial_service import PrintSenseCommercialService, Survey
from printsense.intake import IntakeRefused, IntakeRequest

logger = logging.getLogger("mira.telegram.printsense_commercial")

ROOT = os.environ.get("PRINTSENSE_COMMERCIAL_ROOT", "/data/printsense_commercial")
TENANT = os.environ.get("MIRA_TENANT_ID", "beta-tenant")
_ADMIN_IDS = {
    s.strip() for s in os.environ.get("PRINTSENSE_REVIEWER_CHAT_IDS", "").split(",") if s.strip()
}
_INTENT_RE = re.compile(r"\b(analyze|analyse)\b.*\bprint\b|/printsense", re.IGNORECASE)
_TAG_RE = re.compile(r"^-?\d{0,3}[A-Z]{0,3}\d{0,2}/[A-Z]{1,3}\d{1,4}[A-Z]?$")

PRIVACY_TEXT = (
    "PrintSense privacy: your files are stored content-addressed and "
    "tenant-isolated, logs carry hashes only, nothing is used for model "
    "training, and deletion is on request. Every report passes a human "
    "reviewer before delivery. Reply /printsense to start an analysis."
)
CONSENT_PROMPT = (
    "Before I analyze this: your file will be processed confidentially "
    "(hash-only logs, human-reviewed output, deletion on request). "
    "Reply YES to consent and start, or NO to cancel."
)


class _DeterministicProcessing:
    """OCR tokens → xref extractor + tag-pattern device candidates.

    Deterministic only — no model call. Where Tesseract is unavailable the
    OCR stage is skipped EXPLICITLY and the report says so.
    """

    def process(self, files, file_bytes, question):
        payloads, xrefs = {}, []
        idx = {"sheets": {}, "anchors": {}}
        for f in files:
            sha = f["sha256"]
            devs, page_tokens = [], []
            try:
                page_tokens = xref_extractor.ocr_tokens(file_bytes[sha])
            except xref_extractor.OcrUnavailable:
                payloads[sha] = {"devices": [], "unreadable": False, "ocr_skipped": True}
                continue
            for t in page_tokens:
                if _TAG_RE.match(t["text"]):
                    devs.append({"tag": t["text"], "bbox": t["bbox"]})
            payloads[sha] = {"devices": devs}
            xrefs.extend(xref_extractor.lex_page(page_tokens, source_page=sha))
        return payloads, xref_extractor.resolve(xrefs, idx), {}


class _TelegramDelivery:
    """Concise phone-readable message + full Markdown file."""

    def __init__(self, bot, chat_map: dict):
        self.bot = bot
        self.chat_map = chat_map

    def deliver(self, tenant_id, intake_id, markdown, report):
        chat_id = self.chat_map.get(intake_id)
        if chat_id is None:
            logger.warning("no chat mapping intake=%s — report on disk only", intake_id)
            return
        n_dev = len(report.get("devices", []))
        n_ref = len(report.get("proven_cross_references", []))
        summary = (
            f"✅ Your PrintSense report is reviewed and ready: "
            f"{n_dev} device(s), {n_ref} proven cross-reference(s). "
            f"Full cited report attached. "
            f"{report.get('call_to_action', '')} → /ps_pilot"
        )
        self.bot.send_message(chat_id=chat_id, text=summary)
        self.bot.send_document(
            chat_id=chat_id,
            document=io.BytesIO(markdown.encode("utf-8")),
            filename=f"printsense_report_{intake_id[:8]}.md",
        )


def _service(bot=None, chat_map: dict | None = None):
    return PrintSenseCommercialService(
        ROOT,
        TENANT,
        processing=_DeterministicProcessing(),
        delivery=_TelegramDelivery(bot, chat_map or {}) if bot else None,
    )


# --------------------------------------------------------------------------
# Handlers (async, python-telegram-bot). State kept in context.chat_data.
# --------------------------------------------------------------------------


async def printsense_command(update, context):
    context.chat_data["ps_state"] = "awaiting_photo"
    await update.message.reply_text(
        "Send one print page (photo or PDF page) with your question as the "
        "caption — e.g. 'Why does K01 trip?'. Small photo sets are fine. "
        "/ps_privacy explains confidentiality."
    )


async def ps_privacy_command(update, context):
    await update.message.reply_text(PRIVACY_TEXT)


async def ps_status_command(update, context):
    iid = context.chat_data.get("ps_last_intake")
    if not iid:
        await update.message.reply_text(
            "No PrintSense submission from this chat yet — /printsense to start."
        )
        return
    st = _service().get_status(iid)
    human = {
        "queued": "queued for processing",
        "processing": "processing",
        "needs_review": "processed — awaiting human review",
        "delivered": "delivered ✅",
        "failed": "failed ❌",
    }
    await update.message.reply_text(
        f"Submission {iid[:8]}: {human.get(st['status'], st['status'])}."
    )


async def ps_pilot_command(update, context):
    iid = context.chat_data.get("ps_last_intake")
    svc = _service()
    if iid:
        ok, reason = svc.qualify(iid)
        if ok:
            await update.message.reply_text(
                "🎯 You qualify for a managed package pilot: we analyze your "
                "COMPLETE print package, human-reviewed and cited, with "
                "introductory pricing. Reply here and Mike will follow up "
                "within one business day."
            )
            return
    svc.funnel.emit("package_request_submitted", TENANT, iid or "direct")
    await update.message.reply_text(
        "Package pilot: send us your complete print set (PDF preferred) and "
        "we return searchable, cited troubleshooting knowledge — human-"
        "reviewed, confidential, no reconstruction over-claims. Reply here "
        "to start the conversation."
    )


async def try_printsense_commercial_reply(raw_bytes, caption, update, context) -> bool:
    """Fall-through handler: claims the turn ONLY on explicit intent."""
    state = context.chat_data.get("ps_state")
    explicit = bool(caption and _INTENT_RE.search(caption))
    if state not in ("awaiting_photo", "awaiting_consent") and not explicit:
        return False

    if not caption or len(caption.strip()) < 5 or _INTENT_RE.fullmatch(caption.strip()):
        context.chat_data["ps_state"] = "awaiting_question"
        context.chat_data["ps_pending_file"] = raw_bytes
        await update.message.reply_text(
            "What are you trying to understand from this print? (one sentence is perfect)"
        )
        return True

    context.chat_data["ps_pending_file"] = raw_bytes
    context.chat_data["ps_pending_question"] = caption.strip()
    context.chat_data["ps_state"] = "awaiting_consent"
    await update.message.reply_text(CONSENT_PROMPT)
    return True


async def try_printsense_text_reply(text, update, context) -> bool:
    """Consent + follow-up question turns (text messages)."""
    state = context.chat_data.get("ps_state")
    if state == "awaiting_question" and text.strip():
        context.chat_data["ps_pending_question"] = text.strip()
        context.chat_data["ps_state"] = "awaiting_consent"
        await update.message.reply_text(CONSENT_PROMPT)
        return True
    if state == "awaiting_consent":
        if text.strip().upper().startswith("YES"):
            return await _submit(update, context)
        context.chat_data["ps_state"] = None
        await update.message.reply_text("Cancelled — nothing was stored. /printsense any time.")
        return True
    return False


async def _submit(update, context) -> bool:
    data = context.chat_data.pop("ps_pending_file", None)
    question = context.chat_data.pop("ps_pending_question", "")
    context.chat_data["ps_state"] = None
    user = update.effective_user
    req = IntakeRequest(
        work_email=f"telegram-{user.id}@pending.example",
        company="(telegram beta — collected at pilot stage)",
        machine_type="(from conversation)",
        question=question,
        consent_confidentiality=True,
        request_full_package=False,
    )
    svc = _service()
    try:
        out = svc.submit_intake(req, [("telegram_upload", data)])
    except IntakeRefused as exc:
        await update.message.reply_text(f"Can't accept this upload: {exc}")
        return True
    iid = out["intake_id"]
    context.chat_data["ps_last_intake"] = iid
    _chat_map_store()[iid] = update.effective_chat.id
    try:
        svc.process_submission(iid)
        await update.message.reply_text(
            f"Got it — submission {iid[:8]} is processed and now awaiting "
            f"human review (every report is reviewed before delivery). "
            f"/ps_status to check."
        )
    except Exception:
        await update.message.reply_text(
            f"Processing hit a problem; submission {iid[:8]} is recorded "
            f"and we'll follow up. /ps_status to check."
        )
    return True


# --------------------------------------------------------------------------
# Reviewer surface (beta): admin-gated commands. Approval delivers in-process.
# --------------------------------------------------------------------------


def _chat_map_store() -> dict:
    if not hasattr(_chat_map_store, "_m"):
        _chat_map_store._m = {}
    return _chat_map_store._m


def _is_reviewer(update) -> bool:
    return str(update.effective_chat.id) in _ADMIN_IDS


async def ps_review_command(update, context):
    if not _is_reviewer(update):
        await update.message.reply_text("Not authorized.")
        return
    args = context.args or []
    svc = _service(bot=context.bot, chat_map=_chat_map_store())
    if not args or args[0] == "list":
        pend = svc.queue.list_pending()
        await update.message.reply_text(
            "Pending review: " + (", ".join(p[:8] for p in pend) or "none")
        )
        return
    action, iid = args[0], args[1] if len(args) > 1 else ""
    full = next((p for p in svc.queue.list_pending() if p.startswith(iid)), iid)
    if action == "inspect":
        item = svc.queue.inspect(full)
        mo = item["machine_original"]
        await update.message.reply_text(
            f"{full[:8]}: devices={len(mo['devices'])} "
            f"proven={len(mo['proven_cross_references'])} "
            f"open={len(mo['unresolved_or_contradictory'])} "
            f"files={len(item['source_files'])} (artifacts on disk)"
        )
    elif action == "approve":
        pilot = "pilot" in args
        svc.approve(full, reviewer=f"tg:{update.effective_user.id}", pilot_suitable=pilot)
        await update.message.reply_text(f"{full[:8]} approved + delivered.")
    elif action == "reject":
        svc.reject(
            full, reviewer=f"tg:{update.effective_user.id}", note=" ".join(args[2:]) or "rejected"
        )
        await update.message.reply_text(f"{full[:8]} rejected.")
    else:
        await update.message.reply_text(
            "Usage: /ps_review [list|inspect <id>|approve <id> [pilot]|reject <id> <note>]"
        )


async def ps_survey_command(update, context):
    """5 quick answers: /ps_survey y y y y y."""
    iid = context.chat_data.get("ps_last_intake")
    args = [a.lower().startswith("y") for a in (context.args or [])]
    if not iid or len(args) != 5:
        await update.message.reply_text(
            "After your report: /ps_survey <saved-time y/n> <useful y/n> "
            "<would-trust y/n> <have-complete-package y/n> "
            "<consider-paid-pilot y/n>"
        )
        return
    svc = _service()
    svc.record_survey(
        iid,
        Survey(
            saved_time=args[0],
            identified_useful=args[1],
            would_trust_troubleshooting=args[2],
            has_complete_package=args[3],
            consider_paid_pilot=args[4],
        ),
    )
    ok, _reason = svc.qualify(iid)
    await update.message.reply_text(
        "Thanks! "
        + (
            "🎯 You qualify for the managed package pilot — /ps_pilot for next steps."
            if ok
            else "Noted — /ps_pilot any time you want the complete package analyzed."
        )
    )


async def printsense_grade_session_command(update, context):
    """Admin-only ``/printsense_grade_session start|finish`` — live-session
    truth-free grading (testing-program Phase 3). Body lives in the testkit;
    this wrapper owns the reviewer gate, matching /printsense_test."""
    if not _is_reviewer(update):
        await update.message.reply_text("Not authorized.")
        return
    try:
        import printsense_testkit

        await printsense_testkit.printsense_grade_session_command(update, context)
    except Exception as exc:
        logger.warning("printsense_grade_session failed: %s", type(exc).__name__)
        await update.message.reply_text(f"Session grading failed: {type(exc).__name__}")


async def printsense_compare_command(update, context):
    """Admin-only ``/printsense_compare`` — original-vs-degraded pair diff
    (testing-program Phase 4). Body in the testkit; gate here."""
    if not _is_reviewer(update):
        await update.message.reply_text("Not authorized.")
        return
    try:
        import printsense_testkit

        await printsense_testkit.printsense_compare_command(update, context)
    except Exception as exc:
        logger.warning("printsense_compare failed: %s", type(exc).__name__)
        await update.message.reply_text(f"Compare failed: {type(exc).__name__}")


async def printsense_test_command(update, context):
    """Admin-only Phase-1 smoke: run the frozen deterministic gates through the
    SAME shared printsense logic the concierge uses and return a phone-readable
    summary + JSON/MD artifacts. Zero paid calls, zero OCR, zero network —
    everything is committed synthetic fixtures. Fails closed on every path."""
    if not _is_reviewer(update):
        await update.message.reply_text("Not authorized.")
        return
    phase = context.args[0].lower() if getattr(context, "args", None) else "phase1"
    if phase == "phase2":
        try:
            import printsense_testkit

            await printsense_testkit.run_phase2_live(update, context)
        except Exception as exc:
            logger.warning("printsense_test phase2 failed: %s", type(exc).__name__)
            await update.message.reply_text(f"PrintSense test failed: {type(exc).__name__}")
        return
    if phase == "phase3":
        try:
            import printsense_testkit

            await update.message.reply_text(
                "Phase 3 running — bounded multi-photo sessions through the paid "
                "interpreter; expect several minutes."
            )
            await printsense_testkit.run_phase3_live(update, context)
        except Exception as exc:
            logger.warning("printsense_test phase3 failed: %s", type(exc).__name__)
            await update.message.reply_text(f"PrintSense test failed: {type(exc).__name__}")
        return
    if phase == "phase4":
        try:
            import printsense_testkit

            await update.message.reply_text(
                "Phase 4 running — 16-condition robustness matrix (classification "
                "lane free; bounded answer lane); a few minutes."
            )
            await printsense_testkit.run_phase4_live(update, context)
        except Exception as exc:
            logger.warning("printsense_test phase4 failed: %s", type(exc).__name__)
            await update.message.reply_text(f"PrintSense test failed: {type(exc).__name__}")
        return
    if phase == "unseen":
        try:
            import printsense_testkit

            await update.message.reply_text(
                "UNSEEN generalization lane running — free path only, $0; a couple of minutes."
            )
            await printsense_testkit.run_unseen_lane_live(update, context)
        except Exception as exc:
            logger.warning("printsense_test unseen failed: %s", type(exc).__name__)
            await update.message.reply_text(f"PrintSense test failed: {type(exc).__name__}")
        return
    if phase == "ocr":
        try:
            import printsense_testkit

            await printsense_testkit.run_ocr_report_live(update, context)
        except Exception as exc:
            logger.warning("printsense_test ocr failed: %s", type(exc).__name__)
            await update.message.reply_text(f"PrintSense test failed: {type(exc).__name__}")
        return
    if phase != "phase1":
        await update.message.reply_text(
            "Usage: /printsense_test phase1|phase2|phase3|phase4|unseen|ocr"
        )
        return
    try:
        from printsense import grader_gate
        from printsense.benchmarks import capability_bench as _cb
        from printsense.grade_case import grade_case as _grade_case

        frozen = []
        for label, graph, rubric, expected in grader_gate._CORPUS:
            r = _grade_case(grader_gate._ROOT / graph, grader_gate._ROOT / rubric)
            frozen.append((label.split()[0], r["import_verdict"], expected))

        env = _cb.run_corpus()
        report_md = _cb.render_report(env)
        report_json = _cb.stable_envelope_json(env)
        for artifact in (report_md, report_json):
            violations = _cb.audit_artifact(artifact)
            if violations:
                logger.warning("printsense_test artifact audit failed: %s", violations)
                await update.message.reply_text(
                    "PrintSense test artifact failed its privacy self-audit — not sent."
                )
                return

        frozen_ok = all(v == e for _, v, e in frozen)
        summary = _cb.phone_summary(env, frozen)
        if not frozen_ok:
            summary = "FROZEN GATE REGRESSED\n" + summary
        await update.message.reply_text(summary)
        chat_id = update.effective_chat.id
        await context.bot.send_document(
            chat_id=chat_id,
            document=io.BytesIO(report_json.encode("utf-8")),
            filename="printsense_phase1.json",
        )
        await context.bot.send_document(
            chat_id=chat_id,
            document=io.BytesIO(report_md.encode("utf-8")),
            filename="printsense_phase1.md",
        )
    except Exception as exc:  # fail closed: generic class name, never a traceback
        logger.warning("printsense_test failed: %s", type(exc).__name__)
        await update.message.reply_text(f"PrintSense test failed: {type(exc).__name__}")
