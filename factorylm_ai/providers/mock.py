"""Deterministic fixture provider — the CI backbone of the model lab.

ZTA role: every test, every ``proofpack --experiment ... `` dry-run, and every
default ``get_provider()`` call in CI runs against this provider. It NEVER
touches the network, costs $0, and returns the SAME output for the SAME
input every time (same sha256(task_id + first 2000 chars of the serialized
messages) -> same canned variant). This is what makes the lab's tests and
proofpack scoring reproducible without a live model call. Real quality
signal comes only from ``--live`` runs against ``together.py``, budget-capped
and human-reviewed — this module is scaffolding, not a quality oracle.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from typing import Any

from .base import ModelProvider, ModelRequest, ModelResponse

logger = logging.getLogger("factorylm-ai")

_EMBED_DIM = 8
_M09_DEFAULT_TOOL = "search_print_pages"
_TAG_RE = re.compile(r"\b[A-Z]{1,4}\d{1,4}\b")
_NO_EVIDENCE_RE = re.compile(r'"evidence"\s*:\s*\[\s*\]')

# ---------------------------------------------------------------------------
# M01 — vision intake: hash-selected canned variants (contract §F).
# ---------------------------------------------------------------------------
_M01_VARIANTS: list[dict[str, Any]] = [
    {
        "image_type": "electrical_print",
        "readability": "usable",
        "visible_text": ["K1", "X4"],
        "candidate_devices": ["K1"],
        "recommended_next_action": "route_to_printsense",
    },
    {
        "image_type": "nameplate",
        "readability": "usable",
        "visible_text": ["POWERFLEX 525", "SN 4471"],
        "candidate_devices": ["PowerFlex 525"],
        "recommended_next_action": "route_to_printsense",
    },
    {
        "image_type": "unknown",
        "readability": "unreadable",
        "visible_text": [],
        "candidate_devices": [],
        "recommended_next_action": "ask_for_closeup",
    },
]

# ---------------------------------------------------------------------------
# M03 — print region extract: hash-selected canned variants (contract §F).
# ---------------------------------------------------------------------------
_M03_VARIANTS: list[dict[str, Any]] = [
    {
        "devices": [{"tag": "K1", "kind": "relay_coil"}],
        "terminals": [{"device": "K1", "terminal": "A1"}],
        "wires": [{"from": "K1:A1", "to": "X4:17", "number": "51"}],
        "cross_refs": [{"from_sheet": "6", "ref": "2.5"}],
        "confidence": 0.6,
    },
    {
        "devices": [{"tag": "F1", "kind": "fuse"}],
        "terminals": [{"device": "F1", "terminal": "1"}],
        "wires": [{"from": "F1:1", "to": "X3:9", "number": "12"}],
        "cross_refs": [{"from_sheet": "3", "ref": "15.7"}],
        "confidence": 0.7,
    },
    {
        "devices": [],
        "terminals": [],
        "wires": [],
        "cross_refs": [],
        "confidence": 0.2,
    },
]

# ---------------------------------------------------------------------------
# M05 — intent router: keyword map (contract §F), NOT hash-selected. Order is
# priority order — the first keyword group that matches wins.
# ---------------------------------------------------------------------------
_M05_KEYWORD_ROUTES: list[tuple[tuple[str, ...], str]] = [
    (("print", "drawing", "wiring"), "printsense_photo"),
    (("fault", "drive", "vfd"), "drive_fault_photo"),
    (("pdf", "manual", "package"), "full_pdf_package"),
    (("prd", "spec"), "prd_request"),
    (("prompt", "claude"), "code_prompt_request"),
    (("wrong", "incorrect", "actually"), "feedback_event"),
]
_M05_NEXT_STEP: dict[str, str] = {
    "printsense_photo": "classify_image",
    "drive_fault_photo": "classify_image",
    "full_pdf_package": "extract_pdf_package",
    "prd_request": "draft_prd",
    "code_prompt_request": "generate_code_prompt",
    "feedback_event": "log_feedback_event",
    "unknown": "ask_clarifying_question",
}

# ---------------------------------------------------------------------------
# M10 — answer contract: hash-selected canned variants, overridden by a
# content-triggered refusal variant (contract §F).
# ---------------------------------------------------------------------------
_M10_VARIANTS: list[dict[str, Any]] = [
    {
        "direct_answer": "K1 is shown on sheet 6.",
        "shown_on_drawing": ["K1 coil at D1"],
        "derived_from_drawing": [],
        "technician_confirmed": [],
        "not_proven": [],
        "evidence": [{"kind": "ocr", "ref": "K1"}],
        "overlay_geometry": [],
        "next_checks": ["verify at the panel"],
        "safety_notes": [],
    },
    {
        "direct_answer": "X4 terminal 17 carries wire 51 from K1:A1.",
        "shown_on_drawing": ["wire 51 from K1:A1 to X4:17"],
        "derived_from_drawing": ["K1 is energized when wire 51 is live"],
        "technician_confirmed": [],
        "not_proven": [],
        "evidence": [{"kind": "ocr", "ref": "X4:17"}],
        "overlay_geometry": [],
        "next_checks": ["verify continuity at X4:17"],
        "safety_notes": ["de-energize before probing X4:17"],
    },
]


def _message_text(messages: list[dict[str, Any]]) -> str:
    """Flatten OpenAI-compat message content (str or text blocks) to plain text."""
    parts: list[str] = []
    for msg in messages:
        content = msg.get("content")
        if isinstance(content, str):
            parts.append(content)
        elif isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    parts.append(str(block.get("text", "")))
    return "\n".join(parts)


def _last_user_text(messages: list[dict[str, Any]]) -> str | None:
    for msg in reversed(messages):
        if msg.get("role") != "user":
            continue
        content = msg.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            texts = [
                str(b.get("text", ""))
                for b in content
                if isinstance(b, dict) and b.get("type") == "text"
            ]
            if texts:
                return "\n".join(texts)
    return None


def _hash_key(task_id: str, messages: list[dict[str, Any]]) -> str:
    """sha256(task_id + first 2000 chars of the serialized messages)."""
    serialized = json.dumps(messages, sort_keys=True, default=str)
    basis = f"{task_id}:{serialized[:2000]}"
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()


def _variant_index(task_id: str, messages: list[dict[str, Any]], variant_count: int) -> int:
    if variant_count <= 0:
        return 0
    digest = _hash_key(task_id, messages)
    return int(digest[:8], 16) % variant_count


def _deterministic_vector(text: str) -> list[float]:
    """8-dim deterministic embedding derived from sha256(text)."""
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    return [(b / 127.5) - 1.0 for b in digest[:_EMBED_DIM]]


def _deterministic_score(query: str, document: str) -> float:
    digest = hashlib.sha256(f"{query}::{document}".encode("utf-8")).digest()
    return digest[0] / 255.0


def _route_intent(text: str) -> dict[str, Any]:
    lowered = text.lower()
    for keywords, route in _M05_KEYWORD_ROUTES:
        if any(k in lowered for k in keywords):
            return {
                "route": route,
                "confidence": 0.9,
                "required_next_step": _M05_NEXT_STEP[route],
                "should_ask_clarification": False,
            }
    return {
        "route": "unknown",
        "confidence": 0.3,
        "required_next_step": _M05_NEXT_STEP["unknown"],
        "should_ask_clarification": True,
    }


def _extract_query(text: str) -> str:
    match = _TAG_RE.search(text)
    if match:
        return match.group(0)
    words = text.split()
    return words[0] if words else "unknown"


def _select_tool_name(req: ModelRequest, text: str) -> str:
    names: list[str] = []
    for tool in req.tools or []:
        if not isinstance(tool, dict):
            continue
        fn = tool.get("function")
        name = fn.get("name") if isinstance(fn, dict) else tool.get("name")
        if name:
            names.append(str(name))
    lowered = text.lower()
    for name in names:
        if name.lower() in lowered:
            return name
    return names[0] if names else _M09_DEFAULT_TOOL


def _m09_output(req: ModelRequest, text: str) -> dict[str, Any]:
    tool_name = _select_tool_name(req, text)
    rationale = (
        "lookup before answering"
        if tool_name == _M09_DEFAULT_TOOL
        else f"selected {tool_name} based on case text"
    )
    return {
        "tool_calls": [{"name": tool_name, "arguments": {"query": _extract_query(text)}}],
        "rationale": rationale,
        "answered_from_memory": False,
    }


def _wants_refusal(text: str) -> bool:
    if _NO_EVIDENCE_RE.search(text):
        return True
    return "no evidence" in text.lower()


def _m10_refusal(claim: str) -> dict[str, Any]:
    return {
        "direct_answer": "I can't answer that from the provided evidence.",
        "shown_on_drawing": [],
        "derived_from_drawing": [],
        "technician_confirmed": [],
        "not_proven": [claim],
        "evidence": [],
        "overlay_geometry": [],
        "next_checks": ["gather more evidence before answering"],
        "safety_notes": [],
    }


def _m12_output(text: str) -> dict[str, Any]:
    verbatim = text.strip() or "(empty)"
    return {
        "record_type": "eval_case",
        "input": verbatim,
        "ideal_output": f"[mock-correction] {verbatim[:60]}",
        "tags": ["factorylm"],
        "sensitive": False,
        "needs_human_review": True,
    }


class MockProvider(ModelProvider):
    """Deterministic, free, network-free provider — the default everywhere.

    Every ``complete()`` call is a pure function of ``req``: no randomness,
    no wall clock, no I/O. ``estimated_cost_usd`` is always 0.0 and
    ``latency_ms`` is always 1.
    """

    name = "mock"

    def is_configured(self) -> bool:
        return True

    async def complete(self, req: ModelRequest) -> ModelResponse:
        logger.debug("mock.complete task=%s input_kind=%s", req.task_id, req.input_kind)
        if req.input_kind == "embedding":
            return self._complete_embedding(req)
        if req.input_kind == "rerank":
            return self._complete_rerank(req)
        return self._complete_chat(req)

    def _complete_chat(self, req: ModelRequest) -> ModelResponse:
        task = req.task_id.upper()
        text = _message_text(req.messages)

        if task == "M05":
            parsed = _route_intent(text)
        elif task == "M09":
            parsed = _m09_output(req, text)
        elif task == "M10":
            if _wants_refusal(text):
                parsed = _m10_refusal(_last_user_text(req.messages) or "the requested claim")
            else:
                idx = _variant_index(task, req.messages, len(_M10_VARIANTS))
                parsed = _M10_VARIANTS[idx]
        elif task == "M12":
            parsed = _m12_output(_last_user_text(req.messages) or text)
        elif task == "M01":
            idx = _variant_index(task, req.messages, len(_M01_VARIANTS))
            parsed = _M01_VARIANTS[idx]
        elif task == "M03":
            idx = _variant_index(task, req.messages, len(_M03_VARIANTS))
            parsed = _M03_VARIANTS[idx]
        else:
            # No canned fixture for this task id — still return a valid,
            # deterministic, schema-agnostic echo rather than raising, so an
            # unregistered task never crashes a dry run.
            parsed = {
                "task_id": req.task_id,
                "note": "no canned fixture for this task",
                "input_excerpt": text[:200],
            }

        serialized = json.dumps(parsed, sort_keys=True)
        return ModelResponse(
            text=serialized,
            parsed=parsed,
            tool_calls=None,
            embeddings=None,
            rerank_scores=None,
            model=req.model or f"mock/{task.lower()}",
            provider=self.name,
            input_tokens=max(1, len(text) // 4),
            output_tokens=max(1, len(serialized) // 4),
            latency_ms=1,
            estimated_cost_usd=0.0,
            raw={},
        )

    def _complete_embedding(self, req: ModelRequest) -> ModelResponse:
        inputs = req.embed_inputs or []
        embeddings = [_deterministic_vector(text) for text in inputs]
        total_chars = sum(len(t) for t in inputs)
        return ModelResponse(
            text=None,
            parsed=None,
            tool_calls=None,
            embeddings=embeddings,
            rerank_scores=None,
            model=req.model or "mock/embedding",
            provider=self.name,
            input_tokens=max(1, total_chars // 4),
            output_tokens=0,
            latency_ms=1,
            estimated_cost_usd=0.0,
            raw={},
        )

    def _complete_rerank(self, req: ModelRequest) -> ModelResponse:
        query = req.rerank_query or ""
        documents = req.rerank_documents or []
        raw_scores = [_deterministic_score(query, doc) for doc in documents]
        scores = sorted(raw_scores, reverse=True)
        total_chars = len(query) + sum(len(d) for d in documents)
        return ModelResponse(
            text=None,
            parsed=None,
            tool_calls=None,
            embeddings=None,
            rerank_scores=scores,
            model=req.model or "mock/rerank",
            provider=self.name,
            input_tokens=max(1, total_chars // 4),
            output_tokens=0,
            latency_ms=1,
            estimated_cost_usd=0.0,
            raw={},
        )
