"""MIRA Supervisor — Orchestrates workers, manages FSM state, routes intent."""

import asyncio
import json
import logging
import os
import re
import sqlite3
import time
from datetime import datetime, timedelta, timezone

import httpx

from .chat_tenant import resolve as resolve_tenant
from .conversation_router import route_intent
from .detection.recurring_fault import check_recurring_and_annotate
from .fallback_responses import (
    GENERIC_ENGINE_ERROR,
    INFERENCE_EXHAUSTED,
    PHOTO_FAILURE,
    RAG_FAILURE,
    TIMEOUT_WARNING,
    work_order_failure,
)
from .fsm import (
    _FAULT_INFO_RE,  # noqa: F401 — re-exported for test_engine.py backward compat
    _MAX_Q_ROUNDS,  # noqa: F401 — re-exported for test_engine.py backward compat
    _STATE_ALIASES,  # noqa: F401 — re-exported for test_fsm_properties.py backward compat
    ACTIVE_DIAGNOSTIC_STATES,
    HISTORY_LIMIT,
    PHOTO_MEMORY_TURNS,
    STATE_ORDER,
    VALID_STATES,
    advance_state,
)
from .guardrails import (
    INTENT_KEYWORDS,
    SAFETY_KEYWORDS,
    check_output,
    classify_intent,
    detect_session_followup,
    resolve_option_selection,
    strip_mentions,
    vendor_name_from_text,
    vendor_support_url,
)
from .inference.router import InferenceRouter
from .integrations.atlas_cmms import AtlasCMMSClient
from .integrations.hub_neon import create_hub_work_order
from .integrations.pm_suggestions import (
    PMSuggestion,
    is_pm_acceptance,
    suggest_followup_pm,
)
from .models.work_order import (
    UNSWorkOrder,
    apply_wo_edit,
    build_uns_wo_from_state,
    format_wo_preview,
    log_uns_event,
)
from .nemotron import NemotronClient
from .neon_recall import kb_has_coverage
from .notifications.push import push_safety_alert, push_wo_created
from .photo_handler import (
    build_print_reply,
    clear_session_photo,
    load_session_photo,
    save_session_photo,
)
from .response_formatter import (
    _VISION_PROSE_PREFIX_RE,
    _looks_like_model_number,
    deduplicate_options,  # noqa: F401 — re-exported for test_conversation_continuity.py
    format_reply,
    parse_response,
)
from .session_manager import (
    ensure_table,
    load_state,
    log_interaction,
    record_exchange,
    save_state,
)
from .telemetry import flush as tl_flush
from .telemetry import span as tl_span
from .telemetry import trace as tl_trace
from .workers.nameplate_worker import NameplateWorker
from .workers.plc_worker import PLCWorker
from .workers.print_worker import PrintWorker
from .workers.rag_worker import RAGWorker
from .workers.vision_worker import VisionWorker

logger = logging.getLogger("mira-gsd")

# Confidence-inference keyword sets
_HIGH_CONF_SIGNALS = re.compile(
    r"(replace|fault code|check wiring|the .+ is .+(failed|tripped|open|shorted|overloaded)"
    r"|part number|order number|disconnect|de-energize|lockout)",
    re.IGNORECASE,
)
_LOW_CONF_SIGNALS = re.compile(
    r"(might be|could be|possibly|not sure|uncertain|hard to say"
    r"|without more info|i'?d need|difficult to determine)",
    re.IGNORECASE,
)

_JSON_RE = re.compile(r'\{[^{}]*"reply"[^{}]*\}', re.DOTALL)

_PADDING_OPTION_RE = re.compile(
    r"^(i'?m not sure|not sure|not applicable|n/?a|unknown|other|unsure"
    r"|i don'?t know|don'?t know|not visible|can'?t tell|cannot tell"
    r"|none of the above|maybe|possibly)\.?$",
    re.IGNORECASE,
)
_PLACEHOLDER_OPTION_RE = re.compile(r"^[\"']?\d+[.):\-]?[\"']?$")


def _clean_option_list(options: list) -> list:
    """Strip leading numbers and drop padding/placeholder options.

    Keeps stored last_options in sync with the numbered list the user saw.
    """
    cleaned: list[str] = []
    for raw in options:
        if raw is None:
            continue
        text = re.sub(r"^\s*\d+[.):\-]\s*", "", str(raw)).strip()
        if len(text) <= 1:
            continue
        if _PLACEHOLDER_OPTION_RE.match(text):
            continue
        if _PADDING_OPTION_RE.match(text):
            continue
        cleaned.append(text)
    return cleaned


_VISION_PROSE_BRIDGE_RE = re.compile(
    r"^(?:weathered\s+|corroded\s+|rusty\s+|close[- ]up\s+(?:of\s+|view\s+of\s+)?)?"
    r"(?:metal\s+|aluminum\s+|plastic\s+)?"
    r"(?:plate|label|nameplate|tag|sticker|sign|table|chart|sheet|display|page|image|photo)"
    r"[^.]*?"
    r"(?:with\s+(?:a\s+)?(?:specifications?|label|info(?:rmation)?|data)\s+(?:for|of)"
    r"|specifications?\s+for"
    r"|for|of|showing|displaying)"
    r"\s+(?:a\s+|an\s+|the\s+)?",
    re.IGNORECASE,
)


def _clean_asset_name(raw: str) -> str:
    """Strip vision-model prose from an asset name string."""
    text = _VISION_PROSE_PREFIX_RE.sub("", raw.strip()).lstrip()
    text = _VISION_PROSE_BRIDGE_RE.sub("", text).lstrip()
    first = text.split(".")[0].strip()
    return (first or raw)[:120]


STATE_ORDER = STATE_ORDER  # re-exported from fsm for backward-compat imports
# ---------------------------------------------------------------------------
# Diagnosis self-critique quality gate
# ---------------------------------------------------------------------------
_CRITIQUE_DISABLED = os.getenv("MIRA_DISABLE_SELF_CRITIQUE", "0") == "1"
_CRITIQUE_THRESHOLD = int(os.getenv("MIRA_CRITIQUE_THRESHOLD", "3"))
_CRITIQUE_MAX_ATTEMPTS = int(os.getenv("MIRA_CRITIQUE_MAX_ATTEMPTS", "2"))

# _FAULT_INFO_RE, _Q_STATES, _MAX_Q_ROUNDS now live in fsm.py (imported above)

# Compact judge prompt — returns only the three actionable dims to keep token cost low.
_CRITIQUE_PROMPT = """\
Score this maintenance-AI response. Return ONLY valid JSON — no markdown, no prose.

User asked: {question}

AI responded: {response}

Rate each on 1-5 (5=excellent, 3=acceptable, <3=needs revision):

{{"groundedness":{{"score":<1-5>,"note":"<12 words max: reflects KB or admits gap?>"}},\
"helpfulness":{{"score":<1-5>,"note":"<12 words max: technician can act on this?>"}},\
"instruction_following":{{"score":<1-5>,"note":"<12 words max: honored the user's actual ask?>"}}}}"""
# ACTIVE_DIAGNOSTIC_STATES, HISTORY_LIMIT, PHOTO_MEMORY_TURNS, _STATE_ALIASES
# now live in fsm.py (imported above). _PROCESS_TIMEOUT defined below.
_PROCESS_TIMEOUT = float(os.getenv("MIRA_PROCESS_TIMEOUT", "30"))

# ---------------------------------------------------------------------------
# Manual-lookup gathering subroutine constants
# ---------------------------------------------------------------------------
# Phrases that signal the user wants to abandon the manual search.
_MANUAL_ESCAPE_PHRASES = frozenset(
    {
        "skip",
        "back",
        "nevermind",
        "never mind",
        "back to troubleshooting",
        "back to diagnosis",
        "forget it",
        "doesn't matter",
        "no manual",
        "drop it",
        "cancel",
        "ignore",
        "go back",
        "cancel that",
        "not important",
        "never mind the manual",
    }
)

# Signals that the user is resuming a diagnostic conversation.
_DIAGNOSIS_SIGNAL_RE = re.compile(
    r"\b(?:fault|error|code|alarm|trips?|overload|won'?t start|not working|"
    r"shuts? off|shutting|blink(?:ing)?|flash(?:ing)?|hz|rpm|amps?|volts?|"
    r"f\d+|e\d+|overheat|overcurrent|undervoltage|overvoltage|no power|"
    r"actually|symptom|problem|issue|broken)\b",
    re.IGNORECASE,
)

# Vendor names used by the specificity heuristic.
_KNOWN_VENDORS: frozenset[str] = frozenset(
    {
        "pilz",
        "siemens",
        "allen-bradley",
        "allen bradley",
        "rockwell",
        "schneider",
        "abb",
        "yaskawa",
        "danfoss",
        "vacon",
        "mitsubishi",
        "omron",
        "delta",
        "lenze",
        "nord",
        "baldor",
        "weg",
        "leeson",
        "marathon",
        "emerson",
        "control techniques",
        "nidec",
        "eaton",
        "square d",
        "fuji",
        "toshiba",
        "hitachi",
        "automationdirect",
        "automation direct",
        "keyence",
        "banner",
        "turck",
        "ifm",
        "sick",
        "phoenix contact",
        "weidmuller",
        "murr",
        "idec",
    }
)


# format_diagnostic_response, deduplicate_options, _looks_like_model_number
# now live in response_formatter.py (imported above and re-exported here for
# backward compatibility with any callers that import from engine directly).


class Supervisor:
    """Orchestrates MIRA workers with FSM state tracking."""

    def __init__(
        self,
        db_path: str,
        openwebui_url: str,
        api_key: str,
        collection_id: str,
        vision_model: str = "qwen2.5vl:7b",
        tenant_id: str = None,
        mcp_base_url: str = "",
        mcp_api_key: str = "",
        web_base_url: str = "",
    ):
        self.db_path = db_path
        self.vision_model = vision_model

        # Service base URLs for nameplate downstream calls and reactive ingest
        self.mcp_base_url = (
            mcp_base_url or os.getenv("MCP_BASE_URL", "http://mira-mcp:8001")
        ).rstrip("/")
        self._ingest_base_url = os.getenv("INGEST_BASE_URL", "http://mira-ingest:8001").rstrip("/")
        self.mcp_api_key = mcp_api_key or os.getenv("MCP_REST_API_KEY", "")
        self.web_base_url = (
            web_base_url or os.getenv("WEB_BASE_URL", "http://mira-web:3000")
        ).rstrip("/")

        # Nemotron client — enabled only when NVIDIA_API_KEY is set
        self.nemotron = NemotronClient()

        # Inference router — enabled when INFERENCE_BACKEND=cloud and at least one of
        # GROQ_API_KEY / CEREBRAS_API_KEY / GEMINI_API_KEY is set.
        self.router = InferenceRouter()

        # Initialize workers
        self.vision = VisionWorker(openwebui_url, api_key, vision_model)
        self.nameplate = NameplateWorker(openwebui_url, api_key, vision_model)
        self.rag = RAGWorker(
            openwebui_url,
            api_key,
            collection_id,
            nemotron=self.nemotron,
            router=self.router,
            tenant_id=tenant_id,
        )
        self.print_ = PrintWorker(openwebui_url, api_key)
        self.plc = PLCWorker()

        self._ensure_table()

    # ------------------------------------------------------------------
    # Photo persistence — save/load session photos for follow-up turns
    # ------------------------------------------------------------------

    def _save_session_photo(self, chat_id: str, photo_b64: str) -> str:
        """Save session photo to disk. Returns the file path."""
        return save_session_photo(self.db_path, chat_id, photo_b64)

    def _load_session_photo(self, chat_id: str) -> str | None:
        """Load session photo as base64 if it exists and is within turn limit."""
        return load_session_photo(self.db_path, chat_id)

    def _clear_session_photo(self, chat_id: str) -> None:
        """Remove the session photo when it expires or session resets."""
        clear_session_photo(self.db_path, chat_id)

    def _build_print_reply(self, vision_data: dict) -> str:
        return build_print_reply(vision_data)

    # ------------------------------------------------------------------
    # Confidence inference
    # ------------------------------------------------------------------

    @staticmethod
    def _is_doc_specific(vendor: str, text: str) -> bool:
        """Return True if *text* is specific enough to crawl usefully.

        Requires both:
        - a vendor name present in _KNOWN_VENDORS (either extracted or in text)
        - at least one model-number token OR a standalone ≥2-digit number

        The second fallback covers cases like "PowerFlex 525" where the model
        designator is pure digits (525, 70, 700, etc.).  Vague requests like
        "the safety relay" or "this VFD" still return False.
        """
        text_lower = text.lower()
        vendor_known = bool(vendor) and any(
            v in vendor.lower() or v in text_lower for v in _KNOWN_VENDORS
        )
        if not vendor_known:
            return False
        # Primary: mixed letter+digit token (GS20, FC-302, X3, ACS580).
        if _looks_like_model_number(text):
            return True
        # Fallback: standalone ≥2-digit number (525, 70, 700, 120 ...).
        return bool(re.search(r"\b\d{2,}\b", text))

    @staticmethod
    def _infer_confidence(reply: str) -> str:
        """Infer confidence level from reply text.

        Returns one of: "high", "medium", "low", "none".
        """
        if not reply or len(reply) < 20:
            return "none"
        has_high = bool(_HIGH_CONF_SIGNALS.search(reply))
        has_low = bool(_LOW_CONF_SIGNALS.search(reply))
        if has_high and not has_low:
            return "high"
        if has_low and not has_high:
            return "low"
        if has_high and has_low:
            return "medium"
        # Default: medium for substantive replies, none for short/generic
        return "medium" if len(reply) > 60 else "none"

    @staticmethod
    def _make_result(
        reply: str,
        confidence: str = "none",
        trace_id: str | None = None,
        next_state: str | None = None,
    ) -> dict:
        """Build a standard process_full() result dict."""
        return {
            "reply": reply,
            "confidence": confidence,
            "trace_id": trace_id,
            "next_state": next_state,
        }

    # ------------------------------------------------------------------
    # Entry points
    # ------------------------------------------------------------------

    async def process(
        self,
        chat_id: str,
        message: str,
        photo_b64: str = None,
        *,
        platform: str = "telegram",
    ) -> str:
        """Main entry point. Returns reply string (backward-compatible).

        Wraps process_full() with a configurable timeout (MIRA_PROCESS_TIMEOUT,
        default 30s) and a top-level exception guard so every call returns a
        user-facing string — never raises to the adapter.
        """
        t0 = time.monotonic()
        try:
            result = await asyncio.wait_for(
                self.process_full(chat_id, message, photo_b64),
                timeout=_PROCESS_TIMEOUT,
            )
        except asyncio.TimeoutError:
            logger.error(
                "PROCESS_TIMEOUT chat_id=%s message=%r timeout=%.0fs",
                chat_id,
                message[:80],
                _PROCESS_TIMEOUT,
            )
            return TIMEOUT_WARNING
        except Exception as exc:
            logger.error(
                "PROCESS_ERROR chat_id=%s message=%r error=%s",
                chat_id,
                message[:80],
                exc,
                exc_info=True,
            )
            return GENERIC_ENGINE_ERROR
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        self._log_interaction(
            chat_id,
            message,
            result["reply"],
            fsm_state=result.get("next_state", ""),
            confidence=result.get("confidence", ""),
            has_photo=bool(photo_b64),
            response_time_ms=elapsed_ms,
            platform=platform,
        )
        return result["reply"]

    async def process_full(
        self,
        chat_id: str,
        message: str,
        photo_b64: str = None,
    ) -> dict:
        """Full entry point. Returns {"reply", "confidence", "trace_id", "next_state"}.

        Same logic as process(), but preserves structured metadata for
        benchmark and telemetry consumers.
        """
        # Resolve tenant per call — chat_tenant LRU cache makes this cheap
        resolved_tenant = resolve_tenant(chat_id) or self.rag.tenant_id

        # Telemetry trace
        t = tl_trace("supervisor.process", user_id=chat_id)
        trace_id = t.id

        # Preprocess: strip Slack mention tags
        message = strip_mentions(message)

        state = self._load_state(chat_id)

        # CMMS pending: user is answering the work-order creation prompt — handle before
        # any option resolution, session-followup detection, or intent classification.
        if (state.get("context") or {}).get("cmms_pending") and not photo_b64:
            return await self._handle_cmms_pending(chat_id, message, state, trace_id)

        # PM suggestion pending: user is answering a follow-up PM proposal.
        if (state.get("context") or {}).get("pm_suggestion_pending") and not photo_b64:
            return await self._handle_pm_suggestion_pending(chat_id, message, state, trace_id)

        # Photo persistence: load stored session photo for text follow-ups
        _session_photo = None
        if not photo_b64:
            ctx = state.get("context") or {}
            photo_turn = ctx.get("photo_turn", 0)
            if photo_turn > 0 and state["exchange_count"] - photo_turn < PHOTO_MEMORY_TURNS:
                _session_photo = self._load_session_photo(chat_id)
                if _session_photo:
                    logger.info(
                        "Session photo loaded for turn %d (photo at turn %d, %d turns ago)",
                        state["exchange_count"],
                        photo_turn,
                        state["exchange_count"] - photo_turn,
                    )
            elif photo_turn > 0:
                # Photo memory expired
                self._clear_session_photo(chat_id)
                ctx.pop("photo_turn", None)
                state["context"] = ctx

        # Phase 3 — honest crawl-failure prefix: check if a prior doc-crawl exhausted
        _honest_prefix = ""
        if not photo_b64:
            _honest_prefix = await self._check_pending_doc_job(chat_id, state)

        # Manual-lookup gathering subroutine intercept — must run before guardrail /
        # intent checks so we don't re-classify a gathering answer as "documentation".
        if not photo_b64 and state["state"] == "MANUAL_LOOKUP_GATHERING":
            result = await self._handle_manual_lookup_gathering(
                chat_id, message, state, trace_id, resolved_tenant
            )
            if result is not None:
                return result
            # None → diagnosis signal detected; subroutine restored prior FSM state
            # and cleared the gathering payload — fall through to normal diagnostic flow.

        # Always-on guardrail: safety and off-topic bypass ALL conversation state
        if not photo_b64:
            sc = state.get("context", {}).get("session_context", {})

            # Option selection resolution FIRST: expand "2" / "option 2" / "2 again"
            # → full option text before any follow-up or intent detection runs on it.
            last_options = sc.get("last_options", [])
            if last_options:
                expanded = resolve_option_selection(message, last_options)
                if expanded:
                    logger.info("Selection resolved: '%s' → '%s'", message, expanded)
                    message = expanded
                    # Clear stale options so this selection doesn't persist into
                    # the next turn and re-resolve against the wrong question.
                    _ctx_opt = state.get("context") or {}
                    _sc_opt = _ctx_opt.get("session_context") or {}
                    _sc_opt.pop("last_options", None)
                    _sc_opt.pop("last_question", None)
                    _ctx_opt["session_context"] = _sc_opt
                    state["context"] = _ctx_opt
                    self._save_state(chat_id, state)

            # Session follow-up detection: now runs on the already-expanded message.
            if detect_session_followup(message, sc, state["state"]):
                return await self._handle_session_followup(
                    message,
                    state,
                    chat_id,
                    session_photo=_session_photo,
                    tenant_id=resolved_tenant,
                    honest_prefix=_honest_prefix,
                )

            # LLM conversation router — determines what the user wants THIS turn.
            # Runs in parallel with the synchronous keyword classifier as a fast fallback.
            _keyword_intent = classify_intent(message)
            try:
                _routing = await route_intent(
                    user_message=message,
                    conversation_history=(state.get("context") or {}).get("history", []),
                    current_fsm_state=state.get("state", "IDLE"),
                    asset_identified=state.get("asset_identified", ""),
                )
                _router_intent = _routing["intent"]
                logger.info(
                    "ROUTER intent=%s confidence=%.2f reason=%r chat_id=%s",
                    _router_intent,
                    _routing.get("confidence", 0),
                    _routing.get("reasoning", ""),
                    chat_id,
                )
            except Exception as _re:
                logger.warning("ROUTER_FAILURE error=%s — using keyword classifier", _re)
                _router_intent = {
                    "safety": "safety_concern",
                    "documentation": "find_documentation",
                    "greeting": "greeting_or_chitchat",
                    "help": "greeting_or_chitchat",
                    "industrial": "continue_current",
                    "off_topic": "general_question",
                }.get(_keyword_intent, "continue_current")

            # Safety ALWAYS wins — router or keyword classifier, either triggers it.
            intent = _keyword_intent  # keep for downstream legacy gates
            if _router_intent == "safety_concern" or _keyword_intent == "safety":
                reply = (
                    "STOP \u2014 describe the hazard. De-energize the equipment first. "
                    "Do not proceed until the area is safe."
                )
                self._record_exchange(chat_id, state, message, reply)
                tl_flush()
                asset = state.get("asset_identified") or "Unknown equipment"
                asyncio.ensure_future(push_safety_alert(asset=asset, message=message[:200]))
                return self._make_result(reply, "high", trace_id, "SAFETY_ALERT")

            # Router-exclusive dispatches — intents the keyword classifier doesn't handle
            if _router_intent == "log_work_order":
                return await self._handle_wo_request(chat_id, message, state, trace_id)

            if _router_intent == "switch_asset":
                return await self._handle_asset_switch(chat_id, message, state, trace_id)

            if _router_intent == "check_equipment_history":
                return await self._handle_check_equipment_history(chat_id, message, state, trace_id)

            if _router_intent == "general_question" and _keyword_intent not in (
                "safety",
                "documentation",
            ):
                return await self._handle_general_question(chat_id, message, state, trace_id)

            if _router_intent == "greeting_or_chitchat" and state["state"] == "IDLE":
                return self._greeting_response(state, chat_id, trace_id)

            # find_documentation: let the existing specificity-gate block handle it below
            if _router_intent == "find_documentation":
                intent = "documentation"

        # Intent gate: casual/help messages in IDLE state — no LLM/RAG needed
        if not photo_b64 and state["state"] == "IDLE" and state["exchange_count"] == 0:
            if intent == "help":
                reply = (
                    "I help maintenance technicians diagnose equipment issues. "
                    "Send me a photo of a fault screen, a fault code like "
                    "'OC' or 'F-201', or describe what's happening with your equipment."
                )
                self._record_exchange(chat_id, state, message, reply)
                tl_flush()
                return self._make_result(reply, "none", trace_id, "IDLE")
            if intent == "greeting":
                reply = (
                    "Hey \u2014 I'm MIRA, your maintenance copilot. "
                    "Send me a photo of equipment, a fault code, or describe what's "
                    "going on and I'll help you diagnose it."
                )
                self._record_exchange(chat_id, state, message, reply)
                tl_flush()
                return self._make_result(reply, "none", trace_id, "IDLE")

        # Documentation intent: specificity check → gathering subroutine or KB pre-check
        if not photo_b64 and intent == "documentation":
            combined = f"{message} {state.get('asset_identified', '')}".strip()
            mfr = vendor_name_from_text(combined) or ""

            # Specificity gate — vague requests ("the safety relay", "this VFD") enter
            # MANUAL_LOOKUP_GATHERING to collect vendor + model before crawling.
            if not self._is_doc_specific(mfr, combined):
                return await self._enter_manual_lookup_gathering(
                    chat_id, message, state, trace_id, mfr
                )

            # Specific enough — Phase 2 KB pre-check + crawl
            return await self._do_documentation_lookup(
                chat_id, message, state, trace_id, resolved_tenant, vendor_override=mfr
            )

        # Photo path: delegate to vision worker, then route
        _photo_continues_session = False
        if photo_b64:
            try:
                with tl_span(t, "vision_worker"):
                    vision_data = await self.vision.process(photo_b64, message)
            except Exception as _ve:
                logger.error(
                    "VISION_WORKER_ERROR chat_id=%s fsm=%s error=%s",
                    chat_id,
                    state.get("state"),
                    _ve,
                    exc_info=True,
                )
                tl_flush()
                return self._make_result(PHOTO_FAILURE, "none", trace_id, state.get("state"))

            # Confidence gate: low-quality photos get a re-send request, not a diagnosis
            # Safety override: if the vision model saw a hazard, bypass and let it fire below
            if vision_data.get("confidence") == "low":
                vision_text = str(vision_data.get("vision_result", "")).lower()
                if not any(kw in vision_text for kw in SAFETY_KEYWORDS):
                    self._save_state(chat_id, state)
                    tl_flush()
                    return self._make_result(
                        "I can see something but the photo is too dark or blurry for a "
                        "reliable diagnosis. Can you send a clearer photo — ideally with "
                        "the nameplate or fault display visible?",
                        "low",
                        trace_id,
                        state["state"],
                    )

            ctx = state.get("context") or {}
            ctx["ocr_text"] = vision_data["tesseract_text"]
            ctx["ocr_items"] = vision_data["ocr_items"]
            # Track which turn the photo was sent on
            ctx["photo_turn"] = state["exchange_count"]
            state["context"] = ctx
            # Store a concise asset identifier, not the full vision description.
            # The LLM regurgitates the full text on every turn if we store the paragraph.
            # 2026-04-19 audit — vision models prefix output with prose like
            # "The image shows a weathered metal plate with a label for a TECO
            # 3-PHASE INDUCTION MOTOR" which then becomes the asset identity on
            # every subsequent turn. Scrub the prose head so the stored asset
            # reads "a weathered metal plate with a label for a TECO…" → "a TECO
            # 3-PHASE INDUCTION MOTOR" (or cleaner).
            full_vision = str(vision_data["vision_result"])
            # Strip "The image shows a " / "I can see this is " prefix only —
            # keep the description of the equipment itself so asset_identified
            # stays useful ("TECO 3-PHASE INDUCTION MOTOR", not empty).
            scrubbed = _VISION_PROSE_PREFIX_RE.sub("", full_vision).lstrip()
            # Also strip physical-object meta ("weathered metal plate with a
            # label for a ...") so we land on the equipment itself.
            scrubbed = re.sub(
                r"^(weathered |corroded |rusty |close[- ]up (of |view of )?"
                r"|photo of |picture of |view of )?"
                r"(metal |aluminum |plastic )?"
                r"(plate|label|nameplate|tag|sticker|sign)[^.]*?"
                r"(?:with (?:a )?label (?:for|of) (?:a |an |the )?"
                r"|for (?:a |an |the )|of (?:a |an |the )|showing (?:a |an |the ))",
                "",
                scrubbed,
                flags=re.IGNORECASE,
            ).lstrip()
            first_sentence = scrubbed.split(".")[0].strip()
            state["asset_identified"] = (
                first_sentence[:120] if first_sentence else full_vision[:120]
            )

            # Save photo to disk for follow-up turns
            self._save_session_photo(chat_id, photo_b64)

            # Active diagnostic: photo is an answer to the pending question
            if state["state"] in ACTIVE_DIAGNOSTIC_STATES:
                _photo_continues_session = True
                sc = ctx.get("session_context", {})
                last_q = sc.get("last_question", "")
                default_caption = "Analyze this equipment photo"
                if last_q and (not message or message == default_caption):
                    message = f"[Photo answering: {last_q}]"
                elif last_q:
                    message = f"[Photo answering: {last_q}] {message}"
                logger.info("Photo-as-answer in %s: %s", state["state"], message[:100])
                # Fall through to RAG — preserve state and session_context

            elif vision_data["classification"] == "ELECTRICAL_PRINT":
                state["state"] = "ELECTRICAL_PRINT"
                ctx["drawing_type"] = vision_data["drawing_type"]
                state["context"] = ctx

                reply = self._build_print_reply(vision_data)
                history = ctx.get("history", [])
                history.append({"role": "user", "content": message})
                history.append({"role": "assistant", "content": reply})
                ctx["history"] = history
                state["context"] = ctx
                state["exchange_count"] += 1
                self._save_state(chat_id, state)
                tl_flush()
                return self._make_result(
                    reply,
                    self._infer_confidence(reply),
                    trace_id,
                    "ELECTRICAL_PRINT",
                )
            elif vision_data["classification"] == "NAMEPLATE":
                reply = await self._handle_nameplate(
                    chat_id=chat_id,
                    photo_b64=photo_b64,
                    state=state,
                    ctx=ctx,
                    message=message,
                    resolved_tenant=resolved_tenant,
                )
                state["state"] = "ASSET_IDENTIFIED"
                state["exchange_count"] += 1
                self._save_state(chat_id, state)
                tl_flush()
                return self._make_result(
                    reply,
                    "high",
                    trace_id,
                    "ASSET_IDENTIFIED",
                )
            else:
                state["state"] = "ASSET_IDENTIFIED"
                existing_sc = ctx.get("session_context", {})
                ctx["session_context"] = {
                    "equipment_type": str(vision_data["vision_result"])[:80],
                    "manufacturer": state.get("asset_identified", "Unknown"),
                    "last_question": existing_sc.get("last_question"),
                    "last_options": existing_sc.get("last_options", []),
                }
                state["context"] = ctx

        # Electrical print follow-up (text question in ELECTRICAL_PRINT state)
        if state.get("state") == "ELECTRICAL_PRINT" and not photo_b64:
            try:
                with tl_span(t, "print_worker"):
                    raw = await self.print_.process(message, state)
            except Exception as e:
                logger.error(
                    "PRINT_WORKER_ERROR chat_id=%s error=%s",
                    chat_id,
                    e,
                    exc_info=True,
                )
                self._save_state(chat_id, state)
                tl_flush()
                return self._make_result(GENERIC_ENGINE_ERROR, "none", trace_id)
            parsed = self._parse_response(raw)
            # Output guardrail for print worker
            print_intent = classify_intent(message)
            parsed["reply"] = check_output(parsed["reply"], print_intent, has_photo=False)
            state["exchange_count"] += 1
            ctx = state.get("context") or {}
            history = ctx.get("history", [])
            history.append({"role": "user", "content": message})
            history.append({"role": "assistant", "content": parsed["reply"]})
            if len(history) > HISTORY_LIMIT:
                history = history[-HISTORY_LIMIT:]
            ctx["history"] = history
            state["context"] = ctx
            self._save_state(chat_id, state)
            formatted = self._format_reply(parsed, user_message=message)
            tl_flush()
            return self._make_result(
                formatted,
                self._infer_confidence(formatted),
                trace_id,
                "ELECTRICAL_PRINT",
            )

        # Photo with no specific intent → check for visible fault indicators first
        # (Skip for photo-as-answer: active session photos go straight to RAG)
        if (
            photo_b64
            and not _photo_continues_session
            and not any(kw in message.lower() for kw in INTENT_KEYWORDS)
        ):
            # Check OCR + vision for fault indicators on equipment faceplates
            ctx = state.get("context") or {}
            ocr_items = ctx.get("ocr_items", [])
            ocr_text = " ".join(ocr_items).lower()
            vision_text = state.get("asset_identified", "").lower()
            _FAULT_INDICATORS = (
                "fault",
                "alarm",
                "error",
                "trip",
                "tripped",
                "faulted",
                "overload",
                "overcurrent",
                "overvoltage",
                "warning",
                "stopped",
                "off",
                "fail",
                "run fault",
            )
            has_fault_indicators = any(
                kw in ocr_text or kw in vision_text for kw in _FAULT_INDICATORS
            )

            if has_fault_indicators:
                # Auto-diagnose: inject fault context into message and route to RAG
                asset = state.get("asset_identified", "this equipment")
                fault_items = [
                    item
                    for item in ocr_items
                    if any(kw in item.lower() for kw in _FAULT_INDICATORS)
                ]
                fault_summary = (
                    ", ".join(fault_items[:5]) if fault_items else "fault indicator visible"
                )
                message = (
                    f"[Equipment photo: {asset}] "
                    f"Visible indicators: {fault_summary}. "
                    f"OCR labels: {', '.join(ocr_items[:15])}. "
                    f"Analyze the indicator states, compare against normal operation, "
                    f"and propose the most likely cause and fix."
                )
                logger.info("Auto-diagnose equipment fault: %s", message[:120])
                state["state"] = "Q1"
                sc = ctx.get("session_context", {})
                sc["equipment_type"] = str(state.get("asset_identified", ""))[:80]
                sc["last_question"] = None
                sc["last_options"] = []
                ctx["session_context"] = sc
                state["context"] = ctx
                # Fall through to RAG worker below
            else:
                asset = state.get("asset_identified", "this equipment")
                reply = f"I can see this is {asset}. How can I help you with it?"
                history = ctx.get("history", [])
                history.append({"role": "user", "content": message})
                history.append({"role": "assistant", "content": reply})
                ctx["history"] = history
                sc = ctx.get("session_context", {})
                if sc:
                    sc["last_question"] = reply[:200]
                    ctx["session_context"] = sc
                state["context"] = ctx
                self._save_state(chat_id, state)
                tl_flush()
                return self._make_result(reply, "none", trace_id, "ASSET_IDENTIFIED")

        # RAG worker with self-correction: text queries and photo+intent queries
        # Use session photo for follow-up text questions within PHOTO_MEMORY_TURNS
        effective_photo = photo_b64 or _session_photo
        try:
            with tl_span(t, "rag_worker"):
                raw, parsed = await self._call_with_correction(
                    message,
                    state,
                    effective_photo,
                    tenant_id=resolved_tenant,
                )
        except Exception as _re:
            logger.error(
                "RAG_WORKER_ERROR chat_id=%s fsm=%s error=%s",
                chat_id,
                state.get("state"),
                _re,
                exc_info=True,
            )
            # Partial degradation: RAG failed but session is still alive
            self._save_state(chat_id, state)
            tl_flush()
            # Try to surface a vendor support link if we know the equipment
            asset = state.get("asset_identified") or ""
            from .guardrails import vendor_support_url as _vsu

            url = _vsu(asset)
            fallback = RAG_FAILURE
            if url:
                fallback = (
                    f"I'm having trouble accessing the knowledge base right now. "
                    f"For {asset}, try the OEM portal directly: {url}. "
                    f"Try again in a moment."
                )
            return self._make_result(fallback, "none", trace_id, state.get("state"))
        if raw is None:
            self._save_state(chat_id, state)
            tl_flush()
            # raw=None means all providers failed — use INFERENCE_EXHAUSTED fallback
            # unless parsed["reply"] already contains a meaningful message
            fallback_reply = parsed.get("reply") or INFERENCE_EXHAUSTED
            if not fallback_reply or fallback_reply.strip() == "":
                fallback_reply = INFERENCE_EXHAUSTED
            return self._make_result(fallback_reply, "none", trace_id)

        # Output guardrails
        intent = classify_intent(message)
        parsed["reply"] = check_output(parsed["reply"], intent, has_photo=bool(photo_b64))

        # Photo device-name guardrail: ensure identified device + fault appear in reply
        if photo_b64 and state.get("asset_identified"):
            asset = state["asset_identified"]
            # Extract first two meaningful segments (strip "Manufacturer:" labels)
            parts = [
                p.strip().replace("Manufacturer:", "").replace("Model:", "").strip()
                for p in asset.split(",")[:2]
            ]
            asset_key = ", ".join(p for p in parts if p)
            if asset_key and asset_key.lower() not in parsed["reply"].lower():
                # Include fault caption to anchor fault-cause keywords in reply
                caption_prefix = message[:70].rstrip() if message else ""
                if caption_prefix:
                    parsed["reply"] = f"{asset_key} — reported: {caption_prefix}\n{parsed['reply']}"
                else:
                    parsed["reply"] = f"{asset_key} — {parsed['reply']}"

        state = self._advance_state(state, parsed)

        # ---------------------------------------------------------------------------
        # Diagnosis self-critique quality gate (AutoGen-style nudge loop)
        # Runs only on DIAGNOSIS state, text-only turns.
        #
        # diag_rev_count tracks how many times this fault episode has already sent
        # the groundedness clarifying question.  It persists across turns (unlike the
        # old revision_attempts which caused the same question to repeat indefinitely
        # and then permanently disabled the critique after 2 turns).  The critique
        # itself runs every DIAGNOSIS turn — the cap is only on how many times we
        # ask the user for more info, not on how many times we evaluate quality.
        # ---------------------------------------------------------------------------
        if state["state"] == "DIAGNOSIS" and not photo_b64 and not _CRITIQUE_DISABLED:
            ctx_sc = state.get("context") or {}
            diag_rev_count = ctx_sc.get("diag_rev_count", 0)

            scores = await self._self_critique_diagnosis(parsed["reply"], message, chat_id)
            low_dims = [d for d, s in scores.items() if s < _CRITIQUE_THRESHOLD]

            if low_dims:
                logger.info(
                    "SELF_CRITIQUE_TRIGGERED chat_id=%s dims=%s scores=%s diag_rev_count=%d",
                    chat_id,
                    low_dims,
                    {d: scores[d] for d in low_dims},
                    diag_rev_count,
                )

                if "groundedness" in low_dims and diag_rev_count == 0:
                    # First time this fault episode has low groundedness — ask one
                    # targeted clarifying question and park in DIAGNOSIS_REVISION.
                    note = scores.get("groundedness_note", "")
                    clarifying_q = (
                        "Before I can give you a confident diagnosis, could you "
                        "share one more detail — what exact fault code, alarm "
                        "number, or behaviour is the equipment showing right now?\n\n"
                        "1. Fault/alarm code displayed (e.g. F001, AL-14, OC)\n"
                        "2. Visible symptom (e.g. trips on start, runs slow, won't start)\n"
                        "3. Sensor reading (e.g. pressure at 120 PSI, temp at 90°C)\n"
                        "4. Other — describe what you're seeing"
                    )
                    if note:
                        clarifying_q += f"\n\n*(My confidence was limited because: {note})*"
                    ctx_sc["diag_rev_count"] = diag_rev_count + 1
                    ctx_sc["revision_critique"] = {
                        "dims": low_dims,
                        "diag_rev_count": diag_rev_count + 1,
                        "scores": scores,
                    }
                    state["context"] = ctx_sc
                    state["state"] = "DIAGNOSIS_REVISION"
                    parsed["reply"] = clarifying_q
                    # Populate last_options so "1."/"2."/"3."/"4." resolve next turn
                    sc = ctx_sc.get("session_context", {})
                    sc["last_options"] = [
                        "Fault/alarm code displayed",
                        "Visible symptom",
                        "Sensor reading",
                        "Other — describe what you're seeing",
                    ]
                    sc["last_question"] = clarifying_q[:200]
                    ctx_sc["session_context"] = sc
                    state["context"] = ctx_sc

                elif "groundedness" in low_dims and diag_rev_count >= 1:
                    # Already asked once — user's response still has low groundedness.
                    # Don't repeat the same question.  Accept the LLM response and move on.
                    logger.info(
                        "SELF_CRITIQUE_GROUNDEDNESS_ACCEPT chat_id=%s diag_rev_count=%d "
                        "— proceeding with available info",
                        chat_id,
                        diag_rev_count,
                    )
                    ctx_sc.pop("diag_rev_count", None)
                    ctx_sc.pop("revision_critique", None)
                    state["context"] = ctx_sc

                else:
                    # Helpfulness / instruction gap — regenerate inline without
                    # asking the user for anything.
                    critique_hint = "; ".join(f"{d} score={scores[d]}" for d in low_dims)
                    revised_message = (
                        f"[Quality note: previous answer had low {critique_hint}. "
                        f"Regenerate: be more specific, concrete, and actionable. "
                        f"User question: {message[:200]}]\n\n{message}"
                    )
                    try:
                        raw2, parsed2 = await self._call_with_correction(
                            revised_message, state, None, tenant_id=resolved_tenant
                        )
                        if raw2 is not None and parsed2.get("reply"):
                            parsed = parsed2
                            logger.info(
                                "SELF_CRITIQUE_REVISED chat_id=%s diag_rev_count=%d",
                                chat_id,
                                diag_rev_count,
                            )
                    except Exception as exc:
                        logger.warning(
                            "SELF_CRITIQUE_REVISION_FAILED chat_id=%s error=%s",
                            chat_id,
                            exc,
                        )
            else:
                # Quality is acceptable — reset groundedness clarify counter.
                ctx_sc.pop("diag_rev_count", None)
                ctx_sc.pop("revision_critique", None)
                state["context"] = ctx_sc

        # RESOLVED hook: build UNS-structured WO draft and show preview.
        # Amend parsed["reply"] now so both history and formatted output include it.
        _wo_draft = None
        if state["state"] == "RESOLVED":
            try:
                _wo = build_uns_wo_from_state(state)
                _wo_draft = _wo.to_dict()
                _preview = format_wo_preview(_wo)
                parsed["reply"] = parsed.get("reply", "").rstrip() + "\n\n" + _preview
            except Exception as _woe:
                logger.error(
                    "WO_BUILD_ERROR chat_id=%s error=%s",
                    chat_id,
                    _woe,
                    exc_info=True,
                )
                # Diagnosis text is already in parsed["reply"]; append manual WO note
                diagnosis_summary = parsed.get("reply", "")[:300]
                parsed["reply"] = (
                    parsed.get("reply", "").rstrip()
                    + "\n\n"
                    + work_order_failure(diagnosis_summary)
                )

            # Recurring fault detection — annotate reply if same fault recurred
            try:
                _annotated, _pushed = await check_recurring_and_annotate(
                    self.db_path, state, parsed["reply"]
                )
                parsed["reply"] = _annotated
            except Exception as _rfe:
                logger.warning("RECURRING_FAULT check failed: %s", _rfe)

        ctx = state.get("context") or {}
        history = ctx.get("history", [])
        history.append({"role": "user", "content": message})
        history.append({"role": "assistant", "content": parsed["reply"]})
        if len(history) > HISTORY_LIMIT:
            history = history[-HISTORY_LIMIT:]
        ctx["history"] = history

        # Update session_context with latest question so off-topic replies can recap
        sc = ctx.get("session_context", {})
        if sc:
            sc["last_question"] = parsed["reply"][:200]
            sc["last_options"] = parsed.get("options", [])
            ctx["session_context"] = sc

        # Persist work-order draft so _handle_cmms_pending can use it next turn.
        if _wo_draft is not None:
            ctx["cmms_pending"] = True
            ctx["cmms_wo_draft"] = _wo_draft
            logger.info("CMMS_WO_PENDING chat_id=%s title=%r", chat_id, _wo_draft.get("title"))

        state["context"] = ctx

        self._save_state(chat_id, state)

        formatted = self._format_reply(parsed, user_message=message)
        # Phase 3 — prepend honest crawl-failure message if a prior doc-crawl exhausted.
        if _honest_prefix:
            formatted = _honest_prefix + formatted
        tl_flush()
        return self._make_result(
            formatted,
            self._infer_confidence(formatted),
            trace_id,
            state["state"],
        )

    # ------------------------------------------------------------------
    # CMMS work-order integration
    # ------------------------------------------------------------------

    _CMMS_YES = frozenset(
        {
            "yes",
            "yeah",
            "yep",
            "yup",
            "sure",
            "ok",
            "okay",
            "y",
            "log",
            "long",  # common typo for "log"
            "create",
            "submit",
            "confirm",
            "do it",
            "log it",
            "create it",
            "go ahead",
            "please",
            "1",
        }
    )

    def _build_wo_draft(self, state: dict) -> dict:
        """Construct work-order title/description/priority from resolved diagnostic state."""
        asset = (state.get("asset_identified") or "Unknown equipment")[:120]
        fault = state.get("fault_category") or "corrective"
        title = f"[MIRA] {asset[:60]} — {fault} action"

        ctx = state.get("context") or {}
        history = ctx.get("history", [])
        lines = []
        for turn in history[-6:]:
            role = (turn.get("role") or "").upper()
            content = (turn.get("content") or "")[:400]
            lines.append(f"{role}: {content}")
        summary = "\n".join(lines)

        description = (
            f"MIRA Diagnostic Session\n"
            f"Equipment: {asset}\n"
            f"Fault category: {fault}\n\n"
            f"Conversation summary:\n{summary}"
        )

        _HIGH_PRIORITY_FAULTS = {"power", "thermal", "hydraulic"}
        priority = "HIGH" if fault in _HIGH_PRIORITY_FAULTS else "MEDIUM"

        return {
            "title": title[:100],
            "description": description[:2000],
            "priority": priority,
            "asset_label": asset,
        }

    async def _post_cmms_work_order(self, wo: UNSWorkOrder) -> str:
        """Create work order in Atlas CMMS and Hub NeonDB. Returns confirmation string."""
        atlas_wo_id: str | None = None
        hub_wo_number: str | None = None

        # --- Atlas CMMS (via mira-mcp) ---
        client = AtlasCMMSClient(base_url=self.mcp_base_url, api_key=self.mcp_api_key)
        result = await client.create_work_order(
            title=wo.title,
            description=wo.to_atlas_description(),
            priority=wo.priority,
            asset_id=0,
            category=wo.wo_type,
        )
        if "error" in result:
            raise RuntimeError(result["error"])
        atlas_wo_id = str(result.get("id", "unknown"))

        # --- Hub NeonDB (fire-and-forget; failure doesn't block the reply) ---
        tenant_id = os.getenv("MIRA_TENANT_ID", wo.chat_id or "")
        if tenant_id:
            hub_result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: create_hub_work_order(
                    tenant_id=tenant_id,
                    user_id=wo.chat_id or "mira-bot",
                    title=wo.title,
                    description=wo.to_atlas_description(),
                    priority=wo.priority,
                    asset_name=wo.asset,
                    wo_number=f"MIRA-{atlas_wo_id}",
                    source="telegram_text",
                ),
            )
            if "error" not in hub_result:
                hub_wo_number = hub_result.get("work_order_number", "")
            else:
                logger.warning("Hub NeonDB WO write skipped: %s", hub_result["error"])

        label = hub_wo_number or f"#{atlas_wo_id}"
        return f"Work order {label} created for {wo.asset or 'equipment'} ✓"

    _CMMS_NO = frozenset({"no", "nope", "n", "skip", "cancel", "abort", "never mind", "nevermind"})

    async def _handle_cmms_pending(
        self,
        chat_id: str,
        message: str,
        state: dict,
        trace_id: str,
    ) -> dict:
        """Handle tech response to WO preview: yes/no, edit instructions, or missing-field supply."""
        ctx = state.get("context") or {}
        wo_draft = ctx.get("cmms_wo_draft", {})

        msg_lower = message.strip().lower()
        is_yes = msg_lower in self._CMMS_YES or any(
            w in msg_lower for w in self._CMMS_YES if len(w) > 3
        )
        is_no = msg_lower in self._CMMS_NO or any(
            w in msg_lower for w in self._CMMS_NO if len(w) > 3
        )

        # Check for edit instructions before yes/no — edits keep cmms_pending alive.
        if not is_yes and not is_no:
            edited = apply_wo_edit(wo_draft, message)
            if edited is not None:
                ctx["cmms_wo_draft"] = edited
                state["context"] = ctx
                self._save_state(chat_id, state)
                wo = UNSWorkOrder(**edited)
                reply = "Updated.\n\n" + format_wo_preview(wo)
                self._record_exchange(chat_id, state, message, reply)
                tl_flush()
                return self._make_result(reply, "none", trace_id, "RESOLVED")

            # No yes/no and no recognised edit — fill missing fields in order.
            if not wo_draft.get("asset") and message.strip():
                ctx["cmms_wo_draft"] = {**wo_draft, "asset": message.strip()[:80]}
                state["context"] = ctx
                self._save_state(chat_id, state)
                wo = UNSWorkOrder(**ctx["cmms_wo_draft"])
                reply = "Got it — asset set.\n\n" + format_wo_preview(wo)
                self._record_exchange(chat_id, state, message, reply)
                tl_flush()
                return self._make_result(reply, "none", trace_id, "RESOLVED")

            if not wo_draft.get("fault_description") and message.strip():
                ctx["cmms_wo_draft"] = {**wo_draft, "fault_description": message.strip()[:500]}
                state["context"] = ctx
                self._save_state(chat_id, state)
                wo = UNSWorkOrder(**ctx["cmms_wo_draft"])
                reply = "Got it — fault description noted.\n\n" + format_wo_preview(wo)
                self._record_exchange(chat_id, state, message, reply)
                tl_flush()
                return self._make_result(reply, "none", trace_id, "RESOLVED")

            # Unrecognised input — re-show the preview rather than silently
            # treating it as "no" (which would discard the WO draft).
            ctx["cmms_pending"] = True
            state["context"] = ctx
            self._save_state(chat_id, state)
            wo = UNSWorkOrder(**wo_draft)
            reply = (
                "Say **yes** to log this work order, **no** to cancel, "
                "or correct any field (e.g. *asset is Pump A3*).\n\n"
            ) + format_wo_preview(wo)
            self._record_exchange(chat_id, state, message, reply)
            tl_flush()
            return self._make_result(reply, "none", trace_id, "RESOLVED")

        # Consume the pending state now that we have a definitive yes/no.
        ctx.pop("cmms_wo_draft", None)
        ctx.pop("cmms_pending", None)
        state["context"] = ctx

        if is_yes and wo_draft:
            wo = UNSWorkOrder(**wo_draft)

            # Validation gate — must have asset, title, fault_description.
            if not wo.is_valid:
                missing = wo.missing_fields
                ctx["cmms_pending"] = True
                ctx["cmms_wo_draft"] = wo_draft
                state["context"] = ctx
                self._save_state(chat_id, state)
                lines = ["I need a few more details before I can log this:"]
                lines += [f"• {f.replace('_', ' ').title()}" for f in missing]
                if "asset" in missing:
                    lines.append(
                        "\nWhat asset is this for? (e.g. *GS10 VFD on Line 1* or *Pump A3*)"
                    )
                lines.append("\nProvide the missing info or say *skip* to cancel.")
                reply = "\n".join(lines)
                self._record_exchange(chat_id, state, message, reply)
                tl_flush()
                return self._make_result(reply, "none", trace_id, "RESOLVED")

            try:
                reply = await self._post_cmms_work_order(wo)
                log_uns_event(wo)
                logger.info(
                    "CMMS_WO_CREATED chat_id=%s title=%r uns=%s", chat_id, wo.title, wo.uns_topic
                )
                wo_id = reply.split("#")[1].split()[0] if "#" in reply else "?"
                asyncio.ensure_future(
                    push_wo_created(
                        wo_id=wo_id, asset=wo.asset, tech_name=wo.technician_id or chat_id
                    )
                )
                # PM suggestion — append to reply and arm pending state
                pm = suggest_followup_pm(state.get("fault_category", ""), wo.asset or "")
                if pm:
                    reply = reply.rstrip() + "\n\n" + pm.prompt_text()
                    ctx["pm_suggestion_pending"] = {
                        "action": pm.action,
                        "days": pm.days,
                        "asset": pm.asset,
                        "fault_category": pm.fault_category,
                    }
                    state["context"] = ctx
                    self._save_state(chat_id, state)
            except Exception as e:
                logger.error("CMMS WO creation failed for %s: %s", chat_id, e)
                reply = (
                    "I wasn't able to create the work order — please log it manually. "
                    "The diagnosis is complete."
                )
        else:
            reply = "Understood — no work order logged. Let me know if you need anything else."

        self._record_exchange(chat_id, state, message, reply)
        tl_flush()
        return self._make_result(reply, "none", trace_id, "RESOLVED")

    async def _handle_pm_suggestion_pending(
        self, chat_id: str, message: str, state: dict, trace_id: str
    ) -> dict:
        """Handle user response to a PM follow-up suggestion."""
        ctx = state.get("context") or {}
        pm_data = ctx.pop("pm_suggestion_pending", {})
        state["context"] = ctx

        if is_pm_acceptance(message):
            pm = PMSuggestion(
                fault_category=pm_data.get("fault_category", ""),
                action=pm_data.get("action", "Follow-up inspection"),
                days=pm_data.get("days", 30),
                asset=pm_data.get("asset", ""),
            )
            try:
                _cmms = AtlasCMMSClient(base_url=self.mcp_base_url, api_key=self.mcp_api_key)
                result = await _cmms.create_work_order(
                    title=pm.wo_title(),
                    description=pm.wo_description(),
                    priority="LOW",
                    category="PREVENTIVE",
                )
                wo_id = result.get("id", "?")
                reply = (
                    f"Done — PM work order #{wo_id} scheduled: *{pm.action}* within {pm.days} days."
                )
                logger.info("PM_WO created wo_id=%s asset=%r", wo_id, pm.asset)
            except Exception as exc:
                logger.error("PM_WO creation failed: %s", exc)
                reply = (
                    f"I couldn't create the PM automatically — please add "
                    f"*{pm.action}* (due in {pm.days} days) to your CMMS manually."
                )
        else:
            reply = "No problem — skipping the PM for now. Let me know if you need anything else."

        self._save_state(chat_id, state)
        self._record_exchange(chat_id, state, message, reply)
        tl_flush()
        return self._make_result(reply, "none", trace_id, "RESOLVED")

    def reset(self, chat_id: str) -> None:
        """Reset conversation to IDLE state."""
        self._clear_session_photo(chat_id)
        db = sqlite3.connect(self.db_path)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("DELETE FROM conversation_state WHERE chat_id = ?", (chat_id,))
        db.commit()
        db.close()

    def log_feedback(self, chat_id: str, feedback: str, reason: str = "") -> None:
        state = self._load_state(chat_id)
        history = state.get("context", {}).get("history", [])
        last_reply = next(
            (e["content"] for e in reversed(history) if e.get("role") == "assistant"), ""
        )
        db = sqlite3.connect(self.db_path)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute(
            "INSERT INTO feedback_log (chat_id, feedback, reason, last_reply, exchange_count) VALUES (?,?,?,?,?)",
            (chat_id, feedback, reason, last_reply, state.get("exchange_count", 0)),
        )
        db.commit()
        db.close()
        logger.warning("FEEDBACK [%s] feedback=%s reason=%r", chat_id, feedback, reason)

    # ------------------------------------------------------------------
    # State management
    # ------------------------------------------------------------------

    async def _handle_nameplate(
        self,
        chat_id: str,
        photo_b64: str,
        state: dict,
        ctx: dict,
        message: str,
        resolved_tenant: str,
    ) -> str:
        """Run the full nameplate flow: extract fields → create Atlas asset → seed knowledge.

        Returns the reply string to send back to the user.
        """
        # 1. Extract structured fields from the nameplate photo
        try:
            fields = await self.nameplate.extract(photo_b64)
        except Exception as e:
            logger.error("nameplate extract failed: %s", e)
            fields = {}

        if "parse_error" in fields:
            logger.warning("nameplate parse_error: %s", fields["parse_error"])
            fields = {}

        manufacturer = fields.get("manufacturer") or "Unknown"
        model = fields.get("model") or "Unknown"

        # 2. Create Atlas CMMS asset via mira-mcp REST
        mcp_headers = {"Content-Type": "application/json"}
        if self.mcp_api_key:
            mcp_headers["Authorization"] = f"Bearer {self.mcp_api_key}"

        mcp_payload = {
            "tenant_id": resolved_tenant,
            "manufacturer": manufacturer,
            "model": model,
            "serial": fields.get("serial") or "",
            "voltage": fields.get("voltage") or "",
            "hp": fields.get("hp") or "",
            "fla": fields.get("fla") or "",
        }

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                mcp_resp = await client.post(
                    f"{self.mcp_base_url}/api/cmms/nameplate",
                    json=mcp_payload,
                    headers=mcp_headers,
                )
                mcp_resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            logger.error(
                "nameplate mcp call HTTP %d: %s",
                e.response.status_code,
                e.response.text[:200],
            )
        except Exception as e:
            logger.error("nameplate mcp call failed: %s", e)

        # 3. Seed tenant knowledge via mira-web
        linked_chunks = 0
        web_headers = {"Content-Type": "application/json"}
        if self.mcp_api_key:
            web_headers["Authorization"] = f"Bearer {self.mcp_api_key}"

        web_payload = {
            "tenant_id": resolved_tenant,
            "nameplate": {
                "manufacturer": manufacturer,
                "modelNumber": model,
                "serial": fields.get("serial") or "",
                "voltage": fields.get("voltage") or "",
                "fla": fields.get("fla") or "",
                "hp": fields.get("hp") or "",
            },
        }

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                web_resp = await client.post(
                    f"{self.web_base_url}/api/provision/nameplate",
                    json=web_payload,
                    headers=web_headers,
                )
                web_resp.raise_for_status()
                web_data = web_resp.json()
                linked_chunks = web_data.get("linkedChunks", 0)
        except httpx.HTTPStatusError as e:
            logger.error(
                "nameplate web call HTTP %d: %s",
                e.response.status_code,
                e.response.text[:200],
            )
        except Exception as e:
            logger.error("nameplate web call failed: %s", e)

        # 4. Update session state with nameplate data
        ctx["session_context"] = {
            "equipment_type": f"{manufacturer} {model}",
            "manufacturer": manufacturer,
            "last_question": None,
            "last_options": [],
        }
        state["asset_identified"] = f"{manufacturer}, {model}"
        state["context"] = ctx

        history = ctx.get("history", [])
        history.append({"role": "user", "content": message})
        reply = (
            f"Asset registered: {manufacturer} {model} — "
            f"linked to {linked_chunks} OEM manual chunks. "
            f"Ask me anything about this equipment."
        )
        history.append({"role": "assistant", "content": reply})
        if len(history) > HISTORY_LIMIT:
            history = history[-HISTORY_LIMIT:]
        ctx["history"] = history
        state["context"] = ctx

        logger.info(
            "NAMEPLATE_FLOW tenant=%s manufacturer=%s model=%s linked_chunks=%d",
            resolved_tenant,
            manufacturer,
            model,
            linked_chunks,
        )
        return reply

    async def _self_critique_diagnosis(self, reply: str, user_question: str, chat_id: str) -> dict:
        """Score a DIAGNOSIS reply on 3 quality dimensions via the router cascade.

        Returns a dict mapping dimension name → score (1-5), e.g.:
            {"groundedness": 4, "helpfulness": 2, "instruction_following": 3}

        Returns {} on any failure — always fails open so that a judge error never
        blocks a response from reaching the user.
        """
        if not self.router.enabled:
            return {}
        prompt = _CRITIQUE_PROMPT.format(
            question=user_question[:300],
            response=reply[:600],
        )
        try:
            text, _ = await self.router.complete(
                [{"role": "user", "content": prompt}],
                max_tokens=256,
                session_id=f"{chat_id}_critique",
            )
        except Exception as exc:
            logger.warning("SELF_CRITIQUE_CALL_FAILED chat_id=%s error=%s", chat_id, exc)
            return {}

        if not text:
            return {}

        try:
            # Strip markdown fences if present
            clean = re.sub(r"```(?:json)?\s*|\s*```", "", text).strip()
            data = json.loads(clean)
            return {
                dim: int(data[dim]["score"])
                for dim in ("groundedness", "helpfulness", "instruction_following")
                if dim in data and isinstance(data[dim], dict) and "score" in data[dim]
            }
        except Exception as exc:
            logger.warning(
                "SELF_CRITIQUE_PARSE_FAILED chat_id=%s error=%s text=%r",
                chat_id,
                exc,
                text[:120],
            )
            return {}

    async def _call_with_correction(
        self,
        message: str,
        state: dict,
        photo_b64: str = None,
        tenant_id: str | None = None,
    ) -> tuple:
        """Call RAG worker with self-corrective retry.

        Returns (raw, parsed) on success, (None, {"reply": error_msg}) on failure.
        If first response is not grounded and Nemotron is enabled, rewrites
        query and retries once (max 2 attempts).

        Args:
            tenant_id: Resolved per-call tenant to forward to RAGWorker.process().
        """
        max_attempts = 1 if photo_b64 else (2 if self.nemotron.enabled else 1)
        query = message

        for attempt in range(max_attempts):
            try:
                raw = await self.rag.process(
                    query,
                    state,
                    photo_b64=photo_b64,
                    vision_model=self.vision_model,
                    tenant_id=tenant_id,
                )
            except Exception as e:
                logger.error("LLM call failed (rag worker): %s", e)
                return None, {"reply": f"MIRA error: {e}"}

            parsed = self._parse_response(raw)

            # Check grounding: did we get sources and does response reference them?
            if self._is_grounded(parsed, self.rag._last_sources):
                return raw, parsed

            # Not grounded on first attempt — rewrite and retry
            if attempt == 0 and max_attempts > 1:
                logger.info("SELF_CORRECT attempt=1 — rewriting query")
                query = await self.nemotron.rewrite_query(
                    query=message,
                    context=state.get("asset_identified", ""),
                )

        return raw, parsed

    async def _handle_session_followup(
        self,
        message: str,
        state: dict,
        chat_id: str,
        session_photo: str = None,
        tenant_id: str | None = None,
        honest_prefix: str = "",
    ) -> dict:
        """Route a session follow-up through the RAG pipeline without intent filtering.

        Returns a dict via _make_result() — must match process_full() return type.
        """
        raw, parsed = await self._call_with_correction(
            message, state, photo_b64=session_photo, tenant_id=tenant_id
        )
        if raw is None:
            self._save_state(chat_id, state)
            return self._make_result(parsed["reply"], "none", None, state["state"])

        parsed["reply"] = check_output(
            parsed["reply"],
            "industrial",
            has_photo=bool(session_photo),
        )
        state = self._advance_state(state, parsed)

        ctx = state.get("context") or {}
        history = ctx.get("history", [])
        history.append({"role": "user", "content": message})
        history.append({"role": "assistant", "content": parsed["reply"]})
        if len(history) > HISTORY_LIMIT:
            history = history[-HISTORY_LIMIT:]
        ctx["history"] = history

        sc = ctx.get("session_context", {})
        if sc:
            sc["last_question"] = parsed["reply"][:200]
            sc["last_options"] = parsed.get("options", [])
            ctx["session_context"] = sc

        state["context"] = ctx
        self._save_state(chat_id, state)
        formatted = self._format_reply(parsed, user_message=message)
        if honest_prefix:
            formatted = honest_prefix + formatted
        return self._make_result(
            formatted,
            self._infer_confidence(formatted),
            None,
            state["state"],
        )

    # ------------------------------------------------------------------
    # Manual-lookup gathering subroutine
    # ------------------------------------------------------------------

    async def _enter_manual_lookup_gathering(
        self,
        chat_id: str,
        message: str,
        state: dict,
        trace_id: str,
        initial_vendor: str,
    ) -> dict:
        """Set FSM to MANUAL_LOOKUP_GATHERING and ask for the first missing field."""
        ctx = state.get("context") or {}
        gathered: dict = {}
        if initial_vendor:
            gathered["vendor"] = initial_vendor

        ctx["manual_lookup_gathering"] = {
            "collected": gathered,
            "attempts": 0,
            "prior_state": state["state"],
        }
        state["state"] = "MANUAL_LOOKUP_GATHERING"
        state["context"] = ctx
        self._save_state(chat_id, state)

        if not initial_vendor:
            reply = (
                "I want to find that manual for you. "
                "What's the **brand or manufacturer**? "
                "(You can also say 'back to troubleshooting' anytime.)"
            )
        else:
            reply = (
                f"Got it — {initial_vendor}. "
                "What's the **exact model number**? "
                "It's usually printed on the nameplate. "
                "(Say 'skip' to try with what I have, or 'back to troubleshooting' "
                "to drop the manual search.)"
            )

        logger.info(
            "MANUAL_LOOKUP_GATHERING_ENTER chat_id=%s vendor=%r model=None attempts=0",
            chat_id,
            initial_vendor or "",
        )
        self._record_exchange(chat_id, state, message, reply)
        tl_flush()
        return self._make_result(reply, "none", trace_id, "MANUAL_LOOKUP_GATHERING")

    async def _handle_manual_lookup_gathering(
        self,
        chat_id: str,
        message: str,
        state: dict,
        trace_id: str,
        resolved_tenant: str,
    ) -> dict | None:
        """Handle a user turn while FSM is in MANUAL_LOOKUP_GATHERING.

        Returns a reply dict when the subroutine handles the turn fully.
        Returns None when a diagnosis signal is detected — caller should restore
        prior state and fall through to normal diagnostic processing.
        Never raises.
        """
        ctx = state.get("context") or {}
        gathering = ctx.get("manual_lookup_gathering", {})
        collected: dict = gathering.get("collected", {})
        attempts: int = gathering.get("attempts", 0)
        prior_state: str = gathering.get("prior_state", "IDLE")

        msg_lower = message.lower().strip()

        # ---- Escape detection --------------------------------------------------
        # Pure diagnosis signals → return None so process_full falls through.
        has_diagnosis_signal = bool(_DIAGNOSIS_SIGNAL_RE.search(message))
        # Explicit escape phrases.
        has_escape_phrase = any(phrase in msg_lower for phrase in _MANUAL_ESCAPE_PHRASES)

        if has_diagnosis_signal and not has_escape_phrase:
            # User is describing a fault, not answering our question.  Restore state
            # silently so the normal diagnostic flow handles this turn.
            ctx.pop("manual_lookup_gathering", None)
            state["state"] = prior_state
            state["context"] = ctx
            self._save_state(chat_id, state)
            logger.info(
                "MANUAL_LOOKUP_GATHERING_ESCAPED chat_id=%s reason=diagnosis_signal",
                chat_id,
            )
            return None  # fall through

        if has_escape_phrase:
            ctx.pop("manual_lookup_gathering", None)
            state["state"] = prior_state
            state["context"] = ctx
            self._save_state(chat_id, state)
            logger.info(
                "MANUAL_LOOKUP_GATHERING_ESCAPED chat_id=%s reason=user_said_back",
                chat_id,
            )
            reply = "OK, back to the diagnosis. What fault or symptom were you seeing?"
            self._record_exchange(chat_id, state, message, reply)
            tl_flush()
            return self._make_result(reply, "none", trace_id, prior_state)

        # ---- Extract info from this turn ----------------------------------------
        new_vendor = vendor_name_from_text(message) or ""
        new_model = _looks_like_model_number(message)

        # If we're already waiting for the model specifically (vendor in hand) and
        # _looks_like_model_number found nothing, accept any short non-stopword token.
        # This covers user answers like "525" or just "PNOZ-X3".
        if not new_model and collected.get("vendor"):
            _STOP = {
                "the",
                "a",
                "an",
                "is",
                "it",
                "its",
                "my",
                "our",
                "for",
                "that",
                "this",
                "model",
                "number",
                "type",
                "unit",
            }
            for tok in message.split():
                tok_clean = re.sub(r"[^\w-]", "", tok).strip()
                if len(tok_clean) >= 2 and tok_clean.lower() not in _STOP:
                    new_model = tok_clean
                    break

        if new_vendor and not collected.get("vendor"):
            collected["vendor"] = new_vendor
        if new_model and not collected.get("model"):
            collected["model"] = new_model

        gathered_vendor = collected.get("vendor", "")
        gathered_model = collected.get("model", "")
        logger.info(
            "MANUAL_LOOKUP_GATHERING_PROVIDED chat_id=%s vendor=%r model=%r",
            chat_id,
            gathered_vendor,
            gathered_model,
        )

        # ---- Now specific enough → proceed to KB pre-check + crawl ----------------
        if gathered_vendor and gathered_model:
            ctx.pop("manual_lookup_gathering", None)
            state["state"] = prior_state
            state["context"] = ctx
            return await self._do_documentation_lookup(
                chat_id,
                message,
                state,
                trace_id,
                resolved_tenant,
                vendor_override=gathered_vendor,
                model_override=gathered_model,
            )

        # ---- Still missing info — ask for next field or give up ------------------
        attempts += 1
        gathering["collected"] = collected
        gathering["attempts"] = attempts
        ctx["manual_lookup_gathering"] = gathering
        state["context"] = ctx

        if attempts >= 2:
            # Give up — proceed with whatever we have.
            logger.info(
                "MANUAL_LOOKUP_GATHERING_GAVE_UP chat_id=%s attempts=%d",
                chat_id,
                attempts,
            )
            ctx.pop("manual_lookup_gathering", None)
            state["state"] = prior_state
            state["context"] = ctx
            return await self._do_documentation_lookup(
                chat_id,
                message,
                state,
                trace_id,
                resolved_tenant,
                vendor_override=gathered_vendor,
                low_confidence=True,
            )

        # Ask for the next missing piece.
        self._save_state(chat_id, state)
        if not gathered_vendor:
            reply = (
                "I want to find that manual for you. "
                "What's the **brand or manufacturer**? "
                "(You can also say 'back to troubleshooting' anytime.)"
            )
        else:
            reply = (
                f"Got it — {gathered_vendor}. "
                "What's the **exact model number**? "
                "It's usually printed on the nameplate. "
                "(Say 'skip' to try with what I have, or 'back to troubleshooting' "
                "to drop the manual search.)"
            )

        self._record_exchange(chat_id, state, message, reply)
        tl_flush()
        return self._make_result(reply, "none", trace_id, "MANUAL_LOOKUP_GATHERING")

    # ------------------------------------------------------------------
    # Conversation Router handler stubs
    # ------------------------------------------------------------------

    def _format_simple_response(self, text: str, suggestions: list[str] | None = None) -> str:
        """Format a response with contextual suggestion chips."""
        if not suggestions:
            suggestions = ["Diagnose equipment", "Find documentation", "Log work order"]
        chip_text = "\n\n---\n" + " | ".join(f"*{s}*" for s in suggestions)
        return text + chip_text

    def _greeting_response(self, state: dict, chat_id: str, trace_id: str) -> dict:
        """Handle greetings without disrupting an active session."""
        fsm = state.get("state", "IDLE")
        asset = state.get("asset_identified", "")

        if fsm not in ("IDLE", "ASSET_IDENTIFIED") and asset:
            # Mid-diagnostic — don't reset, just acknowledge
            reply = self._format_simple_response(
                f"Hey! Still here — we were in the middle of diagnosing {asset}. "
                "Ready to keep going, or do you need something else?",
                suggestions=["Continue diagnosis", "Log a work order", "Switch equipment"],
            )
        elif asset:
            reply = self._format_simple_response(
                f"Hey! I\u2019m still tracking {asset}. What can I help with?",
                suggestions=[
                    "Continue diagnosis",
                    "Find manual for this equipment",
                    "Log a work order",
                ],
            )
        else:
            reply = self._format_simple_response(
                "Hey! I\u2019m MIRA \u2014 your maintenance copilot. What are you working on?",
                suggestions=["Troubleshoot equipment", "Find a manual", "Log a work order"],
            )
        self._record_exchange(chat_id, state, "", reply)
        tl_flush()
        return self._make_result(reply, "none", trace_id, fsm)

    # Keywords that suggest the question needs equipment-specific RAG lookup
    _SPEC_KEYWORDS = frozenset(
        "torque spec parameter setting resistance voltage current ampere rpm frequency "
        "hz setpoint acceleration deceleration boost carrier fault code alarm reset".split()
    )

    async def _handle_general_question(
        self, chat_id: str, message: str, state: dict, trace_id: str
    ) -> dict:
        """Answer a general industrial question — uses RAG for equipment-specific specs."""
        asset = state.get("asset_identified", "")
        msg_lower = message.lower()
        needs_rag = asset and any(kw in msg_lower for kw in self._SPEC_KEYWORDS)

        raw = ""
        if needs_rag:
            try:
                raw_resp = await self.rag.process(message, state, photo_b64=None, tenant_id=None)
                parsed = self._parse_response(raw_resp)
                raw = parsed.get("reply", "") if parsed else ""
            except Exception as exc:
                logger.warning("GENERAL_QUESTION_RAG_FAILURE error=%s — falling back to LLM", exc)

        if not raw:
            asset_ctx = f" The current equipment is: {asset}." if asset else ""
            system = (
                "You are MIRA, an industrial maintenance assistant."
                f"{asset_ctx} "
                "Answer this question concisely and accurately using your training knowledge. "
                "Keep the reply under 120 words."
            )
            try:
                raw = await self._call_llm_direct(message, system=system)
            except Exception as exc:
                logger.warning("GENERAL_QUESTION_LLM_FAILURE error=%s", exc)
                raw = "I can help with that — could you give me a bit more context?"

        reply = self._format_simple_response(
            raw,
            suggestions=[
                "Diagnose a specific machine",
                "Find documentation",
                "Log a work order",
            ],
        )
        self._record_exchange(chat_id, state, message, reply)
        tl_flush()
        return self._make_result(
            reply, self._infer_confidence(raw), trace_id, state.get("state", "IDLE")
        )

    async def _handle_asset_switch(
        self, chat_id: str, message: str, state: dict, trace_id: str
    ) -> dict:
        """User wants to talk about a different asset — clear FSM, preserve session memory."""
        old_asset = state.get("asset_identified", "") or "unknown"

        # Try to identify the new asset from the switch message itself
        new_asset = vendor_name_from_text(message) or ""

        logger.info(
            "ASSET_SWITCH chat_id=%s from=%r to=%r",
            chat_id,
            old_asset,
            new_asset or "unidentified",
        )

        state["state"] = "IDLE"
        state["asset_identified"] = new_asset
        ctx = state.get("context") or {}
        # Clear active diagnostic context but keep session_memory for cross-session recall
        ctx.pop("session_context", None)
        ctx.pop("cmms_pending", None)
        ctx.pop("cmms_wo_draft", None)
        ctx.pop("pending_doc_job", None)
        state["context"] = ctx
        self._save_state(chat_id, state)

        if new_asset:
            reply = self._format_simple_response(
                f"Switching to {new_asset} — what's going on with it?",
                suggestions=["Describe the fault", "Upload a nameplate photo", "Find the manual"],
            )
        else:
            reply = self._format_simple_response(
                "Got it \u2014 switching to a new asset. What equipment do you need help with?",
                suggestions=[
                    "Describe the machine",
                    "Scan the QR code",
                    "Upload a nameplate photo",
                ],
            )
        self._record_exchange(chat_id, state, message, reply)
        tl_flush()
        return self._make_result(reply, "none", trace_id, "IDLE")

    @staticmethod
    def _parse_asset_fault_from_message(message: str) -> tuple[str, str]:
        """Extract (asset, fault_description) from a cold WO creation message.

        Handles common patterns:
        - "create a work order for Pump 7 — leaking seal on discharge side"
        - "log a WO for GS10 VFD on Line 1: overheating on startup"
        - "I need a work order for cooling tower motor, vibrating badly"
        """
        msg = message.strip()
        for sep in [" — ", " – ", " - ", ": ", ", "]:
            if sep not in msg:
                continue
            idx = msg.index(sep)
            pre, fault = msg[:idx], msg[idx + len(sep):].strip()
            m = re.search(r"\bfor\s+(.{3,}?)$", pre, re.IGNORECASE)
            if m:
                asset = m.group(1).strip()
                if not re.match(r"^a?\s*work\s+order", asset, re.IGNORECASE):
                    return asset[:80], fault[:500]
        m = re.search(
            r"\bfor\s+((?!a?\s*work\s+order).{3,80}?)(?:\s*[—–\-:,].*)?$",
            msg,
            re.IGNORECASE,
        )
        if m:
            return m.group(1).strip()[:80], ""
        return "", ""

    async def _handle_wo_request(
        self, chat_id: str, message: str, state: dict, trace_id: str
    ) -> dict:
        """Router detected 'log_work_order' intent — build WO draft from context + message."""
        # Parse asset + fault from the message itself (cold "create WO for X — Y" pattern).
        parsed_asset, parsed_fault = self._parse_asset_fault_from_message(message)

        wo = build_uns_wo_from_state(state)

        # Overlay parsed values so a cold "create WO for Pump 7 — leaking seal" message
        # produces a fully pre-filled draft without requiring prior Q1→DIAGNOSIS flow.
        if parsed_asset:
            wo.asset = parsed_asset
            wo.title = f"[MIRA] {parsed_asset[:60]} — corrective action"
        if parsed_fault and not wo.fault_description:
            wo.fault_description = parsed_fault

        wo.chat_id = chat_id
        wo.fsm_state_at_creation = state.get("state", "IDLE")
        wo_dict = wo.to_dict()
        ctx = state.get("context") or {}
        ctx["cmms_pending"] = True
        ctx["cmms_wo_draft"] = wo_dict
        state["context"] = ctx
        self._save_state(chat_id, state)
        preview = format_wo_preview(wo)
        self._record_exchange(chat_id, state, message, preview)
        tl_flush()
        return self._make_result(preview, "none", trace_id, state.get("state", "IDLE"))

    async def _handle_check_equipment_history(
        self, chat_id: str, message: str, state: dict, trace_id: str
    ) -> dict:
        """Return recent interaction history for the current asset (Short #9)."""
        asset = state.get("asset_identified", "")
        rows: list[dict] = []
        try:
            db = sqlite3.connect(self.db_path)
            cur = db.cursor()
            if asset:
                cur.execute(
                    """
                    SELECT created_at, fsm_state, intent, user_message, bot_response
                    FROM interactions
                    WHERE chat_id = ?
                      AND (user_message LIKE ? OR bot_response LIKE ?)
                    ORDER BY created_at DESC
                    LIMIT 5
                    """,
                    (chat_id, f"%{asset[:30]}%", f"%{asset[:30]}%"),
                )
            else:
                cur.execute(
                    """
                    SELECT created_at, fsm_state, intent, user_message, bot_response
                    FROM interactions
                    WHERE chat_id = ?
                    ORDER BY created_at DESC
                    LIMIT 5
                    """,
                    (chat_id,),
                )
            rows = [
                {
                    "created_at": r[0],
                    "fsm_state": r[1],
                    "intent": r[2],
                    "user_message": r[3],
                    "bot_response": r[4],
                }
                for r in cur.fetchall()
            ]
            db.close()
        except Exception as exc:
            logger.warning("HISTORY_QUERY_FAILURE error=%s", exc)

        if not rows:
            subject = f"this {asset}" if asset else "this equipment"
            reply_text = (
                f"No previous interactions found for {subject} in this session. "
                "This might be the first time it's been diagnosed here."
            )
        else:
            subject = asset or "this equipment"
            lines = [f"Last {len(rows)} interactions for {subject}:\n"]
            for r in rows:
                ts = str(r["created_at"])[:16]
                snippet = str(r["user_message"])[:80].replace("\n", " ")
                lines.append(f'• {ts} — {r["fsm_state"] or "?"} — "{snippet}"')
            reply_text = "\n".join(lines)

        reply = self._format_simple_response(
            reply_text,
            suggestions=["Continue diagnosis", "Log a work order", "Find documentation"],
        )
        self._record_exchange(chat_id, state, message, reply)
        tl_flush()
        return self._make_result(reply, "none", trace_id, state.get("state", "IDLE"))

    async def _handle_documentation_intent(
        self,
        chat_id: str,
        message: str,
        state: dict,
        trace_id: str,
        resolved_tenant: str,
    ) -> dict:
        """Router-dispatched doc intent — delegates to the existing specificity-gate path."""
        combined = f"{message} {state.get('asset_identified', '')}".strip()
        mfr = vendor_name_from_text(combined) or ""
        if not self._is_doc_specific(mfr, combined):
            return await self._enter_manual_lookup_gathering(chat_id, message, state, trace_id, mfr)
        return await self._do_documentation_lookup(
            chat_id, message, state, trace_id, resolved_tenant, vendor_override=mfr
        )

    async def _call_llm_direct(self, message: str, system: str = "") -> str:
        """One-shot LLM call via the existing inference router. Returns plain text."""
        messages: list[dict] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": message})
        raw, _usage = await self.router.complete(messages, max_tokens=300)
        return raw.strip() if raw else "I'm not sure — can you give me more context?"

    async def _do_documentation_lookup(
        self,
        chat_id: str,
        message: str,
        state: dict,
        trace_id: str,
        resolved_tenant: str,
        *,
        vendor_override: str = "",
        model_override: str = "",
        low_confidence: bool = False,
    ) -> dict:
        """Phase 2 KB pre-check + async crawl trigger.

        Consolidated from the old in-line documentation intent block so both the
        direct (specific request) path and the gathering subroutine share one code path.
        Never raises.
        """
        asset = state.get("asset_identified", "")
        combined = " ".join(filter(None, [vendor_override, model_override, message, asset])).strip()
        mfr = vendor_override or vendor_name_from_text(combined) or ""
        url = vendor_support_url(combined)

        # Phase 2 — KB pre-check: skip crawl when we already have coverage.
        kb_covered, kb_reason = kb_has_coverage(mfr, combined, resolved_tenant or "")
        if kb_covered:
            reply = (
                "I already have documentation indexed for that equipment — just "
                "ask me about fault codes, specs, or wiring and I'll pull from "
                "it directly."
            )
            logger.info(
                "KB_PRE_CHECK_HIT chat_id=%s manufacturer=%r reason=%s",
                chat_id,
                mfr,
                kb_reason,
            )
            self._record_exchange(chat_id, state, message, reply)
            tl_flush()
            return self._make_result(reply, "medium", trace_id, state["state"])

        # KB miss — queue crawl and store pending marker for honest-failure check.
        logger.info(
            "KB_PRE_CHECK_MISS chat_id=%s manufacturer=%r reason=%s — queuing crawl",
            chat_id,
            mfr,
            kb_reason,
        )
        low_conf_note = ""
        if low_confidence:
            low_conf_note = (
                f"\n\nI tried with what I had ({mfr or 'no vendor'} / "
                f"{model_override or 'no model'}). "
                "If you can grab the model number from the nameplate, I'll have "
                "a much better shot."
            )
        if url:
            reply = (
                f"I don't have documentation for that equipment in my knowledge "
                f"base yet.\n\n"
                f"You can find it here: {url}\n\n"
                f"I've queued a crawl to pull the manual automatically — ask me "
                f"again in a couple of minutes and I'll have more specific "
                f"information.{low_conf_note}"
            )
        else:
            reply = (
                "I don't have documentation for that equipment in my knowledge "
                "base yet.\n\n"
                "Try searching the manufacturer's website for the model number "
                "and document type.\n\n"
                f"I've queued a search — ask me again shortly.{low_conf_note}"
            )

        ctx = state.get("context") or {}
        ctx["pending_doc_job"] = {
            "vendor": mfr,
            "query": combined[:120],
            "queued_at": datetime.now(timezone.utc).isoformat(),
        }
        state["context"] = ctx
        # KB miss → exit Q-state loop and return to IDLE so the technician can ask
        # something else while the crawl runs. Without this, the FSM gets stuck in
        # whatever Q-state triggered the lookup (pilz_11, dist_36 fixtures).
        state["state"] = "IDLE"
        asyncio.create_task(self._fire_scrape_trigger(message, mfr, resolved_tenant or "", chat_id))
        logger.info(
            "DOC_INTENT_ROUTING chat_id=%s manufacturer=%r support_url=%s",
            chat_id,
            mfr,
            url,
        )
        self._record_exchange(chat_id, state, message, reply)
        tl_flush()
        return self._make_result(reply, "low", trace_id, state["state"])

    async def _check_pending_doc_job(self, chat_id: str, state: dict) -> str:
        """Check if a previous doc-crawl job for this chat finished with exhausted fallback.

        Returns an honest-failure prefix string to prepend to the reply, or "" if
        there is nothing to report (still pending, succeeded, or no job queued).
        Clears the pending marker from state on any terminal outcome.
        Never raises — failures are non-fatal.
        """
        ctx = state.get("context") or {}
        pending = ctx.get("pending_doc_job")
        if not pending:
            return ""

        # Expire stale pending markers after 30 minutes — crawl cannot still be running
        queued_at_str = pending.get("queued_at", "")
        try:
            queued_at = datetime.fromisoformat(queued_at_str)
            if datetime.now(timezone.utc) - queued_at > timedelta(minutes=30):
                ctx.pop("pending_doc_job", None)
                state["context"] = ctx
                logger.info("DOC_JOB_EXPIRED chat_id=%s queued_at=%s", chat_id, queued_at_str)
                return ""
        except (ValueError, TypeError):
            ctx.pop("pending_doc_job", None)
            state["context"] = ctx
            return ""

        # Poll GET /ingest/crawl-verifications (last 50 records) and filter by vendor.
        # /crawl-status/{chat_id} does not exist — crawl_runs has no chat_id column.
        vendor = pending.get("vendor", "")
        vendor_lower = vendor.lower()
        _FAILED_OUTCOMES = {"LOW_QUALITY", "SHELL_ONLY", "EMPTY", "FAILED"}
        queued_at_dt = datetime.fromisoformat(queued_at_str)

        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(f"{self._ingest_base_url}/ingest/crawl-verifications")
            if resp.status_code != 200:
                return ""
            records = resp.json()
        except Exception as exc:
            logger.debug("DOC_JOB_CHECK failed (non-fatal): %s", exc)
            return ""

        for rec in records:
            rec_mfr = (rec.get("manufacturer") or "").lower()
            if vendor_lower and vendor_lower not in rec_mfr and rec_mfr not in vendor_lower:
                continue
            finished_at = rec.get("finished_at")
            if not finished_at:
                continue  # still running
            try:
                finished_dt = datetime.fromisoformat(finished_at.replace("Z", "+00:00"))
                if finished_dt < queued_at_dt:
                    continue  # this run predates our request
            except (ValueError, TypeError):
                continue
            outcome = rec.get("outcome", "")
            if outcome == "SUCCESS":
                ctx.pop("pending_doc_job", None)
                state["context"] = ctx
                logger.info("DOC_JOB_SUCCESS chat_id=%s vendor=%r", chat_id, vendor)
                return ""
            if outcome in _FAILED_OUTCOMES:
                ctx.pop("pending_doc_job", None)
                state["context"] = ctx
                logger.info(
                    "DOC_JOB_EXHAUSTED chat_id=%s vendor=%r outcome=%s",
                    chat_id,
                    vendor,
                    outcome,
                )
                return (
                    f"I tried multiple sources but couldn't find the "
                    f"{vendor or 'equipment'} manual online. "
                    f"Want to upload the PDF directly?\n\n"
                )

        # No completed run yet — crawl still running, leave marker
        return ""

    async def _fire_scrape_trigger(
        self,
        equipment_id: str,
        manufacturer: str,
        tenant_id: str,
        chat_id: str,
    ) -> None:
        """POST to /ingest/scrape-trigger in the background — failures are non-fatal.

        Called via asyncio.create_task() so it never blocks the user response.
        """
        url = f"{self._ingest_base_url}/ingest/scrape-trigger"
        payload = {
            "equipment_id": equipment_id[:120],
            "manufacturer": manufacturer,
            "model": "",
            "tenant_id": tenant_id or "",
            "chat_id": chat_id,
            "context": "documentation_request",
        }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(url, json=payload)
            if resp.status_code == 200:
                job_id = resp.json().get("job_id", "?")
                logger.info(
                    "SCRAPE_TRIGGER queued job_id=%s manufacturer=%r chat_id=%s",
                    job_id,
                    manufacturer,
                    chat_id,
                )
            else:
                logger.warning(
                    "SCRAPE_TRIGGER HTTP %d: %s",
                    resp.status_code,
                    resp.text[:200],
                )
        except Exception as e:
            logger.warning("SCRAPE_TRIGGER failed (non-fatal): %s", e)

    _STOP_WORDS = frozenset(
        {
            "the",
            "a",
            "an",
            "is",
            "are",
            "was",
            "were",
            "be",
            "been",
            "being",
            "have",
            "has",
            "had",
            "do",
            "does",
            "did",
            "will",
            "would",
            "could",
            "should",
            "may",
            "might",
            "can",
            "shall",
            "to",
            "of",
            "in",
            "for",
            "on",
            "with",
            "at",
            "by",
            "from",
            "as",
            "into",
            "through",
            "during",
            "before",
            "after",
            "and",
            "but",
            "or",
            "nor",
            "not",
            "so",
            "yet",
            "both",
            "either",
            "neither",
            "each",
            "every",
            "all",
            "any",
            "few",
            "more",
            "most",
            "other",
            "some",
            "such",
            "no",
            "only",
            "own",
            "same",
            "than",
            "too",
            "very",
            "just",
            "about",
            "above",
            "below",
            "between",
            "it",
            "its",
            "this",
            "that",
            "these",
            "those",
            "i",
            "you",
            "he",
            "she",
            "we",
            "they",
            "me",
            "him",
            "her",
            "us",
            "them",
            "my",
            "your",
            "his",
            "our",
            "their",
            "if",
            "then",
            "else",
            "when",
            "up",
            "out",
            "off",
        }
    )

    def _is_grounded(self, parsed: dict, sources: list[str]) -> bool:
        """Check if response appears grounded in retrieved sources."""
        if not sources:
            return True  # No sources available — can't check, trust the LLM

        reply = parsed.get("reply", "").lower()
        # If response explicitly says it has no info, that's grounded (honest)
        if "don't have" in reply or "not in my records" in reply:
            return True

        # Check if response references any content from sources
        for source in sources[:3]:
            source_words = set(source.lower().split()) - self._STOP_WORDS
            reply_words = set(reply.split()) - self._STOP_WORDS
            overlap = source_words & reply_words
            if len(overlap) >= 5:
                return True

        if not self._is_grounded.__dict__.get("_warned", False):
            logger.warning(
                "Response may not be grounded in sources (<%d significant word overlap)", 5
            )
        return False

    # ------------------------------------------------------------------

    def _ensure_table(self):
        """Create conversation_state table if it doesn't exist."""
        ensure_table(self.db_path)

    def _load_state(self, chat_id: str) -> dict:
        """Load conversation state from SQLite."""
        return load_state(self.db_path, chat_id)

    def _save_state(self, chat_id: str, state: dict) -> None:
        """Persist conversation state to SQLite."""
        save_state(self.db_path, chat_id, state)

    @staticmethod
    def _strip_memory_block(message: str) -> str:
        """Remove injected [MIRA MEMORY...END MEMORY] prefix before storing to history."""
        import re as _re

        return _re.sub(
            r"^\[MIRA MEMORY[^\]]*\].*?\[END MEMORY\]\s*\n*",
            "",
            message,
            flags=_re.DOTALL,
        ).lstrip()

    def _record_exchange(self, chat_id: str, state: dict, message: str, reply: str) -> None:
        """Save a user/assistant exchange to conversation history and persist."""
        record_exchange(self.db_path, chat_id, state, self._strip_memory_block(message), reply)

    def _log_interaction(
        self,
        chat_id: str,
        message: str,
        reply: str,
        *,
        fsm_state: str = "",
        intent: str = "",
        has_photo: bool = False,
        confidence: str = "",
        response_time_ms: int = 0,
        platform: str = "telegram",
    ) -> None:
        """Append-only log of every user/bot exchange for quality analysis."""
        if fsm_state == "DIAGNOSIS_REVISION":
            fsm_state = "DIAGNOSIS"
        log_interaction(
            self.db_path,
            chat_id,
            message,
            reply,
            fsm_state=fsm_state,
            intent=intent,
            has_photo=has_photo,
            confidence=confidence,
            response_time_ms=response_time_ms,
            platform=platform,
        )

    # ------------------------------------------------------------------
    # Response parsing
    # ------------------------------------------------------------------

    def _parse_response(self, raw: str) -> dict:
        """Parse LLM response. Delegates to response_formatter.parse_response."""
        return parse_response(raw)

    # ------------------------------------------------------------------
    # FSM state machine
    # ------------------------------------------------------------------

    _VALID_STATES = VALID_STATES  # re-exported from fsm for class-level access

    def _advance_state(self, state: dict, parsed: dict) -> dict:
        """Advance FSM state. Delegates to fsm.advance_state."""
        return advance_state(state, parsed)

    def _format_reply(self, parsed: dict, user_message: str = "") -> str:
        """Format parsed response for display. Delegates to response_formatter.format_reply."""
        kb_status = getattr(self.rag, "kb_status", None) or {}
        return format_reply(parsed, user_message, kb_status)
