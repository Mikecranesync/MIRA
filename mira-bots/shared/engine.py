"""MIRA Supervisor — Orchestrates workers, manages FSM state, routes intent."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sqlite3
import time
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta, timezone

import httpx

from . import print_recall, quality_gate
from .chat_tenant import resolve as resolve_tenant
from .citation_compliance import check_citation_compliance as _check_citation_compliance
from .citation_compliance import citation_enforce_enabled as _citation_enforce_enabled
from .citation_compliance import enforce_citation_via_rewrite as _enforce_citation_via_rewrite
from .conversation_router import route_intent
from .ctx_enrichment import fetch_ctx_approved_signals as _fetch_ctx_approved_signals
from .detection.recurring_fault import check_recurring_and_annotate
from .dialogue_state import (
    DialogueState,
)
from .dialogue_tracker import (
    DISPATCH_ACTION,
    DISPATCH_ACTION_INTERRUPT,
    DISPATCH_ASK_GENERAL,
    DISPATCH_ASK_PROCEDURAL,
    DISPATCH_GREET,
    DISPATCH_META,
    DISPATCH_SAFETY,
    DISPATCH_SLOT_DONT_KNOW,
    track_turn,
)
from .drive_packs import (
    answer_fault_code,
    answer_question,
    extract_pack_fault_codes,
    resolve_pack,
)
from .fallback_responses import (
    GENERIC_ENGINE_ERROR,
    INFERENCE_EXHAUSTED,
    PHOTO_FAILURE,
    RAG_FAILURE,
    TIMEOUT_WARNING,
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
from .interlock_context import build_interlock_answer, fetch_interlocks
from .live_snapshot import STALE, render_machine_evidence
from .live_snapshot import normalize as normalize_live_tags
from .models.work_order import (
    UNSWorkOrder,
    apply_wo_edit,
    build_uns_wo_from_state,
    format_wo_preview,
    log_uns_event,
)
from .nemotron import NemotronClient
from .neon_recall import kb_has_coverage, kb_has_pair_coverage
from .notifications.push import push_safety_alert, push_wo_created
from .photo_handler import (
    DEFAULT_PHOTO_CAPTION,
    build_print_reply,
    clear_session_photo,
    load_session_photo,
    save_session_photo,
)
from .quota import QUOTA_BLOCK_MESSAGE, check_quota
from .response_formatter import (
    _VISION_PROSE_PREFIX_RE,
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
from .uns_resolver import UNSResolution, resolve_uns_path, resolve_uns_path_multi
from .wo_evidence import recall_work_orders as _recall_work_orders
from .workers.nameplate_worker import NameplateWorker
from .workers.photo_ingest_worker import propose_from_nameplate
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

# Vocabulary used by the cmms-pending bypass: short responses that are clearly a
# WO confirmation, denial, or edit instruction. Anything outside this vocab AND
# longer than the threshold is treated as a fresh question that should NOT be
# routed into the WO confirmation flow.
_WO_RESPONSE_VOCAB = frozenset(
    {
        "yes",
        "yeah",
        "yep",
        "yup",
        "y",
        "sure",
        "ok",
        "okay",
        "log",
        "long",
        "create",
        "submit",
        "confirm",
        "do it",
        "log it",
        "create it",
        "go ahead",
        "please",
        "1",
        "no",
        "nope",
        "n",
        "skip",
        "cancel",
        "abort",
        "never mind",
        "nevermind",
    }
)

_WO_EDIT_RE = re.compile(
    r"\b("
    r"priority\s+(?:is|to)\s+(?:LOW|MEDIUM|HIGH|CRITICAL)"
    r"|(?:asset|equipment|site|area|line|fault|resolution)\s+(?:is|:)"
    r"|change\s+(?:priority|asset|site|area|line)"
    r")",
    re.IGNORECASE,
)

# Cues that the message is a fresh question, not a WO confirmation/edit.
_NEW_QUESTION_RE = re.compile(
    r"\b(what|how|why|when|where|which|who|tell me|explain|describe|"
    r"diagnose|troubleshoot|help me|i need|can you|cause(?:s|d)?|"
    r"causes?\s+of|caused\s+by|trigger(?:s|ed)?)\b",
    re.IGNORECASE,
)


def _is_fresh_question_during_wo(message: str) -> bool:
    """True if message is a brand-new question, not a response to the WO preview.

    Fixes the regression where a follow-up diagnostic question gets misrouted into
    the cmms_pending flow because cmms_pending was set during a prior session.
    """
    msg = (message or "").strip()
    if not msg:
        return False
    msg_lower = msg.lower()
    # Short message that matches WO yes/no vocab → it's a WO response.
    if msg_lower in _WO_RESPONSE_VOCAB:
        return False
    # Recognised edit instruction → WO response.
    if _WO_EDIT_RE.search(msg):
        return False
    # Long message OR question marker OR question word → fresh question.
    if "?" in msg:
        return True
    if _NEW_QUESTION_RE.search(msg):
        return True
    if len(msg) > 40:
        return True
    return False


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

# Replies the quality gate must not second-guess: hand-crafted fallback
# strings the engine returns for known failure modes. They're intentionally
# short and may trip generic heuristics (e.g. low n-gram diversity), but
# they're trusted by definition.
_TRUSTED_FALLBACKS: set[str] = {
    s.strip()
    for s in (
        GENERIC_ENGINE_ERROR,
        INFERENCE_EXHAUSTED,
        PHOTO_FAILURE,
        RAG_FAILURE,
        TIMEOUT_WARNING,
    )
}

# Dispatch kinds whose replies are structured/templated by hand and bypass
# the quality gate. The fast-paths below set this on the result dict.
# Stage 0 (2026-05-04): see PLAN.md §2 for the systemic dialogue-act fix.
# Stage 1 (2026-05-04): the dialogue-tracker dispatch kinds for handler-
# generated replies (greeting, meta-command, slot don't-know) join this set.
_TRUSTED_DISPATCH_KINDS: frozenset[str] = frozenset(
    {
        # Stage 0
        "action_request",
        "dont_know",
        "cmms_pending",
        "session_followup",
        # Stage 1 (DST handlers)
        "dst_greet",
        "dst_meta",
        "dst_action_interrupt",
        # 2026-06-06: live-tag and status-summary replies are templated from
        # the live tag block, not LLM-generated free text. The n-gram /
        # substring heuristics spuriously flag repeated tag-name patterns.
        "tag_query",
        "status_summary",
        # 2026-07-06: drive-pack fast-path replies are composed verbatim from
        # a pack's fault/parameter cards (shared.drive_packs.ask.answer_question)
        # — templated, pack-grounded text, not LLM free text. Repeated
        # boilerplate ("VIEW-ONLY", citation blocks) trips the same n-gram /
        # substring heuristics as tag_query/status_summary above.
        "drive_pack",
        # 2026-07-19: electrical-print replies are grounded to the saved print
        # image before this dispatch kind is set. Schematic answers naturally
        # repeat symbols/labels (M1, K1, contactor), which can trip the generic
        # repetition gate and replace the useful print answer with a rephrase.
        "ELECTRICAL_PRINT",
    }
)

# Stage 1 (PLAN.md §2 / §4) feature flag — when enabled the dialogue
# state tracker becomes the routing backbone. Default OFF to keep the
# existing Stage 0 + route_intent path unchanged in production until the
# flag flips on a clean week of dev/eval. Even when ON, the dispatch
# block falls through to the existing route_intent flow on classifier
# failure — see `_dispatch_dialogue_turn` below.
_DST_ENABLED = os.getenv("MIRA_USE_DST", "0") == "1"

# UNS Confirmation Gate kill-switch. Default ON — the gate is the doctrinal
# entry point of the namespace-builder product (spec §"The UNS Location-Confirmation
# Gate"). Setting MIRA_UNS_GATE_ENABLED=0 returns the engine to pre-gate behavior
# (treats every diagnose_equipment turn as if the asset were already confirmed).
# Used by `_should_fire_uns_gate`; preserves the flag-off regression path called
# out in docs/plans/2026-05-15-maintenance-namespace-builder.md Phase 1 acceptance.
_UNS_GATE_ENABLED = os.getenv("MIRA_UNS_GATE_ENABLED", "1") == "1"

# Router intents that require a CONFIRMED asset before MIRA acts on it: diagnosing
# a fault and scheduling asset-specific maintenance. (log_work_order /
# check_equipment_history / switch_asset have their own dedicated handlers that run
# before the gate.) Keep this narrow -- general questions, doc fetches, and
# chitchat must NOT be gated.
_GATED_INTENTS = frozenset({"diagnose_equipment", "schedule_maintenance"})

# KG maintenance-context enrichment (additive, OFF by default). When on AND
# INTERNAL_KG_API_KEY is configured, the diagnosis path fetches knowledge-graph
# context (equipment hierarchy, components, recent faults + work orders) for the
# confirmed asset from mira-hub's internal KG API and injects it into the RAG
# prompt. Best-effort: any miss (flag off, no key, hub down, no KG entity) yields
# "" and leaves the existing diagnosis flow untouched. Default off so it stays
# dark until validated against a live hub. See specs/MIRA_LANGGRAPH_ARCHITECTURE.md.
_KG_CONTEXT_ENABLED = os.getenv("MIRA_KG_CONTEXT_ENABLED", "0") == "1"
_KG_CONTEXT_TIMEOUT_S = float(os.getenv("MIRA_KG_CONTEXT_TIMEOUT_S", "3.0"))
_MIRA_HUB_URL = os.getenv("MIRA_HUB_URL", "http://mira-hub:3000")

# Live equipment-status enrichment (additive, OFF by default). When on, the
# diagnosis path pulls the latest diagnosis from mira-fault-detective's read-only
# HTTP API and injects a [LIVE EQUIPMENT STATUS] block. Best-effort: any miss
# (flag off, service down, timeout, bad payload) returns "" and the flow is
# byte-for-byte unchanged. Same wrap-don't-rewrite pattern as the KG block.
_LIVE_DATA_ENABLED = os.getenv("MIRA_LIVE_DATA_ENABLED", "0") == "1"
_FAULT_DETECTIVE_URL = os.getenv("FAULT_DETECTIVE_URL", "http://mira-fault-detective:8077")
_LIVE_DATA_TIMEOUT_S = float(os.getenv("MIRA_LIVE_DATA_TIMEOUT_S", "2.0"))

# Contextualization-signals enrichment (additive, OFF by default). When on,
# queries kg_entities for approved ctx signals under the resolved UNS path and
# injects a [APPROVED PLC SIGNALS] block before the RAG call. Best-effort: ""
# on any miss (flag off, no tenant/asset, NeonDB unreachable). Enabled by
# MIRA_CTX_SIGNALS_ENABLED=1.
_CTX_SIGNALS_ENABLED = os.getenv("MIRA_CTX_SIGNALS_ENABLED", "0") == "1"
_CTX_SIGNALS_TIMEOUT_S = float(os.getenv("MIRA_CTX_SIGNALS_TIMEOUT_S", "3.0"))

# Interlock-context enrichment — the CONSUME side of the interlock flywheel
# (docs/north-star/interlock-flywheel-audit.md). Additive, OFF by default. When
# on, recalls VERIFIED kg_relationships interlock edges (USED_IN_LOGIC / CAUSES)
# under the resolved UNS path — the previously-invisible approved logic the
# answer path never read — and injects an [APPROVED INTERLOCK LOGIC] block so MIRA
# can explain *why a machine won't move*. Best-effort: "" on any miss. Enabled by
# MIRA_INTERLOCK_CONTEXT_ENABLED=1.
_INTERLOCK_CONTEXT_ENABLED = os.getenv("MIRA_INTERLOCK_CONTEXT_ENABLED", "0") == "1"
_INTERLOCK_CONTEXT_TIMEOUT_S = float(os.getenv("MIRA_INTERLOCK_CONTEXT_TIMEOUT_S", "3.0"))

# Work-order-history evidence (additive, OFF by default). When on, the diagnosis
# path recalls recent CMMS work orders for the CONFIRMED asset from the Hub
# NeonDB (work_orders JOIN cmms_equipment — the store hub_neon.py writes to) and
# injects them as CITABLE evidence lines. Best-effort: "" on any miss (flag off,
# no tenant/asset, NeonDB unreachable) — the diagnosis path is byte-for-byte
# unchanged. Same wrap-don't-rewrite pattern as the ctx-signals block.
_WO_EVIDENCE_ENABLED = os.getenv("ENABLE_WO_EVIDENCE", "0") == "1"
_WO_EVIDENCE_TIMEOUT_S = float(os.getenv("MIRA_WO_EVIDENCE_TIMEOUT_S", "3.0"))
_WO_EVIDENCE_LIMIT = int(os.getenv("MIRA_WO_EVIDENCE_LIMIT", "5"))

# Single-shot kiosk mode (e.g. the Ignition Ask-MIRA panel). When on, MIRA
# answers directly (see rag_worker DIRECT_ANSWER_SYSTEM_PROMPT) AND the engine
# suppresses interactive follow-ups that a kiosk operator can't act on: the
# auto work-order prompt (which also arms cmms_pending and would corrupt the
# next single-shot turn) and the recurring-fault "log a work order?" annotation.
# Scoped per-container: bots leave it unset and keep the full interactive flow.
_DIRECT_ANSWER_MODE = os.getenv("MIRA_DIRECT_ANSWER_MODE", "") not in ("", "0", "false", "False")

# Stage 0 (2026-05-04) action-request fast-path. Catches imperative
# work-order requests BEFORE `route_intent`, which currently sends them
# into RAG (CRITICAL RULE 3 prefers continue_current mid-flow). Without
# this fast-path the LLM produces garbled output that the quality gate
# then substitutes with the GRACEFUL_FALLBACK ("rephrase your question…").
_WO_ACTION_REQUEST_RE = re.compile(
    r"\b(?:can\s+you\s+|please\s+|could\s+you\s+|would\s+you\s+)?"
    r"(?:make|create|log|file|open|submit|put\s+in|generate|raise|start|need|want)\s+"
    r"(?:a\s+|an\s+|the\s+|me\s+a\s+|me\s+an\s+|me\s+the\s+|us\s+a\s+)?"
    r"(?:work\s*order|workorder|work[\s-]ticket|wo\b|"
    r"maintenance\s+(?:request|ticket|order)|repair\s+ticket|"
    r"service\s+(?:ticket|request|order))\b",
    re.IGNORECASE,
)

# Stage 0 (2026-06-06) live-tag query fast-path. Fires BEFORE route_intent
# for direct safety/state questions that name a live PLC/VFD tag literally.
# Prevents the LLM router from misrouting these as check_equipment_history
# (Q2 regression: "is the e-stop OK?" was routed to _handle_check_equipment_history).
# Only fires when the message is a question (contains '?' or starts with a
# question word) so imperative commands still fall through to normal routing.
_TAG_QUERY_RE = re.compile(
    r"\b(?:"
    r"e[\s-]?stop|emergency\s+stop|estop"
    r"|mlc|main\s+line\s+contactor"
    r"|photo[\s-]?eye|pe[\s-]01|pe[\s-]beam|pe[\s-]latched"
    r"|vfd[\s-]?freq(?:uency)?|vfd[\s-]?current|vfd[\s-]?dc[\s-]?bus"
    r"|vfd[\s-]?comm|vfd[\s-]?fault|vfd[\s-]?cmd|vfd[\s-]?status"
    r"|vfd[\s-]?freq[\s-]?sp|set[\s-]?point|freq(?:uency)?\s+set"
    r"|dc[\s-]bus|drive\s+current|drive\s+freq(?:uency)?"
    r")\b",
    re.IGNORECASE,
)
_TAG_QUESTION_RE = re.compile(
    r"(?:^|\b)(?:is|are|what|does|do|show|check|how)\b|\?",
    re.IGNORECASE,
)
_LIVE_STATUS_HEADER = "[LIVE CONVEYOR STATUS]"

# Q1 length trim (2026-06-06 follow-up to PR #1754 / #1755). The gate-bypass
# at _apply_quality_gate trusts the LLM output for any reply > 80 chars that
# carries the live-tag header. That landed Q1 grounded but at ~165 words,
# 20 over the askmira-tester rubric's 145-word style ceiling. The golden
# reference is 145 words; the engine's job is to meet or beat it, not be
# verbose. Strategy: drop trailing sentences from the reply until at or
# below the soft target. NEVER drop a sentence containing a `[Source:`
# citation (would break H4 and force a redundant stock admission to be
# appended). Refuse to go below a minimum sentence count so we don't
# butcher the reply on edge cases. Only fires on the kiosk path because
# the trim is wired into the gate-bypass site at line ~1270.
_KIOSK_STATUS_WORD_CAP = 145
_KIOSK_STATUS_WORD_TARGET = 130
_KIOSK_STATUS_MIN_SENTENCES = 4
_KIOSK_TRIM_SOURCE_MARKER = "[Source:"
# Sentence boundary: end-of-sentence punctuation followed by whitespace then
# capital letter OR `[` (handles `[Source:` openings). Conservative — if the
# reply uses lowercase sentence starts, the split misses them and the trim
# bails out by retaining everything.
_KIOSK_SENTENCE_END_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z\[])")


def _trim_kiosk_status_reply(reply: str) -> str:
    """Deterministic post-process trim for kiosk Q1 status-summary replies.

    Fires only when the reply exceeds `_KIOSK_STATUS_WORD_CAP`. Walks from
    the end and drops the first non-citation sentence found; repeats until
    the reply is at or below `_KIOSK_STATUS_WORD_TARGET`, OR until no
    non-citation sentence is left to drop, OR until removing one more would
    take us below `_KIOSK_STATUS_MIN_SENTENCES`. Citation-carrying sentences
    are never dropped.
    """
    if not reply:
        return reply
    if len(re.findall(r"\S+", reply)) <= _KIOSK_STATUS_WORD_CAP:
        return reply
    sentences = _KIOSK_SENTENCE_END_RE.split(reply.strip())
    if len(sentences) <= _KIOSK_STATUS_MIN_SENTENCES:
        return reply

    def _wc(parts: list[str]) -> int:
        return len(re.findall(r"\S+", " ".join(parts)))

    # Walk from the end looking for the first non-citation sentence we can drop
    # without violating the floor.
    while _wc(sentences) > _KIOSK_STATUS_WORD_TARGET:
        if len(sentences) <= _KIOSK_STATUS_MIN_SENTENCES:
            break
        drop_idx = None
        for i in range(len(sentences) - 1, -1, -1):
            if _KIOSK_TRIM_SOURCE_MARKER not in sentences[i]:
                drop_idx = i
                break
        if drop_idx is None:
            # Every remaining sentence has a citation — leave them all.
            break
        sentences.pop(drop_idx)
    return " ".join(sentences)


# 2026-06-06 Q5 fix: maintenance-specific queries (lubrication, PM schedules,
# specs-from-nameplate) that won't be answered by "I have X docs indexed".
# When a message matches this AND the KB-hit path fires, we emit a KB-gap
# admission instead of the 5-word "I have X documentation indexed" reply.
_MAINT_GAP_RE = re.compile(
    r"\b(?:"
    r"lubricat(?:ion|e|ing)|lube\s+schedule|oil\s+change|grease\s+interval"
    r"|pm\s+schedule|preventive\s+maintenance\s+schedule|maintenance\s+schedule"
    r"|inspection\s+interval|service\s+interval|service\s+schedule"
    r"|lubrication\s+schedule|lube\s+interval|oiling\s+schedule"
    r")\b",
    re.IGNORECASE,
)

# Stage 0 (2026-05-04) "I don't know" / short-answer fast-path. Fires only
# when MIRA has a pending question (last_question populated) AND the user's
# message is short. Prevents "I don't know. I was just given the new one
# to put in" from being tokenized into "IDON" / "I-DON" and embedded into
# the vector search as candidate fault codes.
_DONT_KNOW_RE = re.compile(
    r"^\s*(?:"
    r"i\s+don'?t\s+know"
    r"|i\s+do\s+not\s+know"
    r"|don'?t\s+know"
    r"|dont\s+know"
    r"|not\s+sure"
    r"|i'?m\s+not\s+sure"
    r"|no\s+idea"
    r"|i\s+have\s+no\s+(?:idea|clue)"
    r"|haven'?t\s+(?:a\s+)?clue"
    r"|can'?t\s+(?:tell|say)"
    r"|cannot\s+(?:tell|say)"
    r"|unsure"
    r"|unclear"
    r"|beats\s+me"
    r"|who\s+knows"
    r")\b",
    re.IGNORECASE,
)
_DONT_KNOW_MAX_LEN = int(os.getenv("MIRA_DONT_KNOW_MAX_LEN", "200"))

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
# User types "PROCEED" (case-insensitive, standalone) in response to the
# KB-honesty prompt "Type PROCEED to continue with my best estimate".
# Matched in process_full BEFORE RAG routing to avoid the text being
# embedded as a vector query for the word "proceed".
_PROCEED_RE = re.compile(r"^\s*proceed\s*$", re.IGNORECASE)

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


# ---------------------------------------------------------------------------
# H4 citation / KB-gap enforcer (2026-06-06)
# ---------------------------------------------------------------------------

_H4_SOURCE_RE = re.compile(r"\[Source:", re.IGNORECASE)

# Phrases that constitute an explicit KB-gap admission — ordered from most
# specific to least. The "I don't have a" check is anchored to avoid matching
# conversational phrases like "I don't have a clue what you mean".
_H4_GAP_PHRASES: tuple[str, ...] = (
    "I don't have specific documentation",
    "not explicitly mentioned",
    "I do not have that specific information",
    "no docs for",
    "not in the knowledge base",
    "not indexed",
    "KB-gap:",
    "I don't have a lubrication",
    "I don't have a maintenance",
    "I don't have a schedule",
    "I don't have a spec",
    "I don't have the specific",
    "not have specific documentation",
    "consult the asset nameplate",
    "consult the vendor manual",
)

_H4_STOCK_ADMISSION = (
    "\n\nI don't have specific documentation indexed for this — consult the asset"
    " nameplate or vendor manual. [KB-gap: I do not have that specific information"
    " in the knowledge base — consult the asset nameplate or vendor manual.]"
)

# 2026-06-06 followup: some LLM cascade replies emit citations as a
# `--- Sources ---\n[1] vendor` block instead of inline `[Source: vendor]`.
# Normalize to the inline format so downstream scoring + AskMira view rendering
# treat them identically. The original block is preserved AFTER the inline
# markers for human readability.
_H4_SOURCES_BLOCK_RE = re.compile(
    r"---\s*Sources\s*---\s*\n((?:\s*\[\d+\]\s+[^\n]+\n?)+)",
    re.IGNORECASE,
)


def _normalize_sources_block(reply: str) -> str:
    m = _H4_SOURCES_BLOCK_RE.search(reply)
    if not m:
        return reply
    entries = [
        line.split("]", 1)[1].strip() for line in m.group(1).strip().splitlines() if "]" in line
    ]
    if not entries:
        return reply
    inline = " ".join(f"[Source: {e}]" for e in entries)
    # Insert inline markers BEFORE the original block so the block can stay for
    # readability; the inline tokens are what the scorer + H4 enforcer match.
    return reply[: m.start()] + inline + "\n\n" + reply[m.start() :]


# Replies that should NEVER have H4 appended — they are already fallback strings.
_H4_SKIP_REPLIES: frozenset[str] = frozenset(
    {quality_gate.GRACEFUL_FALLBACK.strip()}  # noqa: F821 — quality_gate imported above
)


def enforce_citation_or_gap_admission(reply: str) -> str:
    """H4 enforcer: ensure every reply carries a [Source:] or KB-gap admission.

    If the reply already contains a citation tag OR an explicit KB-gap phrase,
    it is returned unchanged. Otherwise the stock admission line is appended.

    Skip conditions:
    - reply is the GRACEFUL_FALLBACK string (appending to it makes it worse)
    - reply is very short (<= 20 chars, e.g. "OK")
    """
    if not reply or len(reply.strip()) <= 20:
        return reply
    stripped = reply.strip()
    if stripped in _H4_SKIP_REPLIES:
        return reply
    # Normalize `--- Sources ---` blocks to inline `[Source: ...]` markers so
    # downstream scoring + view rendering see a single citation format.
    reply = _normalize_sources_block(reply)
    if _H4_SOURCE_RE.search(reply):
        return reply
    lower = reply.lower()
    for phrase in _H4_GAP_PHRASES:
        if phrase.lower() in lower:
            return reply
    return reply + _H4_STOCK_ADMISSION


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
        self.tenant_id = tenant_id or ""

        # Background decision-trace tasks (Phase 9). Holding strong refs keeps
        # fire-and-forget writes from being GC'd before they complete.
        self._decision_trace_tasks: set = set()

        # Troubleshooting-session lifecycle (Phase 7, #1659). Strong refs keep
        # the fire-and-forget NeonDB writes alive; the dict maps chat_id → the
        # active troubleshooting_sessions UUID so a session opens once per
        # confirmed-asset conversation and subsequent turns append to it.
        self._session_tasks: set = set()
        self._ts_sessions: dict[str, str] = {}

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
        # GROQ_API_KEY / CEREBRAS_API_KEY / TOGETHERAI_API_KEY is set.
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

    @staticmethod
    def _background_state_for(state: dict) -> str:
        """Return the steady-state FSM node for non-diagnostic turns."""
        return "ASSET_IDENTIFIED" if state.get("asset_identified") else "IDLE"

    def _clear_diagnostic_carryover(
        self,
        chat_id: str,
        state: dict,
        *,
        clear_photo: bool = False,
        target_state: str | None = None,
    ) -> dict:
        """Drop stale diagnostic baggage when the user pivots to a new ask.

        Also drops any pending WO draft + symptom/diagnosis summaries so a stale
        WO from a prior conversation doesn't bleed into the next one.
        """
        ctx = state.get("context") or {}
        sc = ctx.get("session_context") or {}

        if sc:
            ctx["session_context"] = {
                "equipment_type": sc.get("equipment_type"),
                "manufacturer": sc.get("manufacturer"),
                "last_question": None,
                "last_options": [],
            }

        # Clear any pending WO from a prior session — otherwise the next RESOLVED
        # diagnosis re-uses the stale draft and shows wrong asset/fault to the user.
        ctx.pop("cmms_pending", None)
        ctx.pop("cmms_wo_draft", None)

        state["fault_category"] = None
        state["final_state"] = None
        state["state"] = target_state or self._background_state_for(state)

        if clear_photo:
            ctx.pop("photo_turn", None)
            self._clear_session_photo(chat_id)

        state["context"] = ctx
        return state

    def _load_recent_session_photo(self, chat_id: str, state: dict) -> str | None:
        """Load the prior photo only while it is still within the follow-up window."""
        ctx = state.get("context") or {}
        photo_turn = ctx.get("photo_turn", 0)
        if photo_turn <= 0:
            return None

        turns_since_photo = max(0, state["exchange_count"] - photo_turn)
        if turns_since_photo >= PHOTO_MEMORY_TURNS:
            self._clear_session_photo(chat_id)
            ctx.pop("photo_turn", None)
            state["context"] = ctx
            return None

        session_photo = self._load_session_photo(chat_id)
        if session_photo:
            logger.info(
                "Session photo loaded for turn %d (photo at turn %d, %d turns ago)",
                state["exchange_count"],
                photo_turn,
                turns_since_photo,
            )
        return session_photo

    def _build_print_reply(self, vision_data: dict) -> str:
        return build_print_reply(vision_data)

    @staticmethod
    def _print_vision_context_from_state(state: dict) -> dict:
        """Rebuild the print vision context persisted with an ELECTRICAL_PRINT session."""
        ctx = state.get("context") or {}
        last_print = ctx.get("last_print_vision") if isinstance(ctx, dict) else None
        if isinstance(last_print, dict):
            vision_data = dict(last_print)
        else:
            vision_data = {
                "classification": "ELECTRICAL_PRINT",
                "vision_result": state.get("asset_identified", ""),
                "ocr_items": ctx.get("ocr_items", []),
                "tesseract_text": ctx.get("ocr_text", ""),
                "drawing_type": ctx.get("drawing_type") or "electrical drawing",
                "confidence": "medium",
            }
        vision_data.setdefault("classification", "ELECTRICAL_PRINT")
        vision_data.setdefault("ocr_items", ctx.get("ocr_items", []))
        vision_data.setdefault("tesseract_text", ctx.get("ocr_text", ""))
        vision_data.setdefault("drawing_type", ctx.get("drawing_type") or "electrical drawing")
        return vision_data

    async def _handle_electrical_print_followup(
        self,
        chat_id: str,
        message: str,
        state: dict,
        trace_id: str,
    ) -> dict:
        """Answer a text follow-up while preserving the visual print context."""
        ctx = state.get("context") or {}
        session_photo = self._load_recent_session_photo(chat_id, state)
        if session_photo:
            vision_data = self._print_vision_context_from_state(state)
            reply = await self._grounded_print_reply(session_photo, message, vision_data, chat_id)
            if not reply:
                reply = self._build_print_reply(vision_data)
            formatted = reply
        else:
            try:
                raw = await self.print_.process(message, state)
            except Exception as e:
                logger.error(
                    "PRINT_WORKER_ERROR chat_id=%s error=%s",
                    chat_id,
                    e,
                    exc_info=True,
                )
                self._save_state(chat_id, state)
                return self._make_result(GENERIC_ENGINE_ERROR, "none", trace_id)
            parsed = self._parse_response(raw)
            print_intent = classify_intent(message)
            reply = check_output(parsed["reply"], print_intent, has_photo=False)
            parsed["reply"] = reply
            formatted = self._format_reply(parsed, user_message=message)

        state["state"] = "ELECTRICAL_PRINT"
        state["exchange_count"] += 1
        history = ctx.get("history", [])
        history.append({"role": "user", "content": message})
        history.append({"role": "assistant", "content": reply})
        if len(history) > HISTORY_LIMIT:
            history = history[-HISTORY_LIMIT:]
        ctx["history"] = history
        state["context"] = ctx
        self._save_state(chat_id, state)
        return self._make_result(
            formatted,
            self._infer_confidence(formatted),
            trace_id,
            "ELECTRICAL_PRINT",
        )

    async def _grounded_print_reply(
        self,
        photo_b64: str,
        question: str | None,
        vision_data: dict,
        chat_id: str,
        *,
        interpret_b64: str | None = None,
        observe: dict | None = None,
    ) -> str:
        """Grounded, display-ready answer for a classified ELECTRICAL_PRINT photo.

        ``observe`` (optional mutable dict) collects privacy-safe synthesis
        provenance — ``route`` (which path answered), ``fallback_reason`` (why a
        synthesis branch declined), ``verify_outcome`` — for the caller to feed
        into ``_log_interaction``. Reason codes / route names only; never page
        content. No behavior change when omitted.

        Anthropic PrintSynth interpreter FIRST (deep, typed, never-invent — only
        when configured), else the No-Anthropic grounded cascade
        (``print_translator`` over Groq -> Cerebras -> Together). Always returns a
        display-ready string — the cascade's ``format_theory_reply`` yields a
        graceful fallback even on an empty provider result — so a print question is
        never left unanswered.

        ``interpret_b64`` is the FULL-RESOLUTION image for the Anthropic
        interpreter — the bot passes the raw Telegram bytes so Claude's 2576 px
        high-res vision budget is used, NOT the 1024 px ``photo_b64`` crushed for
        the local qwen classifier (roadmap Phase 0.1). Defaults to ``photo_b64``
        when a caller has no full-res image to hand (e.g. the FSM path), which is
        the prior behavior. The cascade fallback stays on ``photo_b64`` — the local
        vision models want the small image.
        """
        from . import print_translator

        obs = observe if observe is not None else {}

        # 1. Anthropic PrintSynth interpreter (primary, isolated, flag+key gated).
        reply = await self._interpret_print_anthropic(
            interpret_b64 or photo_b64, question, vision_data
        )
        if reply:
            obs["route"] = "print_vision_primary"
            return reply
        obs["route"] = "grounded_cascade"

        # 2. Grounded cascade fallback (No-Anthropic vision path).
        # PRINT_THEORY_FULL_RES=1 sends the caller's full-resolution image to
        # the cascade theory call instead of the 1024 px classifier crush. The
        # R5-alpha probe (2026-07-19) showed serverless big-vision models
        # reading dense table rows correctly at full resolution that the
        # crushed image loses. Default OFF: the small free models the cascade
        # was tuned on want the small image. Or-form parse (compose ${VAR:-}
        # delivers an empty string in-container).
        theory_b64 = photo_b64
        if (os.environ.get("PRINT_THEORY_FULL_RES") or "").strip().lower() in ("1", "true", "on"):
            theory_b64 = interpret_b64 or photo_b64

        async def _sample() -> tuple[str, list[dict]]:
            """One theory(+verify) chain -> (reply, [per-call usage]). Never raises.

            Reproduces the single-pass behavior exactly: a theory draft, then the
            optional ``PRINT_THEORY_VERIFY`` second pass that re-reads the sheet
            against the draft. Fall-through on ANY router failure or empty result
            — the draft is never lost, the turn is never eaten.
            """
            sample_usages: list[dict] = []
            messages = print_translator.build_theory_messages(
                theory_b64, vision_data, question=question
            )
            reply = ""
            try:
                reply, usage = await self.router.complete(
                    messages,
                    max_tokens=int(os.environ.get("PRINT_THEORY_MAX_TOKENS") or "2000"),
                    session_id=str(chat_id),
                )
                if reply:
                    InferenceRouter.log_usage(usage)
                    sample_usages.append(usage)
            except Exception as exc:  # noqa: BLE001 — never eat the turn
                logger.warning("PRINT_GROUNDED_ROUTER_ERROR error=%s", exc)
                reply = ""
                obs["fallback_reason"] = "provider_error"
            # PRINT_THEORY_VERIFY=1 (or-form, default off): one self-verification
            # pass — the vision model re-reads the sheet against its own draft
            # (fix misquotes to the printed text, delete claims it cannot see
            # printed, add printed tiers/contacts/cross-refs it omitted on the
            # asked device). R5-delta's remaining defect classes (a wrong
            # volunteered terminal, a paraphrased label, a column-shift trace, a
            # dropped header tier) are second-look errors by construction.
            if reply and (os.environ.get("PRINT_THEORY_VERIFY") or "").strip().lower() in (
                "1",
                "true",
                "on",
            ):
                try:
                    v_messages = print_translator.build_verify_messages(
                        theory_b64, reply, question=question
                    )
                    v_raw, v_usage = await self.router.complete(
                        v_messages,
                        max_tokens=int(os.environ.get("PRINT_THEORY_MAX_TOKENS") or "2000"),
                        session_id=str(chat_id),
                    )
                    if v_raw:
                        logger.info(
                            "PRINT_VERIFY_APPLIED len_before=%d len_after=%d",
                            len(reply),
                            len(v_raw),
                        )
                        InferenceRouter.log_usage(v_usage)
                        sample_usages.append(v_usage)
                        reply = v_raw
                        obs["verify_outcome"] = "applied"
                    else:
                        logger.info("PRINT_VERIFY_EMPTY — keeping draft")
                        obs["verify_outcome"] = "empty"
                except Exception as exc:  # noqa: BLE001 — verification must never eat the turn
                    logger.warning("PRINT_VERIFY_ERROR error=%s — keeping draft", exc)
                    obs["verify_outcome"] = "error"
            return reply, sample_usages

        # PRINT_THEORY_SELF_CONSISTENCY=N (or-form, default 0/1 = off): sample the
        # theory(+verify) chain N times and reconcile DETERMINISTICALLY to the
        # consensus (medoid) reply — variance reduction on the handful of runs
        # that coin-flip a near-ambiguous reading or fabricate a fresh
        # false-precision detail (ROUND5 Addendum 3, 2026-07-19). No LLM judge.
        # Any sample error is skipped (fall through); if every sample fails the
        # reply is empty and format_theory_reply yields the graceful fallback —
        # the turn is never eaten. N<2 is the single-pass path, unchanged.
        samples_n = int(os.environ.get("PRINT_THEORY_SELF_CONSISTENCY") or "0")
        if samples_n >= 2:
            candidates: list[str] = []
            usages: list[dict] = []
            for _i in range(samples_n):
                try:
                    reply_i, usages_i = await _sample()
                except Exception as exc:  # noqa: BLE001 — a sample must never eat the turn
                    logger.warning("PRINT_SELF_CONSISTENCY_SAMPLE_ERROR error=%s", exc)
                    continue
                usages.extend(usages_i)
                if reply_i:
                    candidates.append(reply_i)
            if candidates:
                raw, agreed = print_translator.reconcile_print_samples(candidates)
                logger.info(
                    "PRINT_SELF_CONSISTENCY samples=%d/%d agreed=%s",
                    len(candidates),
                    samples_n,
                    agreed,
                )
                self._record_self_consistency_usage(usages)
            else:
                raw = ""
        else:
            raw, _ = await _sample()
        # Empty synthesis after the cascade (and any verify pass) → the reply
        # will be format_theory_reply's graceful FALLBACK_REPLY. Record the
        # decline reason if a more specific one (provider_error) wasn't already
        # set, so the turn is never silently a fallback.
        if not raw:
            obs.setdefault("fallback_reason", "empty_synthesis")
        logger.info(
            "PRINT_SYNTHESIS_OUTCOME route=%s fallback_reason=%s verify=%s empty=%s",
            obs.get("route"),
            obs.get("fallback_reason"),
            obs.get("verify_outcome"),
            not bool(raw),
        )
        return print_translator.format_theory_reply(raw, (vision_data or {}).get("drawing_type"))

    def _record_self_consistency_usage(self, usages: list[dict]) -> None:
        """Best-effort: record the SUMMED token usage of a self-consistency print
        turn into ``printsense.interpret.pop_last_usage``'s slot, so a bench
        envelope reads the total cost of ALL samples (not one call).

        Best-effort telemetry only — ``printsense`` may not be shipped in this
        image, and the slot never grades truth; never raises, never eats the turn.
        """
        if not usages:
            return
        try:
            from printsense import interpret

            total_in = sum(int(u.get("input_tokens") or 0) for u in usages)
            total_out = sum(int(u.get("output_tokens") or 0) for u in usages)
            last = usages[-1]
            interpret.record_sampled_usage(
                last.get("provider"), last.get("model"), total_in, total_out
            )
        except Exception as exc:  # noqa: BLE001 — telemetry must never eat the turn
            logger.warning("PRINT_SELF_CONSISTENCY_USAGE_ERROR error=%s", exc)

    async def _interpret_print_anthropic(
        self,
        photo_b64: str,
        question: str | None,
        vision_data: dict,
    ) -> str:
        """ISOLATED paid PrintSynth interpretation -> rendered Telegram reply.

        (Method name keeps its historical ``_anthropic`` suffix — it is the paid
        print-vision seam; the provider is ``PRINT_VISION_PROVIDER``, OpenAI by
        default since 2026-07-16, Anthropic retained behind the knob.)

        Returns "" (caller falls back to the free cascade) when the provider
        isn't configured: no ``printsense`` package in this image, provider/key
        not set (``interpret.is_configured()``), or the call fails. The paid
        provider is confined to this seam — the general cascade never touches
        it. The blocking call runs in a worker thread so the bot event loop
        stays free during the ~30-60 s interpretation.
        """
        pkg_ctx = {"drawing_type": (vision_data or {}).get("drawing_type")}
        return await self._interpret_print_anthropic_pages(
            photo_b64s=[photo_b64],
            question=question,
            package_context=pkg_ctx,
        )

    async def _interpret_print_anthropic_pages(
        self,
        *,
        photo_b64s: list[str],
        question: str | None,
        package_context: dict | None = None,
    ) -> str:
        """ISOLATED paid PrintSynth interpretation for a print package.

        The Telegram album path uses this to send multiple print photos as one
        ``interpret_print(pages=[...])`` package so cross-page references stay
        in the same typed graph. Returns "" when unavailable or failed so callers
        can fall back to the free-cascade vision path.
        """
        try:
            from printsense import interpret, render
        except ImportError:
            return ""  # framework not shipped in this image -> cascade
        if not interpret.is_configured():
            return ""  # inert without the provider flag + its key
        import base64

        pages: list[tuple[bytes, str]] = []
        for b64 in photo_b64s:
            try:
                pages.append((base64.b64decode(b64), "image/jpeg"))
            except Exception:  # noqa: BLE001 — bad b64 -> cascade
                return ""
        try:
            if print_recall.enabled():
                # Recall gate: an identical print turn reuses a stored interpretation
                # with NO model call (behavior-preserving — the key folds question +
                # package context). Falls through to a plain paid interpret on any
                # recall error. Default OFF (PRINT_RECALL_ENABLED).
                graph = await asyncio.to_thread(
                    print_recall.interpret_with_recall,
                    pages=pages,
                    question=question,
                    package_context=package_context or {},
                    model=interpret.DEFAULT_MODEL,
                    preprocess=True,
                    interpret_fn=interpret.interpret_print,
                )
            else:
                graph = await asyncio.to_thread(
                    interpret.interpret_print,
                    pages,
                    package_context=package_context or {},
                    question=question,
                )
        except interpret.PrintVisionUnavailable:
            return ""
        except Exception as exc:  # noqa: BLE001 — any interp/API error -> cascade
            logger.warning("PRINT_ANTHROPIC_ERROR error=%s", exc)
            return ""
        return render.format_graph_for_telegram(graph)

    async def _analyze_schematic_with_question(
        self,
        photo_b64: str,
        question: str,
        vision_data: dict,
        chat_id: str,
    ) -> str:
        """Send schematic photo + technician question to the vision LLM and
        return a circuit-analysis reply.

        Used when the user attaches a real question to a schematic photo
        (not the bot's default ``Analyze this equipment photo`` caption).
        The model is asked to identify components, trace paths, and answer
        the specific question. OCR labels already extracted by the vision
        worker are fed in as ground-truth so the model doesn't have to
        re-read every wire number from pixels.

        Returns the empty string when the inference cascade has no vision
        provider available or every provider failed — the caller MUST fall
        back to ``_build_print_reply`` in that case so the user is never
        left with nothing.
        """
        ocr_items = vision_data.get("ocr_items") or []
        drawing_type = vision_data.get("drawing_type") or "electrical drawing"
        ocr_block = (
            "OCR labels extracted from the drawing (ground truth — use these "
            "verbatim, do not invent new labels):\n"
            + "\n".join(f"- {item}" for item in ocr_items[:80])
            if ocr_items
            else "No OCR labels were extracted; rely on the image."
        )

        system_prompt = (
            "You are MIRA, an industrial maintenance intelligence assistant "
            "with 30 years of experience reading electrical schematics, "
            "wiring diagrams, PLC prints, and control-circuit drawings.\n\n"
            "When shown a schematic or wiring diagram:\n"
            "1. Identify the circuit type (motor control, safety circuit, "
            "sensor circuit, communication, power distribution, etc.).\n"
            "2. List the major components with their designations "
            "(K10, R11, CR1, etc.) using the OCR labels when available.\n"
            "3. Trace the signal/power paths and explain what the circuit "
            "does.\n"
            "4. Identify safety-critical elements (emergency stops, "
            "interlocks, ground-fault paths).\n"
            "5. Note component values where visible (resistance, voltage "
            "ratings).\n"
            "6. Answer the technician's specific question directly.\n"
            "7. Flag any unusual configurations or potential issues.\n\n"
            "Be specific. Use the actual designations from the drawing. "
            "Explain in terms a maintenance technician would understand. "
            "If you cannot read a label or value clearly, say so — do not "
            "guess.\n\n"
            "CRITICAL — never fabricate a device inventory:\n"
            "- Name ONLY components whose labels/designations you can actually "
            "read on this drawing. Do NOT output a generic device taxonomy "
            "(timers, counters, logic gates, I/O modules, PLC blocks, relay "
            "coils) unless those exact elements are visibly labelled here.\n"
            "- Do NOT assume this is ladder logic or a PLC program. Most field "
            "drawings are power/wiring/interconnection schematics; identify the "
            "type only from what you can actually see.\n"
            "- If the image is too unclear to read the device labels (glare, "
            "moiré, low resolution, a photo of a screen), say exactly that and "
            "ask for a closer, flatter photo or the source PDF — an honest "
            "'I can't read this clearly' beats a confident guess.\n"
            "- Never claim 'no safety-critical elements' unless you can "
            "positively read the whole drawing; absence of a readable label is "
            "NOT absence of a hazard.\n\n"
            "Keep the reply under 350 words; bullet lists are fine."
        )

        user_text = (
            f"Drawing type (auto-detected): {drawing_type}.\n\n"
            f"{ocr_block}\n\n"
            f"Technician's question: {question}"
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{photo_b64}",
                        },
                    },
                    {"type": "text", "text": user_text},
                ],
            },
        ]

        try:
            reply, usage = await self.router.complete(
                messages,
                max_tokens=900,
                session_id=str(chat_id),
            )
        except Exception as exc:
            logger.warning("SCHEMATIC_ANALYSIS_ROUTER_ERROR error=%s", exc)
            return ""
        if reply:
            InferenceRouter.log_usage(usage)
            logger.info(
                "SCHEMATIC_ANALYSIS_OK chat_id=%s provider=%s tokens=%s",
                chat_id,
                usage.get("provider", "unknown") if isinstance(usage, dict) else "unknown",
                usage.get("total_tokens", "?") if isinstance(usage, dict) else "?",
            )
        else:
            logger.warning(
                "SCHEMATIC_ANALYSIS_EMPTY chat_id=%s — cascade returned nothing, "
                "falling back to OCR-only reply",
                chat_id,
            )
        return reply or ""

    async def _extract_schematic(self, photo_b64: str) -> dict:
        """Call mira-mcp's /api/kg/schematic endpoint to run the schematic
        intelligence pipeline (classify → detect symbols → trace connections).

        Returns the KG-shaped payload (entities, relationships, schematic_type,
        notes) on success, or ``{}`` when the endpoint is unreachable, the
        bot is missing credentials, or the pipeline detected nothing useful.
        Never raises — schematic extraction is opportunistic enrichment, not
        a critical path.
        """
        if not photo_b64 or not self.mcp_base_url:
            return {}
        url = f"{self.mcp_base_url}/api/kg/schematic"
        headers = {"Content-Type": "application/json"}
        if self.mcp_api_key:
            headers["Authorization"] = f"Bearer {self.mcp_api_key}"
        body = {
            "image_b64": photo_b64,
            "tenant_id": self.tenant_id or "",
            "persist": False,
        }
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(url, json=body, headers=headers)
                if resp.status_code != 200:
                    logger.warning(
                        "SCHEMATIC_EXTRACT_HTTP_%s body=%s",
                        resp.status_code,
                        resp.text[:200],
                    )
                    return {}
                data = resp.json() or {}
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("SCHEMATIC_EXTRACT_FAILED error=%s", exc)
            return {}
        if not data.get("ok"):
            return {}
        return data.get("result") or {}

    @staticmethod
    def _summarize_schematic(payload: dict) -> str:
        """Render a one-paragraph summary of an extracted schematic — used to
        augment the ELECTRICAL_PRINT reply."""
        if not payload:
            return ""
        entities = payload.get("entities") or []
        if not entities:
            return ""
        schematic_type = payload.get("schematic_type", "unknown")
        type_counts: dict[str, int] = {}
        for ent in entities:
            sub = ((ent.get("properties") or {}).get("subtype")) or ent.get("entity_type", "")
            type_counts[sub] = type_counts.get(sub, 0) + 1
        breakdown = ", ".join(f"{n} {t}" for t, n in sorted(type_counts.items()))
        n_relationships = len(payload.get("relationships") or [])
        type_label = schematic_type.replace("_", " ")
        return (
            f"\n\nSchematic intelligence: {type_label} — {len(entities)} components"
            f" ({breakdown}); {n_relationships} connections traced."
            f' Say "add this to documentation for [plant/equipment]" to store'
            f" them in the knowledge graph."
        )

    # ------------------------------------------------------------------
    # Confidence inference
    # ------------------------------------------------------------------

    @staticmethod
    def _is_doc_specific(vendor: str, text: str) -> bool:
        """Return True if *text* is specific enough to crawl usefully.

        Requires both vendor known AND model present. Delegates to the UNS
        resolver — vendor is injected into the resolver input so pure-digit
        models like "525" resolve when adjacent to a known family name.
        """
        combined = f"{vendor} {text}".strip() if vendor else text
        ctx = resolve_uns_path(combined)
        return bool(ctx.manufacturer) and bool(ctx.model)

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
        dispatch_kind: str = "",
        citation_evidence: dict | None = None,
        *,
        route: str | None = None,
        model: str | None = None,
        input_sha256: str | None = None,
        fallback_reason: str | None = None,
    ) -> dict:
        """Build a standard process_full() result dict.

        dispatch_kind labels the routing decision so the runtime quality gate
        can bypass replies it shouldn't second-guess (action_request,
        cmms_pending, dont_know, session_followup). Empty string = default
        diagnostic flow → gate runs normally.

        citation_evidence carries THIS turn's per-call retrieval snapshot
        (kb_status / chunks / sources / no_kb) from process_full() out to the
        post-process_full() consumers in process() — the citation rewrite and
        decision-trace — so they never read it off the shared RAGWorker
        instance after an await (#1704). None on non-RAG turns.
        """
        return {
            "reply": reply,
            "confidence": confidence,
            "trace_id": trace_id,
            "next_state": next_state,
            "dispatch_kind": dispatch_kind,
            "_citation_evidence": citation_evidence,
            # Print-turn observability provenance (privacy-safe: route/model
            # names + reason codes only, never page content) — read by
            # process()'s _log_interaction so "check the bot results" shows the
            # full synthesis story. None on turns that don't set them.
            "route": route,
            "model": model,
            "input_sha256": input_sha256,
            "fallback_reason": fallback_reason,
        }

    @staticmethod
    def _evidence_from_parsed(parsed: dict) -> dict:
        """Per-turn citation/grounding evidence carried on ``parsed`` (#1704).

        Built from the snapshot _call_with_correction popped off ``state``;
        threaded into the result dict so the rewrite + decision-trace read this
        turn's data, never the shared self.rag.* attributes.
        """
        return {
            "kb_status": parsed.get("_kb_status") or {},
            "chunks": parsed.get("_last_chunks") or [],
            "sources": parsed.get("_sources") or [],
            "no_kb": parsed.get("_no_kb", False),
        }

    async def _enforce_citation_rewrite(
        self, reply: str, *, chat_id: str, fsm_state: str, evidence: dict | None = None
    ) -> str:
        """#1659 enforce-mode bridge: connect the insertion-only citation rewrite
        to this turn's retrieval set + the inference router.

        Returns ``reply`` unchanged unless it owes a citation, had retrieval
        chunks, and dropped the ``[Source:]`` tag — in which case one
        insertion-only second pass salvages it (validated for content
        preservation + real labels by the helper). Kill-switch
        ``MIRA_CITATION_REWRITE=0`` disables it; any error falls open.

        ``evidence`` is THIS turn's per-call snapshot (chunks + kb_status),
        threaded via the result dict. It is read ONLY from here, never from the
        shared self.rag.* attributes a concurrent tenant overwrites (#1704). No
        snapshot (non-RAG turn) → nothing to enforce → reply unchanged, with no
        stale-shared fallback.
        """
        if os.getenv("MIRA_CITATION_REWRITE", "1") != "1":
            return reply
        if not evidence:
            return reply
        rag = getattr(self, "rag", None)
        if rag is None:
            return reply
        try:
            return await _enforce_citation_via_rewrite(
                reply,
                evidence.get("chunks"),
                evidence.get("kb_status"),
                fsm_state=fsm_state,
                chat_id=chat_id,
                llm_call=rag._call_llm,
            )
        except Exception:
            logger.warning(
                "CITATION_REWRITE_BRIDGE_ERROR chat_id=%s — keeping original reply",
                chat_id,
                exc_info=True,
            )
            return reply

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
        tenant_id: str | None = None,
        mira_user_id: str | None = None,
        uns_source: str | None = None,
        tag_evidence: list | None = None,
        live_tags: dict | None = None,
        retrieval_query: str | None = None,
    ) -> str:
        """Main entry point. Returns reply string (backward-compatible).

        Wraps process_full() with a configurable timeout (MIRA_PROCESS_TIMEOUT,
        default 30s) and a top-level exception guard so every call returns a
        user-facing string — never raises to the adapter.

        ``uns_source`` marks the provenance of the UNS context for this turn.
        A direct-connection surface (Ignition cloud-chat, Perspective panel,
        MQTT/Sparkplug, PLC bridge, Hub display, QR) passes
        ``uns_source="direct_connection"`` — the connection itself certifies the
        UNS path (see .claude/rules/direct-connection-uns-certified.md). Default
        None = a chat surface; the chat UNS gate applies unchanged. This marker
        is recorded on ``state["context"]["uns_context"]["source"]`` and surfaced
        in the decision trace; it does NOT by itself alter gate firing (the full
        gate bypass is master-plan Phase 6).

        ``live_tags`` (optional) is a raw read-only PLC/VFD tag dict. It is
        attached to the message ONLY after the UNS confirmation gate has passed
        (see ``_maybe_attach_live_snapshot``) — never before — so live data can
        never bypass the gate. Callers that don't pass it are unaffected.

        ``retrieval_query`` (optional) overrides the text used for LEXICAL recall
        only — BM25, fault-code extraction, product-name extraction. Direct-
        connection surfaces (the Ignition /ask kiosk) prepend a large static
        context card to ``message``; passing the trimmed question+status here
        keeps the lexical streams from keying off that boilerplate (#1766). The
        EMBEDDING still uses the full ``message`` for semantic context. Default
        None = use ``message`` (chat surfaces unchanged).
        """
        # Per-call tenant flows through method params (tenant_id → process_full,
        # workers, and the decision-trace) — NOT stashed on self, which a
        # concurrent tenant would overwrite across this turn's awaits.
        # Plan/quota gate (audit issue #1) — the ONE enforcement point every
        # adapter (Telegram/Slack/Ignition/web) inherits. Flag-gated behind
        # ENFORCE_PLAN_QUOTA (default OFF — no DB call, no behavior change) and
        # fail-open on any error or missing tenant. Runs BEFORE inference so a
        # blocked tenant costs zero LLM calls; does not touch the UNS gate,
        # greeting, or safety paths (those live inside process_full).
        quota_tenant = tenant_id or self.tenant_id or None
        quota_allowed, quota_reason = await check_quota(quota_tenant)
        if not quota_allowed:
            logger.warning(
                "QUOTA_BLOCKED chat_id=%s tenant_id=%s platform=%s reason=%s",
                chat_id,
                quota_tenant,
                platform,
                quota_reason,
            )
            return QUOTA_BLOCK_MESSAGE
        # Read-only live-tag snapshot — gated on a confirmed asset (see helper).
        message = self._maybe_attach_live_snapshot(chat_id, message, live_tags, platform)

        t0 = time.monotonic()
        try:
            result = await asyncio.wait_for(
                self.process_full(
                    chat_id,
                    message,
                    photo_b64,
                    uns_source=uns_source,
                    retrieval_query=retrieval_query,
                ),
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
        reply = await self._apply_quality_gate(
            chat_id,
            message,
            result["reply"],
            dispatch_kind=result.get("dispatch_kind", ""),
        )
        # #1659 enforce-mode: if the reply owes a citation and the KB returned
        # chunks but the LLM dropped the [Source:] tag, salvage it with one
        # insertion-only rewrite BEFORE H4 falls back to a (misleading) KB-gap
        # admission. Runs post-quality-gate so the injected tag can't perturb
        # the gate; gated + fail-open inside the bridge.
        reply = await self._enforce_citation_rewrite(
            reply,
            chat_id=chat_id,
            fsm_state=result.get("next_state", ""),
            evidence=result.get("_citation_evidence"),
        )
        # H4 enforcer (2026-06-06): every reply must carry a [Source:] citation
        # or an explicit KB-gap admission. Applied AFTER the quality gate so the
        # appended text doesn't confuse the gate's heuristics. Skips graceful-
        # fallback strings and trusted templated replies that already carry
        # structural tags (live-tag block, WO preview, etc.).
        reply = enforce_citation_or_gap_admission(reply)
        self._log_interaction(
            chat_id,
            message,
            reply,
            fsm_state=result.get("next_state", ""),
            confidence=result.get("confidence", ""),
            has_photo=bool(photo_b64),
            response_time_ms=elapsed_ms,
            platform=platform,
            route=result.get("route"),
            model=result.get("model"),
            input_sha256=result.get("input_sha256"),
            fallback_reason=result.get("fallback_reason"),
        )
        # Phase 9 — decision trace (observational, fire-and-forget). Scheduled
        # AFTER the reply is built so it adds zero latency to the user response,
        # and fully guarded so a trace failure can never affect the reply.
        self._schedule_decision_trace(
            chat_id=chat_id,
            message=message,
            reply=reply,
            result=result,
            platform=platform,
            latency_ms=elapsed_ms,
            tag_evidence=tag_evidence,
            tenant_id=tenant_id,
        )
        # Phase 7 (#1659) — troubleshooting-session lifecycle (observational,
        # fire-and-forget). Opens a session on gate-pass (confirmed asset +
        # active diagnostic state), appends each turn, closes on RESOLVED.
        # Idle sessions are abandoned by the nightly cron. Fully guarded.
        self._schedule_session_lifecycle(
            chat_id=chat_id,
            message=message,
            reply=reply,
            result=result,
            platform=platform,
            tenant_id=tenant_id,
        )
        return reply

    def _schedule_decision_trace(
        self,
        *,
        chat_id: str,
        message: str,
        reply: str,
        result: dict,
        platform: str,
        latency_ms: int,
        tag_evidence: list | None = None,
        tenant_id: str | None = None,
    ) -> None:
        """Schedule a non-blocking decision_traces write for this turn.

        Best-effort: gathers the evidence the engine already has on hand (UNS
        context, RAG sources, citation presence, outcome) and fires the write as
        a background task. Every step is guarded — a trace failure must never
        touch the reply path. See mira-bots/shared/decision_trace.py.
        """
        try:
            import asyncio

            from .decision_trace import write_trace

            state = self._load_state(chat_id)
            ctx = (state.get("context") or {}) if isinstance(state, dict) else {}
            uns_context = ctx.get("uns_context") if isinstance(ctx, dict) else None

            next_state = result.get("next_state") or ""
            if next_state == "RESOLVED" or state.get("final_state") == "RESOLVED":
                outcome = "resolved"
            elif ctx.get("pending_uns_confirm"):
                outcome = "gate_fired"
            else:
                outcome = None

            # Use THIS turn's tenant, passed in by the caller — never a shared
            # self._current_tenant_id read after process_full's awaits, which a
            # concurrent tenant could overwrite (cross-tenant trace attribution).
            tenant_id = tenant_id or self.tenant_id

            # Only attach RAG sources when THIS turn actually retrieved. Read
            # the per-turn snapshot threaded on the result dict (#1704) — NOT
            # the shared worker._last_sources, which persists across turns and,
            # under concurrency, can hold another tenant's evidence. No snapshot
            # (non-RAG turn) → no manual sources, which also keeps the trace in
            # agreement with citations_present.
            ev = result.get("_citation_evidence") or {}
            retrieved = bool(ev) and not ev.get("no_kb", True)
            manual_sources = (ev.get("sources") or None) if retrieved else None

            # Phase 2 — model attribution. The cascade router caches the model that
            # answered each session (keyed by session_id, #1704-safe); look it up by
            # this turn's chat_id. None when the answering call passed no session_id
            # or fell back to Open WebUI. Feeds both the NeonDB row and the local trace.
            try:
                model_used = self.router.last_model_for(str(chat_id))
            except Exception:  # noqa: BLE001
                model_used = None

            coro = write_trace(
                tenant_id=tenant_id,
                user_question=message,
                recommendation=reply,
                platform=platform,
                uns_context=uns_context,
                tag_evidence=tag_evidence,
                manual_sources=manual_sources,
                outcome=outcome,
                model_used=model_used,
                latency_ms=latency_ms,
            )
            # Hold a reference so the task isn't GC'd before it runs.
            task = asyncio.create_task(coro)
            self._decision_trace_tasks.add(task)
            task.add_done_callback(self._decision_trace_tasks.discard)

            # Phase 1 — local AnswerTrace (off unless MIRA_LOCAL_TRACE=1; fail-open).
            # Same evidence as the NeonDB row above (incl. model_used from Phase 2),
            # written as inspectable JSONL so every adapter routing through process()
            # emits a local trace. Governance/incident checks run in Phase 3.
            try:
                from .observe.from_engine import emit_local_trace

                emit_local_trace(
                    question=message,
                    reply=reply,
                    platform=platform,
                    tenant_id=tenant_id,
                    uns_context=uns_context,
                    tag_evidence=tag_evidence,
                    manual_sources=manual_sources,
                    confidence=result.get("confidence"),
                    model_used=model_used,
                    latency_ms=latency_ms,
                    outcome=outcome,
                )
            except Exception as exc:  # noqa: BLE001 — observational, never block reply
                logger.debug("local trace emit skipped: %s", exc)
        except Exception as exc:  # noqa: BLE001
            logger.debug("decision_trace schedule skipped: %s", exc)

    def _schedule_session_lifecycle(
        self,
        *,
        chat_id: str,
        message: str,
        reply: str,
        result: dict,
        platform: str,
        tenant_id: str | None = None,
    ) -> None:
        """Open / append / close a ``troubleshooting_sessions`` row for this turn.

        Phase 7 (#1659). Best-effort and fully guarded — a NeonDB blip must
        never touch the reply path:

          * **Open** on gate-pass: an asset is confirmed (``asset_identified``),
            the UNS gate is no longer pending, and the turn is in an active
            diagnostic state. Opens once per ``chat_id`` (deduped via
            ``self._ts_sessions``).
          * **Append** every turn while a session is active — the user message
            and the assistant reply.
          * **Close** (``resolved``) on a ``RESOLVED`` next_state. Idle sessions
            (>24h) are abandoned by ``mira-bots/scripts/nightly_close_sessions.py``.

        Asset context lives in ``metadata`` — chat surfaces carry no asset UUID,
        so ``asset_id``/``component_id`` stay NULL (the column is nullable).
        """
        try:
            import asyncio  # noqa: PLC0415

            from .fsm import ACTIVE_DIAGNOSTIC_STATES  # noqa: PLC0415
            from .troubleshooting_session import (  # noqa: PLC0415
                append_turn_coro,
                close_session_coro,
                open_session_coro,
            )

            tenant_id = tenant_id or self.tenant_id
            if not tenant_id:
                return

            state = self._load_state(chat_id)
            if not isinstance(state, dict):
                return
            ctx = state.get("context") or {}
            uns_context = ctx.get("uns_context") if isinstance(ctx, dict) else None
            next_state = result.get("next_state") or ""
            asset_label = state.get("asset_identified") or ""
            gate_passed = bool(asset_label) and not (
                isinstance(ctx, dict) and ctx.get("pending_uns_confirm")
            )

            async def _run() -> None:
                sid = self._ts_sessions.get(chat_id)
                if not sid and gate_passed and next_state in ACTIVE_DIAGNOSTIC_STATES:
                    uc = uns_context if isinstance(uns_context, dict) else {}
                    metadata = {
                        "asset_label": asset_label,
                        "manufacturer": uc.get("manufacturer"),
                        "model": uc.get("model"),
                        "uns_path": uc.get("uns_path"),
                        "fault_code": uc.get("fault_code"),
                        "source": uc.get("source"),
                        "fsm_state": next_state,
                    }
                    sid = await open_session_coro(
                        tenant_id=tenant_id,
                        asset_id=None,
                        component_id=None,
                        channel=platform,
                        metadata=metadata,
                    )
                    if sid:
                        self._ts_sessions[chat_id] = sid
                if not sid:
                    return
                await append_turn_coro(
                    session_id=sid, tenant_id=tenant_id, role="user", content=message
                )
                await append_turn_coro(
                    session_id=sid, tenant_id=tenant_id, role="assistant", content=reply
                )
                if next_state == "RESOLVED":
                    await close_session_coro(session_id=sid, tenant_id=tenant_id, reason="resolved")
                    self._ts_sessions.pop(chat_id, None)

            task = asyncio.create_task(_run())
            self._session_tasks.add(task)
            task.add_done_callback(self._session_tasks.discard)
        except Exception as exc:  # noqa: BLE001
            logger.debug("session_lifecycle schedule skipped: %s", exc)

    def _maybe_attach_live_snapshot(
        self,
        chat_id: str,
        message: str,
        live_tags: dict | None,
        platform: str,
    ) -> str:
        """Prefix ``message`` with a read-only live-tag status block, gated.

        Returns ``message`` unchanged unless ALL hold:
          * ``live_tags`` was provided, and
          * the conversation has already passed the UNS confirmation gate — the
            pre-turn FSM state is an active diagnostic state AND an asset is
            confirmed (``asset_identified``).

        This is the gate-safety guarantee: live machine data is never attached
        before the technician's asset context is confirmed, so it cannot drive a
        troubleshooting answer ahead of the gate. Each attached snapshot is
        logged (``LIVE_SNAPSHOT``) for traceability. Best-effort: any failure
        falls back to the original message so a snapshot bug never breaks chat.
        """
        if not live_tags:
            return message
        try:
            state = self._load_state(chat_id)
            fsm_state = state.get("state", "IDLE")
            if fsm_state not in ACTIVE_DIAGNOSTIC_STATES or not state.get("asset_identified"):
                logger.info(
                    "LIVE_SNAPSHOT_WITHHELD chat_id=%s reason=gate_not_passed state=%s",
                    chat_id,
                    fsm_state,
                )
                return message
            uns_ctx = (state.get("context") or {}).get("uns_context") or {}
            uns_base = uns_ctx.get("uns_path") or ""
            ts = datetime.now(timezone.utc).isoformat()
            snapshots = normalize_live_tags(live_tags, uns_base, source=platform, ts=ts)
            # Attach the structured Live Machine Evidence section (decoded values
            # + deterministic assessment + separation instruction) — the Python
            # mirror of the Hub machine-context packet. Same gated, best-effort,
            # read-only text-preamble mechanism as before.
            block = render_machine_evidence(snapshots)
            if not block:
                return message
            n_stale = sum(1 for s in snapshots if s.quality == STALE)
            logger.info(
                "LIVE_SNAPSHOT chat_id=%s uns=%s source=%s ts=%s n=%d stale=%d datapoints=%s",
                chat_id,
                uns_base or "-",
                platform,
                ts,
                len(snapshots),
                n_stale,
                ",".join(s.datapoint for s in snapshots),
            )
            return f"{block}\n\n{message}"
        except Exception as exc:
            logger.warning("LIVE_SNAPSHOT_ERROR chat_id=%s err=%s", chat_id, exc)
            return message

    async def _apply_quality_gate(
        self,
        chat_id: str,
        message: str,
        reply: str,
        *,
        dispatch_kind: str = "",
    ) -> str:
        """Run the runtime quality gate; substitute a graceful fallback on failure.

        Wrapped in a broad except: a buggy gate must never block the bot.

        Stage 0 (2026-05-04): trusted dispatch kinds bypass the gate. Replies
        for action-request, cmms_pending, dont_know, and session_followup are
        structured/templated and the heuristic checks (n-gram repetition,
        substring repetition) flag them spuriously — the WO preview has
        intentional repeated bullet headers.
        """
        if not quality_gate.is_enabled():
            return reply
        if dispatch_kind in _TRUSTED_DISPATCH_KINDS:
            logger.debug(
                "QUALITY_GATE_BYPASS chat_id=%s dispatch_kind=%s",
                chat_id,
                dispatch_kind,
            )
            return reply
        # Q1 fix (2026-06-06): status-summary replies from the Ignition kiosk
        # path legitimately repeat tag names and status tokens, which trips the
        # n-gram / substring heuristics. Bypass the gate when the enriched
        # message contains the live-tag block AND the reply is substantive
        # (>80 chars). This is deterministic on observable inputs, not on LLM
        # output shape, so it doesn't move the flakiness — it removes it.
        if _LIVE_STATUS_HEADER in message and len(reply.strip()) > 80:
            # Q1 length trim (follow-up to PR #1754): kiosk status-summary
            # replies were landing ~165 words against the 145 ceiling. Drop
            # trailing non-citation sentences in-place.
            trimmed = _trim_kiosk_status_reply(reply)
            if trimmed != reply:
                logger.info(
                    "KIOSK_REPLY_TRIMMED chat_id=%s before_words=%d after_words=%d",
                    chat_id,
                    len(re.findall(r"\S+", reply)),
                    len(re.findall(r"\S+", trimmed)),
                )
            logger.debug(
                "QUALITY_GATE_BYPASS chat_id=%s reason=live_status_summary len=%d",
                chat_id,
                len(trimmed),
            )
            return trimmed
        try:
            gate = await quality_gate.evaluate(
                reply,
                user_message=message,
                router=self.router,
                skip_strings=_TRUSTED_FALLBACKS,
            )
        except Exception as exc:
            logger.warning("QUALITY_GATE_INTERNAL_ERROR chat_id=%s err=%s", chat_id, exc)
            return reply
        if gate.verdict == "fail":
            logger.warning(
                "QUALITY_GATE_FAIL chat_id=%s reasons=%s elapsed_ms=%.1f original=%r",
                chat_id,
                ",".join(gate.reasons),
                gate.elapsed_ms,
                reply[:200],
            )
            return quality_gate.GRACEFUL_FALLBACK
        if gate.judge_score is not None:
            logger.info(
                "QUALITY_GATE_PASS chat_id=%s judge_score=%.2f reason=%s elapsed_ms=%.1f",
                chat_id,
                gate.judge_score,
                gate.judge_reason,
                gate.elapsed_ms,
            )
        return reply

    async def process_multi_photo(
        self,
        chat_id: str,
        message: str,
        photos_b64: list[str],
        *,
        platform: str = "telegram",
        tenant_id: str | None = None,
        mira_user_id: str | None = None,
        on_progress: Callable[[int, int], Awaitable[None]] | None = None,
    ) -> str:
        """Burst entry point. Returns combined reply for N photos (N >= 1).

        Each photo runs through VisionWorker.process() sequentially because the
        vision model is GPU-bound on a single Ollama node. Per-photo vision
        failures degrade to a placeholder for that slot — the method never
        raises to the caller. Combined results are sent through
        InferenceRouter.complete() for synthesis; if the router returns empty
        (every cascade provider down), the method falls back to a deterministic
        numbered list. Only the LAST photo is persisted via _save_session_photo
        so follow-up turns ("tell me more about photo 4") have a single anchor.

        ``on_progress(idx_done, n_total)`` — optional async callback fired after
        each photo's vision call completes (idx_done is 1-based, fires N times
        across the burst). Callers (the photo-batch worker) use this to edit
        the chat ack message ("Processing photo 2/4..."). Callback exceptions
        are caught and logged so a flaky chat-edit can't take down the engine.
        """
        n = len(photos_b64)
        t0 = time.monotonic()

        try:
            analyses: list[dict] = []
            for idx, photo_b64 in enumerate(photos_b64, start=1):
                try:
                    vresult = await self.vision.process(photo_b64, message)
                except Exception as exc:
                    logger.warning(
                        "MULTI_PHOTO_VISION_FAILURE chat_id=%s idx=%d/%d error=%s",
                        chat_id,
                        idx,
                        n,
                        exc,
                    )
                    vresult = {
                        "classification": "UNCLEAR",
                        "classification_confidence": 0.0,
                        "vision_result": "unclear",
                        "ocr_items": [],
                        "ocr_tokens": [],
                        "ocr_source": "none",
                        "tesseract_text": "",
                        "drawing_type": None,
                        "drawing_type_confidence": 0.0,
                    }
                analyses.append(vresult)
                if on_progress is not None:
                    try:
                        await on_progress(idx, n)
                    except Exception as cb_exc:
                        logger.warning(
                            "MULTI_PHOTO_PROGRESS_CALLBACK_FAILURE chat_id=%s idx=%d/%d error=%s",
                            chat_id,
                            idx,
                            n,
                            cb_exc,
                        )

            bullets = []
            for idx, a in enumerate(analyses, start=1):
                cls = str(a.get("classification", "")).strip()
                vr = str(a.get("vision_result", "")).strip()
                ocr = a.get("ocr_items") or []
                ocr_str = ", ".join(str(o) for o in ocr[:6]) if ocr else ""
                line = f"{idx}. [{cls}] {vr}" if cls else f"{idx}. {vr}"
                if ocr_str:
                    line += f" (OCR: {ocr_str})"
                bullets.append(line)

            system_prompt = (
                "You are MIRA, an industrial maintenance assistant. The user just "
                f"sent {n} photos in one burst. Below is each photo's vision/OCR "
                "analysis. Briefly list each photo's content (numbered, one short "
                "line each), then synthesize across them: if a nameplate and a "
                "damage/fault photo are both present, connect the two; if photos "
                "appear unrelated, ask which asset to troubleshoot first. Reference "
                "photos by number. Keep under 300 words."
            )
            user_prompt = (
                (f"User caption: {message}\n\n" if message else "")
                + f"Photo analyses ({n}):\n"
                + "\n".join(bullets)
            )
            try:
                reply_text, _usage = await self.router.complete(
                    [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    max_tokens=600,
                    session_id=f"{chat_id}_multi_photo",
                )
            except Exception as exc:
                logger.warning(
                    "MULTI_PHOTO_ROUTER_FAILURE chat_id=%s n=%d error=%s",
                    chat_id,
                    n,
                    exc,
                )
                reply_text = ""

            if reply_text and reply_text.strip():
                reply = reply_text.strip()
            else:
                reply = f"📸 Processed {n} photos:\n\n" + "\n".join(
                    f"{i}. {(str(a.get('vision_result', '')).strip() or 'unclear')}"
                    for i, a in enumerate(analyses, start=1)
                )

            if photos_b64:
                self._save_session_photo(chat_id, photos_b64[-1])

        except Exception as exc:
            logger.error(
                "MULTI_PHOTO_PROCESS_ERROR chat_id=%s n=%d error=%s",
                chat_id,
                n,
                exc,
                exc_info=True,
            )
            return GENERIC_ENGINE_ERROR

        elapsed_ms = int((time.monotonic() - t0) * 1000)
        self._log_interaction(
            chat_id,
            f"[multi-photo x{n}] {message}".strip(),
            reply,
            has_photo=True,
            response_time_ms=elapsed_ms,
            platform=platform,
        )
        return reply

    async def process_full(
        self,
        chat_id: str,
        message: str,
        photo_b64: str = None,
        *,
        uns_source: str | None = None,
        retrieval_query: str | None = None,
    ) -> dict:
        """Full entry point. Returns {"reply", "confidence", "trace_id", "next_state"}.

        Same logic as process(), but preserves structured metadata for
        benchmark and telemetry consumers.

        ``uns_source`` (e.g. "direct_connection") is stamped onto the resolved
        ``state["context"]["uns_context"]["source"]`` so downstream consumers
        (decision trace, audits) can see the turn's provenance. See process().
        """
        # Boundary normalization: adapters send strings, but a captionless photo
        # from a non-Telegram caller may arrive as None — the pipeline's regex
        # guards assume str (guardrails.py). Normalize once at the entry point.
        message = message or ""

        # Resolve tenant per call — chat_tenant LRU cache makes this cheap
        resolved_tenant = resolve_tenant(chat_id) or self.rag.tenant_id

        # Telemetry trace
        t = tl_trace("supervisor.process", user_id=chat_id)
        trace_id = t.id

        # Preprocess: strip Slack mention tags
        message = strip_mentions(message)

        # Slash-command interceptor: /reset and /new must be handled here so
        # eval fixtures that send "/reset" as a plain message (not a Telegram
        # CommandHandler) still clear the session.  The Telegram bot calls
        # engine.reset() directly via its CommandHandler and never reaches
        # process_full, so this path is only taken for inline-text callers
        # (eval runner, Slack, mira-pipeline HTTP).
        _msg_stripped = message.strip()
        if _msg_stripped.lower() in ("/reset", "/new"):
            self.reset(chat_id)
            reply = "Started a fresh session. What equipment can I help with?"
            tl_flush()
            return self._make_result(reply, "none", trace_id, "IDLE")

        state = self._load_state(chat_id)

        # Per-turn clean lexical-recall query (#1766). Stashed on state so the
        # RAGWorker uses it for BM25/fault/product extraction without threading a
        # new arg through the two self.rag.process() call sites. Set every turn
        # (incl. None) so a value never persists stale across turns. The embedding
        # path still uses the full message; only lexical recall reads this.
        state["retrieval_query"] = retrieval_query

        if _PROCEED_RE.match(_msg_stripped) and not photo_b64:
            ctx_p = state.get("context") or {}
            ctx_p.pop("awaiting_proceed", None)
            ctx_p.pop("pending_uns_confirm", None)
            state["context"] = ctx_p
            # Advance state once (counts as a diagnostic turn) so q_rounds
            # increments and the Q-trap can fire if near threshold.
            parsed_proceed: dict = {"reply": "", "next_state": state.get("state") or "Q1"}
            state = self._advance_state(state, parsed_proceed)
            self._save_state(chat_id, state)
            logger.info(
                "PROCEED_INTERCEPTED chat_id=%s fsm=%s → continued diagnostic",
                chat_id,
                state.get("state"),
            )
            tl_flush()
            return self._make_result(
                "Got it — let me give you my best assessment based on general "
                "industrial knowledge. This is not verified against specific "
                "documentation for your equipment.",
                "low",
                trace_id,
                state.get("state", "Q1"),
            )

        # Single UNS-aware extraction — one truth per turn for
        # vendor / model / fault code / category. Downstream sites read
        # `state["context"]["uns_context"]` instead of re-running
        # vendor_name_from_text or _looks_like_model_number locally.
        #
        # Stored UNDER state["context"] (not at the top level) because
        # session_manager.save_state only persists the declared columns plus
        # state["context"] as a JSON blob — top-level extras are dropped.
        # Carries forward across turns so "make a work order" after
        # "PowerFlex 525 F0004" keeps the equipment in scope.
        # See docs/specs/uns-message-resolver-spec.md.
        _ctx_for_uns = state.get("context") or {}
        prior_uns = _ctx_for_uns.get("uns_context") or None
        uns_ctx = resolve_uns_path(
            message,
            tenant_id=resolved_tenant,
            prior_ctx=prior_uns,
        )
        _uns_ctx_dict = uns_ctx.as_dict()
        # Direct-connection provenance: a surface that already knows which
        # machine the technician is on (Ignition, MQTT, PLC bridge, Hub display,
        # QR) certifies the UNS path by construction. We stamp the source so the
        # decision trace + hallucination audit can see it. Recorded only; the
        # gate-firing change is master-plan Phase 6. See
        # .claude/rules/direct-connection-uns-certified.md.
        if uns_source:
            _uns_ctx_dict["source"] = uns_source
        _ctx_for_uns["uns_context"] = _uns_ctx_dict
        state["context"] = _ctx_for_uns
        if uns_ctx.manufacturer and uns_ctx.confidence >= 0.7 and not state.get("asset_identified"):
            label = uns_ctx.manufacturer
            if uns_ctx.model:
                label = f"{label}, {uns_ctx.model}"
            state["asset_identified"] = label

        # CMMS pending: user is answering the work-order creation prompt — handle before
        # any option resolution, session-followup detection, or intent classification.
        # Bypass guard: if the message is clearly a brand-new diagnostic question (not a
        # yes/no/edit on the pending WO), drop the stale WO flag and fall through to
        # normal routing. Without this, a fresh question after a prior RESOLVED session
        # gets misrouted into _handle_cmms_pending and the user can't escape the WO flow.
        if (state.get("context") or {}).get("cmms_pending") and not photo_b64:
            if _is_fresh_question_during_wo(message):
                # Full diagnostic-carryover clear: pops cmms_pending + cmms_wo_draft,
                # resets state["state"] off RESOLVED, clears fault_category and
                # final_state. Without this, a poisoned RESOLVED state lands the
                # message back in the RESOLVED hook which rebuilds a stale WO.
                state = self._clear_diagnostic_carryover(chat_id, state, clear_photo=False)
                self._save_state(chat_id, state)
                logger.info(
                    "CMMS_PENDING_BYPASS chat_id=%s msg=%r — treating as fresh question",
                    chat_id,
                    message[:120],
                )
            else:
                return await self._handle_cmms_pending(chat_id, message, state, trace_id)

        # PM suggestion pending: user is answering a follow-up PM proposal.
        if (state.get("context") or {}).get("pm_suggestion_pending") and not photo_b64:
            return await self._handle_pm_suggestion_pending(chat_id, message, state, trace_id)

        # UNS confirmation pending: user is answering the equipment-confirmation
        # prompt fired by the UNS Confirmation Gate. Returns a result on explicit
        # yes/no, or None to fall through (e.g., user typed equipment specs — let
        # the normal flow re-run the UNS resolver on the message).
        if (state.get("context") or {}).get("pending_uns_confirm") and not photo_b64:
            _uns_resp = await self._handle_uns_confirmation_response(
                chat_id, message, state, trace_id
            )
            if _uns_resp is not None:
                return _uns_resp

        if message.strip() and state.get("final_state") == "RESOLVED":
            state["final_state"] = None

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

            # Stage 1 (2026-05-04) — Dialogue State Tracker dispatch. Behind
            # MIRA_USE_DST flag; default OFF. When enabled the tracker is the
            # single routing decision (PLAN.md §2.3): one Groq llama-3.1-8b
            # call returning a typed DialogueTurn → DispatchPlan → handler.
            # The Stage 0 regex fast-paths below stay in place as the OFF-flag
            # path AND as the shortcircuit a DST tracker hits before the LLM
            # call (see `dialogue_acts._shortcircuit_act`).
            if _DST_ENABLED:
                _dst_result = await self._maybe_dispatch_via_dst(
                    chat_id, message, state, trace_id, sc, resolved_tenant
                )
                if _dst_result is not None:
                    return _dst_result
                # Fall through to legacy routing on classifier failure or
                # default-RAG dispatch — the tracker explicitly returns None
                # to signal "let the existing flow handle this turn".

            # Stage 0 (2026-05-04) — action-request fast-path. Catches explicit
            # imperative work-order requests BEFORE the LLM router, which
            # currently returns continue_current mid-flow (CRITICAL RULE 3 in
            # conversation_router.py) and lets the request fall into RAG. The
            # LLM then garbles the response and the quality gate substitutes
            # the GRACEFUL_FALLBACK ("rephrase your question…"). See PLAN.md
            # §2.3 for the systemic fix; this is the targeted hot-fix.
            if _WO_ACTION_REQUEST_RE.search(message):
                logger.info(
                    "ACTION_REQUEST_FAST_PATH chat_id=%s kind=work_order match=%r",
                    chat_id,
                    message[:80],
                )
                return await self._handle_wo_request(chat_id, message, state, trace_id)

            # Stage 0 (2026-06-06) — live-tag query fast-path (Q2 fix).
            # Fires when the user's QUESTION (not the status block) names a
            # known PLC/VFD tag and is phrased as a question. Prevents the LLM
            # router from misrouting e.g. "is the e-stop OK?" as
            # check_equipment_history (regression observed 2026-06-06).
            # Only fires when the enriched message already contains a
            # [LIVE CONVEYOR STATUS] block — scoped to the Ignition kiosk path.
            # We match the regex against only the [QUESTION] portion so tag
            # names in the status block itself don't spuriously trigger this path.
            if _LIVE_STATUS_HEADER in message:
                _question_only = message
                _q_marker = "\n[QUESTION]\n"
                if _q_marker in message:
                    _question_only = message[message.index(_q_marker) + len(_q_marker) :]
                if _TAG_QUERY_RE.search(_question_only) and _TAG_QUESTION_RE.search(_question_only):
                    logger.info(
                        "TAG_QUERY_FAST_PATH chat_id=%s match=%r",
                        chat_id,
                        _question_only[:80],
                    )
                    return await self._handle_tag_query(chat_id, message, state, trace_id)

            # Stage 0 (2026-05-04) — "I don't know" / short-answer fast-path.
            # Fires only when MIRA has a pending question (last_question
            # populated) AND the user's reply is a short uncertainty
            # admission. Prevents "I don't know. I was just given the new
            # one to put in" from being tokenized into "IDON" / "I-DON" and
            # embedded as candidate fault codes via the vector search.
            if (
                sc.get("last_question")
                and len(message.strip()) <= _DONT_KNOW_MAX_LEN
                and _DONT_KNOW_RE.search(message)
            ):
                logger.info(
                    "DONT_KNOW_FAST_PATH chat_id=%s state=%s match=%r",
                    chat_id,
                    state.get("state"),
                    message[:80],
                )
                return self._handle_dont_know_followup(chat_id, message, state, trace_id)

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
                    "instructional": "answer_question",
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

            if state.get("state") == "ELECTRICAL_PRINT":
                result = await self._handle_electrical_print_followup(
                    chat_id,
                    message,
                    state,
                    trace_id,
                )
                tl_flush()
                return result

            # Drive-pack fast-path (2026-07-06) — deterministic, pack-grounded
            # answer for a text question that explicitly names a drive MIRA has
            # a pack for (e.g. "what does CE10 mean on my gs10"). Placed AFTER
            # the safety short-circuit above (safety always wins) and BEFORE
            # the router-exclusive dispatches below — this fast-path must never
            # pre-empt the safety stop. resolve_pack() is a pure text match over
            # pack aliases/keywords (shared/drive_packs/loader.py); a non-match,
            # or a match whose question doesn't map to real pack content
            # (answer_question().matched is False), falls through to the
            # existing routing/RAG path completely unchanged — a false-positive
            # resolve_pack() match is harmless by construction. See ADR-0025 +
            # shared/drive_packs/ask.py for the pack-grounded-only contract
            # (never a generic LLM answer, never a guess).
            #
            # Match on the technician's QUESTION ONLY (2026-07-12) — never on
            # attached context blocks. The kiosk /ask path composes
            # MACHINE_CONTEXT + status block + "[QUESTION]\n<q>" (ask_api/app.py),
            # and MACHINE_CONTEXT embeds the full GS10 fault-code TABLE
            # ("4=GFF ground fault; 12=Lvd; …") — so matching the whole message
            # made answer_question() hit the first table mnemonic (GFF) on EVERY
            # kiosk turn, hijacking unrelated questions to the GFF card. Same
            # class of risk for the Ignition "[LIVE TAGS …]…[END LIVE TAGS]"
            # preamble (mira-pipeline/ignition_chat.py). Strip both; a message
            # with no marker is already a bare question.
            _dp_question = message
            if "[QUESTION]\n" in _dp_question:
                _dp_question = _dp_question.rsplit("[QUESTION]\n", 1)[-1]
            if "[END LIVE TAGS]" in _dp_question:
                _dp_question = _dp_question.rsplit("[END LIVE TAGS]", 1)[-1]
            _dp_pack = resolve_pack(_dp_question)
            if _dp_pack is not None:
                _dp_answer = answer_question(_dp_pack.pack_id, _dp_question)
                if _dp_answer.matched:
                    _dp_seen: set[tuple[str, str]] = set()
                    _dp_cite_parts: list[str] = []
                    for _c in _dp_answer.citations:
                        _doc = _c.get("doc", "")
                        _page = _c.get("page", "")
                        _key = (_doc, _page)
                        if not _doc or _key in _dp_seen:
                            continue
                        _dp_seen.add(_key)
                        _dp_cite_parts.append(
                            f"[Source: {_doc} p.{_page}]" if _page else f"[Source: {_doc}]"
                        )
                    reply = _dp_answer.answer
                    if _dp_cite_parts:
                        reply = f"{reply}\n\n{' '.join(_dp_cite_parts)}"
                    # Static-vs-live label: a drive-pack answer is manual-cited
                    # pack intelligence, NEVER a live telemetry read
                    # (DrivePackAnswer.live_telemetry is always False — see
                    # shared/drive_packs/ask.py). If this turn ALSO carries a
                    # live snapshot, say so explicitly so a static pack answer is
                    # never conflated with a live read. Two live-preamble markers
                    # reach the engine: the kiosk/conveyor "[LIVE CONVEYOR STATUS]"
                    # block (_maybe_attach_live_snapshot) and the Ignition
                    # direct-connection "[LIVE TAGS …]" preamble
                    # (mira-pipeline/ignition_chat.py::_format_tag_preamble) — cover both.
                    if _LIVE_STATUS_HEADER in message or "[LIVE TAGS" in message:
                        reply = f"(Static pack reference — not from live telemetry.)\n\n{reply}"
                    self._record_exchange(chat_id, state, message, reply)
                    tl_flush()
                    return self._make_result(
                        reply,
                        "high",
                        trace_id,
                        state.get("state", "IDLE"),
                        dispatch_kind="drive_pack",
                    )
                # else: matched=False — the question doesn't map to this pack's
                # fault/parameter content; fall through to the existing
                # routing/RAG flow below unchanged.

            # Router-exclusive dispatches — intents the keyword classifier doesn't handle
            if _router_intent == "log_work_order":
                return await self._handle_wo_request(chat_id, message, state, trace_id)

            if _router_intent == "switch_asset":
                return await self._handle_asset_switch(
                    chat_id, message, state, trace_id, tenant_id=resolved_tenant
                )

            if _router_intent == "check_equipment_history":
                return await self._handle_check_equipment_history(chat_id, message, state, trace_id)

            if _router_intent == "store_documentation":
                # Same target-extraction path the DST short-circuit uses, but
                # surface the regex over the message directly since the LLM
                # router doesn't return entities.
                from .dialogue_acts import _RX_STORE_DOC

                _store_match = _RX_STORE_DOC.search(message)
                _target = ""
                if _store_match:
                    _target = (
                        _store_match.group("target") or _store_match.group("target2") or ""
                    ).strip()
                return await self._handle_store_documentation(
                    chat_id, message, state, trace_id, _target
                )

            # Guard: when already in an active diagnostic session and the keyword
            # classifier sees industrial intent, don't pull the turn out to a
            # generic/instructional handler — fall through to the RAG diagnostic
            # path instead. This prevents the LLM router from forcing IDLE on
            # diagnostic follow-ups like "what should I check first?" that lack
            # explicit session-followup signals ("you said", "earlier", etc.).
            _in_active_diagnostic = state["state"] in ACTIVE_DIAGNOSTIC_STATES
            _router_industrial_override = _in_active_diagnostic and _keyword_intent == "industrial"

            if (
                _router_intent == "general_question"
                and _keyword_intent not in ("safety", "documentation")
                and not _router_industrial_override
            ):
                return await self._handle_general_question(
                    chat_id, message, state, trace_id, tenant_id=resolved_tenant
                )

            if _router_intent == "greeting_or_chitchat" and state["state"] == "IDLE":
                return self._greeting_response(state, chat_id, trace_id)

            # Procedural how-to questions: answer from knowledge, skip doc crawl.
            # Keyword "instructional" also routes here via the fallback mapping above.
            # Guard: same override — industrial turns in active sessions fall through to RAG.
            if (
                _router_intent == "answer_question" or _keyword_intent == "instructional"
            ) and not _router_industrial_override:
                if detect_session_followup(message, sc, state["state"]):
                    return await self._handle_session_followup(
                        message,
                        state,
                        chat_id,
                        session_photo=self._load_recent_session_photo(chat_id, state),
                        tenant_id=resolved_tenant,
                        honest_prefix=_honest_prefix,
                    )
                return await self._handle_instructional_question(chat_id, message, state, trace_id)

            if _router_intent == "continue_current" and detect_session_followup(
                message, sc, state["state"]
            ):
                return await self._handle_session_followup(
                    message,
                    state,
                    chat_id,
                    session_photo=self._load_recent_session_photo(chat_id, state),
                    tenant_id=resolved_tenant,
                    honest_prefix=_honest_prefix,
                )

            # find_documentation: let the existing specificity-gate block handle it below
            if _router_intent == "find_documentation":
                intent = "documentation"

            # UNS Confirmation Gate — no diagnosis without confirmed equipment.
            # Telegram + Slack both go through here. Conditions extracted into
            # _should_fire_uns_gate so the bypass logic is testable directly.
            # Require confidence > 0: truly vague messages (no vendor/model/fault
            # detected) should not trigger the gate — the bot asks Q1 clarifiers
            # instead. Gate fires when we have at least a partial context to confirm.
            if uns_ctx.confidence > 0 and self._should_fire_uns_gate(
                _router_intent, state, message, sc
            ):
                return await self._handle_uns_confirmation_request(
                    chat_id,
                    message,
                    state,
                    uns_ctx,
                    trace_id,
                    tenant_id=resolved_tenant,
                )

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
            mfr = ((state.get("context") or {}).get("uns_context") or {}).get("manufacturer") or ""

            # Specificity gate — vague requests ("the safety relay", "this VFD") enter
            # MANUAL_LOOKUP_GATHERING to collect vendor + model before crawling.
            if not self._is_doc_specific(mfr, combined):
                # If nameplate was already scanned, asset_identified is "Vendor, Model".
                # Skip gathering — we already know enough to crawl.
                # NOTE: SQLite returns None for NULL columns, ignoring dict.get default,
                # so coalesce explicitly to avoid `'NoneType' is not iterable` on the
                # following `in` check (bug surfaced by tech-19 benchmark case).
                asset_id = state.get("asset_identified") or ""
                if "," in asset_id:
                    fallback_mfr = mfr or asset_id.split(",", 1)[0].strip()
                    return await self._do_documentation_lookup(
                        chat_id,
                        message,
                        state,
                        trace_id,
                        resolved_tenant,
                        vendor_override=fallback_mfr,
                    )
                if mfr:
                    kb_covered, _ = kb_has_coverage(mfr, combined, resolved_tenant or "")
                    if kb_covered:
                        return await self._do_documentation_lookup(
                            chat_id,
                            message,
                            state,
                            trace_id,
                            resolved_tenant,
                            vendor_override=mfr,
                        )
                return await self._enter_manual_lookup_gathering(
                    chat_id, message, state, trace_id, mfr, resolved_tenant or ""
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
            ctx["photo_turn"] = state["exchange_count"] + 1
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
                ctx["last_print_vision"] = {
                    "classification": "ELECTRICAL_PRINT",
                    "vision_result": vision_data.get("vision_result", ""),
                    "ocr_items": vision_data.get("ocr_items", []),
                    "tesseract_text": vision_data.get("tesseract_text", ""),
                    "drawing_type": vision_data.get("drawing_type") or "electrical drawing",
                    "confidence": vision_data.get("confidence", ""),
                }
                state["context"] = ctx
                self._save_state(chat_id, state)

                # Visual-first routing (operator directive 2026-07-15): a photo
                # the vision worker classified as an ELECTRICAL_PRINT ALWAYS gets
                # the grounded interpretation — Anthropic PrintSynth first (deep,
                # typed, never-invent), else the OCR-verbatim cascade. Captions
                # are weak evidence: a real question is forwarded to the
                # interpreter; an empty caption or the bot's own default caption
                # means "interpret the whole sheet" (question=None). The live
                # 2026-07-15 phone test proved a technician typing the literal
                # default caption otherwise got only the thin OCR-label preview.
                has_real_question = bool(message) and message != DEFAULT_PHOTO_CAPTION
                question = message if has_real_question else None
                print_observe: dict = {}
                reply = await self._grounded_print_reply(
                    photo_b64, question, vision_data, chat_id, observe=print_observe
                )
                if not reply:
                    # Fail-safe only — the grounded path is display-ready even on
                    # provider failure, but never leave a print unanswered.
                    reply = self._build_print_reply(vision_data)
                    if not has_real_question:
                        reply += "\n\nWhat would you like to know about this circuit?"

                # Phase 5 schematic intelligence — opportunistically run the
                # IEC/ANSI symbol + connection extractor on the same photo.
                # Result is held in state context so a follow-up
                # "add this to documentation for X" can persist it scoped to
                # the named plant/equipment.
                schematic_payload = await self._extract_schematic(photo_b64)
                if schematic_payload and schematic_payload.get("entities"):
                    ctx["last_schematic_extraction"] = schematic_payload
                    reply += self._summarize_schematic(schematic_payload)
                    logger.info(
                        "SCHEMATIC_EXTRACTED chat_id=%s type=%s entities=%d relationships=%d",
                        chat_id,
                        schematic_payload.get("schematic_type"),
                        len(schematic_payload.get("entities") or []),
                        len(schematic_payload.get("relationships") or []),
                    )

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
                    route=print_observe.get("route"),
                    fallback_reason=print_observe.get("fallback_reason"),
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
            elif vision_data["classification"] == "UNKNOWN":
                # ROUND 4 defect #2: the vision model returned no usable signal
                # (decline_reason below) and no strong LAYOUT/OCR evidence
                # carried the page. Decline with an evidence-based fallback —
                # surface whatever OCR could read and ask for a clearer photo —
                # instead of routing to the equipment-diagnosis path on a
                # fabricated classification. Never promote a fallback to a
                # model-qualified answer.
                decline_reason = vision_data.get("decline_reason") or "vision_unavailable"
                _ocr_items = vision_data.get("ocr_items") or []
                logger.info(
                    "PHOTO_CLASSIFY_UNKNOWN chat_id=%s decline_reason=%s ocr_items=%d",
                    chat_id,
                    decline_reason,
                    len(_ocr_items),
                )
                if _ocr_items:
                    preview = ", ".join(str(i) for i in _ocr_items[:8])
                    reply = (
                        "I couldn't get a clear read on that photo — the image "
                        "analysis didn't return a usable description. Here's the "
                        f"text I could pull off it: {preview}. Could you resend a "
                        "sharper, well-lit shot of the whole page or nameplate? "
                        "Or tell me the equipment and fault and I'll help from there."
                    )
                else:
                    reply = PHOTO_FAILURE
                state["exchange_count"] += 1
                self._save_state(chat_id, state)
                tl_flush()
                return self._make_result(
                    reply,
                    "low",
                    trace_id,
                    state.get("state"),
                    dispatch_kind="dont_know",
                    route="classify_decline",
                    fallback_reason=decline_reason,
                )
            else:
                state["state"] = "ASSET_IDENTIFIED"
                state["fault_category"] = None
                state["final_state"] = None
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
            with tl_span(t, "print_worker"):
                result = await self._handle_electrical_print_followup(
                    chat_id,
                    message,
                    state,
                    trace_id,
                )
            tl_flush()
            return result

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
                # Photo→pack fast-path (the OCR-code → drive-pack bridge): if we
                # already know WHICH drive this is — resolved from the identified
                # ASSET, never inferred from the code (a bare code is ambiguous
                # across vendors) — and the OCR shows a fault code that drive
                # documents, answer from the pack: cited, deterministic,
                # read-only. Any miss (no pack, no code, or code not documented)
                # falls through to the generic RAG auto-diagnose below, unchanged.
                # extract_pack_fault_codes() is the gate that rejects bare OCR
                # numerals ("5 A"); see shared/drive_packs/ask.py +
                # .claude/rules/direct-connection-uns-certified.md (grounded only).
                #
                # Safety precedence: NEVER let this fast-path pre-empt a hazard.
                # If the OCR/vision text carries a safety keyword (arc flash,
                # smoke, ...), skip the pack answer entirely and fall through so
                # a cited fault answer can never mask the safety path — mirrors
                # the text drive-pack fast-path, which sits AFTER the safety
                # short-circuit, and the vision-safety bypass above (~L2489).
                _photo_safety = any(kw in ocr_text or kw in vision_text for kw in SAFETY_KEYWORDS)
                _pf_pack = (
                    None if _photo_safety else resolve_pack(state.get("asset_identified", "") or "")
                )
                if _pf_pack is not None:
                    _pf_ocr = " ".join(ocr_items)
                    for _pf_code in extract_pack_fault_codes(_pf_pack, _pf_ocr):
                        _pf_ans = answer_fault_code(_pf_pack.pack_id, _pf_code)
                        if not _pf_ans.matched:
                            continue
                        _pf_seen: set[tuple[str, str]] = set()
                        _pf_cites: list[str] = []
                        for _c in _pf_ans.citations:
                            _doc = _c.get("doc", "")
                            _page = _c.get("page", "")
                            if not _doc or (_doc, _page) in _pf_seen:
                                continue
                            _pf_seen.add((_doc, _page))
                            _pf_cites.append(
                                f"[Source: {_doc} p.{_page}]" if _page else f"[Source: {_doc}]"
                            )
                        # Echo the code we READ off the photo so a human catches
                        # an OCR misread before trusting the answer.
                        _pf_reply = (
                            f"I read fault code {_pf_code} off the photo.\n\n{_pf_ans.answer}"
                        )
                        if _pf_cites:
                            _pf_reply = f"{_pf_reply}\n\n{' '.join(_pf_cites)}"
                        self._record_exchange(chat_id, state, message, _pf_reply)
                        tl_flush()
                        return self._make_result(
                            _pf_reply,
                            "high",
                            trace_id,
                            state.get("state", "IDLE"),
                            dispatch_kind="drive_pack",
                        )

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
        session_photo = None
        if not photo_b64 and state.get("state") != "IDLE":
            session_photo = self._load_recent_session_photo(chat_id, state)
        effective_photo = photo_b64 or session_photo

        # NOTE: asset_identified seeding from message is handled earlier in this
        # function via the UNS resolver block (state["uns_context"]). The previous
        # _seeded_vendor regression-guard (#1206 / commit 4537dd3d) was removed as
        # part of the UNS resolver refactor — one extraction point per turn.
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

        # RESOLVED hook: previously this auto-appended a WO preview and set
        # cmms_pending=True any time the FSM landed on RESOLVED. That made
        # MIRA "uninvited" propose a work order after every diagnosis.
        # The WO flow is now ONLY entered when the LLM router classifies
        # intent as "log_work_order" → _handle_wo_request — i.e. the user
        # explicitly says "create a work order", "log this", etc.
        # We still run recurring-fault annotation on RESOLVED so persistent
        # issues are flagged, but we do not push the WO preview.
        # Skip in direct-answer/kiosk mode: the annotation appends a "log a work
        # order?" question the kiosk operator can't act on (single-shot turn).
        if state["state"] == "RESOLVED" and not _DIRECT_ANSWER_MODE:
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
        sc["last_question"] = parsed["reply"][:200]
        sc["last_options"] = parsed.get("options", [])
        ctx["session_context"] = sc

        # Auto-WO prompt on RESOLVED: when a full diagnostic session ends (asset
        # identified AND fault_category or exchange_count >= 3), offer to create
        # a CMMS work order.  Scoped to real diagnostic sessions — no WO prompt
        # for one-turn lookups or documentation fetches.  The user must still
        # say "yes" to actually create the WO; the prompt just arms cmms_pending.
        if (
            state["state"] == "RESOLVED"
            and not _DIRECT_ANSWER_MODE  # kiosk is single-shot: no WO prompt, don't arm cmms_pending
            and state.get("asset_identified")
            and (state.get("fault_category") or state.get("exchange_count", 0) >= 3)
            and not ctx.get("cmms_pending")
            and not ctx.get("cmms_wo_draft")
        ):
            wo_auto = build_uns_wo_from_state(state)
            wo_auto.chat_id = chat_id
            wo_auto.fsm_state_at_creation = "RESOLVED"
            wo_dict = wo_auto.to_dict()
            ctx["cmms_pending"] = True
            ctx["cmms_wo_draft"] = wo_dict
            preview = format_wo_preview(wo_auto)
            parsed["reply"] = (
                parsed["reply"].rstrip()
                + "\n\n"
                + "Would you like to log a work order for this? Say **yes** to create it, **no** to skip.\n\n"
                + preview
            )
            logger.info(
                "AUTO_WO_PROMPT chat_id=%s asset=%r fault=%r",
                chat_id,
                state.get("asset_identified"),
                state.get("fault_category"),
            )

        state["context"] = ctx

        self._save_state(chat_id, state)

        formatted = self._format_reply(parsed, user_message=message)
        # Phase 3 — prepend honest crawl-failure message if a prior doc-crawl exhausted.
        if _honest_prefix:
            formatted = _honest_prefix + formatted

        # CRA-11 / Unit 2 — citation presence (observational) + P0-3 relevance.
        # Presence logs OK/MISS for the inline-cite rate metric. Relevance (the
        # "stop the lie" gate) strips a cited source that names a DIFFERENT
        # manufacturer than the resolved asset (alias-aware, fail-open) so a
        # confidently-wrong attribution never reaches the technician.
        _cc = _check_citation_compliance(
            formatted,
            parsed.get("_kb_status") or {},
            fsm_state=state.get("state", ""),
            chat_id=chat_id,
            uns_context=(state.get("context") or {}).get("uns_context"),
            enforce=_citation_enforce_enabled(),
        )
        if _cc.get("sanitized_reply"):
            formatted = _cc["sanitized_reply"]

        tl_flush()
        return self._make_result(
            formatted,
            self._infer_confidence(formatted),
            trace_id,
            state["state"],
            citation_evidence=self._evidence_from_parsed(parsed),
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
        return f"Work order {label} created in CMMS for {wo.asset or 'equipment'} ✓"

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
        """Reset conversation to IDLE state.

        Deletes any conversation_state row matching this chat_id under any of
        the known key formats:
          - exact match (legacy/internal callers passing the raw key)
          - "telegram:<id>"           (current ChatDispatcher key, no thread)
          - "telegram:<id>:..."       (current ChatDispatcher key with thread)
        Same shape for slack/teams/etc. We delete via LIKE prefix so a /new
        from any caller wipes all rows that could re-surface stale state.
        """
        self._clear_session_photo(chat_id)
        db = sqlite3.connect(self.db_path)
        db.execute("PRAGMA journal_mode=WAL")
        # Exact key
        db.execute("DELETE FROM conversation_state WHERE chat_id = ?", (chat_id,))
        # Composite keys for known platforms ending in this raw chat id
        for platform in ("telegram", "slack", "teams", "gchat", "webui"):
            prefix = f"{platform}:{chat_id}"
            db.execute(
                "DELETE FROM conversation_state WHERE chat_id = ? OR chat_id LIKE ?",
                (prefix, f"{prefix}:%"),
            )
        db.commit()
        deleted = db.total_changes
        db.close()
        logger.info("ENGINE_RESET chat_id=%s rows_deleted=%d", chat_id, deleted)

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

        # 3.5. Write a KG proposal to NeonDB so the Hub /proposals page can
        # surface this photo for review. Closes the demo loop described in
        # docs/specs/mira-ground-truth-architecture-investigation.md §3.1 #1.
        # Best-effort — propose_from_nameplate returns {} on any failure and
        # never raises into the reply path.
        uns_ctx = ctx.get("uns_context") or {}
        try:
            proposal = await asyncio.to_thread(
                propose_from_nameplate,
                resolved_tenant,
                fields,
                asset_id=None,
                uns_path=uns_ctx.get("uns_path"),
                photo_path=None,
                chat_id=chat_id,
            )
            if proposal:
                state["last_photo_proposal"] = proposal
        except Exception as e:
            logger.error("photo_ingest_worker call failed: %s", e)

        # 4. Update session state with nameplate data
        ctx["session_context"] = {
            "equipment_type": f"{manufacturer} {model}",
            "manufacturer": manufacturer,
            "last_question": None,
            "last_options": [],
        }
        state["fault_category"] = None
        state["final_state"] = None
        state["asset_identified"] = f"{manufacturer}, {model}"
        state["context"] = ctx

        history = ctx.get("history", [])
        history.append({"role": "user", "content": message})

        # Build a clear, varied reply based on identification + KB coverage.
        identified = manufacturer != "Unknown" and model != "Unknown"
        if not identified:
            reply = (
                "Could not identify equipment from this nameplate. "
                "Please reply with manufacturer and model "
                "(e.g. 'Allen-Bradley PowerFlex 525')."
            )
        else:
            try:
                kb_covered, _ = kb_has_coverage(manufacturer, model, resolved_tenant or "")
            except Exception as e:
                logger.warning("nameplate kb_has_coverage failed: %s", e)
                kb_covered = linked_chunks > 0

            header = f"Identified: {manufacturer} {model}"
            if linked_chunks > 0:
                kb_line = (
                    f"Found {linked_chunks} manual chunks for {manufacturer} in the knowledge base."
                )
            elif kb_covered:
                kb_line = (
                    f"Manuals for {manufacturer} are already in the "
                    f"knowledge base — ask me anything about this equipment."
                )
            else:
                kb_line = (
                    f"No manuals found for {manufacturer} {model}. "
                    f"MIRA will search for one in the background — "
                    f"you can still ask questions and I'll answer from "
                    f"general knowledge."
                )
            reply = f"{header}\n{kb_line}"
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

    # ------------------------------------------------------------------
    # KG maintenance-context enrichment (additive, flag-gated)
    # ------------------------------------------------------------------
    async def _build_kg_context(self, state: dict, tenant_id: str | None) -> str:
        """Best-effort knowledge-graph maintenance context for the confirmed asset.

        Returns a labeled text block for prompt injection, or "" on any miss
        (flag off, no asset/tenant, no API key, hub unreachable, no KG entity).
        Never raises -- the diagnosis path must be unaffected when KG is absent.
        """
        if not _KG_CONTEXT_ENABLED:
            return ""
        asset = (state.get("asset_identified") or "").strip()
        if not asset or not tenant_id:
            return ""
        if not os.getenv("INTERNAL_KG_API_KEY"):
            return ""  # hub auth unset -> internal KG API disabled
        try:
            uns_path = resolve_uns_path(asset).uns_path
            if not uns_path:
                return ""
            data = await asyncio.wait_for(
                self._fetch_kg_maintenance_context(tenant_id, uns_path),
                timeout=_KG_CONTEXT_TIMEOUT_S,
            )
            return self._format_kg_context(data) if data else ""
        except Exception as exc:  # noqa: BLE001 -- enrichment must never block diagnosis
            logger.debug("KG_CONTEXT miss asset=%r: %s", asset, exc)
            return ""

    async def _fetch_kg_maintenance_context(self, tenant_id: str, uns_path: str) -> dict | None:
        """POST the maintenance_context op to mira-hub's internal KG API.

        Mirrors mira-mcp/kg_client.py's contract (that hyphenated package isn't
        importable from mira-bots). Returns the result dict, or None on any
        non-ok response.
        """
        body = {
            "op": "maintenance_context",
            "tenantId": tenant_id,
            "args": {"unsPath": uns_path, "maxWorkOrders": 3},
        }
        headers = {
            "Authorization": f"Bearer {os.getenv('INTERNAL_KG_API_KEY', '')}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(
            base_url=_MIRA_HUB_URL, timeout=_KG_CONTEXT_TIMEOUT_S, headers=headers
        ) as client:
            resp = await client.post("/api/internal/kg", json=body)
        if resp.status_code >= 400:
            return None
        data = resp.json()
        return data.get("result") if data.get("ok") else None

    @staticmethod
    def _format_kg_context(mc: dict | None) -> str:
        """Render a maintenanceContext payload as a compact prompt block.

        Defensive: tolerates missing/extra keys and never raises. Empty input or
        a payload with no usable signal returns "".
        """
        if not isinstance(mc, dict):
            return ""

        def _name(obj) -> str:
            return (obj.get("name") or "").strip() if isinstance(obj, dict) else ""

        lines: list[str] = []
        eq_name = _name(mc.get("equipment"))
        h = mc.get("hierarchy") or {}
        loc = " / ".join(
            f"{lbl} {_name(h.get(key))}"
            for lbl, key in (("Line", "line"), ("Area", "area"), ("Plant", "plant"))
            if _name(h.get(key))
        )
        if eq_name:
            lines.append(f"Equipment: {eq_name}" + (f"  ({loc})" if loc else ""))

        comps = [c for c in (_name(x) for x in (mc.get("components") or [])) if c]
        if comps:
            lines.append("Known components: " + ", ".join(comps[:8]))

        fault_strs: list[str] = []
        for f in (mc.get("recentFaults") or [])[:6]:
            if not isinstance(f, dict):
                continue
            code = str(f.get("code") or "").strip()
            if not code:
                continue
            cnt = f.get("count")
            fault_strs.append(f"{code} x{cnt}" if cnt else code)
        if fault_strs:
            lines.append("Recent faults: " + ", ".join(fault_strs))

        wos = [w for w in (_name(x) for x in (mc.get("recentWorkOrders") or [])) if w]
        if wos:
            lines.append("Recent work orders: " + "; ".join(wos[:5]))

        if not lines:
            return ""
        body_text = "\n".join(lines)
        return (
            "\n--- KNOWN ASSET CONTEXT (knowledge graph; context only, not a "
            f"citable source) ---\n{body_text}\n---\n"
        )

    # ------------------------------------------------------------------
    # Live equipment-status enrichment (additive, flag-gated)
    # ------------------------------------------------------------------
    async def _build_live_data_context(self, state: dict) -> str:
        """Best-effort live equipment status from mira-fault-detective's HTTP API.

        Returns a [LIVE EQUIPMENT STATUS] block or "" on any miss (flag off,
        service down, timeout, bad payload). Never raises.
        """
        if not _LIVE_DATA_ENABLED:
            return ""
        try:
            data = await asyncio.wait_for(self._fetch_live_status(), timeout=_LIVE_DATA_TIMEOUT_S)
            return self._format_live_data(data) if data else ""
        except Exception as exc:  # noqa: BLE001 -- enrichment must never block diagnosis
            logger.debug("LIVE_DATA miss: %s", exc)
            return ""

    async def _fetch_live_status(self) -> dict | None:
        """GET mira-fault-detective /current_fault. None on any non-ok response."""
        token = os.getenv("FAULT_DETECTIVE_HTTP_TOKEN", "")
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        async with httpx.AsyncClient(
            base_url=_FAULT_DETECTIVE_URL, timeout=_LIVE_DATA_TIMEOUT_S, headers=headers
        ) as client:
            resp = await client.get("/current_fault")
        if resp.status_code >= 400:
            return None
        return resp.json()

    @staticmethod
    def _format_live_data(d: dict | None) -> str:
        """Render a /current_fault payload as a compact prompt block. Never raises."""
        if not isinstance(d, dict):
            return ""
        fault = str(d.get("fault") or "").strip()
        asset = str(d.get("asset_prefix") or "").strip()
        where = f" on {asset}" if asset else ""
        if not fault or fault == "ok":
            return f"\n--- LIVE EQUIPMENT STATUS ---\nNo active fault detected{where}.\n---\n"
        head = f"Active fault{where}: {fault}"
        conf = d.get("confidence")
        if isinstance(conf, (int, float)):
            head += f" (confidence {int(round(conf * 100))}%)"
        lines = [head]
        comps = [str(c) for c in (d.get("affected_components") or []) if c]
        if comps:
            lines.append("Affected: " + ", ".join(comps[:8]))
        chk = str(d.get("recommended_first_check") or "").strip()
        if chk:
            lines.append("First check: " + chk)
        safety = str(d.get("safety_note") or "").strip()
        if safety:
            lines.append("Safety: " + safety)
        return "\n--- LIVE EQUIPMENT STATUS ---\n" + "\n".join(lines) + "\n---\n"

    # ------------------------------------------------------------------
    # Contextualization-signals enrichment (additive, flag-gated)
    # ------------------------------------------------------------------
    async def _build_ctx_signals_context(self, state: dict, tenant_id: str | None) -> str:
        """Best-effort approved PLC-signal context from kg_entities.

        Queries for signals (entity_type='signal', approval_state IN
        ('proposed','verified')) whose uns_path is a descendant of the asset's
        resolved UNS path.  Returns a labeled block for prompt injection, or ""
        on any miss.  Never raises.
        """
        if not _CTX_SIGNALS_ENABLED:
            return ""
        if not tenant_id:
            return ""
        asset = (state.get("asset_identified") or "").strip()
        if not asset:
            return ""
        try:
            uns_path = resolve_uns_path(asset).uns_path
            if not uns_path:
                return ""
            ltree_prefix = uns_path.replace("/", ".")
            signals = await asyncio.wait_for(
                asyncio.to_thread(_fetch_ctx_approved_signals, tenant_id, ltree_prefix),
                timeout=_CTX_SIGNALS_TIMEOUT_S,
            )
            return self._format_ctx_signals(signals)
        except Exception as exc:  # noqa: BLE001
            logger.debug("CTX_SIGNALS miss asset=%r: %s", asset, exc)
            return ""

    @staticmethod
    def _format_ctx_signals(signals: list[dict]) -> str:
        """Render approved ctx signals as a compact prompt block. Never raises."""
        if not signals:
            return ""
        lines = ["\n--- APPROVED PLC SIGNALS ---"]
        for s in signals:
            roles = s.get("roles") or []
            roles_str = ", ".join(roles) if roles else "unknown"
            conf = s.get("confidence")
            try:
                conf_str = f" ({float(conf):.0%})" if conf is not None else ""
            except (TypeError, ValueError):
                conf_str = ""
            lines.append(f"  {s['name']}: {s['uns_path']} [{roles_str}]{conf_str}")
        lines.append("---\n")
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Interlock-context enrichment — consume side of the interlock flywheel
    # (additive, flag-gated). Surfaces approved kg_relationships interlock edges.
    # ------------------------------------------------------------------
    async def _build_interlock_context(self, state: dict, tenant_id: str | None) -> str:
        """Best-effort approved-interlock context for the confirmed asset.

        Recalls VERIFIED interlock edges (USED_IN_LOGIC / CAUSES) from
        kg_relationships under the asset's UNS subtree — the human-approved logic
        the answer path historically never read — and renders them as grounded,
        citable context. When a live tag snapshot is present on the turn, also
        assembles the "why it won't move" explanation. Returns "" on any miss
        (flag off, no asset/tenant, DB unreachable, nothing verified). Never
        raises — diagnosis must be unaffected when interlock context is absent.
        """
        if not _INTERLOCK_CONTEXT_ENABLED or not tenant_id:
            return ""
        asset = (state.get("asset_identified") or "").strip()
        if not asset:
            return ""
        try:
            uns_path = resolve_uns_path(asset).uns_path
            if not uns_path:
                return ""
            ltree_prefix = uns_path.replace("/", ".")
            edges = await asyncio.wait_for(
                asyncio.to_thread(fetch_interlocks, tenant_id, ltree_prefix),
                timeout=_INTERLOCK_CONTEXT_TIMEOUT_S,
            )
            if not edges:
                return ""  # nothing verified -> no approved context -> no block
            live = ((state.get("context") or {}).get("session_context") or {}).get(
                "tag_state"
            ) or {}
            answer = build_interlock_answer(edges, live, asset) if live else None
            return self._format_interlock_context(edges, answer)
        except Exception as exc:  # noqa: BLE001 -- enrichment must never block diagnosis
            logger.debug("INTERLOCK_CONTEXT miss asset=%r: %s", asset, exc)
            return ""

    @staticmethod
    def _format_interlock_context(edges: list, answer: dict | None = None) -> str:
        """Render recalled interlock edges (+ optional live explanation) as a
        compact prompt block. Never raises; "" when there are no edges."""
        if not edges:
            return ""
        lines = ["\n--- APPROVED INTERLOCK LOGIC (verified relationships; grounded, citable) ---"]
        for e in edges[:12]:
            loc = ""
            for ev in getattr(e, "evidence", None) or []:
                if ev.get("location"):
                    loc = f"  [{ev.get('type') or 'evidence'}: {ev['location']}]"
                    break
            lines.append(f"  {e.source} -[{e.relationship_type}]-> {e.target}{loc}")
        if answer and answer.get("why"):
            lines.append(f"Why not moving: {answer['why']}")
            checks = answer.get("next_checks") or []
            if checks:
                lines.append("Suggested checks: " + "; ".join(checks[:3]))
        lines.append("---\n")
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Work-order-history evidence (additive, flag-gated)
    # ------------------------------------------------------------------
    async def _build_wo_evidence_context(self, state: dict, tenant_id: str | None) -> str:
        """Best-effort CMMS work-order history for the confirmed asset.

        Recalls recent Hub work_orders rows for the asset and renders them as a
        labeled, CITABLE evidence block for prompt injection. Returns "" on any
        miss (flag off, no tenant/asset, DB unreachable). Never raises -- the
        diagnosis path must be unaffected when the CMMS store is absent.
        """
        if not _WO_EVIDENCE_ENABLED:
            return ""
        if not tenant_id:
            return ""
        asset = (state.get("asset_identified") or "").strip()
        if not asset:
            return ""
        try:
            try:
                uns_path = resolve_uns_path(asset).uns_path or ""
            except Exception:  # noqa: BLE001 -- fall back to name-only matching
                uns_path = ""
            ltree_prefix = uns_path.replace("/", ".") if uns_path else None
            wos = await asyncio.wait_for(
                _recall_work_orders(
                    tenant_id, asset, uns_path=ltree_prefix, limit=_WO_EVIDENCE_LIMIT
                ),
                timeout=_WO_EVIDENCE_TIMEOUT_S,
            )
            return self._format_wo_evidence(wos)
        except Exception as exc:  # noqa: BLE001 -- enrichment must never block diagnosis
            logger.debug("WO_EVIDENCE miss asset=%r: %s", asset, exc)
            return ""

    @staticmethod
    def _format_wo_evidence(wos: list[dict]) -> str:
        """Render work-order rows as a compact citable-evidence block.

        Defensive: tolerates missing/extra keys and never raises. Only fields
        read from the DB are rendered -- nothing is invented. Empty input
        returns "".
        """
        if not wos:
            return ""
        lines: list[str] = []
        for w in wos[:_WO_EVIDENCE_LIMIT]:
            if not isinstance(w, dict):
                continue
            num = str(w.get("work_order_number") or "").strip()
            title = str(w.get("title") or "").strip()
            if not num or not title:
                continue
            created = w.get("created_at")
            date = ""
            try:
                date = created.date().isoformat() if created else ""
            except AttributeError:
                date = str(created)[:10] if created else ""
            status = str(w.get("status") or "").strip()
            head = f"  [WO {num}]" + (f" {date}" if date else "")
            if status:
                head += f" ({status})"
            head += f": {title}"
            detail = str(w.get("resolution") or w.get("fault_description") or "").strip()
            if detail:
                head += f" -- {detail[:200]}"
            lines.append(head)
        if not lines:
            return ""
        return (
            "\n--- WORK ORDER HISTORY (CMMS; citable -- cite as [WO <number>]) ---\n"
            + "\n".join(lines)
            + "\n---\n"
        )

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
        # Fetch KG + live-equipment context once (both best-effort, "" when
        # disabled/absent) and reuse across self-correction retries. They are
        # pre-formatted, self-labeled blocks; concatenate and inject as one.
        kg_context = await self._build_kg_context(state, tenant_id)
        live_context = await self._build_live_data_context(state)
        ctx_signals_context = await self._build_ctx_signals_context(state, tenant_id)
        interlock_context = await self._build_interlock_context(state, tenant_id)
        wo_evidence_context = await self._build_wo_evidence_context(state, tenant_id)
        extra_context = (
            kg_context
            + live_context
            + ctx_signals_context
            + interlock_context
            + wo_evidence_context
        )

        for attempt in range(max_attempts):
            try:
                raw = await self.rag.process(
                    query,
                    state,
                    photo_b64=photo_b64,
                    vision_model=self.vision_model,
                    tenant_id=tenant_id,
                    kg_context=extra_context,
                )
            except Exception as e:
                logger.error("LLM call failed (rag worker): %s", e)
                return None, {"reply": f"MIRA error: {e}"}

            parsed = self._parse_response(raw)
            # Pop this call's citation/grounding evidence (stashed on ``state``
            # by rag.process() before its LLM await) onto ``parsed`` — the
            # durable per-turn carrier the footer, rewrite, grounding check, and
            # decision-trace read, instead of the shared self.rag.* attributes a
            # concurrent tenant overwrites (#1704). POP (not get) so the keys
            # never reach _save_state. Set every attempt so the last one wins.
            parsed["_kb_status"] = state.pop("_rag_kb_status", None) or {}
            parsed["_sources"] = state.pop("_rag_sources", None) or []
            parsed["_last_chunks"] = state.pop("_rag_last_chunks", None) or []
            parsed["_no_kb"] = state.pop("_rag_no_kb", False)

            # Check grounding against THIS turn's sources snapshot, never the
            # shared self.rag._last_sources (#1704).
            if self._is_grounded(parsed, parsed["_sources"]):
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
        sc["last_question"] = parsed["reply"][:200]
        sc["last_options"] = parsed.get("options", [])
        ctx["session_context"] = sc

        state["context"] = ctx
        self._save_state(chat_id, state)
        formatted = self._format_reply(parsed, user_message=message)
        if honest_prefix:
            formatted = honest_prefix + formatted

        _cc = _check_citation_compliance(
            formatted,
            parsed.get("_kb_status") or {},
            fsm_state=state.get("state", ""),
            chat_id=chat_id,
            uns_context=ctx.get("uns_context"),
            enforce=_citation_enforce_enabled(),
        )
        if _cc.get("sanitized_reply"):
            formatted = _cc["sanitized_reply"]

        return self._make_result(
            formatted,
            self._infer_confidence(formatted),
            None,
            state["state"],
            citation_evidence=self._evidence_from_parsed(parsed),
        )

    # ------------------------------------------------------------------
    # Manual-lookup gathering subroutine
    # ------------------------------------------------------------------

    @staticmethod
    def _collect_session_entities(
        state: dict, message: str, current_vendor: str
    ) -> tuple[str, str]:
        """Harvest (vendor, model) from session memory before gathering. Read-only.

        Sources, in priority order:
          1. ``state["asset_identified"]`` — engine's own pinned asset.
          2. ``state["context"]["history"]`` — last 8 turns of user+assistant text.
          3. ``state["context"]["dialogue"]["salient_entities"]`` — DST snapshot.
          4. The current ``message`` itself.

        Returns ``("", "")`` when nothing is found. Never mutates state or DST.
        """
        vendor = current_vendor or ""
        model = ""

        # Primary source: UNS resolver result for this turn (includes
        # prior-context carry-over from previous turns). Stored under
        # state["context"]["uns_context"] so it survives SQLite round-trip.
        uns = (state.get("context") or {}).get("uns_context") or {}
        if not vendor and uns.get("manufacturer"):
            vendor = str(uns["manufacturer"])
        if not model and uns.get("model"):
            model = str(uns["model"])

        # Secondary: asset_identified is the canonical "Vendor, Model" string.
        asset_id = state.get("asset_identified") or ""
        if "," in asset_id:
            parts = [p.strip() for p in asset_id.split(",", 1)]
            if not vendor and parts[0]:
                vendor = parts[0]
            if len(parts) > 1 and parts[1]:
                model = parts[1]
        elif asset_id and (not vendor or not model):
            # Fallback: resolve asset_id through the UNS resolver
            fallback_ctx = resolve_uns_path(asset_id)
            if not vendor and fallback_ctx.manufacturer:
                vendor = fallback_ctx.manufacturer
            if not model and fallback_ctx.model:
                model = fallback_ctx.model

        ctx = state.get("context") or {}
        if not vendor or not model:
            dialogue = ctx.get("dialogue") or {}
            ents = dialogue.get("salient_entities") or {}
            if not vendor and ents.get("vendor"):
                vendor = str(ents["vendor"])
            if not model and ents.get("model"):
                model = str(ents["model"])

        # Last resort: re-resolve the current message directly. This branch
        # fires only when uns_context wasn't populated (e.g., called from a
        # path that bypassed process_full's top-of-loop resolution).
        if not vendor or not model:
            msg_ctx = resolve_uns_path(message)
            if not vendor and msg_ctx.manufacturer:
                vendor = msg_ctx.manufacturer
            if not model and msg_ctx.model:
                model = msg_ctx.model
        return vendor, model

    async def _enter_manual_lookup_gathering(
        self,
        chat_id: str,
        message: str,
        state: dict,
        trace_id: str,
        initial_vendor: str,
        resolved_tenant: str = "",
    ) -> dict:
        """Set FSM to MANUAL_LOOKUP_GATHERING and ask for the first missing field."""
        # CRA-8 Cluster B: if the technician already named the vendor across the
        # session (asset_identified, history, DST), skip the gather and queue a
        # crawl directly. Asking "what's the brand?" after the user said "Pilz
        # PNOZ" three turns ago is annoying and strands the FSM in MLG when the
        # eval has no further turn to satisfy the question.
        seeded_vendor, seeded_model = self._collect_session_entities(state, message, initial_vendor)
        if seeded_vendor:
            logger.info(
                "MANUAL_LOOKUP_GATHERING_BYPASS chat_id=%s vendor=%r model=%r — entities from session",
                chat_id,
                seeded_vendor,
                seeded_model,
            )
            return await self._do_documentation_lookup(
                chat_id,
                message,
                state,
                trace_id,
                resolved_tenant,
                vendor_override=seeded_vendor,
                model_override=seeded_model or "",
                low_confidence=not seeded_model,
            )

        state = self._clear_diagnostic_carryover(chat_id, state, clear_photo=True)
        ctx = state.get("context") or {}
        gathered: dict = {}
        if initial_vendor:
            gathered["vendor"] = initial_vendor

        ctx["manual_lookup_gathering"] = {
            "collected": gathered,
            "attempts": 0,
            "prior_state": self._background_state_for(state),
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
            # Preserve any vendor/model already collected so the diagnostic FSM has context.
            if not state.get("asset_identified"):
                if collected.get("vendor") and collected.get("model"):
                    state["asset_identified"] = f"{collected['vendor']}, {collected['model']}"
                elif collected.get("vendor"):
                    state["asset_identified"] = collected["vendor"]
            ctx.pop("manual_lookup_gathering", None)
            state["state"] = prior_state
            state["context"] = ctx
            self._save_state(chat_id, state)
            logger.info(
                "MANUAL_LOOKUP_GATHERING_ESCAPED chat_id=%s reason=diagnosis_signal vendor=%r",
                chat_id,
                state.get("asset_identified"),
            )
            return None  # fall through

        if has_escape_phrase:
            if "skip" in msg_lower:
                # "skip" = proceed with whatever we have, including nameplate context.
                # Seed collected from asset_identified if it wasn't manually provided.
                asset_id = state.get("asset_identified", "")
                if "," in asset_id:
                    parts = asset_id.split(",", 1)
                    if not collected.get("vendor"):
                        collected["vendor"] = parts[0].strip()
                    if not collected.get("model"):
                        collected["model"] = parts[1].strip()
                ctx.pop("manual_lookup_gathering", None)
                state["state"] = prior_state
                state["context"] = ctx
                logger.info(
                    "MANUAL_LOOKUP_GATHERING_SKIP chat_id=%s vendor=%r model=%r",
                    chat_id,
                    collected.get("vendor", ""),
                    collected.get("model", ""),
                )
                return await self._do_documentation_lookup(
                    chat_id,
                    message,
                    state,
                    trace_id,
                    resolved_tenant,
                    vendor_override=collected.get("vendor", ""),
                    model_override=collected.get("model", ""),
                    low_confidence=not (collected.get("vendor") and collected.get("model")),
                )
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
        # Bias the resolver with any vendor already collected so a bare model
        # answer like "525" resolves correctly (vendor-adjacent rule).
        if collected.get("vendor"):
            biased = f"{collected['vendor']} {message}"
        else:
            biased = message
        turn_ctx = resolve_uns_path(biased)
        new_vendor = turn_ctx.manufacturer or ""
        new_model = turn_ctx.model or ""

        # MLG-specific permissive fallback: when vendor is in hand and the
        # resolver still didn't find a model, accept any short non-stopword
        # token as the model (covers "PNOZ-X3" and other unusual answers).
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

    # Heuristic: looks like an industrial question that *should* resolve to a
    # vendor/model. If we can't extract one, asking is better than guessing.
    _INDUSTRIAL_HINTS_RE = re.compile(
        r"\b(vfd|plc|hmi|scada|motor|fault|alarm|trip|modbus|profinet|"
        r"ethernet/?ip|cip|rs[\- ]?485|rs[\- ]?232|contactor|relay|servo|"
        r"encoder|nameplate|drive|f\d{2,4}|e\d{2,4}|oc\b|ol\b)\b",
        re.IGNORECASE,
    )

    # Greetings / pleasantries that aren't really "questions" — used to gate
    # whether the doc-lookup formatter appends its generic "Ask about..." menu.
    _NON_QUESTION_TOKENS = frozenset(
        {
            "hi",
            "hello",
            "hey",
            "howdy",
            "yo",
            "sup",
            "thanks",
            "thank",
            "ok",
            "okay",
            "k",
            "cool",
            "great",
            "nice",
            "yes",
            "no",
            "y",
            "n",
            "?",
            "??",
            "help",
        }
    )

    @classmethod
    def _message_is_specific_question(cls, message: str) -> bool:
        """True when the user's message looks like a real question that
        deserves a real answer, not the generic "Ask about manuals…" menu.

        Heuristic: >3 word-tokens AND not just a greeting / acknowledgement.
        Used by the doc-lookup formatter to skip a non-responsive menu line
        when the user clearly asked something specific.
        """
        if not message:
            return False
        tokens = re.findall(r"\w+", message.lower())
        if len(tokens) <= 3:
            return False
        return any(t not in cls._NON_QUESTION_TOKENS for t in tokens)

    async def _handle_general_question(
        self,
        chat_id: str,
        message: str,
        state: dict,
        trace_id: str,
        *,
        tenant_id: str | None = None,
    ) -> dict:
        """KB-first answer with conversation history.

        Decision order:
          1. Re-resolve equipment (manufacturer/model) from current message
             plus recent user turns — every turn gets a fresh extraction.
          2. If a vendor is identified and the KB has coverage → RAG worker,
             so the reply carries citations.
          3. Vendor identified but no KB coverage → hand off to the
             documentation lookup path so the crawler fills the gap.
          4. No vendor anywhere AND the question looks industrial → ask for
             vendor/model rather than hallucinate.
          5. Otherwise → answer from training knowledge with conversation
             history threaded through. Disclose lack of docs when relevant.
        """
        # Don't wipe an active session photo for a general question — a
        # clarifying ask mid-diagnostic shouldn't break the photo flow.
        # target_state="IDLE": general questions must leave the FSM at IDLE so
        # callers that return state.get("state") don't surface ASSET_IDENTIFIED.
        state = self._clear_diagnostic_carryover(
            chat_id, state, clear_photo=False, target_state="IDLE"
        )

        ctx = state.get("context") or {}
        history = ctx.get("history", [])
        asset = state.get("asset_identified", "")

        # 1) Re-extract equipment from the user's recent turns + current msg.
        user_window = [h.get("content", "") for h in history[-6:] if h.get("role") == "user"]
        combined_for_resolve = " ".join([*user_window, message]).strip()
        resolved_tenant = tenant_id or state.get("tenant_id") or ""

        # Multi-candidate resolution catches cross-vendor questions (e.g.
        # "connect Micro 820 to AutomationDirect GS11") that the single-result
        # resolver would collapse to one vendor. Candidates are pair-validated
        # against the KB by resolve_uns_path_multi so chimeric (vendor, model)
        # pairings are dropped before we reach the speak path.
        uns_resolution = resolve_uns_path_multi(combined_for_resolve, tenant_id=resolved_tenant)
        uns = uns_resolution.primary
        mfr = uns.manufacturer or ((ctx.get("uns_context") or {}).get("manufacturer") or "")
        model = uns.model or ""

        # Multi-vendor branch — when the user names two pieces of equipment
        # from different OEMs, the single-vendor decision tree would pick
        # one and ignore the other. Route to the cross-vendor handler instead.
        if uns_resolution.has_multi_vendor:
            return await self._handle_multi_vendor_question(
                chat_id,
                message,
                state,
                trace_id,
                uns_resolution,
                history,
                resolved_tenant,
            )

        kb_covered = False
        kb_reason = ""
        if mfr:
            try:
                kb_covered, kb_reason = kb_has_coverage(mfr, combined_for_resolve, resolved_tenant)
            except Exception as exc:
                logger.warning("GENERAL_QUESTION_KB_PROBE_FAILURE error=%s", exc)

        logger.info(
            "GENERAL_QUESTION_GATE chat_id=%s mfr=%r model=%r kb_covered=%s reason=%r",
            chat_id,
            mfr,
            model,
            kb_covered,
            kb_reason,
        )

        # 2) Vendor + KB coverage → answer through RAG (citations enforced).
        if mfr and kb_covered:
            if not asset:
                state["asset_identified"] = f"{mfr}, {model}" if model else mfr
            try:
                raw_resp = await self.rag.process(
                    message, state, photo_b64=None, tenant_id=resolved_tenant
                )
                # This path calls rag.process() directly (no _call_with_correction),
                # so pop the per-turn evidence off state here — BEFORE
                # _record_exchange persists state — and thread it via result (#1704).
                _evidence = {
                    "kb_status": state.pop("_rag_kb_status", None) or {},
                    "chunks": state.pop("_rag_last_chunks", None) or [],
                    "sources": state.pop("_rag_sources", None) or [],
                    "no_kb": state.pop("_rag_no_kb", False),
                }
                parsed = self._parse_response(raw_resp)
                raw = parsed.get("reply", "") if parsed else ""
                if raw:
                    reply = self._format_simple_response(
                        raw,
                        suggestions=[
                            "Find documentation",
                            "Log a work order",
                            "Diagnose this asset",
                        ],
                    )
                    self._record_exchange(chat_id, state, message, reply)
                    tl_flush()
                    return self._make_result(
                        reply,
                        self._infer_confidence(raw),
                        trace_id,
                        state.get("state", "IDLE"),
                        citation_evidence=_evidence,
                    )
            except Exception as exc:
                logger.warning("GENERAL_QUESTION_RAG_FAILURE error=%s — falling through", exc)

        # 3) Vendor identified but no KB coverage → kick off doc lookup/crawl.
        if mfr and not kb_covered:
            return await self._do_documentation_lookup(
                chat_id,
                message,
                state,
                trace_id,
                resolved_tenant,
                vendor_override=mfr,
                model_override=model,
            )

        # 4) Industrial-flavored question with no resolvable vendor → ask.
        looks_industrial = bool(self._INDUSTRIAL_HINTS_RE.search(message))
        if looks_industrial and not asset:
            clarify_system = (
                "You are MIRA, an industrial maintenance assistant. The "
                "technician asked a question but the manufacturer and model "
                "haven't been identified. Reply in ≤2 short sentences: "
                "acknowledge what you understood, then ask for the missing "
                "piece (manufacturer and/or model). Do NOT try to answer the "
                "question yet — getting the docs requires knowing the asset."
            )
            try:
                raw = await self._call_llm_direct(message, system=clarify_system, history=history)
            except Exception as exc:
                logger.warning("GENERAL_QUESTION_CLARIFY_FAILURE error=%s", exc)
                raw = (
                    "Which equipment is this — manufacturer and model? "
                    "Once I know, I'll pull the docs and walk you through it."
                )
            reply = self._format_simple_response(
                raw,
                suggestions=[
                    "Send a nameplate photo",
                    "Type the model number",
                    "Describe the symptom",
                ],
            )
            self._record_exchange(chat_id, state, message, reply)
            tl_flush()
            return self._make_result(reply, "none", trace_id, state.get("state", "IDLE"))

        # 5) Truly general question → answer with history. Disclose missing
        #    docs when an asset is known but the KB doesn't cover it.
        asset_ctx = f" The current equipment is: {asset}." if asset else ""
        disclosure = (
            " You do not have documentation for this in your knowledge base — "
            "say so up front, then answer from general training knowledge."
            if asset and not kb_covered
            else ""
        )
        system = (
            "You are MIRA, an industrial maintenance assistant."
            f"{asset_ctx}{disclosure} "
            "Answer the technician's question concisely and accurately, using "
            "the conversation history for context. Keep it under 120 words."
        )
        try:
            raw = await self._call_llm_direct(message, system=system, history=history)
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

    async def _handle_multi_vendor_question(
        self,
        chat_id: str,
        message: str,
        state: dict,
        trace_id: str,
        uns_resolution: UNSResolution,
        history: list[dict],
        resolved_tenant: str,
    ) -> dict:
        """Cross-vendor integration question handler.

        Triggered when ``resolve_uns_path_multi`` finds ≥2 distinct vendors
        in the message after pair-coverage validation (e.g. "connect my
        Micro 820 to an AutomationDirect GS11 over RS485 Modbus"). Each
        candidate's (vendor, model) pair has already been validated against
        the KB by the resolver, so the products this handler enumerates
        are guaranteed real — no chimeras.

        v1 behaviour: name all vendors explicitly in the system prompt and
        answer from training knowledge with the conversation history. Cross-
        vendor RAG composition (pulling chunks from both vendors' manuals
        into one grounded reply) is a follow-up that requires RAGWorker
        signature changes; this handler at least prevents the bot from
        pretending one vendor's product belongs to the other.
        """
        candidates = uns_resolution.candidates
        vendor_summary = ", ".join(
            f"{c.manufacturer} {c.model}".strip() if c.model else c.manufacturer
            for c in candidates
            if c.manufacturer
        )
        vendor_names = ", ".join(uns_resolution.vendors())

        logger.info(
            "MULTI_VENDOR_QUESTION chat_id=%s vendors=%s summary=%r",
            chat_id,
            vendor_names,
            vendor_summary,
        )

        # Pick the first KB-validated candidate as the "lead" asset so the
        # session has *some* identified asset for downstream features (work
        # orders, photo follow-ups). The other vendors stay in the system
        # prompt context.
        lead = candidates[0]
        if not state.get("asset_identified") and lead.manufacturer:
            state["asset_identified"] = (
                f"{lead.manufacturer}, {lead.model}" if lead.model else lead.manufacturer
            )

        system = (
            "You are MIRA, an industrial maintenance assistant. The technician "
            f"is asking about a cross-vendor integration involving: {vendor_summary}. "
            "Answer the question with both pieces of equipment in mind. "
            "If the answer requires steps on both sides (e.g. wiring + parameter "
            "setup), structure your reply so each vendor's portion is clear. "
            "If you don't have specific documentation for the integration itself, "
            "say so up front and then answer from general industrial knowledge. "
            "Never invent product names — only reference the vendors and models "
            "listed above. Keep the reply under 180 words."
        )
        try:
            raw = await self._call_llm_direct(message, system=system, history=history)
        except Exception as exc:
            logger.warning("MULTI_VENDOR_LLM_FAILURE error=%s", exc)
            raw = (
                f"You're asking about an integration between {vendor_summary}. "
                "I can pull the docs for either side — which do you want to "
                "start with?"
            )

        reply = self._format_simple_response(
            raw,
            suggestions=[
                f"Pull {candidates[0].manufacturer} docs" if candidates else "Find documentation",
                f"Pull {candidates[1].manufacturer} docs"
                if len(candidates) > 1
                else "Log a work order",
                "Log a work order",
            ],
        )
        self._record_exchange(chat_id, state, message, reply)
        tl_flush()
        return self._make_result(
            reply, self._infer_confidence(raw), trace_id, state.get("state", "IDLE")
        )

    async def _handle_asset_switch(
        self,
        chat_id: str,
        message: str,
        state: dict,
        trace_id: str,
        tenant_id: str | None = None,
    ) -> dict:
        """User wants to talk about a different asset — clear FSM, preserve session memory."""
        old_asset = state.get("asset_identified", "") or "unknown"

        # Try to identify the new asset from the switch message itself.
        # Fresh resolve (no prior_ctx) so we get the NEW asset, not carry-over
        # from the one the user is switching away from.
        new_ctx = resolve_uns_path(message)
        new_asset = new_ctx.manufacturer or ""

        logger.info(
            "ASSET_SWITCH chat_id=%s from=%r to=%r",
            chat_id,
            old_asset,
            new_asset or "unidentified",
        )

        state["state"] = "IDLE"
        ctx = state.get("context") or {}
        # Clear active diagnostic context but keep session_memory for cross-session recall
        ctx.pop("session_context", None)
        ctx.pop("cmms_pending", None)
        ctx.pop("cmms_wo_draft", None)
        ctx.pop("pending_doc_job", None)
        ctx.pop("photo_turn", None)
        state["fault_category"] = None
        state["final_state"] = None
        state["context"] = ctx
        self._clear_session_photo(chat_id)

        # UNS gate: a deliberate switch FROM a confirmed asset must re-confirm the NEW
        # asset before troubleshooting. Guard: only clear + re-gate when there was
        # already a confirmed asset to switch away from. If no prior asset_identified
        # (LLM mis-routed a first-mention as switch_asset), adopt directly so the
        # session doesn't get trapped in AWAITING_UNS_CONFIRMATION — the normal
        # diagnose_equipment gate handles first-mention confirmation via line 1392+gate.
        current_asset = state.get("asset_identified") or ""
        if _UNS_GATE_ENABLED and current_asset and getattr(new_ctx, "confidence", 0.0) > 0:
            state["asset_identified"] = None
            self._save_state(chat_id, state)
            return await self._handle_uns_confirmation_request(
                chat_id, message, state, new_ctx, trace_id, tenant_id=tenant_id
            )

        # Gate off, or nothing resolvable to confirm: legacy behavior -- adopt the
        # (possibly empty) resolved asset and prompt for the fault / equipment.
        state["asset_identified"] = new_asset
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
            pre, fault = msg[:idx], msg[idx + len(sep) :].strip()
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
        return self._make_result(
            preview,
            "none",
            trace_id,
            state.get("state", "IDLE"),
            dispatch_kind="action_request",
        )

    def _handle_dont_know_followup(
        self, chat_id: str, message: str, state: dict, trace_id: str
    ) -> dict:
        """Stage 0 (2026-05-04) handler for "I don't know" answers to MIRA's
        pending question.

        Acknowledges the uncertainty and offers a slot-aware alternative path
        (photo of nameplate, describe symptom) — without embedding the user's
        words as a vector-search query, which would otherwise tokenize "don't"
        into spurious fault codes.
        """
        fsm = state.get("state", "IDLE")
        asset = state.get("asset_identified", "")
        if fsm in ("IDLE", "Q1") or not asset:
            reply = (
                "No problem. If you're at the equipment, send a photo of the "
                "nameplate or fault display and I'll read the model and code "
                "from it. Otherwise, describe what's happening — what does "
                "the machine do or fail to do?"
            )
        elif fsm == "DIAGNOSIS_REVISION":
            reply = (
                "OK — let's work with what you have. Describe the symptom "
                "in your own words: what does the equipment do (or not do) "
                "when you try to run it?"
            )
        else:
            reply = (
                "OK. Tell me what you do see or hear instead — any noise, "
                "smoke, lights, or behavior change. Even a rough description "
                "narrows it down."
            )
        # Persist last_question so the next turn's session_followup logic
        # treats further user replies as continuations of this prompt.
        ctx = state.get("context") or {}
        sc_dk = ctx.get("session_context") or {}
        sc_dk["last_question"] = reply[:200]
        sc_dk["last_options"] = []
        ctx["session_context"] = sc_dk
        state["context"] = ctx
        self._record_exchange(chat_id, state, message, reply)
        self._save_state(chat_id, state)
        tl_flush()
        return self._make_result(reply, "none", trace_id, fsm, dispatch_kind="dont_know")

    # ------------------------------------------------------------------
    # Stage 1 — Dialogue State Tracker dispatch (PLAN.md §2.3 / §10)
    # ------------------------------------------------------------------

    async def _maybe_dispatch_via_dst(
        self,
        chat_id: str,
        message: str,
        state: dict,
        trace_id: str,
        sc: dict,
        resolved_tenant,
    ) -> dict | None:
        """Run one turn through the dialogue state tracker.

        Returns the engine's standard result dict when the tracker handles
        the turn, or `None` when the legacy routing should take over (for
        DEFAULT_RAG dispatches, classifier failures, slot-fill answers that
        the existing flow already handles, etc.).

        Three things happen here:

        1. Build the typed `DialogueState` from the engine's state dict.
        2. Run `track_turn()` — classify, merge entities, decide dispatch,
           update pending question, snapshot interrupts.
        3. Match on `plan.kind` and call the matching handler. The handler
           list is intentionally small in Stage 1 — we only handle the
           dispatch kinds where DST adds new value over Stage 0:
           * SAFETY              → identical safety reply, but with a typed
                                    hazard summary attached for telemetry
           * ACTION_INTERRUPT    → WO / asset switch / reset
           * SLOT_DONT_KNOW      → routes to _handle_dont_know_followup
           * META                → reset / cancel acknowledgement
           * GREET (in IDLE)     → _greeting_response
           * ASK_PROCEDURAL      → _handle_instructional_question
           * ASK_GENERAL         → _handle_general_question
           * ACTION (other)      → _handle_check_equipment_history /
                                    documentation flow / etc.
           * Everything else (SLOT_ANSWER, SLOT_CONFIRM/DENY, DEFAULT_RAG,
             classifier failure) → return None and let the legacy flow run.
        """
        # Build the tracker state from the existing engine state dict —
        # session_manager has no schema knowledge of `dialogue`; we ride on
        # the JSON `context` blob.
        ds = DialogueState.from_engine_state(chat_id, state)

        try:
            new_ds, plan = await track_turn(ds, message)
        except Exception as exc:  # noqa: BLE001 — bot must never raise
            logger.warning("DST_TRACK_FAILURE chat_id=%s err=%s", chat_id, exc)
            return None

        # Persist the updated tracker state — the engine state dict gets
        # written to SQLite by the existing _save_state path on whichever
        # handler we end up calling.
        new_ds.write_to_engine_state(state)

        kind = plan.kind

        # Priority 1 — safety
        if kind == DISPATCH_SAFETY:
            reply = (
                "STOP — describe the hazard. De-energize the equipment first. "
                "Do not proceed until the area is safe."
            )
            self._record_exchange(chat_id, state, message, reply)
            tl_flush()
            asset = state.get("asset_identified") or "Unknown equipment"
            asyncio.ensure_future(push_safety_alert(asset=asset, message=message[:200]))
            return self._make_result(reply, "high", trace_id, "SAFETY_ALERT")

        # Priority 2 — interrupt actions
        if kind == DISPATCH_ACTION_INTERRUPT:
            action = plan.payload.get("action")
            if action == "log_work_order":
                return await self._handle_wo_request(chat_id, message, state, trace_id)
            if action == "switch_asset":
                return await self._handle_asset_switch(chat_id, message, state, trace_id)
            if action == "reset":
                # Reset clears state in SQLite and returns a friendly
                # acknowledgement. Mirrors the /reset bot command.
                self.reset(chat_id)
                reply = "Started a fresh session. What equipment can I help with?"
                tl_flush()
                return self._make_result(reply, "none", trace_id, "IDLE", dispatch_kind="dst_meta")

        # Priority 3 — slot-level dispatches we own
        if kind == DISPATCH_SLOT_DONT_KNOW:
            return self._handle_dont_know_followup(chat_id, message, state, trace_id)

        # Priority 4 — meta-control (cancel / reset / skip / back / stop)
        if kind == DISPATCH_META:
            command = plan.payload.get("command", "cancel")
            if command in ("reset", "stop"):
                self.reset(chat_id)
                reply = "Started a fresh session. What equipment can I help with?"
                tl_flush()
                return self._make_result(reply, "none", trace_id, "IDLE", dispatch_kind="dst_meta")
            # cancel / skip / back — clear pending question, acknowledge,
            # let the next user turn drive the flow.
            ctx = state.get("context") or {}
            sc_meta = ctx.get("session_context") or {}
            sc_meta.pop("last_question", None)
            sc_meta.pop("last_options", None)
            ctx["session_context"] = sc_meta
            state["context"] = ctx
            reply = "Got it — let's drop that. What would you like to do next?"
            self._record_exchange(chat_id, state, message, reply)
            self._save_state(chat_id, state)
            tl_flush()
            return self._make_result(
                reply, "none", trace_id, state.get("state", "IDLE"), dispatch_kind="dst_meta"
            )

        # Priority 5 — non-interrupt action requests
        if kind == DISPATCH_ACTION:
            action = plan.payload.get("action")
            if action == "check_equipment_history":
                return await self._handle_check_equipment_history(chat_id, message, state, trace_id)
            if action == "find_documentation":
                # The existing post-router block handles `find_documentation`
                # via the specificity gate + crawl pipeline. Returning None
                # lets the legacy `route_intent` call re-classify it (cheap)
                # and route to the same place. Stage 2 will short-circuit
                # this when the legacy router is removed.
                return None
            if action == "store_documentation":
                target = ""
                turn = getattr(plan, "turn", None)
                turn_entities = getattr(turn, "entities", None)
                if turn_entities is not None:
                    target = (getattr(turn_entities, "asset_label", "") or "").strip()
                return await self._handle_store_documentation(
                    chat_id, message, state, trace_id, target
                )
            if action == "schedule_maintenance":
                # PM scheduling has a deep wizard already; let the existing
                # path handle it. Set a hint so the keyword classifier on
                # the legacy path knows what the user wanted.
                return None

        # Priority 6 — questions
        # Guard: when the FSM is in any active diagnostic state (Q1+), don't pull
        # the turn out to an instructional/general handler that resets FSM to IDLE.
        # Fall through to None so the legacy RAG path continues the session.
        # This mirrors the _router_industrial_override guard in the LLM router
        # block — DST can intercept before that guard fires when MIRA_USE_DST=1.
        _dst_in_active = state.get("state") in ACTIVE_DIAGNOSTIC_STATES
        if kind == DISPATCH_ASK_PROCEDURAL:
            if _dst_in_active:
                return None
            return await self._handle_instructional_question(chat_id, message, state, trace_id)
        if kind == DISPATCH_ASK_GENERAL:
            if _dst_in_active:
                return None
            return await self._handle_general_question(
                chat_id, message, state, trace_id, tenant_id=resolved_tenant
            )

        # Priority 7 — greeting in IDLE
        if kind == DISPATCH_GREET and state.get("state", "IDLE") == "IDLE":
            return self._greeting_response(state, chat_id, trace_id)

        # Priority 8 — anything left (SLOT_ANSWER, SLOT_CONFIRM, SLOT_DENY,
        # DEFAULT_RAG) → let the legacy router/classifier handle it. The
        # existing flow already knows how to advance Q1→Q2→Q3 from a slot
        # answer; rebuilding that here is Stage 2 work.
        return None

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

    async def _handle_tag_query(
        self, chat_id: str, message: str, state: dict, trace_id: str
    ) -> dict:
        """Answer a direct live-tag state question from the [LIVE CONVEYOR STATUS] block.

        Called by the tag-query fast-path (Q2 fix, 2026-06-06) when the user's
        message names a known PLC/VFD tag AND is phrased as a question. Reads the
        status block already prepended to the message by the Ignition Ask API and
        returns an answer grounded in those live values — NOT historical DB rows.
        """
        # Extract the live status block from the enriched message if present.
        live_block = ""
        if _LIVE_STATUS_HEADER in message:
            start = message.find(_LIVE_STATUS_HEADER)
            end = message.find("\n\n[QUESTION]", start)
            live_block = message[start : end if end != -1 else start + 1500].strip()

        if live_block:
            # Build a grounded, concise answer from the tag values already decoded.
            reply = (
                f"Based on the live conveyor data:\n\n{live_block}\n\n"
                f"[Source: Live PLC/VFD tag snapshot via Ignition OPC-UA]"
            )
        else:
            # No live block available — honest admission.
            reply = (
                "I can see you're asking about a live conveyor status tag, but "
                "no live tag data was available in this request. "
                "Check the VFD panel or Ignition tag browser directly for the current value."
                "\n\n[Source: Live PLC/VFD tag snapshot via Ignition OPC-UA — data unavailable this turn]"
            )

        self._record_exchange(chat_id, state, message, reply)
        tl_flush()
        return self._make_result(
            reply, "high", trace_id, state.get("state", "IDLE"), dispatch_kind="tag_query"
        )

    async def _handle_store_documentation(
        self,
        chat_id: str,
        message: str,
        state: dict,
        trace_id: str,
        target_name: str,
    ) -> dict:
        """Handle "add this to documentation for [plant/equipment]" — pulls
        the most-recent schematic extraction off session state, scopes it to
        the named target, and persists to the KG via mira-mcp's
        ``/api/kg/schematic?persist=true`` endpoint.

        When no schematic has been extracted yet, falls back to recording
        the asset_identified ↔ target association so a follow-up photo can
        be auto-scoped. The user gets a friendly explanation either way.
        """
        ctx = state.get("context") or {}
        target = (target_name or "").strip().rstrip(".!?,;:").strip()

        if not target:
            reply = (
                "Got it — but who should I file this under? "
                'Try "add this to documentation for [plant or equipment name]".'
            )
            self._record_exchange(chat_id, state, message, reply)
            self._save_state(chat_id, state)
            tl_flush()
            return self._make_result(
                reply, "none", trace_id, state.get("state", "IDLE"), dispatch_kind="dst_action"
            )

        payload = ctx.get("last_schematic_extraction") or {}
        if not payload or not payload.get("entities"):
            # No schematic to persist — record the association in session
            # state so the next photo can pick up the target as parent.
            sc = ctx.get("session_context") or {}
            sc["pending_doc_target"] = target
            ctx["session_context"] = sc
            state["context"] = ctx
            self._save_state(chat_id, state)
            reply = (
                f"Noted — I'll file the next schematic or nameplate you send under "
                f'"{target}". I don\'t have a schematic extracted yet for this session.'
            )
            self._record_exchange(chat_id, state, message, reply)
            tl_flush()
            return self._make_result(
                reply, "none", trace_id, state.get("state", "IDLE"), dispatch_kind="dst_action"
            )

        # Persist via mira-mcp /api/kg/schematic — same endpoint the bot used
        # for extraction, this time with persist=true and an explicit
        # parent_equipment_id derived from the user-supplied target.
        n_entities = len(payload.get("entities") or [])
        n_relationships = len(payload.get("relationships") or [])
        schematic_type = payload.get("schematic_type", "schematic")

        headers = {"Content-Type": "application/json"}
        if self.mcp_api_key:
            headers["Authorization"] = f"Bearer {self.mcp_api_key}"
        body = {
            "tenant_id": self.tenant_id or "",
            "parent_equipment_id": target,
            "payload": payload,
        }

        persisted_summary = ""
        persisted_error = ""
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.post(
                    f"{self.mcp_base_url}/api/kg/schematic/persist",
                    json=body,
                    headers=headers,
                )
                if resp.status_code == 200:
                    data = resp.json() or {}
                    if data.get("ok"):
                        result = data.get("result") or {}
                        persisted_summary = (
                            f"{result.get('entities_upserted', n_entities)} components stored, "
                            f"{result.get('relationships_inserted', n_relationships)} connections linked"
                        )
                    else:
                        persisted_error = str(data.get("error") or "persistence rejected")
                else:
                    persisted_error = f"HTTP {resp.status_code}"
        except (httpx.HTTPError, ValueError) as exc:
            persisted_error = str(exc)
            logger.warning("STORE_DOC_PERSIST_FAILED error=%s", exc)

        if persisted_summary:
            reply = (
                f"Added to {target} documentation. "
                f"{schematic_type.replace('_', ' ').capitalize()}: {persisted_summary}."
            )
        else:
            # Fall back to a "queued" reply when persistence is unreachable —
            # the extraction still lives in session state for the user to
            # retry later. Don't claim it was stored when it wasn't.
            reply = (
                f"Captured the {schematic_type.replace('_', ' ')} for {target} "
                f"({n_entities} components, {n_relationships} connections). "
                f"Persistence is offline right now ({persisted_error or 'unreachable'}); "
                f"the extraction is held in this session — try again when connectivity returns."
            )

        # Clear the staged extraction so a fresh photo doesn't get re-saved.
        ctx.pop("last_schematic_extraction", None)
        sc = ctx.get("session_context") or {}
        sc.pop("pending_doc_target", None)
        ctx["session_context"] = sc
        state["context"] = ctx
        self._save_state(chat_id, state)
        self._record_exchange(chat_id, state, message, reply)
        tl_flush()
        return self._make_result(
            reply,
            "high" if persisted_summary else "none",
            trace_id,
            state.get("state", "IDLE"),
            dispatch_kind="dst_action",
        )

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
        mfr = ((state.get("context") or {}).get("uns_context") or {}).get("manufacturer") or ""
        if not self._is_doc_specific(mfr, combined):
            asset_id = state.get("asset_identified", "")
            if "," in asset_id:
                fallback_mfr = mfr or asset_id.split(",", 1)[0].strip()
                return await self._do_documentation_lookup(
                    chat_id,
                    message,
                    state,
                    trace_id,
                    resolved_tenant,
                    vendor_override=fallback_mfr,
                )
            return await self._enter_manual_lookup_gathering(
                chat_id, message, state, trace_id, mfr, resolved_tenant or ""
            )
        return await self._do_documentation_lookup(
            chat_id, message, state, trace_id, resolved_tenant, vendor_override=mfr
        )

    async def _handle_instructional_question(
        self,
        chat_id: str,
        message: str,
        state: dict,
        trace_id: str,
    ) -> dict:
        """Answer a procedural how-to question directly via the LLM.

        Bypasses the doc-crawl path and the Q1/Q2/Q3 diagnosis FSM. Injects
        the known asset context so the answer is equipment-specific when available.
        """
        # target_state="IDLE": instructional answers are background responses;
        # the FSM must return IDLE so state.get("state") doesn't surface ASSET_IDENTIFIED.
        state = self._clear_diagnostic_carryover(
            chat_id, state, clear_photo=True, target_state="IDLE"
        )
        asset = state.get("asset_identified", "")
        ctx = state.get("context") or {}
        history = ctx.get("history", [])

        system = (
            "You are MIRA, an industrial maintenance assistant. "
            "Answer the technician's procedural question with clear, numbered steps. "
            "Be concise and practical — they are on the shop floor. "
            "If the exact procedure varies by model, note what to check on the specific unit."
        )
        messages: list[dict] = [{"role": "system", "content": system}]
        messages.extend(history[-6:])
        user_content = f"Equipment: {asset}\n\n{message}" if asset else message
        messages.append({"role": "user", "content": user_content})

        raw, _usage = await self.router.complete(messages, max_tokens=600, session_id=chat_id)
        reply = (
            raw.strip()
            if raw
            else "I need more context about this specific equipment to answer that accurately. What's the make and model?"
        )

        history.append({"role": "user", "content": message})
        history.append({"role": "assistant", "content": reply})
        if len(history) > HISTORY_LIMIT:
            history = history[-HISTORY_LIMIT:]
        ctx["history"] = history
        state["context"] = ctx

        self._record_exchange(chat_id, state, message, reply)
        tl_flush()
        return self._make_result(
            reply, self._infer_confidence(reply), trace_id, state.get("state", "IDLE")
        )

    async def _call_llm_direct(
        self,
        message: str,
        system: str = "",
        history: list[dict] | None = None,
    ) -> str:
        """LLM call via the inference router. Threads conversation history.

        Pass ``history`` (the ``context.history`` list of {role, content}
        dicts) to give the stateless LLM the same illusion of memory that
        ChatGPT/Claude/Gemini provide — older turns get token-budget-trimmed
        and spliced between the system prompt and the current user message.
        """
        from .workers.rag_worker import _trim_history_by_tokens

        messages: list[dict] = []
        if system:
            messages.append({"role": "system", "content": system})
        if history:
            for entry in _trim_history_by_tokens(history):
                role = entry.get("role")
                content = entry.get("content")
                if role in ("user", "assistant") and content:
                    messages.append({"role": role, "content": content})
        messages.append({"role": "user", "content": message})
        raw, _usage = await self.router.complete(messages, max_tokens=600)
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
        state = self._clear_diagnostic_carryover(chat_id, state, clear_photo=True)
        asset = state.get("asset_identified", "")
        combined = " ".join(filter(None, [vendor_override, model_override, message, asset])).strip()
        # Resolve the combined input through the UNS resolver. Overrides win
        # when present; otherwise we use what the resolver found.
        combined_ctx = resolve_uns_path(combined)
        mfr = vendor_override or combined_ctx.manufacturer or ""
        url = vendor_support_url(combined)

        # Phase 2 — KB pre-check: skip crawl when we already have coverage.
        kb_covered, kb_reason = kb_has_coverage(mfr, combined, resolved_tenant or "")
        if kb_covered:
            # CRA-8 Cluster A: include the model token (and the literal word "manual")
            # so vendor-specific manual requests don't fall through the keyword check.
            model_hint = model_override or combined_ctx.model or ""

            # Chimera guard — kb_has_coverage filters on vendor only, so a
            # message naming two vendors (e.g. "Micro 820" + "AutomationDirect
            # GS11") can resolve to one vendor's name paired with another's
            # model number. Validate the pair against the KB; if zero rows
            # have BOTH together, drop the model so the reply never speaks
            # "AutomationDirect 820" or any other fabricated product.
            if mfr and model_hint:
                pair_covered, pair_count = kb_has_pair_coverage(
                    mfr, model_hint, resolved_tenant or ""
                )
                if not pair_covered and pair_count >= 0:
                    logger.info(
                        "DOC_LOOKUP_CHIMERA_BLOCKED chat_id=%s mfr=%r model=%r "
                        "kb_pair_count=%d — dropping model from reply",
                        chat_id,
                        mfr,
                        model_hint,
                        pair_count,
                    )
                    model_hint = ""

            # Q5 fix (2026-06-06): maintenance-gap queries (lubrication schedules,
            # PM intervals, etc.) are NOT answered by vendor docs in the KB —
            # emit an honest KB-gap admission so the technician knows to check
            # the asset nameplate or a physical maintenance card instead.
            if _MAINT_GAP_RE.search(message):
                asset_hint = model_override or model_hint or mfr or "this conveyor"
                reply = (
                    f"I don't have specific documentation indexed for the lubrication "
                    f"or maintenance schedule on {asset_hint}. Schedules are "
                    f"asset-specific and are not typically included in vendor "
                    f"electrical or drive manuals.\n\n"
                    f"Check the asset nameplate or the gearbox/motor manufacturer's "
                    f"maintenance datasheet. Your plant's PM card or CMMS work-order "
                    f"history is the most reliable source for interval data.\n\n"
                    f"[KB-gap: lubrication/maintenance schedule not indexed — consult "
                    f"the asset nameplate or vendor maintenance datasheet.]"
                )
                logger.info(
                    "KB_GAP_MAINT_SCHEDULE chat_id=%s manufacturer=%r maint_query=True",
                    chat_id,
                    mfr,
                )
                state["state"] = "IDLE"
                self._record_exchange(chat_id, state, message, reply)
                tl_flush()
                return self._make_result(reply, "none", trace_id, state["state"])

            if mfr and model_hint:
                reply = f"I have the {mfr} {model_hint} manual indexed."
            elif mfr:
                reply = f"I have {mfr} documentation indexed."
            else:
                reply = "I already have documentation indexed for that equipment."
            # The support URL is always the vendor's /support landing page
            # (see VENDOR_SUPPORT_URLS in guardrails.py) — useful when we
            # have NO docs, useless noise when we already do. Skip on the
            # KB_HIT path; the crawl-pending path below still uses it.
            #
            # The trailing "Ask about the manual, fault codes, specs, or
            # wiring" menu is also dropped when the user already asked a
            # specific question (>3 words and not a greeting) — appending
            # a menu after a real question reads as non-responsive.
            if not self._message_is_specific_question(message):
                reply += " Ask about the manual, fault codes, specs, or wiring."
            logger.info(
                "KB_PRE_CHECK_HIT chat_id=%s manufacturer=%r reason=%s",
                chat_id,
                mfr,
                kb_reason,
            )
            state["state"] = "IDLE"
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
            vendor_phrase = f" for {mfr}" if mfr else " for that equipment"
            reply = (
                f"I don't have documentation{vendor_phrase} in my knowledge base yet.\n\n"
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
        route: str | None = None,
        model: str | None = None,
        devices: int | None = None,
        input_sha256: str | None = None,
        fallback_reason: str | None = None,
    ) -> None:
        """Append-only log of every user/bot exchange for quality analysis.

        The optional provenance fields (``route``/``model``/``devices``/
        ``input_sha256``/``fallback_reason``) are populated by print turns so
        "check the bot results" retrieves the full story without screenshots
        (2026-07-15 operator directive)."""
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
            route=route,
            model=model,
            devices=devices,
            input_sha256=input_sha256,
            fallback_reason=fallback_reason,
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
        """Format parsed response for display. Delegates to response_formatter.format_reply.

        Reads kb_status from this turn's ``parsed`` (the per-call snapshot
        threaded by _call_with_correction), NOT the shared self.rag.kb_status
        attribute a concurrent tenant can overwrite (#1704). A reply that did
        not run RAG retrieval carries no snapshot → no citation footer, which
        is correct (it had nothing to cite).
        """
        kb_status = parsed.get("_kb_status") or {}
        return format_reply(parsed, user_message, kb_status)

    # ------------------------------------------------------------------
    # UNS Confirmation Gate
    # ------------------------------------------------------------------
    # Rule: no diagnosis without a confirmed asset. When the LLM router
    # classifies a turn as `diagnose_equipment` and the session has no
    # `asset_identified`, the engine asks the user to confirm before any
    # diagnostic work. Storage lives in state["context"]["pending_uns_confirm"]
    # so a second turn can consume the answer.

    def _should_fire_uns_gate(
        self,
        router_intent: str,
        state: dict,
        message: str,
        session_context: dict,
    ) -> bool:
        """Return True when the gate should interrupt the turn with a confirm prompt.

        Conditions (all must hold):
        - MIRA_UNS_GATE_ENABLED is on (default true)
        - router classified the turn as a gated intent (see _GATED_INTENTS:
          diagnose_equipment or schedule_maintenance)
        - session has no asset_identified
        - session is in IDLE (don't interrupt mid-FSM Q1/Q2/Q3/DIAGNOSIS).
          AWAITING_UNS_CONFIRMATION is consumed earlier in `process()` via
          `_handle_uns_confirmation_response`, so it never reaches this check.

        `message` and `session_context` are accepted for symmetry with other
        gate helpers and to keep the call site readable, even though the
        current implementation only inspects intent + state + flag.

        Direct-connection carve-out: a turn whose UNS context was certified by
        the connection itself (Ignition, MQTT/Sparkplug, PLC bridge, Hub
        display, QR — source="direct_connection") MUST NOT be interrupted with a
        "which machine?" confirmation. The connection already proved the asset;
        asking would be the exact anti-pattern
        .claude/rules/direct-connection-uns-certified.md forbids. We honor the
        marker here at the chat-gate so it can never lie. (The broader
        reject-on-missing-identifier contract for direct surfaces is still P6.)
        """
        del message, session_context  # reserved for future signal expansion
        if not _UNS_GATE_ENABLED:
            return False
        uns_ctx = (state.get("context") or {}).get("uns_context") or {}
        if uns_ctx.get("source") == "direct_connection":
            return False
        if router_intent not in _GATED_INTENTS:
            return False
        if state.get("asset_identified"):
            return False
        if state.get("state", "IDLE") != "IDLE":
            return False
        return True

    async def _handle_uns_confirmation_request(
        self,
        chat_id: str,
        message: str,
        state: dict,
        uns_ctx,
        trace_id,
        tenant_id: str | None = None,
    ) -> dict:
        """Gate firing: ask the user to confirm or supply the equipment.

        Saves `pending_uns_confirm` on state["context"] so the next user turn
        is consumed by `_handle_uns_confirmation_response`.

        Two-tier candidate resolution:
          1. Tenant-scoped demo-namespace lookup — if the message references
             an asset tag/name or component tag that exists in the tenant's
             kg_entities / installed_component_instances, prefer that as the
             confirmation candidate. This is the path the May 21 expo demo
             takes ("I'm on Conveyor 001 / PE-001"). The existing UNS
             resolver doesn't know tenant data; this fills that gap without
             touching the resolver.
          2. Generic manufacturer/model from `uns_ctx` — the unchanged
             behavior for every other tenant and every other turn.
        """
        ctx = state.get("context") or {}

        # Tier 1 — tenant-scoped lookup.
        demo_match = None
        try:
            from .demo_namespace import resolve_demo_namespace  # noqa: PLC0415

            demo_match = resolve_demo_namespace(message, tenant_id)
        except Exception as exc:  # noqa: BLE001 — never block the gate
            logger.debug("UNS_CONFIRM demo_namespace lookup error: %s", exc)
            demo_match = None

        candidate = None
        prompt: str
        if demo_match and demo_match.confidence >= 0.7:
            parts: list[str] = []
            if demo_match.asset_name:
                parts.append(demo_match.asset_name)
            if demo_match.asset_tag and demo_match.asset_tag not in parts:
                parts.append(demo_match.asset_tag)
            if demo_match.component_name:
                parts.append(demo_match.component_name)
            candidate = " / ".join(parts) if parts else None
            confidence_pct = int(round(demo_match.confidence * 100))
            if candidate:
                prompt = (
                    f"Before I diagnose, confirm the equipment: **{candidate}** "
                    f"(confidence {confidence_pct}%). "
                    "Reply 'yes' to confirm, or tell me the correct equipment."
                )
            else:
                prompt = (
                    "Before I diagnose, I need to know the equipment. "
                    "Tell me the asset and component you're working on."
                )
            # Stash the namespace match so a follow-up turn can promote it
            # straight into asset_identified / asset_id without re-querying.
            ctx["pending_uns_confirm"] = {
                "candidate": candidate,
                "demo_namespace": demo_match.as_dict(),
            }
        elif getattr(uns_ctx, "manufacturer", None):
            # Tier 2 — generic manufacturer/model path (unchanged).
            candidate = uns_ctx.manufacturer
            if getattr(uns_ctx, "model", None):
                candidate = f"{candidate}, {uns_ctx.model}"
            confidence_pct = int(round((getattr(uns_ctx, "confidence", 0.0) or 0.0) * 100))
            prompt = (
                f"Before I diagnose, confirm the equipment: **{candidate}** "
                f"(confidence {confidence_pct}%). "
                "Reply 'yes' to confirm, or tell me the correct manufacturer and model."
            )
            ctx["pending_uns_confirm"] = {"candidate": candidate}
        else:
            prompt = (
                "Before I diagnose, I need to know the equipment. "
                "Tell me the manufacturer and model "
                "(e.g., 'Allen-Bradley PowerFlex 525')."
            )
            ctx["pending_uns_confirm"] = {"candidate": None}

        # Promote to AWAITING_UNS_CONFIRMATION so downstream code paths
        # (citation-compliance enforcement, telemetry, dialogue-state tracker)
        # can key off a single FSM state instead of inspecting context. The
        # response handler clears it back to IDLE on yes / no / fallthrough.
        state["state"] = "AWAITING_UNS_CONFIRMATION"
        state["context"] = ctx
        self._save_state(chat_id, state)
        self._record_exchange(chat_id, state, message, prompt)
        logger.info(
            "UNS_CONFIRM_REQUEST chat_id=%s candidate=%r confidence=%.2f demo_match=%s",
            chat_id,
            candidate,
            (demo_match.confidence if demo_match else (getattr(uns_ctx, "confidence", 0.0) or 0.0)),
            bool(demo_match),
        )
        return self._make_result(
            prompt,
            "high",
            trace_id,
            state["state"],
            dispatch_kind="uns_confirm_request",
        )

    async def _handle_uns_confirmation_response(
        self,
        chat_id: str,
        message: str,
        state: dict,
        trace_id,
    ):
        """Consume the user's reply to a pending UNS confirmation prompt.

        Returns a result dict on explicit yes/no, or None to signal fall-through
        (user typed equipment specs — let the normal flow re-run the UNS resolver).
        """
        ctx = state.get("context") or {}
        pending = ctx.get("pending_uns_confirm") or {}
        candidate = pending.get("candidate")
        msg = (message or "").strip().lower()

        _YES = {"yes", "y", "yep", "yeah", "yup", "correct", "confirm", "confirmed"}
        _NO = {"no", "n", "nope", "wrong", "incorrect"}

        if msg in _YES and candidate:
            state["asset_identified"] = candidate
            # When the request came from the demo-namespace path, preserve
            # the asset_id / component_id under context["confirmed_namespace"]
            # so downstream retrieval can target the KG row directly instead
            # of fuzzy-matching on the label.
            demo_ns = pending.get("demo_namespace")
            if demo_ns:
                ctx["confirmed_namespace"] = demo_ns
            ctx.pop("pending_uns_confirm", None)
            # Side state cleared — normal IDLE→Q1/DIAGNOSIS flow resumes on
            # the next turn now that asset_identified is set.
            if state.get("state") == "AWAITING_UNS_CONFIRMATION":
                state["state"] = "IDLE"
            state["context"] = ctx
            self._save_state(chat_id, state)
            reply = (
                f"Got it — equipment is **{candidate}**. Now tell me what's happening "
                "(fault code, symptom, or what you're seeing)."
            )
            self._record_exchange(chat_id, state, message, reply)
            logger.info(
                "UNS_CONFIRM_YES chat_id=%s asset=%r confirmed_namespace=%s",
                chat_id,
                candidate,
                bool(demo_ns),
            )
            return self._make_result(
                reply,
                "high",
                trace_id,
                state.get("state", "IDLE"),
                dispatch_kind="uns_confirm_yes",
            )

        if msg in _NO:
            ctx.pop("pending_uns_confirm", None)
            if state.get("state") == "AWAITING_UNS_CONFIRMATION":
                state["state"] = "IDLE"
            state["context"] = ctx
            self._save_state(chat_id, state)
            reply = (
                "OK — tell me the correct manufacturer and model "
                "(e.g., 'Allen-Bradley PowerFlex 525')."
            )
            self._record_exchange(chat_id, state, message, reply)
            logger.info("UNS_CONFIRM_NO chat_id=%s", chat_id)
            return self._make_result(
                reply,
                "high",
                trace_id,
                state.get("state", "IDLE"),
                dispatch_kind="uns_confirm_no",
            )

        # User likely typed equipment specs or otherwise off-script. Drop
        # pending and let the normal flow run UNS resolver on the message.
        # Returning to IDLE lets the gate re-fire with new context on the
        # next turn if the user still hasn't given us enough.
        ctx.pop("pending_uns_confirm", None)
        if state.get("state") == "AWAITING_UNS_CONFIRMATION":
            state["state"] = "IDLE"
        state["context"] = ctx
        self._save_state(chat_id, state)
        logger.info("UNS_CONFIRM_FALLTHROUGH chat_id=%s msg=%r", chat_id, (message or "")[:80])
        return None
