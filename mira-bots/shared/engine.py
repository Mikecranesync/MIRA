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
from .nemotron import NemotronClient
from .neon_recall import kb_has_coverage
from .session_memory import load_session, save_session
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

STATE_ORDER = ["IDLE", "Q1", "Q2", "Q3", "DIAGNOSIS", "FIX_STEP", "RESOLVED"]
# ---------------------------------------------------------------------------
# Diagnosis self-critique quality gate
# ---------------------------------------------------------------------------
_CRITIQUE_DISABLED = os.getenv("MIRA_DISABLE_SELF_CRITIQUE", "0") == "1"
_CRITIQUE_THRESHOLD = int(os.getenv("MIRA_CRITIQUE_THRESHOLD", "3"))
_CRITIQUE_MAX_ATTEMPTS = int(os.getenv("MIRA_CRITIQUE_MAX_ATTEMPTS", "2"))
# Patterns that indicate the user has already supplied fault/alarm specifics.
# If any match in the conversation history + current message, skip the
# groundedness clarifying question — the critique is scoring on incomplete context.
_FAULT_INFO_RE = re.compile(
    r"""
    (?:[A-Z]{1,3}-?\d{3,})              # F30001, AL-14, E001
    | \b[A-Z]{2,3}\b(?=\s+fault)        # OC fault, OL fault (common VFD 2-letter codes)
    | \b(?:fault\s+code|alarm\s+(?:code|number)|error\s+code|fault\s+number)\b
    | \b(?:tripping\s+on|tripped\s+on|showing\s+(?:fault|error|alarm))\b
    | \b(?:displays?|shows?|reading)\s+[A-Z0-9]{2,}  # "shows OC", "displays F7"
    """,
    re.IGNORECASE | re.VERBOSE,
)
# Compact judge prompt — returns only the three actionable dims to keep token cost low.
_CRITIQUE_PROMPT = """\
Score this maintenance-AI response. Return ONLY valid JSON — no markdown, no prose.

User asked: {question}

AI responded: {response}

Rate each on 1-5 (5=excellent, 3=acceptable, <3=needs revision):

{{"groundedness":{{"score":<1-5>,"note":"<12 words max: reflects KB or admits gap?>"}},\
"helpfulness":{{"score":<1-5>,"note":"<12 words max: technician can act on this?>"}},\
"instruction_following":{{"score":<1-5>,"note":"<12 words max: honored the user's actual ask?>"}}}}"""
ACTIVE_DIAGNOSTIC_STATES = frozenset({"Q1", "Q2", "Q3", "DIAGNOSIS", "FIX_STEP"})
_Q_STATES = frozenset({"Q1", "Q2", "Q3"})

# Diagnostic-instruction phrases that can legitimately precede a safety keyword
# without implying an active hazard. "Check for melted insulation" is an
# instruction to the tech, not a report that insulation is currently melted.
_SAFETY_INSTRUCTION_PREFIXES: tuple[str, ...] = (
    "check for ",
    "check for any ",
    "check for signs of ",
    "check for evidence of ",
    "look for ",
    "look for any ",
    "look for signs of ",
    "look for evidence of ",
    "inspect for ",
    "inspect for any ",
    "inspect for signs of ",
    "test for ",
    "test for any ",
    "measure for ",
    "verify no ",
    "verify there is no ",
    "verify there are no ",
    "if you see ",
    "if you observe ",
    "if there is ",
    "if there are ",
    "if any ",
    "any sign of ",
    "signs of ",
    "evidence of ",
    "indication of ",
    "before opening ",
    "before touching ",
    "before working ",
)


def _safety_is_observational(reply_lower: str) -> bool:
    """Return True if any SAFETY_KEYWORDS occurrence in ``reply_lower`` is in
    an observational (hazard-visible-now) context — i.e. NOT immediately
    preceded by a diagnostic-instruction phrase like "check for" or "if you see".

    Used by ``_advance_state`` to trigger SAFETY_ALERT on real hazard reports
    while preserving valid diagnostic steps that incidentally name a safety
    term (issue #386 regression fix).
    """
    for kw in SAFETY_KEYWORDS:
        idx = 0
        while True:
            pos = reply_lower.find(kw, idx)
            if pos == -1:
                break
            preceding = reply_lower[max(0, pos - 40) : pos].rstrip()
            is_instruction = any(
                preceding.endswith(pfx.rstrip()) for pfx in _SAFETY_INSTRUCTION_PREFIXES
            )
            if not is_instruction:
                return True
            idx = pos + len(kw)
    return False


# After this many entries into a Q-state the FSM forces a commit to DIAGNOSIS.
# Counting includes the first non-Q→Q transition, so IDLE→Q1→Q2→Q3 reaches
# q_rounds=3 at Q3 and triggers. See #387 for the off-by-one fix.
_MAX_Q_ROUNDS = int(os.getenv("MIRA_MAX_Q_ROUNDS", "3"))
HISTORY_LIMIT = int(os.getenv("MIRA_HISTORY_LIMIT", "20"))
# How many turns the session photo stays available for follow-up questions
PHOTO_MEMORY_TURNS = int(os.getenv("MIRA_PHOTO_MEMORY_TURNS", "10"))

# Fuzzy-match common LLM-invented state names to valid FSM states.
# Groq llama-3.3-70b and llama-4-scout frequently produce these.
_STATE_ALIASES: dict[str, str] = {
    # Diagnosis variants
    "DIAGNOSTICS": "DIAGNOSIS",
    "DIAGNOSTIC": "DIAGNOSIS",
    "DIAGNOSIS_SUMMARY": "DIAGNOSIS",
    "FAULT_ANALYSIS": "DIAGNOSIS",
    "FAULT_IDENTIFIED": "DIAGNOSIS",  # fault identified → ready for diagnosis
    "ANALYZING": "DIAGNOSIS",
    "ANALYSIS": "DIAGNOSIS",
    "ROOT_CAUSE": "DIAGNOSIS",
    "FAULT_INVESTIGATION": "Q2",  # mid-investigation → Q2 (still gathering)
    "INVESTIGATING": "Q2",
    # Question variants
    "TROUBLESHOOT": "Q1",
    "TROUBLESHOOTING": "Q1",
    "QUESTION": "Q1",
    "USER_QUERY": "Q1",
    "INQUIRY": "Q1",
    "NEED_MORE_INFO": "Q1",
    "NEEDS_MORE_INFO": "Q1",  # LLM variant with trailing S
    "NEED_INFO": "Q1",
    "NEED_MODEL_NUMBER": "Q1",  # request for model clarification
    "PARAMETER_INQUIRY": "IDLE",  # pure parameter lookup — no diagnostic session
    "PARAMETER_IDENTIFIED": "Q1",
    "READING_IDENTIFIED": "Q1",
    "INSTALLATION_GUIDANCE": "FIX_STEP",
    "INSTALLATION": "FIX_STEP",
    "WIRING_CHECK": "Q2",
    "CONFIGURATION": "Q2",
    "GATHERING_INFO": "Q2",
    "INSPECT": "Q2",
    "VERIFY": "Q2",
    "CHECK_OUTPUT_REACTOR": "Q2",
    "Q4": "Q3",  # no Q4 — clamp to Q3
    "Q5": "Q3",
    # Fix step variants
    "FIX": "FIX_STEP",
    "REPAIR": "FIX_STEP",
    "ACTION": "FIX_STEP",
    "CONFIG_STEP": "FIX_STEP",
    "PARAMETER_SETTINGS": "FIX_STEP",
    "IN_PROGRESS": "FIX_STEP",
    # Resolved variants
    "SUMMARY": "RESOLVED",
    "COMPLETE": "RESOLVED",
    "DONE": "RESOLVED",
    "CLOSED": "RESOLVED",
    # Internal self-critique state — LLMs should not propose this; if they do, map to DIAGNOSIS
    "DIAGNOSIS_REVISION": "DIAGNOSIS",
}

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
# Detects honesty prefix the model should emit for out-of-KB vendors.
# Used by the programmatic honesty-prefix injection in process_full().
_HONESTY_PREFIX_RE = re.compile(
    r"I don'?t have\b.{0,60}(?:documentation|records|knowledge base)",
    re.IGNORECASE,
)

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


def format_diagnostic_response(
    equipment_id: str, key_observation: str, question: str, options: list
) -> str:
    """Format a structured diagnostic reply with equipment header and options."""
    header = f"📷 {equipment_id} — {key_observation}"
    opts = "\n".join(f"{i + 1}. {opt}" for i, opt in enumerate(options))
    return f"{header}\n\n{question}\n{opts}"


def deduplicate_options(reply_text: str, keyboard_options: list) -> str:
    """Remove numbered option lines from reply_text that already appear in keyboard_options."""
    if not keyboard_options:
        return reply_text
    for opt in keyboard_options:
        reply_text = re.sub(rf"\n\d+\.\s+{re.escape(opt)}", "", reply_text)
    return reply_text.strip()


def _looks_like_model_number(text: str) -> str:
    """Return the first model-number-like token from *text*, or ''.

    A model number must contain both at least one letter and at least one
    digit (e.g. "GS20", "X3", "FC-302", "VLT-FC302").  Pure-letter and
    pure-digit tokens are excluded unless the caller handles them separately.
    """
    for raw in re.split(r"[\s,;]+", text):
        tok = re.sub(r"[^\w-]", "", raw)
        if len(tok) >= 2 and re.search(r"[A-Za-z]", tok) and re.search(r"\d", tok):
            return tok
    return ""


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

        # Inference router — enabled only when INFERENCE_BACKEND=claude + ANTHROPIC_API_KEY set
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
        import base64

        photos_dir = os.path.join(os.path.dirname(self.db_path), "session_photos")
        os.makedirs(photos_dir, exist_ok=True)
        path = os.path.join(photos_dir, f"{chat_id}.jpg")
        with open(path, "wb") as f:
            f.write(base64.b64decode(photo_b64))
        logger.info("Session photo saved: %s", path)
        return path

    def _load_session_photo(self, chat_id: str) -> str | None:
        """Load session photo as base64 if it exists and is within turn limit."""
        import base64

        path = os.path.join(os.path.dirname(self.db_path), "session_photos", f"{chat_id}.jpg")
        if not os.path.exists(path):
            return None
        try:
            with open(path, "rb") as f:
                return base64.b64encode(f.read()).decode()
        except Exception as e:
            logger.warning("Failed to load session photo: %s", e)
            return None

    def _clear_session_photo(self, chat_id: str) -> None:
        """Remove the session photo when it expires or session resets."""
        path = os.path.join(os.path.dirname(self.db_path), "session_photos", f"{chat_id}.jpg")
        if os.path.exists(path):
            os.remove(path)
            logger.info("Session photo cleared: %s", path)

    def _build_print_reply(self, vision_data: dict) -> str:
        items_list = vision_data.get("ocr_items", [])
        drawing_type = vision_data.get("drawing_type", "electrical drawing")
        n = len(items_list)

        if n == 0:
            quality = "Couldn't extract text — try better lighting or a closer shot."
        elif n <= 5:
            quality = f"Weak read — only {n} labels. Closer shot recommended."
        elif n <= 20:
            quality = f"Partial read — {n} labels extracted."
        else:
            quality = f"Good read — {n} labels extracted."

        chrome = [
            "ask copilot",
            "sharepoint",
            "file c:/",
            "c:\\",
            ".exe",
            ".dll",
            "microsoft",
            "adobe",
        ]
        artifact_note = (
            " (some labels may be screen UI, not drawing content)"
            if any(p in " ".join(items_list).lower() for p in chrome)
            else ""
        )

        prompts = {
            "ladder logic diagram": "Describe a fault symptom or ask what a specific rung does.",
            "one-line diagram": "Ask me to trace power flow or identify a protection device.",
            "P&ID": "Ask me to identify a tag number or trace a process line.",
            "wiring diagram": "Ask me to trace a wire run or identify connection points.",
            "panel schedule": "Ask me to look up a specific entry.",
        }
        next_step = prompts.get(drawing_type, "Ask me what you're trying to find.")
        preview = ", ".join(items_list[:8]) if items_list else "(no text extracted)"

        # Rule 14: proactively surface fault states visible in OCR — do not wait for the tech to ask
        _FAULT_KEYWORDS = (
            "stopped",
            "fault",
            "alarm",
            "error",
            "trip",
            "warning",
            "faulted",
            "tripped",
        )
        fault_items = [
            item for item in items_list if any(kw in item.lower() for kw in _FAULT_KEYWORDS)
        ]
        if fault_items:
            # Use fault items as preview to save words
            preview = ", ".join(fault_items[:4])
            fault_summary = "; ".join(fault_items[:3])
            next_step = (
                f"Active fault states: {fault_summary}. "
                f"Likely caused by a trip, interlock, or upstream fault. "
                f"Describe what happened before this, or ask me to trace the fault path."
            )

        return (
            f"{drawing_type.capitalize()} — {quality}{artifact_note}\n"
            f"Labels I can see: {preview}\n"
            f"{next_step}"
        )

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
        """Main entry point. Returns reply string (backward-compatible)."""
        t0 = time.monotonic()
        result = await self.process_full(chat_id, message, photo_b64)
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

        # Citation gate — PROCEED override: tech explicitly accepts LLM best-guess mode.
        # Must run before all other checks so the tech can unlock a blocked session.
        if message.strip().upper() in ("PROCEED", "OVERRIDE", "BEST GUESS", "CONTINUE ANYWAY"):
            ctx = state.get("context") or {}
            ctx["override_mode"] = True
            state["context"] = ctx
            self._save_state(chat_id, state)
            tl_flush()
            return self._make_result(
                "⚠️ **BEST-GUESS MODE** — No manual on file. Proceeding with LLM training "
                "knowledge only. Results are not verified against documentation. "
                "Re-ask your question.",
                "none",
                trace_id,
                state["state"],
            )

        # Cross-session equipment memory: if this is a fresh session (IDLE,
        # no asset), check NeonDB for a prior asset context from a previous
        # chat session so the tech doesn't have to re-identify the equipment.
        if state["state"] == "IDLE" and not state.get("asset_identified"):
            prior = load_session(chat_id)
            if prior:
                state["asset_identified"] = prior["asset_id"]
                ctx = state.get("context") or {}
                sc = ctx.setdefault("session_context", {})
                sc["equipment_type"] = prior["asset_id"]
                sc["restored_from_memory"] = True
                if prior.get("open_wo_id"):
                    sc["open_wo_id"] = prior["open_wo_id"]
                if prior.get("last_seen_fault"):
                    sc["last_seen_fault"] = prior["last_seen_fault"]
                state["context"] = ctx
                logger.info(
                    "session_memory: restored asset=%s for chat_id=%s",
                    prior["asset_id"],
                    chat_id,
                )

        # CMMS pending: user is answering the work-order creation prompt — handle before
        # any option resolution, session-followup detection, or intent classification.
        if (state.get("context") or {}).get("cmms_pending") and not photo_b64:
            return await self._handle_cmms_pending(chat_id, message, state, trace_id)

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

            intent = classify_intent(message)
            if intent == "safety":
                reply = (
                    "STOP \u2014 describe the hazard. De-energize the equipment first. "
                    "Do not proceed until the area is safe."
                )
                self._record_exchange(chat_id, state, message, reply)
                tl_flush()
                return self._make_result(reply, "high", trace_id, "SAFETY_ALERT")
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
            asset = state.get("asset_identified") or ""
            combined = f"{message} {asset}".strip()
            mfr = vendor_name_from_text(combined) or ""

            # If no vendor found yet and no asset_identified, scan recent history.
            # Covers "Can you find a manual for this?" mid-session where user
            # named the equipment 2-3 turns ago but asset_identified was never set.
            if not mfr and not asset:
                ctx_h = state.get("context") or {}
                history = ctx_h.get("history", [])
                # Last 4 messages (2 exchanges) — enough to catch recent vendor mentions
                history_tail = " ".join(t.get("content", "") for t in history[-4:])
                mfr = vendor_name_from_text(history_tail) or ""
                if mfr:
                    combined = f"{message} {history_tail}".strip()

            # Fast-path: if KB has no coverage for this vendor, gathering a model
            # number won't help — skip straight to the honest "no docs" response.
            if mfr:
                kb_covered, _ = kb_has_coverage(mfr, combined, resolved_tenant or "")
                if not kb_covered:
                    return await self._do_documentation_lookup(
                        chat_id, message, state, trace_id, resolved_tenant, vendor_override=mfr
                    )

            # Specificity gate — vague requests ("the safety relay", "this VFD") enter
            # MANUAL_LOOKUP_GATHERING to collect vendor + model before crawling.
            # Exception: if we're in an active session AND vendor is known from context
            # (history extraction above), proceed to doc lookup — the crawl is useful
            # and we don't need to ask the tech for vendor they already told us.
            in_active_session = state["state"] not in ("IDLE",)
            vendor_from_context = mfr and not vendor_name_from_text(
                f"{message} {asset}".strip()
            )  # True when mfr came from history (not current message or asset_identified)
            if not self._is_doc_specific(mfr, combined) and not (
                in_active_session and vendor_from_context
            ):
                return await self._enter_manual_lookup_gathering(
                    chat_id, message, state, trace_id, mfr
                )

            # Specific enough (or vendor known from session context) — Phase 2 KB pre-check + crawl
            return await self._do_documentation_lookup(
                chat_id, message, state, trace_id, resolved_tenant, vendor_override=mfr
            )

        # Photo path: delegate to vision worker, then route
        _photo_continues_session = False
        if photo_b64:
            with tl_span(t, "vision_worker"):
                vision_data = await self.vision.process(photo_b64, message)

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
            full_vision = str(vision_data["vision_result"])
            # Try to extract just the equipment name (first sentence or 80 chars)
            first_sentence = full_vision.split(".")[0].strip()
            state["asset_identified"] = (
                first_sentence[:120] if first_sentence else full_vision[:120]
            )

            # Persist asset context to NeonDB for cross-session recall
            save_session(
                chat_id,
                state["asset_identified"],
                last_seen_fault=state.get("fault_category"),
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
                logger.error("LLM call failed (print worker): %s", e)
                self._save_state(chat_id, state)
                tl_flush()
                return self._make_result(f"MIRA error: {e}", "none", trace_id)
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
            formatted = self._format_reply(parsed)
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
        with tl_span(t, "rag_worker"):
            raw, parsed = await self._call_with_correction(
                message,
                state,
                effective_photo,
                tenant_id=resolved_tenant,
            )
        if raw is None:
            self._save_state(chat_id, state)
            tl_flush()
            return self._make_result(parsed["reply"], "none", trace_id)

        # Read KB coverage status from RAG worker (set during process() call above)
        _kb_cover = self.rag.kb_status
        _kb_gate_status = _kb_cover.get("status", "unknown")
        _kb_gate_citations = _kb_cover.get("citations", [])

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
        # Citation gate — enforce KB coverage for technical advice states.
        # UNCOVERED + no override → block with 🔴, fire scrape trigger, return early.
        # PARTIAL → inject 🟡 banner + background scrape.
        # COVERED → inject 🟢 banner + citation footer.
        # Override mode (PROCEED already handled above) shows ⚠️ banner.
        # ---------------------------------------------------------------------------
        _override_mode = (state.get("context") or {}).get("override_mode", False)
        _technical_state = state["state"] in ("DIAGNOSIS", "FIX_STEP")

        if _technical_state and not photo_b64:
            asset = state.get("asset_identified", "")
            vendor = vendor_name_from_text(asset) if asset else None
            vendor_label = vendor or "this equipment"

            if _kb_gate_status == "uncovered" and not _override_mode:
                # Hard gate — block response, fire scrape, prompt PROCEED
                asyncio.create_task(
                    self._fire_scrape_trigger(message, vendor_label, resolved_tenant or "", chat_id)
                )
                logger.info(
                    "CITATION_GATE_BLOCKED chat_id=%s vendor=%r state=%s",
                    chat_id,
                    vendor_label,
                    state["state"],
                )
                self._save_state(chat_id, state)
                tl_flush()
                return self._make_result(
                    f"🔴 **No manual found for {vendor_label}.**\n"
                    f"Searching for documentation now (check back in ~2 hours).\n\n"
                    f"To continue with LLM best-guess (not manual-verified), type **PROCEED**.",
                    "none",
                    trace_id,
                    state["state"],
                )

            elif _kb_gate_status == "partial" and not _override_mode:
                mfr_label = (
                    _kb_gate_citations[0]["manufacturer"] if _kb_gate_citations else vendor_label
                )
                asyncio.create_task(
                    self._fire_scrape_trigger(message, vendor_label, resolved_tenant or "", chat_id)
                )
                parsed["reply"] = (
                    f"🟡 **KB: Partial coverage** — {mfr_label} (searching for more)\n\n"
                    + parsed.get("reply", "")
                )
                logger.info(
                    "CITATION_GATE_PARTIAL chat_id=%s vendor=%r",
                    chat_id,
                    vendor_label,
                )

            elif _kb_gate_status == "covered" and not _override_mode:
                mfr = _kb_gate_citations[0]["manufacturer"] if _kb_gate_citations else ""
                mdl = _kb_gate_citations[0]["model_number"] if _kb_gate_citations else ""
                cov_label = f"{mfr} {mdl}".strip() or vendor_label
                parsed["reply"] = f"🟢 **KB: {cov_label}**\n\n" + parsed.get("reply", "")
                logger.info(
                    "CITATION_GATE_COVERED chat_id=%s vendor=%r",
                    chat_id,
                    cov_label,
                )

            elif _override_mode:
                parsed["reply"] = (
                    "⚠️ **BEST-GUESS MODE** — No manual. LLM estimate only, "
                    "not verified against documentation.\n\n" + parsed.get("reply", "")
                )

            # Append citations footer for covered/partial
            if (
                _kb_gate_status in ("covered", "partial")
                and _kb_gate_citations
                and not _override_mode
            ):
                footer_parts = []
                for c in _kb_gate_citations[:2]:
                    c_label = f"{c['manufacturer']} {c['model_number']}".strip()
                    c_section = c.get("section", "")
                    if c_section:
                        c_label += f", {c_section}"
                    url = c.get("source_url", "")
                    if url:
                        footer_parts.append(f"[{c_label}]({url})")
                    elif c_label:
                        footer_parts.append(c_label)
                if footer_parts:
                    parsed["reply"] = (
                        parsed.get("reply", "")
                        + f"\n\n---\n📚 *Source: {' · '.join(footer_parts)}*"
                    )

        # ---------------------------------------------------------------------------
        # Diagnosis self-critique quality gate (AutoGen-style nudge loop)
        # Runs only on DIAGNOSIS state, text-only turns, caps at _CRITIQUE_MAX_ATTEMPTS.
        # ---------------------------------------------------------------------------
        if state["state"] == "DIAGNOSIS" and not photo_b64 and not _CRITIQUE_DISABLED:
            ctx_sc = state.get("context") or {}
            revision_attempts = ctx_sc.get("revision_attempts", 0)

            if revision_attempts < _CRITIQUE_MAX_ATTEMPTS:
                scores = await self._self_critique_diagnosis(parsed["reply"], message, chat_id)
                low_dims = [d for d, s in scores.items() if s < _CRITIQUE_THRESHOLD]

                if low_dims:
                    revision_attempts += 1
                    ctx_sc["revision_attempts"] = revision_attempts
                    ctx_sc["revision_critique"] = {
                        "dims": low_dims,
                        "attempts": revision_attempts,
                        "scores": scores,
                    }
                    state["context"] = ctx_sc
                    logger.info(
                        "SELF_CRITIQUE_TRIGGERED chat_id=%s dims=%s scores=%s attempt=%d",
                        chat_id,
                        low_dims,
                        {d: scores[d] for d in low_dims},
                        revision_attempts,
                    )

                    if "groundedness" in low_dims:
                        # Before asking for more info, check whether the user
                        # already supplied fault/alarm specifics in this session.
                        # The critique only sees the current message, so it can
                        # score groundedness low even when a fault code appeared
                        # in an earlier turn (e.g. "showing F30001" in turn 1).
                        ctx_hist = state.get("context") or {}
                        history_turns = ctx_hist.get("history", [])
                        combined_history = (
                            " ".join(t.get("content", "") for t in history_turns[-8:])
                            + " "
                            + message
                        )
                        fault_info_present = bool(_FAULT_INFO_RE.search(combined_history))

                        if fault_info_present:
                            # Critique was wrong — user already gave us enough.
                            # Treat as acceptable; clear revision counter.
                            ctx_sc.pop("revision_attempts", None)
                            ctx_sc.pop("revision_critique", None)
                            state["context"] = ctx_sc
                            logger.info(
                                "SELF_CRITIQUE_GROUNDEDNESS_SUPPRESSED chat_id=%s"
                                " (fault info found in history)",
                                chat_id,
                            )
                        else:
                            # Need more info from the user → ask a targeted
                            # clarifying question and park in DIAGNOSIS_REVISION.
                            note = scores.get("groundedness_note", "")
                            clarifying_q = (
                                "Before I can give you a confident diagnosis, could you "
                                "share one more detail — what exact fault code, alarm "
                                "number, or behaviour is the equipment showing right now? "
                                "(e.g. fault light colour, code displayed, or what it does "
                                "when the fault occurs)"
                            )
                            if note:
                                clarifying_q += f"\n\n*(My confidence was limited because: {note})*"
                            state["state"] = "DIAGNOSIS_REVISION"
                            parsed["reply"] = clarifying_q
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
                                    "SELF_CRITIQUE_REVISED chat_id=%s attempt=%d",
                                    chat_id,
                                    revision_attempts,
                                )
                        except Exception as exc:
                            logger.warning(
                                "SELF_CRITIQUE_REVISION_FAILED chat_id=%s error=%s",
                                chat_id,
                                exc,
                            )
                else:
                    # Quality is acceptable — reset revision counter.
                    ctx_sc.pop("revision_attempts", None)
                    ctx_sc.pop("revision_critique", None)
                    state["context"] = ctx_sc

        # RESOLVED hook: append work-order prompt so next turn is intercepted.
        # Amend parsed["reply"] now so both history and formatted output include it.
        _wo_draft = None
        if state["state"] == "RESOLVED":
            _wo_draft = self._build_wo_draft(state)
            parsed["reply"] = parsed.get("reply", "").rstrip() + (
                "\n\nShould I log a work order in the CMMS?"
            )

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

        formatted = self._format_reply(parsed)
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
            "create",
            "do it",
            "log it",
            "create it",
            "go ahead",
            "please",
            "1",
        }
    )

    def _build_wo_draft(self, state: dict) -> dict:
        """Construct work-order title/description from resolved diagnostic state."""
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

    async def _post_cmms_work_order(self, wo_draft: dict) -> str:
        """Call AtlasCMMSClient to create a work order. Returns confirmation string."""
        client = AtlasCMMSClient(base_url=self.mcp_base_url, api_key=self.mcp_api_key)
        result = await client.create_work_order(
            title=wo_draft["title"],
            description=wo_draft["description"],
            priority=wo_draft["priority"],
            asset_id=0,
            category="CORRECTIVE",
        )
        if "error" in result:
            raise RuntimeError(result["error"])
        wo_id = result.get("id", "unknown")
        asset = wo_draft.get("asset_label", "equipment")
        return f"Work order #{wo_id} created. Asset: {asset}."

    async def _handle_cmms_pending(
        self,
        chat_id: str,
        message: str,
        state: dict,
        trace_id: str,
    ) -> dict:
        """Handle the yes/no response to the work-order creation prompt."""
        ctx = state.get("context") or {}
        wo_draft = ctx.pop("cmms_wo_draft", {})
        ctx.pop("cmms_pending", None)
        state["context"] = ctx

        msg_lower = message.strip().lower()
        is_yes = msg_lower in self._CMMS_YES or any(
            w in msg_lower for w in self._CMMS_YES if len(w) > 3
        )

        if is_yes and wo_draft:
            try:
                reply = await self._post_cmms_work_order(wo_draft)
                logger.info(
                    "CMMS_WO_CREATED chat_id=%s wo_draft_title=%r", chat_id, wo_draft.get("title")
                )
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

        # Persist asset context to NeonDB for cross-session recall
        save_session(chat_id, state["asset_identified"])

        history = ctx.get("history", [])
        history.append({"role": "user", "content": message})

        # 5. Vision → RAG loop: immediately surface KB content after nameplate extraction.
        # Fire an auto-query so the user gets a useful answer without a follow-up message.
        # Only runs when the KB has linked chunks for this equipment.
        rag_reply = ""
        if linked_chunks > 0:
            # If the user captioned the photo with a real question, use it.
            # Otherwise fire a default fault/troubleshooting query.
            _cap = message.strip()
            _is_question = "?" in _cap or bool(
                re.match(
                    r"^(what|why|how|when|where|which|is |are |can |does |do )\b",
                    _cap,
                    re.IGNORECASE,
                )
            )
            rag_query = (
                _cap
                if (_cap and _is_question)
                else (f"{manufacturer} {model} common faults troubleshooting")
            )
            try:
                raw = await self.rag.process(
                    rag_query,
                    state,
                    tenant_id=resolved_tenant,
                )
                parsed = self._parse_response(raw)
                rag_reply = parsed.get("reply", "")
            except Exception as e:
                logger.warning("nameplate auto-RAG failed: %s", e)

        if rag_reply:
            reply = (
                f"**{manufacturer} {model}** — asset registered, "
                f"{linked_chunks} manual chunks linked.\n\n"
                f"{rag_reply}"
            )
        else:
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
            "NAMEPLATE_FLOW tenant=%s manufacturer=%s model=%s linked_chunks=%d auto_rag=%s",
            resolved_tenant,
            manufacturer,
            model,
            linked_chunks,
            bool(rag_reply),
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
        formatted = self._format_reply(parsed)
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
        # Doc request handled — return to IDLE so the session doesn't stay
        # stuck in a mid-diagnostic state after the "no docs" response.
        state["state"] = "IDLE"
        state["context"] = ctx
        # Reset session to IDLE — KB miss means no diagnosis can proceed.
        # Allows tech to start fresh after being redirected to manufacturer docs.
        prior_state = state["state"]
        state["state"] = "IDLE"
        asyncio.create_task(self._fire_scrape_trigger(message, mfr, resolved_tenant or "", chat_id))
        logger.info(
            "DOC_INTENT_ROUTING chat_id=%s manufacturer=%r support_url=%s prior_state=%s → IDLE",
            chat_id,
            mfr,
            url,
            prior_state,
        )
        self._record_exchange(chat_id, state, message, reply)
        tl_flush()
        return self._make_result(reply, "low", trace_id, "IDLE")

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
        db = sqlite3.connect(self.db_path)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("""
            CREATE TABLE IF NOT EXISTS conversation_state (
                chat_id          TEXT PRIMARY KEY,
                state            TEXT NOT NULL DEFAULT 'IDLE',
                context          TEXT NOT NULL DEFAULT '{}',
                asset_identified TEXT,
                fault_category   TEXT,
                exchange_count   INTEGER NOT NULL DEFAULT 0,
                final_state      TEXT,
                voice_enabled    INTEGER NOT NULL DEFAULT 0,
                created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS feedback_log (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id         TEXT NOT NULL,
                feedback        TEXT NOT NULL,
                reason          TEXT,
                last_reply      TEXT,
                exchange_count  INTEGER,
                created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS interactions (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id          TEXT NOT NULL,
                platform         TEXT NOT NULL DEFAULT 'telegram',
                user_message     TEXT NOT NULL,
                bot_response     TEXT NOT NULL,
                fsm_state        TEXT,
                intent           TEXT,
                has_photo        INTEGER DEFAULT 0,
                confidence       TEXT,
                response_time_ms INTEGER,
                created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        try:
            db.execute(
                "ALTER TABLE conversation_state ADD COLUMN voice_enabled INTEGER NOT NULL DEFAULT 0"
            )
        except Exception as e:
            logger.debug("voice_enabled column already exists: %s", e)
        db.commit()
        db.close()

    def _load_state(self, chat_id: str) -> dict:
        """Load conversation state from SQLite."""
        db = sqlite3.connect(self.db_path)
        db.execute("PRAGMA journal_mode=WAL")
        db.row_factory = sqlite3.Row
        row = db.execute(
            "SELECT * FROM conversation_state WHERE chat_id = ?", (chat_id,)
        ).fetchone()
        db.close()
        if row:
            state = dict(row)
            try:
                state["context"] = json.loads(state["context"])
            except (json.JSONDecodeError, TypeError):
                state["context"] = {}
            state["context"].setdefault("session_context", {})
            return state
        return {
            "chat_id": chat_id,
            "state": "IDLE",
            "context": {"session_context": {}},
            "asset_identified": None,
            "fault_category": None,
            "exchange_count": 0,
            "final_state": None,
        }

    def _save_state(self, chat_id: str, state: dict) -> None:
        """Persist conversation state to SQLite."""
        context_json = json.dumps(state.get("context", {}))
        db = sqlite3.connect(self.db_path)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute(
            """INSERT INTO conversation_state
               (chat_id, state, context, asset_identified, fault_category,
                exchange_count, final_state, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(chat_id) DO UPDATE SET
                 state = excluded.state,
                 context = excluded.context,
                 asset_identified = excluded.asset_identified,
                 fault_category = excluded.fault_category,
                 exchange_count = excluded.exchange_count,
                 final_state = excluded.final_state,
                 updated_at = CURRENT_TIMESTAMP""",
            (
                chat_id,
                state["state"],
                context_json,
                state.get("asset_identified"),
                state.get("fault_category"),
                state["exchange_count"],
                state.get("final_state"),
            ),
        )
        db.commit()
        db.close()

    def _record_exchange(self, chat_id: str, state: dict, message: str, reply: str):
        """Save a user/assistant exchange to conversation history and persist."""
        ctx = state.get("context") or {}
        history = ctx.get("history", [])
        history.append({"role": "user", "content": message})
        history.append({"role": "assistant", "content": reply})
        ctx["history"] = history
        state["context"] = ctx
        self._save_state(chat_id, state)

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
    ):
        """Append-only log of every user/bot exchange for quality analysis."""
        try:
            db = sqlite3.connect(self.db_path)
            db.execute("PRAGMA journal_mode=WAL")
            db.execute(
                """INSERT INTO interactions
                   (chat_id, platform, user_message, bot_response, fsm_state,
                    intent, has_photo, confidence, response_time_ms)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    chat_id,
                    platform,
                    message,
                    reply,
                    fsm_state,
                    intent,
                    int(has_photo),
                    confidence,
                    response_time_ms,
                ),
            )
            db.commit()
            db.close()
        except Exception as e:
            logger.warning("Failed to log interaction: %s", e)

    # ------------------------------------------------------------------
    # Response parsing
    # ------------------------------------------------------------------

    def _parse_response(self, raw: str) -> dict:
        """Parse LLM response — try JSON envelope, fall back to plain text.

        Groq models frequently return JSON with non-standard keys like
        ``follow_ups``, ``tags``, ``title``, ``queries`` instead of the
        expected ``reply`` key. We attempt to salvage these into a valid
        response so the FSM doesn't stall.

        ``strict=False`` on every ``json.loads`` tolerates unescaped control
        characters (literal newlines, tabs) inside string values — LLMs emit
        prose paragraph breaks this way constantly (P0 #380).
        """
        raw_stripped = raw.strip()

        try:
            parsed = json.loads(raw_stripped, strict=False)
            if isinstance(parsed, dict):
                if "reply" in parsed:
                    return self._extract_parsed(parsed)
                # Groq fallback: salvage non-standard JSON envelopes
                parsed = self._salvage_groq_json(parsed)
                if parsed:
                    return parsed
        except (json.JSONDecodeError, TypeError):
            pass

        if "```" in raw_stripped:
            for block in raw_stripped.split("```"):
                block = block.strip()
                if block.startswith("json"):
                    block = block[4:].strip()
                try:
                    parsed = json.loads(block, strict=False)
                    if isinstance(parsed, dict) and "reply" in parsed:
                        return self._extract_parsed(parsed)
                except (json.JSONDecodeError, TypeError):
                    continue

        for i in range(len(raw_stripped)):
            if raw_stripped[i] == "{":
                for j in range(len(raw_stripped), i, -1):
                    if raw_stripped[j - 1] == "}":
                        try:
                            parsed = json.loads(raw_stripped[i:j], strict=False)
                            if isinstance(parsed, dict) and "reply" in parsed:
                                return self._extract_parsed(parsed)
                        except (json.JSONDecodeError, TypeError):
                            continue
                break

        clean = raw_stripped
        brace_idx = clean.find("{")
        if brace_idx >= 0:
            close_idx = clean.rfind("}")
            if close_idx > brace_idx:
                clean = (clean[:brace_idx] + clean[close_idx + 1 :]).strip()
        # Safety: never leak a raw JSON envelope to chat output. If the
        # stripped prose is empty and the original looks envelope-shaped,
        # last-ditch regex-pluck the reply value; otherwise substitute a
        # generic formatting-error message (P0 #380). Empty input stays empty.
        if not clean and raw_stripped:
            reply_match = re.search(r'"reply"\s*:\s*"((?:[^"\\]|\\.)*)"', raw_stripped, re.DOTALL)
            if reply_match:
                try:
                    clean = json.loads(f'"{reply_match.group(1)}"', strict=False)
                except (json.JSONDecodeError, TypeError):
                    clean = reply_match.group(1).replace("\\n", "\n").replace('\\"', '"')
            else:
                clean = "MIRA had trouble formatting that response. Please ask again."
        logger.warning("_parse_response fallback; raw=%r", raw_stripped[:200])
        return {"next_state": None, "reply": clean, "options": [], "confidence": "LOW"}

    @staticmethod
    def _salvage_groq_json(parsed: dict) -> dict | None:
        """Attempt to extract a usable reply from non-standard Groq JSON.

        Groq's llama models often return ``{"follow_ups": [...]}`` or
        ``{"title": "..."}`` instead of the expected ``{"reply": "..."}``.
        """
        # {"follow_ups": ["Q1", "Q2", "Q3"]} → format as numbered list
        follow_ups = parsed.get("follow_ups") or parsed.get("suggestions")
        if isinstance(follow_ups, list) and follow_ups:
            text = "\n".join(f"{i + 1}. {q}" for i, q in enumerate(follow_ups[:4]))
            return {
                "next_state": None,
                "reply": text,
                "options": follow_ups[:4],
                "confidence": "LOW",
            }

        # {"title": "..."} → use as reply
        title = parsed.get("title")
        if isinstance(title, str) and title.strip():
            return {"next_state": None, "reply": title.strip(), "options": [], "confidence": "LOW"}

        # {"queries": ["...", "..."]} → search queries, use first as reply
        queries = parsed.get("queries")
        if isinstance(queries, list) and queries:
            return {"next_state": None, "reply": queries[0], "options": [], "confidence": "LOW"}

        # {"tags": ["...", "..."]} → not useful as a reply
        return None

    @staticmethod
    def _extract_parsed(parsed: dict) -> dict:
        """Normalize a parsed JSON envelope into standard form."""
        raw_conf = parsed.get("confidence", "LOW")
        confidence = raw_conf if raw_conf in ("HIGH", "MEDIUM", "LOW") else "LOW"
        return {
            "next_state": parsed.get("next_state"),
            "reply": parsed["reply"],
            "options": parsed.get("options", []),
            "confidence": confidence,
        }

    # ------------------------------------------------------------------
    # FSM state machine
    # ------------------------------------------------------------------

    _VALID_STATES = frozenset(
        STATE_ORDER + ["ASSET_IDENTIFIED", "ELECTRICAL_PRINT", "SAFETY_ALERT", "DIAGNOSIS_REVISION"]
    )

    def _advance_state(self, state: dict, parsed: dict) -> dict:
        """Advance FSM state based on parsed LLM response."""
        current = state["state"]
        reply_lower = parsed.get("reply", "").lower()

        # Safety override: fire when LLM explicitly sets next_state OR when a
        # safety keyword appears in the reply in an *observational* context
        # (hazard visible now). Conditional/instructional mentions like
        # "check for melted insulation" or "inspect for burn marks" are
        # legitimate diagnostic steps and must NOT escalate — see #498b43f.
        if parsed.get("next_state") == "SAFETY_ALERT" or _safety_is_observational(reply_lower):
            state["state"] = "SAFETY_ALERT"
            state["final_state"] = "SAFETY_ALERT"
            state["exchange_count"] += 1
            return state

        if current == "ELECTRICAL_PRINT":
            state["state"] = "ELECTRICAL_PRINT"
            state["exchange_count"] += 1
            return state

        if parsed.get("next_state"):
            proposed = _STATE_ALIASES.get(parsed["next_state"], parsed["next_state"])
            if proposed in self._VALID_STATES:
                state["state"] = proposed
            else:
                logger.warning(
                    "Invalid FSM state '%s' from LLM (current: %s) — holding at %s",
                    proposed,
                    current,
                    current,
                )
        else:
            if current == "ASSET_IDENTIFIED":
                state["state"] = "Q1"
            elif current == "DIAGNOSIS_REVISION":
                # No LLM-proposed state while in revision — treat as DIAGNOSIS so the
                # self-critique gate can run again on the regenerated response.
                state["state"] = "DIAGNOSIS"
            elif current in STATE_ORDER:
                idx = STATE_ORDER.index(current)
                if idx + 1 < len(STATE_ORDER):
                    state["state"] = STATE_ORDER[idx + 1]

        if state["state"] in ("RESOLVED", "SAFETY_ALERT"):
            state["final_state"] = state["state"]

        # Q-trap guard: if the FSM has been in Q-states for _MAX_Q_ROUNDS consecutive
        # turns, force a commit to DIAGNOSIS so the technician gets an answer.
        # Count every entry into a Q-state (including the first one from a non-Q
        # current) so IDLE→Q1→Q2→Q3 commits on round 3 rather than round 4.
        ctx_q = state.get("context") or {}
        if state["state"] in _Q_STATES:
            ctx_q["q_rounds"] = ctx_q.get("q_rounds", 0) + 1
            if ctx_q["q_rounds"] >= _MAX_Q_ROUNDS:
                logger.info(
                    "Q_TRAP_COMMIT chat_id=%s q_rounds=%d current=%s → DIAGNOSIS",
                    state.get("chat_id", "?"),
                    ctx_q["q_rounds"],
                    state["state"],
                )
                state["state"] = "DIAGNOSIS"
                ctx_q["q_rounds"] = 0
        else:
            ctx_q.pop("q_rounds", None)
        state["context"] = ctx_q

        if not state.get("fault_category"):
            for cat in (
                "comms",
                "communication",
                "power",
                "electrical",
                "mechanical",
                "vibration",
                "thermal",
                "temperature",
                "hydraulic",
                "pressure",
            ):
                if cat in reply_lower:
                    normalized = {
                        "communication": "comms",
                        "electrical": "power",
                        "vibration": "mechanical",
                        "temperature": "thermal",
                        "pressure": "hydraulic",
                    }
                    state["fault_category"] = normalized.get(cat, cat)
                    # Update cross-session memory with the latest fault category
                    if state.get("asset_identified"):
                        save_session(
                            state["chat_id"],
                            state["asset_identified"],
                            last_seen_fault=state["fault_category"],
                        )
                    break

        state["exchange_count"] += 1
        return state

    def _format_reply(self, parsed: dict) -> str:
        """Format parsed response for display."""
        reply = parsed["reply"]
        options = parsed.get("options", [])
        # LLMs often pre-number their options ("1. Drives"). Strip any leading
        # "N." / "N)" prefix so the enumerate() below doesn't emit "1. 1. Drives".
        meaningful = [
            re.sub(r"^\s*\d+[.):\-]\s*", "", str(o)).strip()
            for o in options
            if len(str(o).strip()) > 2
        ]
        meaningful = [o for o in meaningful if len(o) > 2]
        if meaningful and len(meaningful) >= 2:
            reply = deduplicate_options(reply, meaningful)
            reply += "\n\n" + "\n".join(f"{i + 1}. {opt}" for i, opt in enumerate(meaningful))
        return reply
