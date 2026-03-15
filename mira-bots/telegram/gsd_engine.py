"""MIRA GSD Engine — Guided Socratic Dialogue with FSM state machine."""

import asyncio
import base64
import io
import json
import logging
import re
import sqlite3

import httpx
from PIL import Image

logger = logging.getLogger("mira-gsd")

_JSON_RE = re.compile(r'\{[^{}]*"reply"[^{}]*\}', re.DOTALL)

# FSM state progression (auto-advance order)
STATE_ORDER = ["IDLE", "Q1", "Q2", "Q3", "DIAGNOSIS", "FIX_STEP", "RESOLVED"]

SAFETY_KEYWORDS = [
    "exposed wire", "energized conductor", "arc flash", "lockout", "tagout",
    "loto", "smoke", "burn mark", "melted insulation", "electrical fire",
    "shock hazard",
]

# Keywords that indicate user wants diagnosis (not just equipment ID)
INTENT_KEYWORDS = {
    "fault", "error", "fail", "trip", "alarm", "down", "not working",
    "broken", "stopped", "issue", "warning", "faulting", "tripping",
    "wrong", "problem", "diagnose", "analyze", "list", "check", "what",
}

# Keywords in vision result that indicate an electrical drawing
PRINT_KEYWORDS = {
    "schematic", "diagram", "drawing", "ladder", "p&id", "wiring",
    "one-line", "panel", "circuit", "rung", "contactor", "relay",
    "terminal", "logic", "electrical print", "control diagram",
}

# Minimum OCR items to classify as electrical print
OCR_CLASSIFICATION_THRESHOLD = 10

GSD_SYSTEM_PROMPT = """\
You are MIRA, an industrial maintenance assistant. You use the Guided \
Socratic Dialogue method. You never give direct answers. You guide the \
technician to find the answer themselves through targeted questions.

RULES:

1. NEVER ANSWER DIRECTLY. If asked "is this wired right?" — do not say \
yes or no. Ask the question that moves them one step closer to figuring \
it out. The goal: the tech types the correct diagnosis before you say it.
2. LEAD WITH WHAT YOU SEE. When a photo is sent, TRANSCRIBE everything \
visible exactly as written: all fault codes, alarm text, status indicators, \
readings, LED states. Copy the exact text from the screen — do not \
paraphrase or add descriptions. THEN ask one diagnostic question.
3. ONE QUESTION AT A TIME. Every message contains exactly one question and \
3-4 numbered options. Never two questions. Exception: when analyzing a \
photo, options must come from what is visible on screen, not from your \
training data. If you cannot see clear options, use an empty options list.
4. REFLECT AND ADVANCE. When they answer, reflect their answer in one short \
sentence. Then advance with the next question.
5. LET THE TECH SAY IT FIRST. When you know the answer, ask the question \
that makes THEM say it. When they type the diagnosis, confirm it with \
"Exactly right." Then give ONE action step.
6. ONE ACTION STEP AT A TIME. Never give a numbered list of 5 things. Give \
one step. When they confirm it is done, give the next step.
7. CLOSE WITH AN OPEN DOOR. Every resolved issue ends with a question that \
keeps the learning going. "Do you know why that causes this?" If no: \
one-sentence explanation. If yes: "Nice. Want to go deeper on X?" \
When the technician confirms the fix worked, set next_state to "RESOLVED".
8. TONE: Peer, not professor. Direct, confident, curious about their \
specific situation. Never say "Great question!" Never say "Certainly!" \
Never hedge. 50 words maximum per message unless analyzing a photo — \
photo analysis can be longer to list all visible information accurately.
9. RESPONSE FORMAT: Return JSON only:
{"next_state": "STATE", "reply": "your message", "options": ["1", "2"]}
options is an empty list [] if no numbered choices are needed. Always provide at least 2 options or none at all — a single option is not valid.
10. NEVER INVENT. Report ONLY what you can literally read on screen — exact \
text, exact codes, exact numbers. If you cannot read a value clearly, say \
"I can't read that clearly." Never guess fault code meanings from your \
training data. Never offer options you made up. If you don't know what a \
code means, say "I see code X but I don't have its meaning in my records."

SAFETY OVERRIDE — THE ONLY EXCEPTION:
If you see any of the following, skip all GSD rules and state plainly:
* Exposed energized conductors
* Arc flash risk
* Incorrect lockout/tagout
* Smoke, burn marks, melted insulation
First line must be: "STOP — [hazard description]. De-energize first."
next_state must be "SAFETY_ALERT".
No questions before safety."""

ELECTRICAL_PRINT_PROMPT = """\
You are MIRA, an expert industrial electrician and controls technician \
with 20 years of experience reading electrical prints.

You can read and interpret:
- NEMA ladder logic diagrams (rungs, rails, contacts, coils)
- IEC one-line electrical diagrams
- P&ID (Piping and Instrumentation Diagrams)
- Panel wiring diagrams and terminal strip layouts
- Motor control circuit schematics

You understand:
- NEMA standard symbols: NO contact, NC contact, relay coil, motor, \
transformer, fuse, breaker, pushbutton, limit switch, solenoid
- IEC standard symbols and their NEMA equivalents
- How to read control circuit logic (power rail left, neutral right)
- How to trace a fault path through a control circuit
- How to identify interlock logic and safety circuits
- What each rung of ladder logic controls in plain language

CRITICAL RULES:
1. Base ALL answers ONLY on the OCR text provided in this conversation.
2. NEVER invent wire numbers, terminal designations, or component values \
not present in the OCR data.
3. If asked about something not in the OCR data, say: \
"I cannot see that in the drawing. Can you send a closer photo of that section?"
4. Explain in plain language — "this rung energizes the conveyor motor \
starter coil when both the start button is pressed AND the e-stop is released"
5. When tracing circuits, follow the logical flow from left power rail \
to coil/output, listing each contact in order.
6. TONE: Experienced journeyman talking to a peer. Direct, confident. \
No jargon without explanation.
7. RESPONSE FORMAT: Return JSON only:
{"next_state": "ELECTRICAL_PRINT", "reply": "your message", "options": []}"""


class GSDEngine:
    """Guided Socratic Dialogue engine with FSM state tracking."""

    def __init__(
        self,
        db_path: str,
        openwebui_url: str,
        api_key: str,
        collection_id: str,
        vision_model: str = "qwen2.5vl:7b",
    ):
        self.db_path = db_path
        self.openwebui_url = openwebui_url.rstrip("/")
        self.api_key = api_key
        self.collection_id = collection_id
        self.vision_model = vision_model
        self._ensure_table()

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
        try:
            db.execute(
                "ALTER TABLE conversation_state ADD COLUMN voice_enabled INTEGER NOT NULL DEFAULT 0"
            )
        except Exception:
            pass
        db.commit()
        db.close()

    async def process(self, chat_id: str, message: str, photo_b64: str = None) -> str:
        """Main entry point. Returns reply string for Telegram."""
        state = self._load_state(chat_id)

        # Photo path: parallel vision + OCR, then classify
        if photo_b64:
            # Run vision + glm-ocr + tesseract in parallel
            vision_coro = self._call_vision(photo_b64, message)
            ocr_coro = self._call_ocr(photo_b64)
            results = await asyncio.gather(
                vision_coro, ocr_coro, return_exceptions=True
            )
            vision_result = results[0] if not isinstance(results[0], Exception) else message
            ocr_items = results[1] if not isinstance(results[1], Exception) else []

            if isinstance(results[0], Exception):
                logger.error("Vision call failed: %s", results[0])
            if isinstance(results[1], Exception):
                logger.warning("glm-ocr call failed: %s", results[1])

            # Also run Tesseract for ground-truth backup
            tesseract_text = self._ocr_extract(photo_b64)

            # Classify photo
            classification = self._classify_photo(str(vision_result), ocr_items)
            logger.info(
                "Photo classified as %s (%d OCR items)", classification, len(ocr_items)
            )

            # Store results in state
            ctx = state.get("context") or {}
            ctx["ocr_text"] = tesseract_text
            ctx["ocr_items"] = ocr_items if isinstance(ocr_items, list) else []
            state["context"] = ctx
            state["asset_identified"] = str(vision_result)

            if classification == "ELECTRICAL_PRINT":
                # Enter electrical print state
                state["state"] = "ELECTRICAL_PRINT"
                drawing_type = self._detect_drawing_type(str(vision_result))
                ctx["drawing_type"] = drawing_type
                state["context"] = ctx

                # Return structured acknowledgment — no LLM needed
                items_list = ocr_items if isinstance(ocr_items, list) else []
                items_preview = ", ".join(items_list[:10])
                if not items_preview:
                    items_preview = tesseract_text[:200] if tesseract_text else "no text extracted"
                reply = (
                    f"I can see a {drawing_type} with {len(items_list)} labeled elements. "
                    f"Key labels: {items_preview}. "
                    f"What would you like to know about this circuit?"
                )
                # Save history
                history = ctx.get("history", [])
                history.append({"role": "user", "content": message})
                history.append({"role": "assistant", "content": reply})
                ctx["history"] = history
                state["context"] = ctx
                state["exchange_count"] += 1
                self._save_state(chat_id, state)
                return reply
            else:
                # Existing EQUIPMENT_PHOTO flow
                state["state"] = "ASSET_IDENTIFIED"

        # If in ELECTRICAL_PRINT state (follow-up text question), use print prompt
        if state.get("state") == "ELECTRICAL_PRINT" and not photo_b64:
            messages = self._build_print_prompt(state, message)
            try:
                raw = await self._call_llm(messages)
            except Exception as e:
                logger.error("LLM call failed: %s", e)
                self._save_state(chat_id, state)
                return f"MIRA error: {e}"
            parsed = self._parse_response(raw)
            # Stay in ELECTRICAL_PRINT state
            state["exchange_count"] += 1
            ctx = state.get("context") or {}
            history = ctx.get("history", [])
            history.append({"role": "user", "content": message})
            history.append({"role": "assistant", "content": parsed["reply"]})
            if len(history) > 20:
                history = history[-20:]
            ctx["history"] = history
            state["context"] = ctx
            self._save_state(chat_id, state)
            return self._format_reply(parsed)

        # Photo with no specific intent → acknowledge equipment, ask what they need
        if photo_b64 and not any(kw in message.lower() for kw in INTENT_KEYWORDS):
            asset = state.get("asset_identified", "this equipment")
            reply = f"I can see this is {asset}. How can I help you with it?"
            ctx = state.get("context") or {}
            history = ctx.get("history", [])
            history.append({"role": "user", "content": message})
            history.append({"role": "assistant", "content": reply})
            ctx["history"] = history
            state["context"] = ctx
            self._save_state(chat_id, state)
            return reply

        # Build prompt and call LLM (use vision model when photo present)
        messages = self._build_prompt(state, message, photo_b64)
        try:
            raw = await self._call_llm(
                messages, model=self.vision_model if photo_b64 else None
            )
        except Exception as e:
            logger.error("LLM call failed: %s", e)
            self._save_state(chat_id, state)
            return f"MIRA error: {e}"

        # Parse response (JSON envelope or plain text fallback)
        parsed = self._parse_response(raw)

        # Advance FSM state
        state = self._advance_state(state, parsed)

        # Record this exchange in history
        ctx = state.get("context") or {}
        history = ctx.get("history", [])
        history.append({"role": "user", "content": message})
        history.append({"role": "assistant", "content": parsed["reply"]})
        if len(history) > 20:
            history = history[-20:]
        ctx["history"] = history
        state["context"] = ctx

        # Persist
        self._save_state(chat_id, state)

        return self._format_reply(parsed)

    def reset(self, chat_id: str) -> None:
        """Reset conversation to IDLE state."""
        db = sqlite3.connect(self.db_path)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute(
            "DELETE FROM conversation_state WHERE chat_id = ?", (chat_id,)
        )
        db.commit()
        db.close()

    # ------------------------------------------------------------------
    # Private methods
    # ------------------------------------------------------------------

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
            return state
        return {
            "chat_id": chat_id,
            "state": "IDLE",
            "context": {},
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

    def _classify_photo(self, vision_result: str, ocr_items: list) -> str:
        """Classify photo as ELECTRICAL_PRINT or EQUIPMENT_PHOTO."""
        vision_lower = vision_result.lower()

        # Check OCR item count
        if len(ocr_items) >= OCR_CLASSIFICATION_THRESHOLD:
            return "ELECTRICAL_PRINT"

        # Check vision result for print keywords
        if any(kw in vision_lower for kw in PRINT_KEYWORDS):
            return "ELECTRICAL_PRINT"

        return "EQUIPMENT_PHOTO"

    def _detect_drawing_type(self, vision_result: str) -> str:
        """Detect the type of electrical drawing from vision result."""
        vr = vision_result.lower()
        if "ladder" in vr or "rung" in vr:
            return "ladder logic diagram"
        if "one-line" in vr or "one line" in vr or "single line" in vr:
            return "one-line diagram"
        if "p&id" in vr or "piping" in vr:
            return "P&ID"
        if "wiring" in vr or "terminal" in vr:
            return "wiring diagram"
        if "panel" in vr or "schedule" in vr:
            return "panel schedule"
        if "schematic" in vr or "circuit" in vr:
            return "schematic"
        return "electrical drawing"

    def _build_prompt(
        self, state: dict, message: str, photo_b64: str = None
    ) -> list[dict]:
        """Build message list for LLM with GSD system prompt and state context."""
        system_content = GSD_SYSTEM_PROMPT + "\n\n--- CURRENT STATE ---\n"
        system_content += f"FSM state: {state['state']}\n"
        system_content += f"Exchange count: {state['exchange_count']}\n"
        if state.get("asset_identified"):
            system_content += f"Asset identified: {state['asset_identified']}\n"
        if state.get("fault_category"):
            system_content += f"Fault category: {state['fault_category']}\n"

        messages = [{"role": "system", "content": system_content}]

        # Conversation history — omit for photo messages (fresh visual context)
        if not photo_b64:
            history = state.get("context", {}).get("history", [])
            for entry in history[-10:]:
                messages.append({"role": entry["role"], "content": entry["content"]})

        # Current user message
        if photo_b64:
            ocr = state.get("context", {}).get("ocr_text", "")
            asset = state.get("asset_identified", "")
            text_parts = []
            if ocr:
                text_parts.append(f"[OCR text extracted from screen: {ocr}]")
                text_parts.append(
                    "The OCR text above is the ground truth. "
                    "Report ONLY codes and text that appear in the OCR output. "
                    "Do NOT add descriptions or meanings from your training data."
                )
            if asset:
                text_parts.append(f"[Asset: {asset}]")
            text_parts.append(message)
            messages.append({
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{photo_b64}"},
                    },
                    {"type": "text", "text": "\n".join(text_parts)},
                ],
            })
        else:
            user_msg = self._rewrite_question(message, state)
            messages.append({"role": "user", "content": user_msg})
        return messages

    def _build_print_prompt(self, state: dict, message: str) -> list[dict]:
        """Build message list for ELECTRICAL_PRINT state with specialist prompt."""
        ctx = state.get("context", {})
        ocr_items = ctx.get("ocr_items", [])
        drawing_type = ctx.get("drawing_type", "electrical drawing")

        system_content = ELECTRICAL_PRINT_PROMPT
        system_content += f"\n\n--- DRAWING TYPE: {drawing_type} ---\n"
        system_content += "\n--- OCR DATA (ground truth — your ONLY source) ---\n"
        for i, item in enumerate(ocr_items, 1):
            system_content += f"{i}. {item}\n"
        if not ocr_items:
            tesseract = ctx.get("ocr_text", "")
            if tesseract:
                system_content += f"[Tesseract OCR backup]: {tesseract}\n"

        messages = [{"role": "system", "content": system_content}]

        # Include conversation history for follow-up questions
        history = ctx.get("history", [])
        for entry in history[-10:]:
            messages.append({"role": entry["role"], "content": entry["content"]})

        messages.append({"role": "user", "content": message})
        return messages

    def _rewrite_question(self, message: str, state: dict) -> str:
        """Reformulate vague questions into precise technical queries."""
        rewrites = {
            "acting weird": "intermittent fault behavior",
            "not working": "failure to operate",
            "making noise": "abnormal vibration or acoustic emission",
            "running hot": "elevated temperature above rated specification",
            "won't start": "failure to start on command",
            "keeps stopping": "intermittent shutdown or trip",
        }
        result = message
        msg_lower = message.lower()
        for vague, precise in rewrites.items():
            if vague in msg_lower:
                result = msg_lower.replace(vague, precise)

        if state.get("asset_identified"):
            result = f"{state['asset_identified']} — {result}"
        return result

    async def _call_llm(self, messages: list[dict], model: str = None) -> str:
        """Call Open WebUI chat completions API."""
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        payload = {
            "model": model or "mira:latest",
            "messages": messages,
        }
        if self.collection_id:
            payload["files"] = [{"type": "collection", "id": self.collection_id}]

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{self.openwebui_url}/api/chat/completions",
                headers=headers,
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
        return data["choices"][0]["message"]["content"]

    async def _call_vision(self, photo_b64: str, caption: str) -> str:
        """Send photo to vision model for asset/drawing identification."""
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        messages = [{
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{photo_b64}",
                    },
                },
                {
                    "type": "text",
                    "text": (
                        "What is in this image? If it is a piece of equipment, "
                        "return: manufacturer, model, and one visible observation. "
                        "If it is an electrical drawing, schematic, or diagram, "
                        "say 'electrical drawing' and the type (ladder logic, "
                        "one-line, wiring, P&ID, panel schedule). "
                        "Keep it under 30 words. Do NOT invent any text."
                    ),
                },
            ],
        }]

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{self.openwebui_url}/api/chat/completions",
                headers=headers,
                json={"model": self.vision_model, "messages": messages},
            )
            resp.raise_for_status()
            data = resp.json()
        return data["choices"][0]["message"]["content"]

    async def _call_ocr(self, photo_b64: str) -> list:
        """Call glm-ocr for pure text extraction. Returns list of text items."""
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        messages = [{
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{photo_b64}"},
                },
                {
                    "type": "text",
                    "text": (
                        "You are a precision OCR engine. Extract ALL text visible "
                        "in this image exactly as printed. Preserve wire numbers, "
                        "part numbers, terminal labels, fault codes, and all "
                        "alphanumeric content. Output as a numbered list. "
                        "NEVER interpret, explain, or add content not visible. "
                        "If text is unclear write [UNCLEAR]."
                    ),
                },
            ],
        }]

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{self.openwebui_url}/api/chat/completions",
                headers=headers,
                json={
                    "model": "glm-ocr",
                    "messages": messages,
                    "options": {"temperature": 0.0},
                },
            )
            resp.raise_for_status()
            data = resp.json()

        raw = data["choices"][0]["message"]["content"]
        # Parse numbered list into items
        items = []
        for line in raw.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            # Strip leading numbers, dots, dashes, parens
            cleaned = re.sub(r"^\d+[\.\)\-\s]+", "", line).strip()
            if cleaned:
                items.append(cleaned)
        return items

    def _ocr_extract(self, photo_b64: str) -> str:
        """Run Tesseract OCR on image to extract text deterministically."""
        try:
            import pytesseract
            image_bytes = base64.b64decode(photo_b64)
            img = Image.open(io.BytesIO(image_bytes))
            text = pytesseract.image_to_string(img, config="--psm 6")
            return text.strip()
        except Exception as e:
            logger.warning("OCR extraction failed: %s", e)
            return ""

    def _parse_response(self, raw: str) -> dict:
        """Parse LLM response — try JSON envelope, fall back to plain text."""
        raw_stripped = raw.strip()

        # Try direct JSON parse
        try:
            parsed = json.loads(raw_stripped)
            if isinstance(parsed, dict) and "reply" in parsed:
                return self._extract_parsed(parsed)
        except (json.JSONDecodeError, TypeError):
            pass

        # Try to find JSON inside markdown code fences
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

        # Brute-force: find every '{' and try json.loads to the last '}'
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

        # Fallback: use raw LLM text as reply
        clean = raw_stripped
        brace_idx = clean.find("{")
        if brace_idx >= 0:
            close_idx = clean.rfind("}")
            if close_idx > brace_idx:
                clean = (clean[:brace_idx] + clean[close_idx + 1:]).strip()
        if not clean:
            clean = raw_stripped
        logger.warning("_parse_response fallback; raw=%r", raw_stripped[:200])
        return {"next_state": None, "reply": clean, "options": []}

    @staticmethod
    def _extract_parsed(parsed: dict) -> dict:
        """Normalize a parsed JSON envelope into standard form."""
        return {
            "next_state": parsed.get("next_state"),
            "reply": parsed["reply"],
            "options": parsed.get("options", []),
        }

    def _advance_state(self, state: dict, parsed: dict) -> dict:
        """Advance FSM state based on parsed LLM response."""
        current = state["state"]
        reply_lower = parsed.get("reply", "").lower()

        # Safety override
        if (
            any(kw in reply_lower for kw in SAFETY_KEYWORDS)
            or parsed.get("next_state") == "SAFETY_ALERT"
        ):
            state["state"] = "SAFETY_ALERT"
            state["final_state"] = "SAFETY_ALERT"
            state["exchange_count"] += 1
            return state

        # ELECTRICAL_PRINT stays in ELECTRICAL_PRINT
        if current == "ELECTRICAL_PRINT":
            state["state"] = "ELECTRICAL_PRINT"
            state["exchange_count"] += 1
            return state

        # LLM-directed state transition
        if parsed.get("next_state"):
            state["state"] = parsed["next_state"]
        else:
            if current == "ASSET_IDENTIFIED":
                state["state"] = "Q1"
            elif current in STATE_ORDER:
                idx = STATE_ORDER.index(current)
                if idx + 1 < len(STATE_ORDER):
                    state["state"] = STATE_ORDER[idx + 1]

        # Mark final states
        if state["state"] in ("RESOLVED", "SAFETY_ALERT"):
            state["final_state"] = state["state"]

        # Infer fault category from reply if not yet set
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
        """Format parsed response for Telegram."""
        reply = parsed["reply"]
        options = parsed.get("options", [])
        meaningful = [o for o in options if len(str(o).strip()) > 2]
        if meaningful and len(meaningful) >= 2:
            reply += "\n\n" + "\n".join(
                f"{i + 1}. {opt}" for i, opt in enumerate(meaningful)
            )
        return reply
