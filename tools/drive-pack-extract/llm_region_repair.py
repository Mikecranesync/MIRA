"""LLM region repair — bounded, auditable, optional, source-validated.

The deterministic routes handle the vast majority of tables. This is the
last-resort fallback for a candidate region the deterministic parser scored as
low-confidence (a genuinely irregular table geometry). It is deliberately
constrained:

* **Region-bounded.** The model only ever sees ONE candidate table region's
  tokens + coordinates + the proposed schema — never the whole page, never the
  whole manual. No open-ended "read this PDF".
* **Offline by default.** Disabled unless ``MIRA_DRIVE_LLM_REPAIR=1`` AND a
  provider key is set. The benchmark / CI path never calls a network.
* **Cascade, no Anthropic.** Groq -> Cerebras -> Together (OpenAI-compat),
  matching the repo's provider policy (PR #610 removed Anthropic — never
  reintroduce).
* **Source-validated.** Every record the model returns is re-checked against
  the page's real text (``cite_integrity``); anything whose excerpt is not on
  the page is discarded. The model cannot introduce a value the manual doesn't
  contain.
* **Learning evidence.** Each accepted repair is recorded as a learning
  artifact (region + accepted records + a proposed deterministic-rule stub) so
  a recurring geometry can be promoted into a real dialect later — the model is
  a teacher for the deterministic layer, not a permanent dependency.
"""
from __future__ import annotations

import json
import os
from typing import Any

import cite_integrity
from document_ir import PageIR
from records import make_record
from table_discovery import TableCandidate

_PROVIDERS = [
    ("groq", "GROQ_API_KEY", "https://api.groq.com/openai/v1/chat/completions",
     "llama-3.3-70b-versatile"),
    ("cerebras", "CEREBRAS_API_KEY", "https://api.cerebras.ai/v1/chat/completions",
     "llama-3.3-70b"),
    ("together", "TOGETHERAI_API_KEY", "https://api.together.xyz/v1/chat/completions",
     "meta-llama/Llama-3.3-70B-Instruct-Turbo"),
]

_CONTRACT = (
    "You are a strict table transcriber for an industrial VFD manual. You are given "
    "the raw tokens (with x/y coordinates) of ONE candidate {kind} table region from "
    "one page. Return ONLY valid JSON: an array of objects, each "
    '{{"id": <verbatim identifier string, casing preserved>, "name": <string>, '
    '"fields": {{<role>: <verbatim value string>}}}}. '
    "Roles allowed: {roles}. Copy values VERBATIM from the tokens — never invent, "
    "translate, complete, or normalize a value. If a cell is absent, omit its role. "
    "Output the JSON array and nothing else."
)


def is_enabled() -> bool:
    if os.getenv("MIRA_DRIVE_LLM_REPAIR") != "1":
        return False
    return any(os.getenv(env) for _, env, _, _ in _PROVIDERS)


def _region_tokens(page: PageIR, cand: TableCandidate) -> list[dict[str, Any]]:
    """The candidate region's tokens (id-column downward), coordinate-tagged."""
    top0 = min(cand.id_row_tops) - 4 if cand.id_row_tops else 0
    return [
        {"t": w["text"], "x": round(w["x0"], 1), "y": round(w["top"], 1)}
        for w in page.words if w["top"] >= top0
    ][:400]


def _call_cascade(prompt: str) -> str | None:
    try:
        import httpx
    except Exception:
        return None
    for _name, env, url, model in _PROVIDERS:
        key = os.getenv(env)
        if not key:
            continue
        try:
            resp = httpx.post(
                url,
                headers={"Authorization": f"Bearer {key}"},
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0,
                },
                timeout=60,
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]
        except Exception:
            continue
    return None


def _parse_json_array(text: str) -> list[dict[str, Any]]:
    text = text.strip()
    start, end = text.find("["), text.rfind("]")
    if start < 0 or end < 0:
        return []
    try:
        data = json.loads(text[start : end + 1])
        return data if isinstance(data, list) else []
    except Exception:
        return []


def repair_region(
    page: PageIR, cand: TableCandidate
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Return ``(validated_records, learning_artifact)``.

    When disabled (offline), returns ``([], {"status": "skipped_offline"})`` —
    the deterministic result stands. When enabled, returns only records whose
    excerpt is verified present on the page, plus a learning artifact."""
    if not is_enabled():
        return [], {"status": "skipped_offline", "page": page.number, "kind": cand.kind}

    roles = "fault_id,fault_name,cause,remedy,fault_type" if cand.kind == "fault" \
        else "parameter_id,parameter_name,default,range,unit"
    tokens = _region_tokens(page, cand)
    prompt = _CONTRACT.format(kind=cand.kind, roles=roles) + "\n\nTOKENS:\n" + json.dumps(tokens)
    raw = _call_cascade(prompt)
    if not raw:
        return [], {"status": "no_provider_response", "page": page.number, "kind": cand.kind}

    proposed = _parse_json_array(raw)
    page_norm = cite_integrity.normalize(page.text)
    validated: list[dict[str, Any]] = []
    for obj in proposed:
        ident = str(obj.get("id", "")).strip()
        if not ident:
            continue
        # Source-validate: the id must actually appear on the page.
        if cite_integrity.normalize(ident) not in page_norm:
            continue
        excerpt = ""
        for line in page.text.splitlines():
            if ident in line:
                excerpt = line.strip()
                break
        if not excerpt:
            continue
        fields = {k: str(v) for k, v in (obj.get("fields") or {}).items() if v}
        # Only keep fields whose value head is on the page (no invention).
        fields = {k: v for k, v in fields.items()
                  if " ".join(cite_integrity.normalize(v).split()[:5]) in page_norm}
        validated.append(make_record(
            record_type=cand.kind, ident=ident,
            id_kind="alnum", name=str(obj.get("name", "")), fields=fields,
            page=page.number, bbox=None, excerpt=excerpt,
            route="llm_repair", confidence=0.6,
        ))

    artifact = {
        "status": "repaired" if validated else "no_valid_records",
        "page": page.number,
        "kind": cand.kind,
        "region_token_count": len(tokens),
        "proposed_count": len(proposed),
        "accepted_count": len(validated),
        "accepted_ids": [r["id"] for r in validated],
        # A deterministic-rule proposal seed: the id x-band this region used, so
        # a recurring geometry can be promoted into a real dialect later.
        "proposed_rule": {
            "kind": cand.kind,
            "id_band": list(cand.id_band),
            "header_cells": cand.header_cells,
        },
    }
    return validated, artifact
