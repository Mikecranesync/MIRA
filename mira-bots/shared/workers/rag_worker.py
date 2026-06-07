"""RAG Worker — Routes text queries through Open WebUI RAG pipeline."""

import json
import logging
import os
import re
import time
from pathlib import Path

import httpx
import yaml

from .. import neon_recall as _neon_recall
from ..agentic_retrieval import (
    decompose_query,
    evaluate_retrieval,
    is_decompose_enabled,
    is_self_eval_enabled,
    merge_subquery_results,
)
from ..guardrails import rewrite_question, vendor_name_from_text, vendor_support_url
from ..inference.router import InferenceRouter
from ..langfuse_setup import trace_rag_query

# CRA-11 / Unit 2 — citation infrastructure.
#
# CITATION_TAG_RE matches the "[Source: ...]" markers we inject in retrieval
# headers and instruct the LLM to echo. Used by post-LLM compliance checks.
#
# format_source_label(chunk) builds the human-readable label for one chunk.
# Honesty constraint (per fe916de commit): we DO NOT render a page number.
# The DB column "source_page" actually holds chunk_index (a sequential ID
# from the chunker), not a real PDF page number. Showing "p. 47" when we
# mean "chunk 47" would mislead techs reading the citation. Backfilling
# real page numbers from PDF re-extraction is a separate task.
CITATION_TAG_RE = re.compile(r"\[Source:[^\]]+\]", re.IGNORECASE)


def format_source_label(chunk: dict | None) -> str:
    """Build the "Manufacturer Model — Section" label for a citation tag.

    Returns "" when no usable metadata is present so callers can decide
    whether to emit a [Source:] tag at all. Page numbers are intentionally
    omitted — see module docstring above.
    """
    if not chunk:
        return ""
    mfr = (chunk.get("manufacturer") or "").strip()
    mdl = (chunk.get("model_number") or "").strip()
    meta = chunk.get("metadata") or {}
    section = (meta.get("section") or "").strip()

    head = " ".join(p for p in (mfr, mdl) if p)
    if head and section:
        return f"{head} — {section}"
    if head:
        return head
    return section


# Max tokens to allocate for conversation history in the prompt.
# Prevents late-conversation latency spikes from unbounded context growth.
_HISTORY_TOKEN_BUDGET = int(os.getenv("MIRA_HISTORY_TOKEN_BUDGET", "2000"))

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

_FAULT_MENTION_RE = re.compile(
    r"\b(fault|error|alarm|trip|code|warning|showing|display|flashing|reading)\b",
    re.IGNORECASE,
)

# Strip prompt-injection delimiters from chunk text before LLM injection.
# A crafted document containing these patterns could break the reference-block
# boundary and inject instructions with system-role authority (#1007).
_SENTINEL_RE = re.compile(
    r"---\s*(?:END REFERENCES|END NEONDB CONTEXT|RETRIEVED REFERENCE DOCUMENTS"
    r"|NEONDB KNOWLEDGE BASE|END GENERAL KNOWLEDGE MODE|END NO KB COVERAGE"
    r"|CURRENT STATE)\s*---",
    re.IGNORECASE,
)


def _build_clarification_request(message: str, asset_identified: str) -> str | None:
    """Return a targeted clarification question when the KB has no coverage.

    Uses the same fault code extractor as neon_recall so the codes quoted back
    to the user are exactly what was searched — no false positives from generic
    English words. Returns None for non-fault queries so the LLM honesty path
    fires instead.

    REGRESSION GUARD (2026-05-12): When the user's message ALREADY contains a
    recognizable manufacturer AND a fault code, return None so the LLM answers
    from general engineering knowledge with the no_kb_coverage disclaimer —
    never re-ask for info the user just provided.
    """
    has_fault_mention = bool(_FAULT_MENTION_RE.search(message))
    # Use the same extractor the recall path used — what it found is what failed
    attempted_codes = _neon_recall._extract_fault_codes(message)

    if not has_fault_mention and not attempted_codes:
        return None

    # Short-circuit: user's message already names a vendor + fault code combo.
    # Asking "what manufacturer?" when they just said "PowerFlex 525 F004" is
    # the regression Mike has reported 3+ times. Fall through to the LLM with
    # no_kb_coverage=True — it will answer from general knowledge with a
    # documentation-disclaimer prefix.
    if attempted_codes and vendor_name_from_text(message):
        return None
    if attempted_codes and asset_identified and vendor_name_from_text(asset_identified):
        return None

    parts: list[str] = []

    if attempted_codes:
        quoted = ", ".join(f"**{c}**" for c in attempted_codes[:3])
        parts.append(f"I searched for {quoted} but couldn't find it in my knowledge base.")
    else:
        parts.append("I couldn't find anything matching your description in my knowledge base.")

    parts.append("To look this up I need a bit more info:\n")

    if not asset_identified:
        parts.append(
            "1. **Manufacturer** — who made the equipment? (e.g. AutomationDirect, Yaskawa, Danfoss)"
        )
        parts.append("2. **Model number** — shown on the nameplate or display (e.g. GS20, V1000)")
        parts.append("3. **Exact code** — copy it exactly as it appears on the screen")
    else:
        parts.append(f"Equipment: {asset_identified}")
        parts.append("1. **Exact code** — copy it exactly as it appears on the screen")
        parts.append(
            "2. **What were you doing** when it appeared? (starting up, running, decelerating, idle)"
        )

    return "\n".join(parts)


def _trim_history_by_tokens(
    history: list[dict], max_tokens: int = _HISTORY_TOKEN_BUDGET
) -> list[dict]:
    """Walk history backward, keep entries until token budget is exhausted.

    Replaces the fixed ``history[-10:]`` slice to prevent latency spikes
    when late-conversation messages grow much longer than early ones.
    Uses a rough 1-token ≈ 4-chars heuristic (same as the rest of the codebase).
    """
    trimmed: list[dict] = []
    tokens_used = 0
    for entry in reversed(history):
        entry_tokens = len(entry.get("content", "")) // 4
        if tokens_used + entry_tokens > max_tokens:
            break
        trimmed.append(entry)
        tokens_used += entry_tokens
    return list(reversed(trimmed))


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
16. CITATION REQUIRED. You MUST cite your source for any technical advice \
(parameter values, fault codes, torque specs, timing, electrical specs, wiring, \
sequence-of-operation steps). Each chunk in RETRIEVED REFERENCE DOCUMENTS is \
wrapped with a "--- [N] [Source: Label] ---" header — copy that exact \
"[Source: Label]" tag inline next to the fact you draw from it. Include at \
least one [Source: ...] tag somewhere in your reply. \
Example: "Set P01-01 to 60Hz [Source: AutomationDirect GS10 — Chapter 5]." \
Never invent or alter a [Source: ...] tag — only use tags from the retrieved \
documents above. If no retrieved documents appear in RETRIEVED REFERENCE \
DOCUMENTS, do NOT give technical advice. Instead say exactly: \
"I don't have documentation for this equipment in my records — searching now. \
Type PROCEED to continue with my best estimate (not manual-verified)." \
Never substitute training knowledge for missing documentation without this warning.

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


DIRECT_ANSWER_SYSTEM_PROMPT = """\
You are MIRA, an industrial maintenance assistant for a fixed, known machine \
(a wall-mounted kiosk bolted to one piece of equipment). The technician CANNOT \
reply to you — this is a single-shot question with no follow-up turn. \
Therefore you give DIRECT, COMPLETE answers. You do NOT ask the technician \
questions back, and you do NOT use the Socratic method.

RULES:

1. ANSWER DIRECTLY AND COMPLETELY. State the diagnosis and the fix in full. \
If the question is "why won't it run?", say why and what to do about it — do \
not ask them to check something and report back. Lead with the answer.
2. NO QUESTIONS BACK. Never end with a question. Never ask the technician to \
reply, confirm, or choose. The "options" field MUST be an empty list []. If you \
would normally ask a clarifying question, instead state the most likely cause(s) \
and the action for each. It is fine to say "If X, do A; if Y, do B."
3. ACTION STEPS ALLOWED. Give the complete set of steps needed, as a short \
numbered or bulleted list inside the reply text. Each step starts with a verb \
("Check...", "Press...", "Measure...", "Reset..."). The kiosk operator needs the \
whole procedure at once, not one step at a time.
4. BE CONCISE BUT COMPLETE. Aim for 2-6 sentences (plus a short step list if \
needed). Plain, peer-to-peer tone. Never say "Great question!" or "Certainly!". \
Use the live machine status provided to make the answer specific to right now.
5. LEAD WITH WHAT YOU SEE — PHOTO ONLY. (Same as GSD) When a photo is included, \
transcribe everything visible exactly as written (fault codes, alarm text, \
readings, LED states) before diagnosing. For TEXT-ONLY messages do NOT claim to \
see anything.
6. NEVER INVENT. Report ONLY what you can support from the retrieved reference \
documents and the live machine status. Never guess fault-code meanings from \
training data. If you don't have the information, say so plainly.
7. GROUND TO RETRIEVED CONTEXT. Base technical facts ONLY on the RETRIEVED \
REFERENCE DOCUMENTS and the live status block. If they don't cover the question, \
say "I don't have documentation for that in my records" and give your best \
general guidance clearly labeled as an estimate.
8. RESPONSE FORMAT: Return JSON only:
{"next_state": "RESOLVED", "reply": "your complete answer", "options": [], "confidence": "HIGH|MEDIUM|LOW"}
Always set next_state to "RESOLVED" (single-shot, no follow-up). options is \
ALWAYS an empty list []. confidence = HIGH when grounded in a documentation \
match; MEDIUM when likely but unconfirmed; LOW when records are insufficient.
9. CITATION REQUIRED. You MUST cite your source for any technical advice \
(parameter values, fault codes, specs, wiring, sequence-of-operation steps). \
Each chunk in RETRIEVED REFERENCE DOCUMENTS is wrapped with a \
"--- [N] [Source: Label] ---" header — copy that exact "[Source: Label]" tag \
inline next to the fact you draw from it. Include at least one [Source: ...] tag \
when you give technical advice. Never invent or alter a [Source: ...] tag. If no \
retrieved documents appear, state that you lack documentation and label any \
guidance as an unverified estimate.

SAFETY OVERRIDE — THE ONLY EXCEPTION:
ONLY if a photo PHYSICALLY SHOWS a hazard (exposed energized conductors, active \
arc flash, missing lockout/tagout on an open live panel, smoke/melted insulation \
visible in the image), the first line must be: \
"STOP — [hazard description]. De-energize first." and next_state must be \
"SAFETY_ALERT". Do NOT trigger this for fault descriptions alone."""


# Kiosk/single-shot surfaces (e.g. the Ignition Ask-MIRA panel) set
# MIRA_DIRECT_ANSWER_MODE=1 so MIRA answers directly instead of running the
# Socratic dialogue. Read at call time (not import) so tests/containers can
# toggle it. Scoped per-container: the Telegram/Slack bots leave it unset and
# keep GSD. Helper centralizes the choice for both prompt-assembly paths.
def _direct_answer_mode() -> bool:
    return os.getenv("MIRA_DIRECT_ANSWER_MODE", "") not in ("", "0", "false", "False")


def _active_system_prompt() -> str:
    return DIRECT_ANSWER_SYSTEM_PROMPT if _direct_answer_mode() else GSD_SYSTEM_PROMPT


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
        self._last_no_kb: bool = False
        self._last_neon_chunks: list[dict] = []
        self._kb_status: dict = {"status": "unknown", "citations": []}
        self._prompt_meta = _load_prompt_meta()

    async def process(
        self,
        message: str,
        state: dict,
        photo_b64: str = None,
        vision_model: str = None,
        tenant_id: str | None = None,
        kg_context: str | None = None,
    ) -> str:
        """3-stage RAG pipeline. Returns raw LLM response string.

        Args:
            message: User message text.
            state: Current FSM state dict.
            photo_b64: Optional base64-encoded photo.
            vision_model: Optional vision model override.
            tenant_id: Per-call tenant override. When provided, takes precedence
                over the constructor-level ``self.tenant_id`` fallback.
            kg_context: Optional pre-formatted knowledge-graph context block,
                injected into the system prompt by the prompt builders. "" / None
                = no KG block (the default; enrichment is engine-side + flag-gated).
        """
        effective_tenant = tenant_id or self.tenant_id
        # Stash for the prompt builders (_build_prompt / _build_prompt_with_chunks).
        self._kg_context = kg_context or ""
        # Track whether retrieval was attempted so we can inject the honesty
        # directive when it ran but returned zero useful chunks.
        retrieval_attempted = bool(effective_tenant)
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

                        # Clean lexical-recall query (#1766). The engine stashes a
                        # trimmed question+status string on state for direct-
                        # connection surfaces (the /ask kiosk) whose `message` is a
                        # large static context card. BM25 / fault-code / product-name
                        # extraction key off this; the EMBEDDING still uses
                        # embed_query (full semantic context). Falls back to message
                        # for chat surfaces that don't set it.
                        recall_query = state.get("retrieval_query") or message

                        sub_queries: list[str] = [embed_query]
                        if is_decompose_enabled():
                            try:
                                sub_queries = await decompose_query(embed_query)
                            except Exception as exc:
                                logger.warning("DECOMPOSE_CALL_FAILED %s", exc)
                                sub_queries = [embed_query]

                        if len(sub_queries) > 1:
                            # Embed each sub-query; still call recall_knowledge
                            # when embedding fails so BM25/fault streams run.
                            per_sub: list[list[dict]] = []
                            for sq in sub_queries:
                                sq_emb = await self._embed_ollama(sq)
                                per_sub.append(
                                    _neon_recall.recall_knowledge(
                                        sq_emb,
                                        effective_tenant,
                                        query_text=sq,
                                    )
                                )
                            neon_chunks = merge_subquery_results(per_sub, limit=6)
                            logger.info(
                                "DECOMPOSE_RECALL n_subq=%d n_chunks=%d",
                                len(sub_queries),
                                len(neon_chunks),
                            )
                        else:
                            # Embed the CLEAN recall_query, not the enriched blob
                            # (#1766 follow-up). Prod RAG_STAGE_TIMING showed the
                            # embed of the ~2760-char /ask MACHINE_CONTEXT card was
                            # 3-5s on CPU Ollama — the dominant latency after the
                            # recall fix. recall_query is the trimmed question+status
                            # (~200 chars) → embed drops to <1s, and the vector is
                            # question-focused rather than blurred by the static card.
                            # For chat surfaces recall_query == message, so their
                            # embedding is unchanged (only the /ask kiosk sets
                            # state["retrieval_query"]).
                            _t_emb = time.monotonic()
                            embedding = await self._embed_ollama(recall_query)
                            _embed_ms = int((time.monotonic() - _t_emb) * 1000)
                            # Call recall_knowledge unconditionally — it now
                            # falls through to lexical streams when embedding
                            # is None (Ollama sidecar down). Pre-fix this gate
                            # short-circuited BM25 and produced NO_KB_COVERAGE
                            # despite KB rows being lexically retrievable.
                            _t_rec = time.monotonic()
                            neon_chunks = _neon_recall.recall_knowledge(
                                embedding,
                                effective_tenant,
                                query_text=recall_query,
                            )
                            _recall_ms = int((time.monotonic() - _t_rec) * 1000)
                            logger.info(
                                "RAG_STAGE_TIMING embed_ms=%d recall_ms=%d embed_chars=%d "
                                "recall_chars=%d n_chunks=%d",
                                _embed_ms,
                                _recall_ms,
                                len(recall_query),
                                len(recall_query),
                                len(neon_chunks),
                            )

                        if is_self_eval_enabled() and neon_chunks:
                            try:
                                eq_ctx = state.get("asset_identified") or None
                                is_rel, score, reformulated = await evaluate_retrieval(
                                    embed_query,
                                    neon_chunks,
                                    equipment_context=eq_ctx,
                                )
                                logger.info(
                                    "RAG_SELF_EVAL score=%.2f relevant=%s reformulated=%s",
                                    score,
                                    is_rel,
                                    bool(reformulated),
                                )
                                if not is_rel and reformulated:
                                    retry_emb = await self._embed_ollama(reformulated)
                                    if retry_emb:
                                        retry_chunks = _neon_recall.recall_knowledge(
                                            retry_emb,
                                            effective_tenant,
                                            query_text=reformulated,
                                        )
                                        if retry_chunks:
                                            logger.info(
                                                "RAG_SELF_EVAL_RETRY n_chunks=%d query=%r",
                                                len(retry_chunks),
                                                reformulated[:80],
                                            )
                                            neon_chunks = retry_chunks
                            except Exception as exc:
                                logger.warning("SELF_EVAL_CALL_FAILED %s", exc)

            # Extract chunk texts for reranking / telemetry
            chunk_texts = [c["content"] for c in neon_chunks]

            # Quality gate: only use retrieval when top chunk is genuinely relevant.
            #
            # The `similarity` field is comparable across rows ONLY when the chunk
            # came from the vector stream — BM25 surfaces ts_rank_cd, ILIKE uses
            # a hardcoded 0.5, and structured fault matches hardcode 0.95. So we
            # restrict the cosine threshold to vector-only chunks and trust any
            # chunk that came from a non-vector stream (those streams each apply
            # their own hard relevance filter: tsquery match, model_number ILIKE,
            # fault-code substring). This was the GS11 demo regression — meta-
            # textual questions retrieved valid BM25/product chunks whose merged
            # `similarity` was below the cosine threshold and were suppressed.
            _triage_conf = (state.get("context") or {}).get("triage_result", {}).get("confidence")
            _enriched = (state.get("context") or {}).get("triage_enriched", False)
            if _triage_conf == "medium" or _enriched:
                _min_sim = 0.55
            elif _triage_conf == "low":
                _min_sim = 0.45
            else:
                _min_sim = 0.70

            def _streams_of(c: dict) -> set[str]:
                return set(c.get("retrieval_streams") or [])

            _has_non_vector = any(_streams_of(c) - {"vector"} for c in neon_chunks)
            _vector_only_chunks = [c for c in neon_chunks if _streams_of(c) <= {"vector"}]
            _vector_top = max((c.get("similarity", 0) for c in _vector_only_chunks), default=0)
            _top_score = max((c.get("similarity", 0) for c in neon_chunks), default=0)

            if neon_chunks and not _has_non_vector and _vector_top < _min_sim:
                logger.info(
                    "RAG_QUALITY_GATE vector_top=%.3f min=%.2f triage=%s — suppressed "
                    "(no non-vector evidence)",
                    _vector_top,
                    _min_sim,
                    _triage_conf or "none",
                )
                chunk_texts = []
                neon_chunks = []
            elif neon_chunks:
                logger.info(
                    "RAG_QUALITY_GATE top_score=%.3f vector_top=%.3f min=%.2f "
                    "non_vector=%s n_chunks=%d — kept",
                    _top_score,
                    _vector_top,
                    _min_sim,
                    _has_non_vector,
                    len(neon_chunks),
                )

            # Cross-vendor filter: drop chunks whose manufacturer doesn't match the
            # identified vendor.  Chunks with no manufacturer tag are kept (they may be
            # generic content like fault code tables or application notes).
            # Falls back to the old all-or-nothing suppress if no per-chunk filtering
            # yields results. Vendor is read from state["context"]["uns_context"]
            # (populated by the UNS resolver at the top of Supervisor.process_full).
            if chunk_texts and not photo_b64:
                query_vendor = ((state.get("context") or {}).get("uns_context") or {}).get(
                    "manufacturer"
                )
                if query_vendor:
                    qv_lower = query_vendor.lower()
                    filtered_chunks = [
                        c
                        for c in neon_chunks
                        if not c.get("manufacturer")
                        or qv_lower in (c.get("manufacturer") or "").lower()
                    ]
                    if filtered_chunks:
                        dropped = len(neon_chunks) - len(filtered_chunks)
                        if dropped:
                            logger.info(
                                "CROSS_VENDOR_FILTER vendor=%r — dropped %d mismatched "
                                "chunk(s), kept %d",
                                query_vendor,
                                dropped,
                                len(filtered_chunks),
                            )
                        neon_chunks = filtered_chunks
                        chunk_texts = [c["content"] for c in neon_chunks]
                    else:
                        # No chunks survived filtering — full suppress so honesty fires
                        logger.info(
                            "CROSS_VENDOR_CONTAMINATION vendor=%r — %d chunk(s) fully "
                            "suppressed (no match), honesty directive will fire",
                            query_vendor,
                            len(chunk_texts),
                        )
                        chunk_texts = []
                        neon_chunks = []

            self._last_sources = chunk_texts
            self._last_distances = [c.get("similarity", 0.0) for c in neon_chunks]
            # Snapshot before any await so concurrent sessions can't overwrite
            # this call's metadata (fixes #1082 Nemotron rerank race).
            local_neon_chunks = list(neon_chunks)
            self._last_neon_chunks = local_neon_chunks
            self._kb_status = self._compute_kb_status(neon_chunks, bool(chunk_texts))

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
                self._last_no_kb = False
                messages = self._build_prompt_with_chunks(
                    state,
                    rewritten,
                    chunk_texts,
                    photo_b64=photo_b64,
                    neon_chunks_meta=local_neon_chunks,
                )
            else:
                no_kb = retrieval_attempted and not photo_b64
                self._last_no_kb = no_kb
                if no_kb:
                    logger.info(
                        "NO_KB_COVERAGE asset=%r — checking for clarification shortcut",
                        state.get("asset_identified", "unknown"),
                    )
                    triage_data = (state.get("context") or {}).get("triage_result", {})
                    if triage_data.get("is_answerable_from_general_knowledge"):
                        messages = self._build_prompt(
                            state, rewritten, photo_b64, no_kb_coverage="general_knowledge"
                        )
                    else:
                        clarification = _build_clarification_request(
                            message, state.get("asset_identified", "")
                        )
                        if clarification:
                            return clarification
                        messages = self._build_prompt(
                            state, rewritten, photo_b64, no_kb_coverage=True
                        )
                else:
                    messages = self._build_prompt(state, rewritten, photo_b64)
            t0 = time.monotonic()
            raw = await self._call_llm(messages, model=model)
            elapsed_ms = int((time.monotonic() - t0) * 1000)

            async with spans.llm_inference(len(str(messages)) // 4, raw, elapsed_ms):
                pass

            return raw

    def _compute_kb_status(self, neon_chunks: list[dict], has_chunks: bool) -> dict:
        """Classify KB coverage and extract source citations for the citation gate."""
        if not has_chunks:
            return {"status": "uncovered", "citations": []}
        high_quality = [c for c in neon_chunks if c.get("similarity", 0) >= 0.65]
        citations = []
        for c in high_quality[:3]:
            meta = c.get("metadata") or {}
            citations.append(
                {
                    "manufacturer": c.get("manufacturer", ""),
                    "model_number": c.get("model_number", ""),
                    "source_url": c.get("source_url") or meta.get("source_url", ""),
                    "section": meta.get("section", ""),
                    "page_num": meta.get("page_num"),
                }
            )
        if len(high_quality) >= 3:
            return {"status": "covered", "citations": citations}
        if high_quality:
            return {"status": "partial", "citations": citations}
        return {"status": "uncovered", "citations": []}

    @property
    def kb_status(self) -> dict:
        """Current KB coverage status set during the last process() call."""
        return self._kb_status

    def _build_prompt_with_chunks(
        self,
        state: dict,
        message: str,
        chunks: list,
        photo_b64: str = None,
        neon_chunks_meta: list[dict] | None = None,
    ) -> list[dict]:
        """Build prompt with explicitly injected reranked chunks.

        ``chunks`` may be either a list of plain strings (legacy callers) or
        a list of chunk dicts. When a dict is passed, the [Source: ...] tag
        comes from that dict directly so reranking does not mis-pair labels
        with text. When a string is passed, ``neon_chunks_meta`` (a
        call-local snapshot) is preferred over ``self._last_neon_chunks`` to
        avoid a cross-tenant data race when Nemotron reranking is enabled.
        """
        system_content = (
            _active_system_prompt()
            + getattr(self, "_kg_context", "")
            + "\n\n--- CURRENT STATE ---\n"
        )
        system_content += "IMPORTANT: This is an independent conversation. Do not reference equipment, fault codes, or details from any other session.\n"
        system_content += f"FSM state: {state['state']}\n"
        system_content += f"Exchange count: {state['exchange_count']}\n"
        if state.get("asset_identified"):
            system_content += f"Asset identified: {state['asset_identified']}\n"
        if state.get("fault_category"):
            system_content += f"Fault category: {state['fault_category']}\n"
        _sc = state.get("context", {}).get("session_context", {})
        if _sc.get("active_alarm"):
            system_content += (
                f"ACTIVE INVESTIGATION: {_sc['active_alarm']}\n"
                "Focus EXCLUSIVELY on this alarm. Do NOT discuss other alarms unless "
                "the technician explicitly switches topic.\n"
            )

        # Inject reranked chunks as reference context with source headers.
        # Each chunk gets a [Source: Mfr Mdl — Section] tag the LLM is
        # instructed (rule 16) to echo inline next to facts it cites.
        # Rerank-stable: when `chunks` is a list of dicts, label comes from
        # that dict directly so reordering doesn't mis-pair labels with text.
        # When chunks are bare strings, prefer the call-local snapshot
        # (neon_chunks_meta) over the instance attr to avoid cross-tenant leaks.
        _meta = neon_chunks_meta if neon_chunks_meta is not None else self._last_neon_chunks
        system_content += "\n--- RETRIEVED REFERENCE DOCUMENTS ---\n"
        for i, chunk in enumerate(chunks, 1):
            if isinstance(chunk, dict):
                nc = chunk
                text = chunk.get("content", "")
            else:
                nc = _meta[i - 1] if i - 1 < len(_meta) else {}
                text = chunk
            # Strip prompt-injection sentinel patterns before injection (#1007)
            text = _SENTINEL_RE.sub("[REF_DELIMITER]", text)
            label = format_source_label(nc)
            if label:
                system_content += f"--- [{i}] [Source: {label}] ---\n{text}\n---\n"
            else:
                system_content += f"--- [{i}] ---\n{text}\n---\n"
        system_content += "--- END REFERENCES ---\n"

        messages = [{"role": "system", "content": system_content}]

        history = state.get("context", {}).get("history", [])
        for entry in _trim_history_by_tokens(history):
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
        no_kb_coverage: bool | str = False,
    ) -> list[dict]:
        """Build message list for LLM with GSD system prompt and state context.

        Args:
            no_kb_coverage: True when retrieval ran but returned zero results (injects
                honesty directive). "general_knowledge" when triage flagged the query as
                answerable from general engineering knowledge — LLM answers with a prefix
                instead of refusing.
        """
        system_content = (
            _active_system_prompt()
            + getattr(self, "_kg_context", "")
            + "\n\n--- CURRENT STATE ---\n"
        )
        system_content += "IMPORTANT: This is an independent conversation. Do not reference equipment, fault codes, or details from any other session.\n"
        system_content += f"FSM state: {state['state']}\n"
        system_content += f"Exchange count: {state['exchange_count']}\n"
        if state.get("asset_identified"):
            system_content += f"Asset identified: {state['asset_identified']}\n"
        if state.get("fault_category"):
            system_content += f"Fault category: {state['fault_category']}\n"
        _sc = state.get("context", {}).get("session_context", {})
        if _sc.get("active_alarm"):
            system_content += (
                f"ACTIVE INVESTIGATION: {_sc['active_alarm']}\n"
                "Focus EXCLUSIVELY on this alarm. Do NOT discuss other alarms unless "
                "the technician explicitly switches topic.\n"
            )

        # General knowledge mode: triage says answerable without equipment-specific docs
        if no_kb_coverage == "general_knowledge":
            system_content += (
                "\n\n--- GENERAL KNOWLEDGE MODE ---\n"
                "No equipment-specific documentation found in the knowledge base.\n"
                "You MUST prefix your answer with: "
                '"Based on general industrial knowledge (not from specific documentation for this equipment): "\n'
                "Then give your best answer. Do NOT refuse to answer.\n"
                + (
                    "Do NOT ask the technician any question — this is a single-shot kiosk.\n"
                    if _direct_answer_mode()
                    else "End by asking ONE specific question that would help find the right documentation.\n"
                )
                + "--- END GENERAL KNOWLEDGE MODE ---\n"
            )
        # Honesty directive: retrieval ran but found nothing relevant
        elif no_kb_coverage:
            asset = state.get("asset_identified", "")
            support_url = vendor_support_url(asset) or vendor_support_url(message)
            url_line = (
                f"4. Optionally point them to {support_url} for the official manual.\n"
                if support_url
                else "4. (no vendor URL on file — skip the link)\n"
            )
            system_content += (
                "\n\n--- NO KB COVERAGE ---\n"
                "The knowledge base has no documentation specifically for this equipment, "
                "but the technician still needs a useful answer NOW. Give them one.\n"
                "Rules for this response:\n"
                '1. Prefix your answer with: "Based on general industrial knowledge '
                '(not from documentation specific to this equipment): "\n'
                "2. Provide your best, concrete answer drawing on general industrial knowledge "
                "of this fault code / symptom / equipment class. Explain what the code or "
                "symptom typically means for this type of equipment. Suggest the most likely "
                "causes and first diagnostic steps.\n"
                "3. Do NOT tell the user to consult their manual as the primary action — they "
                "already came to you. Give them an answer first.\n"
                + url_line
                + (
                    "5. Do NOT ask the technician any question — this is a single-shot kiosk "
                    "with no follow-up turn. State the most likely causes and the action for "
                    "each instead of asking.\n"
                    if _direct_answer_mode()
                    else "5. NEVER ask the user for manufacturer, model, or fault code information "
                    "they have ALREADY provided in their message or the conversation history. "
                    "Read the user's message and prior turns carefully — if the manufacturer, "
                    "model, or fault code is already present, USE IT — do not re-ask. "
                    "Only ask for what is genuinely missing, and only AFTER giving your best-effort answer.\n"
                )
                + "6. Set confidence to LOW or MEDIUM. Be honest that this is general guidance.\n"
                "--- END NO KB COVERAGE ---\n"
            )

        # Inject NeonDB knowledge base chunks when available
        if neon_chunks:
            system_content += "\n--- NEONDB KNOWLEDGE BASE (retrieved) ---\n"
            for i, chunk in enumerate(neon_chunks, 1):
                score = chunk.get("similarity") or 0.0
                label = format_source_label(chunk) or (chunk.get("equipment_type") or "unknown")
                # Strip prompt-injection sentinel patterns before injection (#1007)
                safe_content = _SENTINEL_RE.sub("[REF_DELIMITER]", chunk["content"])
                system_content += (
                    f"--- [{i}] [Source: {label}] (score={score:.3f}) ---\n{safe_content}\n---\n"
                )
            system_content += "--- END NEONDB CONTEXT ---\n"

        messages = [{"role": "system", "content": system_content}]

        # Conversation history — omit for fresh photo entries (new equipment)
        # but INCLUDE for photos sent during active diagnostic sessions (photo-as-answer)
        _ACTIVE_DIAG = {"Q1", "Q2", "Q3", "DIAGNOSIS", "FIX_STEP"}
        _photo_continues = photo_b64 and state.get("state") in _ACTIVE_DIAG
        _SELF_REF_SIGNALS = ["you said", "your response", "earlier", "before", "what you told me"]
        if not photo_b64 or _photo_continues:
            history = state.get("context", {}).get("history", [])
            trimmed = _trim_history_by_tokens(history)
            for entry in trimmed:
                messages.append({"role": entry["role"], "content": entry["content"]})
            # Self-reference: inject prior MIRA turns explicitly when technician
            # asks about something MIRA said earlier
            if any(s in message.lower() for s in _SELF_REF_SIGNALS):
                mira_turns = [h for h in trimmed if h["role"] == "assistant"][-3:]
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
        """Embed text via Ollama nomic-embed-text (768-dim, matches NeonDB vectors).

        Tries OLLAMA_BASE_URL first (default: host.docker.internal for Docker deployments),
        then falls back to localhost:11434 for local/offline runs outside Docker.
        """
        primary_url = os.environ.get("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
        embed_model = os.environ.get("EMBED_TEXT_MODEL", "nomic-embed-text:latest")
        candidates = [primary_url]
        if primary_url != "http://localhost:11434":
            candidates.append("http://localhost:11434")
        for ollama_url in candidates:
            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    resp = await client.post(
                        f"{ollama_url}/api/embeddings",
                        json={"model": embed_model, "prompt": text},
                    )
                    resp.raise_for_status()
                    return resp.json()["embedding"]
            except Exception as e:
                logger.debug("Ollama embed failed at %s: %s", ollama_url, e)
        logger.warning("Ollama embed failed on all candidates: %s", candidates)
        return None

    async def _call_llm(self, messages: list[dict], model: str = None) -> str:
        """Call LLM — cloud cascade (Groq→Cerebras→Claude) then Open WebUI fallback.

        PII sanitization (IPv4/MAC/serial → placeholders) is applied to every
        outbound LLM call regardless of which backend is reached. The cascade
        path sanitizes inside `router.complete()`; the Open WebUI fallback is
        sanitized here so neither path can leak.
        """
        clean = (
            self.router.sanitize_context(messages)
            if self.router
            else InferenceRouter.sanitize_context(messages)
        )

        if self.router and self.router.enabled:
            content, usage = await self.router.complete(clean, max_tokens=2048, sanitize=False)
            if content:
                self.router.log_usage(usage)
                return content

        return await self._call_openwebui(clean, model=model)

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
