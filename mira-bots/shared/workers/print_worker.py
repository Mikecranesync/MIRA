"""Print Worker — Electrical print reading specialist."""

import json
import logging
import time

import httpx

logger = logging.getLogger("mira-gsd")

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
4. Explain in plain language \u2014 "this rung energizes the conveyor motor \
starter coil when both the start button is pressed AND the e-stop is released"
5. When tracing circuits, follow the logical flow from left power rail \
to coil/output, listing each contact in order.
6. TONE: Experienced journeyman talking to a peer. Direct, confident. \
No jargon without explanation.
7. RESPONSE FORMAT: Return JSON only:
{"next_state": "ELECTRICAL_PRINT", "reply": "your message", "options": []}"""


class PrintWorker:
    """Handles electrical print analysis and follow-up questions."""

    def __init__(self, openwebui_url: str, api_key: str):
        self.openwebui_url = openwebui_url.rstrip("/")
        self.api_key = api_key

    async def process(self, message: str, state: dict) -> str:
        """Build print-specialist prompt and call LLM. Returns raw response."""
        messages = self._build_print_prompt(state, message)
        return await self._call_llm(messages)

    def _build_print_prompt(self, state: dict, message: str) -> list[dict]:
        """Build message list for ELECTRICAL_PRINT state with specialist prompt."""
        ctx = state.get("context", {})
        ocr_items = ctx.get("ocr_items", [])
        drawing_type = ctx.get("drawing_type", "electrical drawing")

        system_content = ELECTRICAL_PRINT_PROMPT
        system_content += f"\n\n--- DRAWING TYPE: {drawing_type} ---\n"
        system_content += "\n--- OCR DATA (ground truth \u2014 your ONLY source) ---\n"
        for i, item in enumerate(ocr_items, 1):
            system_content += f"{i}. {item}\n"
        if not ocr_items:
            tesseract = ctx.get("ocr_text", "")
            if tesseract:
                system_content += f"[Tesseract OCR backup]: {tesseract}\n"

        messages = [{"role": "system", "content": system_content}]

        history = ctx.get("history", [])
        for entry in history[-10:]:
            messages.append({"role": entry["role"], "content": entry["content"]})

        messages.append({"role": "user", "content": message})
        return messages

    async def _call_llm(self, messages: list[dict], model: str = None) -> str:
        """Call Open WebUI chat completions API."""
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        payload = {
            "model": model or "mira:latest",
            "messages": messages,
            "options": {"temperature": 0.1},
        }

        t0 = time.monotonic()
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{self.openwebui_url}/api/chat/completions",
                headers=headers,
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
        elapsed_ms = int((time.monotonic() - t0) * 1000)

        logger.info("LLM_CALL worker=print %s", json.dumps({
            "model": model or "mira:latest",
            "latency_ms": elapsed_ms,
        }))

        return data["choices"][0]["message"]["content"]
