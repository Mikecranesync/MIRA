#!/usr/bin/env python3
"""Component Template Builder — extract a component_templates row from KB chunks.

Spec: docs/specs/mira-component-intelligence-architecture.md (Step 4)

Pipeline:
  1. Search knowledge_entries for chunks matching manufacturer + model.
  2. Send the chunks to Groq (with Cerebras fallback) using a structured-
     extraction prompt — mirrors the cascade order in
     mira-bots/shared/inference/router.py.
  3. Parse the JSON response into the component_templates schema.
  4. Print (default) or insert into NeonDB with --commit.

First proof:
  doppler run --project factorylm --config prd -- \\
    python3 tools/build_component_template.py \\
      --manufacturer AutomationDirect --model GS10 \\
      --category vfd --type variable_frequency_drive

Run with --commit to actually insert into NeonDB.

Why a local cascade instead of importing the bot router: the mira-bots package
has subdirs that shadow stdlib names (email/, agents/), which breaks Python
path insertion. The cascade is two providers in this tool; splitting it out is
cheaper than restructuring mira-bots.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import uuid
from typing import Any

import httpx

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("build-component-template")


# ---------- KB lookup --------------------------------------------------------

def _engine():
    """NeonDB engine — NullPool because Neon's PgBouncer handles pooling."""
    from sqlalchemy import create_engine
    from sqlalchemy.pool import NullPool

    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        raise RuntimeError("NEON_DATABASE_URL not set — run under `doppler run`")
    return create_engine(
        url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )


def fetch_chunks(manufacturer: str, model: str, limit: int = 40) -> list[dict[str, Any]]:
    """Pull KB chunks that mention manufacturer + model.

    Uses ILIKE against `content` — keyword match, not vector. For a focused
    "give me everything about GS10 from AutomationDirect" lookup this is enough
    and stays explainable. A future iteration can stack vector recall on top.
    """
    from sqlalchemy import text

    sql = text(
        """
        SELECT id, content, source_type, metadata, created_at
        FROM knowledge_entries
        WHERE content ILIKE :mfr_pat AND content ILIKE :model_pat
        ORDER BY length(content) DESC
        LIMIT :limit
        """
    )
    with _engine().connect() as conn:
        rows = (
            conn.execute(
                sql,
                {
                    "mfr_pat": f"%{manufacturer}%",
                    "model_pat": f"%{model}%",
                    "limit": limit,
                },
            )
            .mappings()
            .fetchall()
        )
    return [dict(r) for r in rows]


# ---------- LLM extraction ---------------------------------------------------

_EXTRACTION_SYSTEM_PROMPT = """You are an industrial component-spec extractor.

Read the provided manual/datasheet chunks and return a SINGLE JSON object that
fits the MIRA component_templates schema. Be conservative — only populate fields
you can ground in the chunks. Leave a field empty (null, [], or {}) when the
chunks do not support it.

Output ONLY valid JSON, no prose, no markdown fences."""


_EXTRACTION_USER_TEMPLATE = """Manufacturer: {manufacturer}
Model: {model}
Category: {category}
Type: {component_type}

Source chunks (each is a manual/datasheet excerpt):
---
{chunks}
---

Return JSON with this exact shape:
{{
  "description": "<one-paragraph plain-English summary>",
  "power_specs": {{ "input_voltage": "...", "phase": "...", "amperage": "...", "frequency_range": "..." }},
  "input_output_specs": {{ "analog_inputs": [...], "digital_inputs": [...], "outputs": [...] }},
  "signal_behavior": {{ "normal": "...", "fault_states": [...], "response_time": "..." }},
  "connector_type": "<string or null>",
  "pinout": {{ "<pin_name>": "<function>", ... }},
  "environmental_limits": {{ "temp_c": "...", "humidity": "...", "ip_rating": "...", "vibration": "..." }},
  "mounting_notes": "<string or null>",
  "diagnostic_indicators": [
    {{ "name": "RUN LED", "color": "green", "meaning_on": "...", "meaning_off": "...", "meaning_blink": "..." }}
  ],
  "expected_signals": [
    {{ "signal": "...", "normal_range": "...", "units": "..." }}
  ],
  "common_failure_modes": [
    {{ "name": "...", "symptom": "...", "root_cause": "...", "severity": "low|medium|high|safety_critical" }}
  ],
  "troubleshooting_steps": [
    {{ "step": 1, "action": "...", "expected_result": "..." }}
  ],
  "pm_checks": [
    {{ "interval": "monthly|quarterly|annually", "task": "...", "tools_required": [...] }}
  ],
  "safety_notes": [
    {{ "hazard": "arc_flash|loto|electrical|stored_energy|...", "note": "..." }}
  ],
  "recommended_uns_template": "enterprise.kb.<mfr_lowercase>.<family>.<model_lowercase>"
}}"""


# Mirrors mira-bots/shared/inference/router.py provider config. Same order:
# Groq → Cerebras. (Gemini omitted — the openai-compat shim diverges and adds
# complexity this tool doesn't need. Add it back if both Groq and Cerebras fail
# in practice.)
_CASCADE_PROVIDERS = [
    {
        "name": "groq",
        "key_env": "GROQ_API_KEY",
        "base_url": "https://api.groq.com/openai/v1",
        "model_env": "GROQ_MODEL",
        "model_default": "llama-3.3-70b-versatile",
    },
    {
        "name": "cerebras",
        "key_env": "CEREBRAS_API_KEY",
        "base_url": "https://api.cerebras.ai/v1",
        "model_env": "CEREBRAS_MODEL",
        "model_default": "llama3.1-8b",
    },
]


async def _call_one_provider(
    provider: dict[str, str],
    messages: list[dict[str, Any]],
    max_tokens: int,
) -> str:
    api_key = os.environ.get(provider["key_env"], "")
    if not api_key:
        raise RuntimeError(f"{provider['key_env']} not set")
    model = os.environ.get(provider["model_env"], provider["model_default"])
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            f"{provider['base_url']}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": 0.1,
                "response_format": {"type": "json_object"},
            },
        )
        resp.raise_for_status()
        data = resp.json()
    return data["choices"][0]["message"]["content"]


async def extract_template(
    manufacturer: str,
    model: str,
    category: str,
    component_type: str,
    chunks: list[dict[str, Any]],
    max_tokens: int = 4096,
) -> dict[str, Any]:
    """Try Groq, fall through to Cerebras. Return parsed JSON."""
    if not chunks:
        raise RuntimeError(
            f"No KB chunks found for {manufacturer} {model} — ingest the manual first"
        )

    # Trim chunk bodies so the whole prompt fits — keep the largest informative
    # slice from each row. Manuals frequently have 8-12KB chunks; cap at 2KB so
    # we can fit ~10 chunks under typical 32K context budgets.
    chunk_text = "\n\n---\n\n".join(
        f"[chunk {i + 1} | source={r.get('source_type', '?')}]\n{(r.get('content') or '')[:2000]}"
        for i, r in enumerate(chunks[:10])
    )

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": _EXTRACTION_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": _EXTRACTION_USER_TEMPLATE.format(
                manufacturer=manufacturer,
                model=model,
                category=category,
                component_type=component_type,
                chunks=chunk_text,
            ),
        },
    ]

    content = ""
    last_error: Exception | None = None
    for provider in _CASCADE_PROVIDERS:
        if not os.environ.get(provider["key_env"]):
            continue
        try:
            content = await _call_one_provider(provider, messages, max_tokens)
            log.info("Extraction ok via %s", provider["name"])
            break
        except Exception as e:
            log.warning("Provider %s failed: %s — trying next", provider["name"], e)
            last_error = e

    if not content:
        raise RuntimeError(f"All providers exhausted — last error: {last_error}")

    # Strip code fences if a provider added them despite the "no markdown" instruction.
    cleaned = content.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```", 2)[1]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
        cleaned = cleaned.rsplit("```", 1)[0].strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"LLM returned invalid JSON: {e}\n\n{cleaned[:500]}") from e


# ---------- DB insert --------------------------------------------------------

def insert_template(
    extracted: dict[str, Any],
    manufacturer: str,
    model: str,
    category: str,
    component_type: str,
    chunks: list[dict[str, Any]],
) -> str:
    """Insert into component_templates + component_template_sources. Returns template id."""
    from sqlalchemy import text

    template_id = str(uuid.uuid4())

    with _engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO component_templates (
                    id, component_category, component_type, manufacturer, model, description,
                    power_specs, input_output_specs, signal_behavior, connector_type, pinout,
                    environmental_limits, mounting_notes, diagnostic_indicators, expected_signals,
                    common_failure_modes, troubleshooting_steps, pm_checks, safety_notes,
                    recommended_uns_template, verification_status, version
                ) VALUES (
                    :id, :cat, :type, :mfr, :model, :description,
                    :power, :io, :signal, :connector, :pinout,
                    :env, :mounting, :indicators, :signals,
                    :failures, :troubleshooting, :pm, :safety,
                    :uns, 'proposed', 1
                )
                """
            ),
            {
                "id": template_id,
                "cat": category,
                "type": component_type,
                "mfr": manufacturer,
                "model": model,
                "description": extracted.get("description"),
                "power": json.dumps(extracted.get("power_specs", {})),
                "io": json.dumps(extracted.get("input_output_specs", {})),
                "signal": json.dumps(extracted.get("signal_behavior", {})),
                "connector": extracted.get("connector_type"),
                "pinout": json.dumps(extracted.get("pinout", {})),
                "env": json.dumps(extracted.get("environmental_limits", {})),
                "mounting": extracted.get("mounting_notes"),
                "indicators": json.dumps(extracted.get("diagnostic_indicators", [])),
                "signals": json.dumps(extracted.get("expected_signals", [])),
                "failures": json.dumps(extracted.get("common_failure_modes", [])),
                "troubleshooting": json.dumps(extracted.get("troubleshooting_steps", [])),
                "pm": json.dumps(extracted.get("pm_checks", [])),
                "safety": json.dumps(extracted.get("safety_notes", [])),
                "uns": extracted.get("recommended_uns_template"),
            },
        )

        for chunk in chunks[:10]:
            conn.execute(
                text(
                    """
                    INSERT INTO component_template_sources (
                        template_id, source_type, source_document_id, excerpt,
                        extraction_confidence, extracted_by
                    ) VALUES (
                        :tid, :stype, :sdoc, :excerpt, :conf, 'llm'
                    )
                    """
                ),
                {
                    "tid": template_id,
                    "stype": chunk.get("source_type") or "manual",
                    "sdoc": chunk.get("id"),
                    "excerpt": (chunk.get("content") or "")[:500],
                    "conf": 0.55,  # single-chunk LLM extraction baseline
                },
            )

    return template_id


# ---------- CLI --------------------------------------------------------------

async def amain(args: argparse.Namespace) -> int:
    chunks = fetch_chunks(args.manufacturer, args.model, args.chunk_limit)
    log.info("Found %d KB chunks for %s %s", len(chunks), args.manufacturer, args.model)
    if not chunks:
        log.error("No KB chunks — ingest the manual first, then retry.")
        return 2

    extracted = await extract_template(
        args.manufacturer, args.model, args.category, args.type, chunks
    )

    print(json.dumps(extracted, indent=2))

    if args.commit:
        tid = insert_template(
            extracted, args.manufacturer, args.model, args.category, args.type, chunks
        )
        log.info("Inserted template %s", tid)
        print(f"\n→ Inserted as component_templates.id = {tid}")
    else:
        log.info("Dry run — pass --commit to insert into NeonDB.")

    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--manufacturer", required=True)
    p.add_argument("--model", required=True)
    p.add_argument("--category", required=True, help="sensor, vfd, motor, contactor, plc, ...")
    p.add_argument("--type", required=True, help="proximity_sensor, variable_frequency_drive, ...")
    p.add_argument("--chunk-limit", type=int, default=40)
    p.add_argument("--commit", action="store_true", help="Insert into NeonDB (default: dry run)")
    args = p.parse_args()

    return asyncio.run(amain(args))


if __name__ == "__main__":
    sys.exit(main())
