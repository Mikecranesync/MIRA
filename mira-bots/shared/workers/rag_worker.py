"""RAG Worker — Routes text queries through Open WebUI RAG pipeline."""

import json
import logging
import os
import time
from pathlib import Path

import httpx
import yaml

from ..guardrails import rewrite_question
from ..langfuse_setup import trace_rag_query
from .. import neon_recall as _neon_recall

_PROMPT_PATH = Path(__file__).parent.parent.parent / "prompts" / "diagnose" / "active.yaml"


def _load_prompt_meta() -> dict:
    try:
        with open(_PROMPT_PATH) as f:
            data = yaml.safe_load(f)
        return {
            "codename": data.get("codename", "unknown"),
            "version": str(data.get("version", "unknown")),
        }
    except Exception:
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

    def __init__(self, openwebui_url: str, api_key: str, collection_id: str,
                 nemotron=None, router=None, tenant_id: str = None):
        self.openwebui_url = openwebui_url.rstrip("/")
        self.api_key = api_key
        self.collection_id = collection_id
        self.nemotron = nemotron
        self.router = router  # InferenceRouter instance
        self.tenant_id = tenant_id or os.environ.get("MIRA_TENANT_ID", "")
        self._last_sources: list[str] = []
        self._last_distances: list[float] = []
        self._prompt_meta = _load_prompt_meta()

    async def process(
        self, message: str, state: dict, photo_b64: str = None,
        vision_model: str = None,
    ) -> str:
        """3-stage RAG pipeline. Returns raw LLM response string."""
        model = vision_model if photo_b64 else None
        metadata = {
            "fsm_state": state.get("state"),
            "photo": bool(photo_b64),
            "prompt_codename": self._prompt_meta["codename"],
            "prompt_version": self._prompt_meta["version"],
        }

        async with trace_rag_query(message, metadata=metadata) as spans:
            # Stage 1: Query rewrite + embed for NeonDB recall (Nemotron Q2E or passthrough)
            rewritten = message
            neon_chunks: list[dict] = []
            async with spans.embed_query(message):
                if self.nemotron and not photo_b64:
                    rewritten = await self.nemotron.rewrite_query(
                        query=message,
                        context=state.get("asset_identified", ""),
                    )
                    # Embed rewritten query → NeonDB pgvector recall
                    if self.tenant_id:
                        embedding = await self.nemotron.embed(rewritten)
                        if embedding:
                            neon_chunks = _neon_recall.recall_knowledge(
                                embedding, self.tenant_id
                            )

            # Stage 2: Retrieve via Open WebUI RAG (NeonDB chunks injected into prompt)
            messages = self._build_prompt(state, rewritten, photo_b64, neon_chunks=neon_chunks)
            t0 = time.monotonic()
            raw = await self._call_llm(messages, model=model)
            elapsed_ms = int((time.monotonic() - t0) * 1000)

            # Record retrieval results (populated by _call_openwebui above)
            async with spans.vector_search(rewritten, self._last_sources[:5], self._last_distances[:5]):
                pass
            async with spans.context_compose(self._last_sources[:5], "\n".join(self._last_sources[:3])):
                pass

            # Stage 2b: Rerank retrieved chunks (if Nemotron enabled + sources available)
            if (
                self.nemotron
                and self.nemotron.enabled
                and self._last_sources
                and not photo_b64
            ):
                reranked = await self.nemotron.rerank(rewritten, self._last_sources)
                top_chunks = [r["text"] for r in reranked if r["score"] > 0]
                if top_chunks:
                    # Rebuild prompt with reranked chunks injected explicitly
                    messages = self._build_prompt_with_chunks(
                        state, rewritten, top_chunks,
                    )
                    t0 = time.monotonic()
                    raw = await self._call_llm(messages, model=model)
                    elapsed_ms = int((time.monotonic() - t0) * 1000)

            async with spans.llm_inference(len(str(messages)) // 4, raw, elapsed_ms):
                pass

            return raw

    def _build_prompt_with_chunks(
        self, state: dict, message: str, chunks: list[str],
    ) -> list[dict]:
        """Build prompt with explicitly injected reranked chunks."""
        system_content = GSD_SYSTEM_PROMPT + "\n\n--- CURRENT STATE ---\n"
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

        user_msg = rewrite_question(message, state.get("asset_identified"))
        messages.append({"role": "user", "content": user_msg})
        return messages

    def _build_prompt(
        self, state: dict, message: str, photo_b64: str = None,
        neon_chunks: list[dict] = None,
    ) -> list[dict]:
        """Build message list for LLM with GSD system prompt and state context."""
        system_content = GSD_SYSTEM_PROMPT + "\n\n--- CURRENT STATE ---\n"
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

        # Conversation history — omit for photo messages (fresh visual context)
        _SELF_REF_SIGNALS = ["you said", "your response", "earlier", "before", "what you told me"]
        if not photo_b64:
            history = state.get("context", {}).get("history", [])
            for entry in history[-10:]:
                messages.append({"role": entry["role"], "content": entry["content"]})
            # Self-reference: inject prior MIRA turns explicitly when technician
            # asks about something MIRA said earlier
            if any(s in message.lower() for s in _SELF_REF_SIGNALS):
                mira_turns = [h for h in history[-10:] if h["role"] == "assistant"][-3:]
                if mira_turns:
                    messages.insert(0, {
                        "role": "system",
                        "content": "Your previous responses for reference: " +
                                   " | ".join(t["content"][:200] for t in mira_turns),
                    })

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
            user_msg = rewrite_question(message, state.get("asset_identified"))
            messages.append({"role": "user", "content": user_msg})
        return messages

    async def _call_llm(self, messages: list[dict], model: str = None) -> str:
        """Call LLM — Claude API if router enabled, else Open WebUI."""
        if self.router and self.router.enabled:
            clean = self.router.sanitize_context(messages)
            content, usage = await self.router.complete(clean)
            if content:
                self.router.log_usage(usage)
                return content
            # Claude call failed — fall through to Open WebUI

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
        if self.collection_id:
            payload["files"] = [{"type": "collection", "id": self.collection_id}]

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

        # Open WebUI returns retrieved chunks under "sources", not "citations"
        sources = data.get("sources", [])
        source_docs = []
        source_chunks = []
        for src in sources:
            docs = src.get("document", [])
            metas = src.get("metadata", [])
            distances = src.get("distances", [])
            for i, doc in enumerate(docs):
                name = metas[i].get("source", metas[i].get("name", "")) if i < len(metas) else ""
                dist = distances[i] if i < len(distances) else 0.0
                source_docs.append(f"{name}:{dist:.3f}")
                source_chunks.append(doc)

        # Store for potential reranking
        self._last_sources = source_chunks
        self._last_distances = [
            d for src in sources for d in src.get("distances", [])
        ]

        logger.info("LLM_CALL worker=rag %s", json.dumps({
            "model": model or "mira:latest",
            "latency_ms": elapsed_ms,
            "sources_count": len(source_chunks),
            "source_docs": source_docs[:5],
            "collection_id": self.collection_id or None,
            "response_keys": list(data.keys()),
        }))

        return data["choices"][0]["message"]["content"]
