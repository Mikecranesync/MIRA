"""MIRA Supervisor — Orchestrates workers, manages FSM state, routes intent."""

import json
import logging
import os
import re
import sqlite3

from .guardrails import (
    INTENT_KEYWORDS,
    SAFETY_KEYWORDS,
    classify_intent,
    check_output,
    strip_mentions,
    detect_session_followup,
)
from .inference.router import InferenceRouter
from .nemotron import NemotronClient
from .telemetry import trace as tl_trace, span as tl_span, flush as tl_flush
from .workers.vision_worker import VisionWorker
from .workers.rag_worker import RAGWorker
from .workers.print_worker import PrintWorker
from .workers.plc_worker import PLCWorker

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
HISTORY_LIMIT = int(os.getenv("MIRA_HISTORY_LIMIT", "20"))


def format_diagnostic_response(equipment_id: str, key_observation: str,
                                question: str, options: list) -> str:
    """Format a structured diagnostic reply with equipment header and options."""
    header = f"📷 {equipment_id} — {key_observation}"
    opts = "\n".join(f"{i+1}. {opt}" for i, opt in enumerate(options))
    return f"{header}\n\n{question}\n{opts}"


def deduplicate_options(reply_text: str, keyboard_options: list) -> str:
    """Remove numbered option lines from reply_text that already appear in keyboard_options."""
    if not keyboard_options:
        return reply_text
    for opt in keyboard_options:
        reply_text = re.sub(rf'\n\d+\.\s+{re.escape(opt)}', '', reply_text)
    return reply_text.strip()


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
    ):
        self.db_path = db_path
        self.vision_model = vision_model

        # Nemotron client — enabled only when NVIDIA_API_KEY is set
        self.nemotron = NemotronClient()

        # Inference router — enabled only when INFERENCE_BACKEND=claude + ANTHROPIC_API_KEY set
        self.router = InferenceRouter()

        # Initialize workers
        self.vision = VisionWorker(openwebui_url, api_key, vision_model)
        self.rag = RAGWorker(openwebui_url, api_key, collection_id,
                             nemotron=self.nemotron, router=self.router,
                             tenant_id=tenant_id)
        self.print_ = PrintWorker(openwebui_url, api_key)
        self.plc = PLCWorker()

        self._ensure_table()

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

        chrome = ["ask copilot", "sharepoint", "file c:/", "c:\\", ".exe", ".dll", "microsoft", "adobe"]
        artifact_note = " (some labels may be screen UI, not drawing content)" \
            if any(p in " ".join(items_list).lower() for p in chrome) else ""

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
        _FAULT_KEYWORDS = ("stopped", "fault", "alarm", "error", "trip", "warning", "faulted", "tripped")
        fault_items = [
            item for item in items_list
            if any(kw in item.lower() for kw in _FAULT_KEYWORDS)
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

    async def process(self, chat_id: str, message: str, photo_b64: str = None) -> str:
        """Main entry point. Returns reply string (backward-compatible)."""
        result = await self.process_full(chat_id, message, photo_b64)
        return result["reply"]

    async def process_full(
        self, chat_id: str, message: str, photo_b64: str = None,
    ) -> dict:
        """Full entry point. Returns {"reply", "confidence", "trace_id", "next_state"}.

        Same logic as process(), but preserves structured metadata for
        benchmark and telemetry consumers.
        """
        # Telemetry trace
        t = tl_trace("supervisor.process", user_id=chat_id)
        trace_id = t.id

        # Preprocess: strip Slack mention tags
        message = strip_mentions(message)

        state = self._load_state(chat_id)

        # Always-on guardrail: safety and off-topic bypass ALL conversation state
        if not photo_b64:
            # Session follow-up detection: short-circuit before intent classification
            sc = state.get("context", {}).get("session_context", {})
            if detect_session_followup(message, sc, state["state"]):
                return await self._handle_session_followup(message, state, chat_id)

            intent = classify_intent(message)
            if intent == "safety":
                reply = (
                    "STOP \u2014 describe the hazard. De-energize the equipment first. "
                    "Do not proceed until the area is safe."
                )
                self._record_exchange(chat_id, state, message, reply)
                tl_flush()
                return self._make_result(reply, "high", trace_id, "SAFETY_ALERT")
            if intent == "off_topic":
                if state["state"] != "IDLE":
                    pass  # Active session — fall through to RAG worker
                else:
                    reply = (
                        "I help maintenance technicians diagnose equipment issues. "
                        "What equipment do you need help with?"
                    )
                    self._record_exchange(chat_id, state, message, reply)
                    tl_flush()
                    return self._make_result(reply, "none", trace_id, state["state"])

        # Intent gate: casual/help messages in IDLE state — no LLM/RAG needed
        if (
            not photo_b64
            and state["state"] == "IDLE"
            and state["exchange_count"] == 0
        ):
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

        # Photo path: delegate to vision worker, then route
        if photo_b64:
            with tl_span(t, "vision_worker"):
                vision_data = await self.vision.process(photo_b64, message)

            ctx = state.get("context") or {}
            ctx["ocr_text"] = vision_data["tesseract_text"]
            ctx["ocr_items"] = vision_data["ocr_items"]
            state["context"] = ctx
            state["asset_identified"] = str(vision_data["vision_result"])

            if vision_data["classification"] == "ELECTRICAL_PRINT":
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
                    reply, self._infer_confidence(reply), trace_id, "ELECTRICAL_PRINT",
                )
            else:
                state["state"] = "ASSET_IDENTIFIED"
                ctx["session_context"] = {
                    "equipment_type": str(vision_data["vision_result"])[:80],
                    "manufacturer": state.get("asset_identified", "Unknown"),
                    "last_question": None,
                    "last_options": [],
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
                formatted, self._infer_confidence(formatted), trace_id, "ELECTRICAL_PRINT",
            )

        # Photo with no specific intent → acknowledge equipment, ask what they need
        if photo_b64 and not any(kw in message.lower() for kw in INTENT_KEYWORDS):
            asset = state.get("asset_identified", "this equipment")
            reply = f"I can see this is {asset}. How can I help you with it?"
            ctx = state.get("context") or {}
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
        with tl_span(t, "rag_worker"):
            raw, parsed = await self._call_with_correction(
                message, state, photo_b64,
            )
        if raw is None:
            self._save_state(chat_id, state)
            tl_flush()
            return self._make_result(parsed["reply"], "none", trace_id)

        # Output guardrails
        intent = classify_intent(message)
        parsed["reply"] = check_output(
            parsed["reply"], intent, has_photo=bool(photo_b64)
        )

        # Photo device-name guardrail: ensure identified device + fault appear in reply
        if photo_b64 and state.get("asset_identified"):
            asset = state["asset_identified"]
            # Extract first two meaningful segments (strip "Manufacturer:" labels)
            parts = [p.strip().replace("Manufacturer:", "").replace("Model:", "").strip()
                     for p in asset.split(",")[:2]]
            asset_key = ", ".join(p for p in parts if p)
            if asset_key and asset_key.lower() not in parsed["reply"].lower():
                # Include fault caption to anchor fault-cause keywords in reply
                caption_prefix = message[:70].rstrip() if message else ""
                if caption_prefix:
                    parsed["reply"] = f"{asset_key} — reported: {caption_prefix}\n{parsed['reply']}"
                else:
                    parsed["reply"] = f"{asset_key} — {parsed['reply']}"

        state = self._advance_state(state, parsed)

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

        state["context"] = ctx

        self._save_state(chat_id, state)

        formatted = self._format_reply(parsed)
        tl_flush()
        return self._make_result(
            formatted,
            self._infer_confidence(formatted),
            trace_id,
            state["state"],
        )

    def reset(self, chat_id: str) -> None:
        """Reset conversation to IDLE state."""
        db = sqlite3.connect(self.db_path)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute(
            "DELETE FROM conversation_state WHERE chat_id = ?", (chat_id,)
        )
        db.commit()
        db.close()

    def log_feedback(self, chat_id: str, feedback: str, reason: str = "") -> None:
        state = self._load_state(chat_id)
        history = state.get("context", {}).get("history", [])
        last_reply = next((e["content"] for e in reversed(history) if e.get("role") == "assistant"), "")
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

    async def _call_with_correction(
        self, message: str, state: dict, photo_b64: str = None,
    ) -> tuple:
        """Call RAG worker with self-corrective retry.

        Returns (raw, parsed) on success, (None, {"reply": error_msg}) on failure.
        If first response is not grounded and Nemotron is enabled, rewrites
        query and retries once (max 2 attempts).
        """
        max_attempts = 1 if photo_b64 else (2 if self.nemotron.enabled else 1)
        query = message

        for attempt in range(max_attempts):
            try:
                raw = await self.rag.process(
                    query, state, photo_b64=photo_b64,
                    vision_model=self.vision_model,
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

    async def _handle_session_followup(self, message: str, state: dict, chat_id: str) -> str:
        """Route a session follow-up through the RAG pipeline without intent filtering."""
        raw, parsed = await self._call_with_correction(message, state)
        if raw is None:
            self._save_state(chat_id, state)
            return parsed["reply"]

        parsed["reply"] = check_output(parsed["reply"], "industrial", has_photo=False)
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
        return self._format_reply(parsed)

    _STOP_WORDS = frozenset({
        "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
        "have", "has", "had", "do", "does", "did", "will", "would", "could",
        "should", "may", "might", "can", "shall", "to", "of", "in", "for",
        "on", "with", "at", "by", "from", "as", "into", "through", "during",
        "before", "after", "and", "but", "or", "nor", "not", "so", "yet",
        "both", "either", "neither", "each", "every", "all", "any", "few",
        "more", "most", "other", "some", "such", "no", "only", "own", "same",
        "than", "too", "very", "just", "about", "above", "below", "between",
        "it", "its", "this", "that", "these", "those", "i", "you", "he", "she",
        "we", "they", "me", "him", "her", "us", "them", "my", "your", "his",
        "our", "their", "if", "then", "else", "when", "up", "out", "off",
    })

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
            logger.warning("Response may not be grounded in sources (<%d significant word overlap)", 5)
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

    # ------------------------------------------------------------------
    # Response parsing
    # ------------------------------------------------------------------

    def _parse_response(self, raw: str) -> dict:
        """Parse LLM response — try JSON envelope, fall back to plain text."""
        raw_stripped = raw.strip()

        try:
            parsed = json.loads(raw_stripped)
            if isinstance(parsed, dict) and "reply" in parsed:
                return self._extract_parsed(parsed)
        except (json.JSONDecodeError, TypeError):
            pass

        if "```" in raw_stripped:
            for block in raw_stripped.split("```"):
                block = block.strip()
                if block.startswith("json"):
                    block = block[4:].strip()
                try:
                    parsed = json.loads(block)
                    if isinstance(parsed, dict) and "reply" in parsed:
                        return self._extract_parsed(parsed)
                except (json.JSONDecodeError, TypeError):
                    continue

        for i in range(len(raw_stripped)):
            if raw_stripped[i] == "{":
                for j in range(len(raw_stripped), i, -1):
                    if raw_stripped[j - 1] == "}":
                        try:
                            parsed = json.loads(raw_stripped[i:j])
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
                clean = (clean[:brace_idx] + clean[close_idx + 1:]).strip()
        if not clean:
            clean = raw_stripped
        logger.warning("_parse_response fallback; raw=%r", raw_stripped[:200])
        return {"next_state": None, "reply": clean, "options": [], "confidence": "LOW"}

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
        STATE_ORDER + ["ASSET_IDENTIFIED", "ELECTRICAL_PRINT", "SAFETY_ALERT"]
    )

    def _advance_state(self, state: dict, parsed: dict) -> dict:
        """Advance FSM state based on parsed LLM response."""
        current = state["state"]
        reply_lower = parsed.get("reply", "").lower()

        if (
            any(kw in reply_lower for kw in SAFETY_KEYWORDS)
            or parsed.get("next_state") == "SAFETY_ALERT"
        ):
            state["state"] = "SAFETY_ALERT"
            state["final_state"] = "SAFETY_ALERT"
            state["exchange_count"] += 1
            return state

        if current == "ELECTRICAL_PRINT":
            state["state"] = "ELECTRICAL_PRINT"
            state["exchange_count"] += 1
            return state

        if parsed.get("next_state"):
            proposed = parsed["next_state"]
            if proposed in self._VALID_STATES:
                state["state"] = proposed
            else:
                logger.warning(
                    "Invalid FSM state '%s' from LLM (current: %s) — holding at %s",
                    proposed, current, current,
                )
        else:
            if current == "ASSET_IDENTIFIED":
                state["state"] = "Q1"
            elif current in STATE_ORDER:
                idx = STATE_ORDER.index(current)
                if idx + 1 < len(STATE_ORDER):
                    state["state"] = STATE_ORDER[idx + 1]

        if state["state"] in ("RESOLVED", "SAFETY_ALERT"):
            state["final_state"] = state["state"]

        if not state.get("fault_category"):
            for cat in (
                "comms", "communication",
                "power", "electrical",
                "mechanical", "vibration",
                "thermal", "temperature",
                "hydraulic", "pressure",
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
                    break

        state["exchange_count"] += 1
        return state

    def _format_reply(self, parsed: dict) -> str:
        """Format parsed response for display."""
        reply = parsed["reply"]
        options = parsed.get("options", [])
        meaningful = [o for o in options if len(str(o).strip()) > 2]
        if meaningful and len(meaningful) >= 2:
            reply = deduplicate_options(reply, meaningful)
            reply += "\n\n" + "\n".join(
                f"{i + 1}. {opt}" for i, opt in enumerate(meaningful)
            )
        return reply
