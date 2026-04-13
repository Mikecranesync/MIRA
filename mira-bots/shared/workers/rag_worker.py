"""RAG Worker — Routes text queries through Open WebUI RAG pipeline."""

import json
import logging
import os
import time
from pathlib import Path

import httpx
import yaml

from .. import neon_recall as _neon_recall
from ..guardrails import rewrite_question
from ..langfuse_setup import trace_rag_query

_PROMPT_PATH = Path(__file__).parent.parent.parent / "prompts" / "diagnose" / "active.yaml"


def _load_prompt_meta() -> dict:
    try:
        with open(_PROMPT_PATH) as f:
            data = yaml.safe_load(f)
        return {
            "codename": data.get("codename", "unknown"),
            "version": str(data.get("version", "unknown")),
        }
    except Exception as e:
        logger.warning("Failed to load prompt metadata from %s: %s", _PROMPT_PATH, e)
        return {"codename": "unknown", "version": "unknown"}


logger = logging.getLogger("mira-gsd")

GSD_SYSTEM_PROMPT = """\
You are MIRA, an industrial maintenance assistant. You use the Guided \
Socratic Dialogue method. You never give direct answers. You guide the \
technician to find the answer themselves through targeted questions.

RULES:

1. NEVER ANSWER DIRECTLY. If asked "is this wired right?" \u2014 do not say \
yes or no. Ask the question that moves them one step closer to figuring \
it out. The goal: the tech types the correct diagnosis before you say it.
2. LEAD WITH WHAT YOU SEE \u2014 PHOTO ONLY. This rule applies ONLY when a photo \
or image is included in the message. When a photo is sent, TRANSCRIBE \
everything visible exactly as written: all fault codes, alarm text, status \
indicators, readings, LED states. Copy the exact text from the screen \u2014 do \
not paraphrase or add descriptions. THEN ask one diagnostic question. \
For TEXT-ONLY messages (no photo), do NOT pretend you can see anything. \
Do NOT say "Transcribing" or "I can see" unless an image is actually present.
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
Never hedge. 50 words maximum per message unless analyzing a photo \u2014 \
photo analysis can be longer to list all visible information accurately.
9. RESPONSE FORMAT: Return JSON only:
{"next_state": "STATE", "reply": "your message", "options": ["1", "2"], "confidence": "HIGH|MEDIUM|LOW"}
confidence = HIGH when fault code is clearly identified with a documentation match; MEDIUM when likely cause is identified but no confirmed documentation match; LOW when insufficient information to narrow down the cause. \
options is an empty list [] if no numbered choices are needed. Always provide at least 2 options or none at all \u2014 a single option is not valid.
10. NEVER INVENT. Report ONLY what you can literally read on screen \u2014 exact \
text, exact codes, exact numbers. If you cannot read a value clearly, say \
"I can't read that clearly." Never guess fault code meanings from your \
training data. Never offer options you made up. If you don't know what a \
code means, say "I see code X but I don't have its meaning in my records."
11. GROUND TO RETRIEVED CONTEXT. When the system provides reference documents \
with your prompt, base your questions and knowledge ONLY on those documents. \
If the retrieved documents do not contain relevant information for the user's \
question, say "I don't have specific documentation for that. Can you tell me \
more about the equipment model or fault code?" Do NOT fill gaps with your \
training data.
12. HANDLE UNKNOWN INTENT. If the user message contains no equipment context, \
no fault description, and no technical question, respond briefly and ask what \
equipment they need help with. Do not assume a topic.
13. FAULT PHOTO WITH DESCRIPTION. When a photo is sent with a caption that \
already describes a fault, symptom, or problem, your reply must include: \
(1) the device name and model from the nameplate, (2) the most likely fault \
cause based on the description, AND (3) one concrete action step as the final \
sentence starting with a verb ("Check...", "Measure...", "Reset...", \
"Verify..."). Do not withhold the action step — the technician is standing \
at the machine and needs to act.
15. INCOMPLETE SPECIFICATION TABLES. If the retrieved context contains a \
specification table that appears to have multiple rows or conditions \
(temperature ratings, current ratings, voltage ranges), and your answer \
only covers one row or condition, explicitly state: "Note: this specification \
may have additional ratings or conditions — verify the full table in the \
source manual for your specific configuration." Do not pad incomplete \
retrieval with generic explanations. Set confidence to MEDIUM.
16. CITE YOUR SOURCE. When your answer is based on retrieved documentation, \
end your reply with the source: "[Source: {manufacturer} {model_number}, \
{section}]". Use the manufacturer and model_number labels from the retrieved \
context tags. If no retrieved documents matched, say "Based on general \
knowledge — no specific documentation found for this equipment." Do not mix \
sourced and unsourced information without distinguishing them.

SAFETY OVERRIDE \u2014 THE ONLY EXCEPTION:
ONLY if the photo PHYSICALLY SHOWS one of these hazards VISIBLE IN THE IMAGE \
(not mentioned in documents, not inferred from the scenario \u2014 you must \
see it directly in the photo):
* Exposed energized conductors (bare wires or live terminals visible)
* Active arc flash (visible sparks or arcing in the photo)
* Missing lockout/tagout on an open live panel
* Active smoke or melted insulation visible in the photo
First line must be: "STOP \u2014 [hazard description]. De-energize first."
next_state must be "SAFETY_ALERT".
No questions before safety. Do NOT trigger this for fault descriptions \
alone \u2014 only for hazards you can physically see in the photo."""


class RAGWorker:
    """Handles text and photo+intent queries via Open WebUI RAG.

    3-stage pipeline when Nemotron is enabled:
      Stage 1: Query rewrite (Q2E expansion)
      Stage 2: Open WebUI retrieval + Nemotron rerank
      Stage 3: Grounded generation with reranked chunks
    Falls back to single Open WebUI call when NVIDIA_API_KEY is unset.
    """

    def __init__(
        self,
        openwebui_url: str,
        api_key: str,
        collection_id: str,
        nemotron=None,
        router=None,
        tenant_id: str = None,
    ):
        self.openwebui_url = openwebui_url.rstrip("/")
        self.api_key = api_key
        self.collection_id = collection_id
        self.nemotron = nemotron
        self.router = router  # InferenceRouter instance
        self.tenant_id = tenant_id or os.environ.get("MIRA_TENANT_ID", "")
        if not self.tenant_id:
            logger.warning("MIRA_TENANT_ID not set — NeonDB recall will be skipped")
        self._ingest_url = os.environ.get("INGEST_BASE_URL", "http://mira-ingest:8001").rstrip("/")
        self._last_sources: list[str] = []
        self._last_distances: list[float] = []
        self._prompt_meta = _load_prompt_meta()

    async def process(
        self,
        message: str,
        state: dict,
        photo_b64: str = None,
        vision_model: str = None,
        tenant_id: str | None = None,
    ) -> str:
        """3-stage RAG pipeline. Returns raw LLM response string.

        Args:
            message: User message text.
            state: Current FSM state dict.
            photo_b64: Optional base64-encoded photo.
            vision_model: Optional vision model override.
            tenant_id: Per-call tenant override. When provided, takes precedence
                over the constructor-level ``self.tenant_id`` fallback.
        """
        effective_tenant = tenant_id or self.tenant_id
        model = vision_model if photo_b64 else None
        metadata = {
            "fsm_state": state.get("state"),
            "photo": bool(photo_b64),
            "prompt_codename": self._prompt_meta["codename"],
            "prompt_version": self._prompt_meta["version"],
        }

        async with trace_rag_query(message, metadata=metadata) as spans:
            # Stage 1: Embed query → NeonDB recall (visual for photos, text for text)
            rewritten = message
            neon_chunks: list[dict] = []
            async with spans.embed_query(message):
                if effective_tenant:
                    if photo_b64 and self._ingest_url:
                        neon_chunks = await self._visual_search(photo_b64, message)
                    else:
                        embed_query = message
                        if photo_b64 and state.get("asset_identified"):
                            embed_query = f"{state['asset_identified']} {message}"
                        embedding = await self._embed_ollama(embed_query)
                        if embedding:
                            neon_chunks = _neon_recall.recall_knowledge(
                                embedding,
                                effective_tenant,
                                query_text=embed_query,
                            )

            # Extract chunk texts for reranking / telemetry
            chunk_texts = [c["content"] for c in neon_chunks]

            # Quality gate: only use retrieval when top chunk is genuinely relevant
            top_score = max((c.get("similarity", 0) for c in neon_chunks), default=0)
            if neon_chunks and top_score < 0.70:
                logger.info("RAG_QUALITY_GATE top_score=%.3f — chunks suppressed", top_score)
                chunk_texts = []

            self._last_sources = chunk_texts
            self._last_distances = [c.get("similarity", 0.0) for c in neon_chunks]

            async with spans.vector_search(
                rewritten, self._last_sources[:5], self._last_distances[:5]
            ):
                pass
            async with spans.context_compose(
                self._last_sources[:5], "\n".join(self._last_sources[:3])
            ):
                pass

            # Stage 2: Nemotron rerank NeonDB chunks (before LLM call)
            rerank_query = rewritten
            if photo_b64 and state.get("asset_identified"):
                rerank_query = f"{state['asset_identified']} {rewritten}"

            if self.nemotron and self.nemotron.enabled and chunk_texts:
                reranked = await self.nemotron.rerank(rerank_query, chunk_texts)
                top_chunks = [r["text"] for r in reranked if r["score"] > 0]
                if top_chunks:
                    chunk_texts = top_chunks

            # Stage 3: Build prompt with (reranked) chunks → call LLM
            if chunk_texts:
                messages = self._build_prompt_with_chunks(
                    state,
                    rewritten,
                    chunk_texts,
                    photo_b64=photo_b64,
                )
            else:
                messages = self._build_prompt(state, rewritten, photo_b64)
            t0 = time.monotonic()
            raw = await self._call_llm(messages, model=model)
            elapsed_ms = int((time.monotonic() - t0) * 1000)

            async with spans.llm_inference(len(str(messages)) // 4, raw, elapsed_ms):
                pass

            return raw

    def _build_prompt_with_chunks(
        self,
        state: dict,
        message: str,
        chunks: list[str],
        photo_b64: str = None,
    ) -> list[dict]:
        """Build prompt with explicitly injected reranked chunks."""
        system_content = GSD_SYSTEM_PROMPT + "\n\n--- CURRENT STATE ---\n"
        system_content += "IMPORTANT: This is an independent conversation. Do not reference equipment, fault codes, or details from any other session.\n"
        system_content += f"FSM state: {state['state']}\n"
        system_content += f"Exchange count: {state['exchange_count']}\n"
        if state.get("asset_identified"):
            system_content += f"Asset identified: {state['asset_identified']}\n"
        if state.get("fault_category"):
            system_content += f"Fault category: {state['fault_category']}\n"

        # Inject reranked chunks as reference context
        system_content += "\n--- RETRIEVED REFERENCE DOCUMENTS ---\n"
        for i, chunk in enumerate(chunks, 1):
            system_content += f"[{i}] {chunk}\n"
        system_content += "--- END REFERENCES ---\n"

        messages = [{"role": "system", "content": system_content}]

        history = state.get("context", {}).get("history", [])
        for entry in history[-10:]:
            messages.append({"role": entry["role"], "content": entry["content"]})

        if photo_b64:
            ctx = state.get("context", {})
            ocr = ctx.get("ocr_text", "")
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
                text_parts.append(f"[Asset identified from nameplate: {asset}]")
                text_parts.append(
                    f"REQUIRED: Name the specific device ('{asset.split(',')[0].strip()}') "
                    "explicitly in your reply. Rule 13 overrides Rule 2 for the device name only."
                )
            text_parts.append(message)
            messages.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{photo_b64}"},
                        },
                        {"type": "text", "text": "\n".join(text_parts)},
                    ],
                }
            )
        else:
            user_msg = rewrite_question(message, state.get("asset_identified"))
            messages.append({"role": "user", "content": user_msg})
        return messages

    def _build_prompt(
        self,
        state: dict,
        message: str,
        photo_b64: str = None,
        neon_chunks: list[dict] = None,
    ) -> list[dict]:
        """Build message list for LLM with GSD system prompt and state context."""
        system_content = GSD_SYSTEM_PROMPT + "\n\n--- CURRENT STATE ---\n"
        system_content += "IMPORTANT: This is an independent conversation. Do not reference equipment, fault codes, or details from any other session.\n"
        system_content += f"FSM state: {state['state']}\n"
        system_content += f"Exchange count: {state['exchange_count']}\n"
        if state.get("asset_identified"):
            system_content += f"Asset identified: {state['asset_identified']}\n"
        if state.get("fault_category"):
            system_content += f"Fault category: {state['fault_category']}\n"

        # Inject NeonDB knowledge base chunks when available
        if neon_chunks:
            system_content += "\n--- NEONDB KNOWLEDGE BASE (retrieved) ---\n"
            for i, chunk in enumerate(neon_chunks, 1):
                mfr = chunk.get("manufacturer") or ""
                model = chunk.get("model_number") or ""
                score = chunk.get("similarity") or 0.0
                label = f"{mfr} {model}".strip() or chunk.get("equipment_type") or "unknown"
                system_content += f"[{i}] [{label}] (score={score:.3f})\n{chunk['content']}\n\n"
            system_content += "--- END NEONDB CONTEXT ---\n"

        messages = [{"role": "system", "content": system_content}]

        # Conversation history — omit for fresh photo entries (new equipment)
        # but INCLUDE for photos sent during active diagnostic sessions (photo-as-answer)
        _ACTIVE_DIAG = {"Q1", "Q2", "Q3", "DIAGNOSIS", "FIX_STEP"}
        _photo_continues = photo_b64 and state.get("state") in _ACTIVE_DIAG
        _SELF_REF_SIGNALS = ["you said", "your response", "earlier", "before", "what you told me"]
        if not photo_b64 or _photo_continues:
            history = state.get("context", {}).get("history", [])
            for entry in history[-10:]:
                messages.append({"role": entry["role"], "content": entry["content"]})
            # Self-reference: inject prior MIRA turns explicitly when technician
            # asks about something MIRA said earlier
            if any(s in message.lower() for s in _SELF_REF_SIGNALS):
                mira_turns = [h for h in history[-10:] if h["role"] == "assistant"][-3:]
                if mira_turns:
                    messages.insert(
                        0,
                        {
                            "role": "system",
                            "content": "Your previous responses for reference: "
                            + " | ".join(t["content"][:200] for t in mira_turns),
                        },
                    )

        # Photo-as-answer guidance: help LLM interpret photo in diagnostic context
        if _photo_continues:
            messages.append(
                {
                    "role": "system",
                    "content": (
                        "This photo was sent as a response to your previous question. "
                        "Examine it for information that answers the question. If you "
                        "can extract the answer, confirm it and continue the diagnostic. "
                        "If the photo doesn't clearly show the requested information, "
                        "acknowledge the photo and re-ask the question differently — "
                        "suggest the technician type the value or take a closer shot."
                    ),
                }
            )

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
                text_parts.append(f"[Asset identified from nameplate: {asset}]")
                text_parts.append(
                    f"REQUIRED: Name the specific device ('{asset.split(',')[0].strip()}') "
                    "explicitly in your reply. Rule 13 overrides Rule 2 for the device name only."
                )
            text_parts.append(message)
            messages.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{photo_b64}"},
                        },
                        {"type": "text", "text": "\n".join(text_parts)},
                    ],
                }
            )
        else:
            user_msg = rewrite_question(message, state.get("asset_identified"))
            messages.append({"role": "user", "content": user_msg})
        return messages

    async def _visual_search(self, photo_b64: str, query_text: str) -> list[dict]:
        """Call /ingest/search-visual for dual-modality retrieval. Non-blocking."""
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    f"{self._ingest_url}/ingest/search-visual",
                    json={"query_image_b64": photo_b64, "query_text": query_text, "top_k": 5},
                )
                resp.raise_for_status()
                results = resp.json().get("results", [])
            logger.info("Visual search returned %d chunks", len(results))
            return results
        except Exception as e:
            logger.warning("Visual search failed (falling back to empty): %s", e)
            return []

    async def _embed_ollama(self, text: str) -> list[float] | None:
        """Embed text via Ollama nomic-embed-text (768-dim, matches NeonDB vectors)."""
        ollama_url = os.environ.get("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
        embed_model = os.environ.get("EMBED_TEXT_MODEL", "nomic-embed-text:latest")
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    f"{ollama_url}/api/embeddings",
                    json={"model": embed_model, "prompt": text},
                )
                resp.raise_for_status()
                return resp.json()["embedding"]
        except Exception as e:
            logger.warning("Ollama embed failed: %s", e)
            return None

    async def _call_llm(self, messages: list[dict], model: str = None) -> str:
        """Call LLM — cloud cascade (Groq→Cerebras→Claude) then Open WebUI fallback."""
        if self.router and self.router.enabled:
            clean = self.router.sanitize_context(messages)
            content, usage = await self.router.complete(clean)
            if content:
                self.router.log_usage(usage)
                return content

        return await self._call_openwebui(messages, model=model)

    async def _call_openwebui(self, messages: list[dict], model: str = None) -> str:
        """Call Open WebUI chat completions API with observability logging."""
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        payload = {
            "model": model or "mira:latest",
            "messages": messages,
            "options": {"temperature": 0.1},
        }
        # NeonDB is the single knowledge source — Open WebUI is a pure LLM proxy.
        # Do NOT pass collection_id here; retrieval is handled by neon_recall.

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

        logger.info(
            "LLM_CALL worker=rag %s",
            json.dumps(
                {
                    "model": model or "mira:latest",
                    "latency_ms": elapsed_ms,
                    "neon_chunks": len(self._last_sources),
                    "response_keys": list(data.keys()),
                }
            ),
        )

        return data["choices"][0]["message"]["content"]
