"""Schematic intelligence pipeline (Phase 5 of KG multi-hop spec, #806).

Three passes over an electrical schematic image:

  1. classify         — IEC ladder / ANSI one-line / P&ID / wiring / panel
  2. detect_symbols   — list of {type, ref, position, terminals}
  3. trace_connections — adjacency list keyed off the detected symbols

Output is consumable by the mira-hub KG (see ``to_kg_payload``); persistence
itself happens TS-side via the ``/api/internal/kg`` endpoint so the DB
writer stays in one place.

Vision-LLM choice: per cluster law (Groq → Cerebras → Gemini, no
Anthropic), text classifiers cascade across providers. Gemini Flash is the
only vision-capable provider in the cascade today, so vision passes call
Gemini directly. If/when Groq or Cerebras add a vision-capable model the
``call_vision_llm`` callable can be swapped to a cascade.
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Optional

logger = logging.getLogger(__name__)

# ── Allowlists (validated against LLM output) ──────────────────────────────

SCHEMATIC_TYPES = (
    "iec_ladder",
    "ansi_one_line",
    "p_and_id",
    "wiring_diagram",
    "panel_layout",
    "unknown",
)

SYMBOL_TYPES = (
    "contactor",
    "overload",
    "fuse",
    "breaker",
    "motor",
    "plc_io",
    "sensor",
    "transformer",
    "relay",
    "timer",
    "indicator",
    "pushbutton",
    "selector",
    "terminal_block",
    "vfd",
    "disconnect",
)

# IEC 81346 reference designator pattern (K1, M1, Q1, OL1, KM2, etc.)
IEC_REF_RE = re.compile(r"^[A-Z]{1,3}\d{1,3}([:.-][A-Z0-9]+)?$")
# ANSI / NFPA 79 reference (looser: CR1, MTR-1, TD-1, Q0.0, etc.)
ANSI_REF_RE = re.compile(r"^[A-Z]{2,4}[-_]?\d{1,3}([./]\d{1,3})?$")


def _is_valid_ref(ref: str) -> bool:
    return bool(IEC_REF_RE.match(ref) or ANSI_REF_RE.match(ref))


# ── Data classes ──────────────────────────────────────────────────────────


@dataclass
class Symbol:
    type: str
    ref: str
    position: Optional[dict[str, float]] = None  # {"x": ..., "y": ...} normalized 0–1
    terminals: list[str] = field(default_factory=list)


@dataclass
class Connection:
    from_ref: str  # "K1:A1"
    to_ref: str  # "Q0.0:24V"
    wire_number: Optional[str] = None


@dataclass
class SchematicResult:
    schematic_type: str
    symbols: list[Symbol]
    connections: list[Connection]
    notes: list[str] = field(default_factory=list)


# ── Prompts ───────────────────────────────────────────────────────────────

CLASSIFY_PROMPT = (
    "Classify this electrical drawing as exactly one of: "
    + ", ".join(SCHEMATIC_TYPES)
    + '. Return JSON {"schematic_type":"...","confidence":0.0}. '
    "iec_ladder = vertical rungs with IEC 60617 symbols. "
    "ansi_one_line = horizontal one-line with NFPA 79 symbols. "
    "Use unknown if you cannot tell."
)


def detect_symbols_prompt(schematic_type: str) -> str:
    standard = "IEC 60617" if schematic_type == "iec_ladder" else "ANSI / NFPA 79"
    return (
        f"Identify every electrical symbol in this {standard} drawing. "
        'Return JSON {"symbols":[{"type":"contactor","ref":"K1",'
        '"position":{"x":0.4,"y":0.2},"terminals":["A1","A2"]}]}. '
        "type must be one of: " + ", ".join(SYMBOL_TYPES) + ". "
        "ref is the reference designator visible in the drawing (K1, M1, OL1, Q0.0, etc.). "
        "position is normalized 0–1. terminals lists the labeled terminal points."
    )


def trace_connections_prompt(symbols: list[Symbol]) -> str:
    refs = ", ".join(s.ref for s in symbols)
    return (
        "Trace every wired connection between the symbols below. "
        f"Symbols available: {refs}. "
        'Return JSON {"connections":[{"from":"K1:A1","to":"Q0.0:24V",'
        '"wire_number":"100"}]}. '
        "from and to MUST be of the form REF:TERMINAL where REF is in the symbol "
        "list above. wire_number is the visible wire label (or null)."
    )


# ── LLM-call seam ─────────────────────────────────────────────────────────

VisionCallable = Callable[[str, bytes, dict[str, Any]], Optional[str]]


def gemini_vision(prompt: str, image_bytes: bytes, opts: dict[str, Any]) -> Optional[str]:
    """Default vision call: Gemini via the OpenAI-compatible endpoint.

    Returns the raw response content on success, ``None`` on failure.
    Caller validates / parses. Swap this callable to fall through more
    providers when a vision-capable Groq or Cerebras model exists.
    """
    import base64

    import httpx

    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        logger.warning("schematic-intel: GEMINI_API_KEY unset; vision pass skipped")
        return None

    model = opts.get("model") or os.environ.get("GEMINI_VISION_MODEL", "gemini-2.5-flash")
    timeout = opts.get("timeout_s", 30.0)

    b64 = base64.b64encode(image_bytes).decode("ascii")
    body = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{b64}"},
                    },
                ],
            }
        ],
        "max_tokens": opts.get("max_tokens", 1500),
        "temperature": 0.0,
        "response_format": {"type": "json_object"},
    }
    try:
        resp = httpx.post(
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            json=body,
            timeout=timeout,
        )
        if resp.status_code != 200:
            logger.warning("schematic-intel: vision HTTP %s: %s", resp.status_code, resp.text[:200])
            return None
        data = resp.json()
        return data.get("choices", [{}])[0].get("message", {}).get("content")
    except Exception as exc:
        logger.warning("schematic-intel: vision call failed: %s", exc)
        return None


# ── Parsers / validators ──────────────────────────────────────────────────


def parse_classification(raw: str) -> str:
    """Return one of SCHEMATIC_TYPES; falls back to ``unknown``."""
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return "unknown"
    candidate = data.get("schematic_type") if isinstance(data, dict) else None
    if isinstance(candidate, str) and candidate in SCHEMATIC_TYPES:
        return candidate
    return "unknown"


def parse_symbols(raw: str) -> list[Symbol]:
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []
    items = data.get("symbols") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []
    out: list[Symbol] = []
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        sym_type = item.get("type")
        ref = item.get("ref")
        if not (isinstance(sym_type, str) and sym_type in SYMBOL_TYPES):
            continue
        if not (isinstance(ref, str) and _is_valid_ref(ref)):
            continue
        if ref in seen:
            continue
        seen.add(ref)
        position = item.get("position") if isinstance(item.get("position"), dict) else None
        terminals_raw = item.get("terminals") or []
        terminals = [t for t in terminals_raw if isinstance(t, str)]
        out.append(Symbol(type=sym_type, ref=ref, position=position, terminals=terminals))
    return out


def parse_connections(raw: str, symbol_refs: Iterable[str]) -> list[Connection]:
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []
    items = data.get("connections") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []
    refs = set(symbol_refs)
    out: list[Connection] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        f = item.get("from")
        t = item.get("to")
        if not (isinstance(f, str) and isinstance(t, str)):
            continue
        f_ref = f.split(":", 1)[0]
        t_ref = t.split(":", 1)[0]
        if f_ref not in refs or t_ref not in refs:
            continue
        if f == t:
            continue
        wn = item.get("wire_number")
        wire = wn if isinstance(wn, str) else None
        out.append(Connection(from_ref=f, to_ref=t, wire_number=wire))
    return out


# ── Pipeline orchestrator ─────────────────────────────────────────────────


def run_schematic_pipeline(
    image_bytes: bytes,
    *,
    vision_call: VisionCallable = gemini_vision,
    opts: Optional[dict[str, Any]] = None,
) -> SchematicResult:
    opts = opts or {}
    notes: list[str] = []

    # Pass 1 — classify
    raw1 = vision_call(CLASSIFY_PROMPT, image_bytes, opts)
    schematic_type = parse_classification(raw1) if raw1 else "unknown"
    if schematic_type == "unknown":
        notes.append("classification fell back to unknown")

    # Pass 2 — detect symbols
    raw2 = vision_call(detect_symbols_prompt(schematic_type), image_bytes, opts)
    symbols = parse_symbols(raw2) if raw2 else []
    if not symbols:
        notes.append("no symbols detected")
        return SchematicResult(
            schematic_type=schematic_type, symbols=[], connections=[], notes=notes
        )

    # Pass 3 — trace connections (only when we have ≥2 symbols)
    connections: list[Connection] = []
    if len(symbols) >= 2:
        raw3 = vision_call(trace_connections_prompt(symbols), image_bytes, opts)
        connections = parse_connections(raw3, [s.ref for s in symbols]) if raw3 else []

    return SchematicResult(
        schematic_type=schematic_type,
        symbols=symbols,
        connections=connections,
        notes=notes,
    )


# ── KG payload (consumed by the TS-side persister) ────────────────────────


def to_kg_payload(
    result: SchematicResult,
    *,
    parent_equipment_id: Optional[str] = None,
    drawing_ref: Optional[str] = None,
) -> dict[str, Any]:
    """Convert a SchematicResult into the JSON shape expected by the
    /api/internal/kg endpoint's ``schematic_upsert`` op.

    Each symbol becomes an electrical_component entity. Each connection
    becomes an electrically_connected relationship. Controller-coil pairs
    (contactor → motor) and overload-protector pairs (overload → motor)
    additionally emit ``controls`` and ``protects`` semantic edges.
    """
    entities: list[dict[str, Any]] = []
    relationships: list[dict[str, Any]] = []

    refs_by_type: dict[str, list[str]] = {}
    for sym in result.symbols:
        entities.append(
            {
                "entity_type": "electrical_component",
                "entity_id": sym.ref,
                "name": sym.ref,
                "properties": {
                    "subtype": sym.type,
                    "terminals": sym.terminals,
                    "position": sym.position,
                    "drawing_ref": drawing_ref,
                    "parent_equipment_id": parent_equipment_id,
                },
            }
        )
        refs_by_type.setdefault(sym.type, []).append(sym.ref)

    for conn in result.connections:
        relationships.append(
            {
                "source_entity_id": conn.from_ref.split(":", 1)[0],
                "target_entity_id": conn.to_ref.split(":", 1)[0],
                "relationship_type": "electrically_connected",
                "properties": {
                    "from_terminal": conn.from_ref,
                    "to_terminal": conn.to_ref,
                    "wire_number": conn.wire_number,
                },
            }
        )

    # Semantic inferences: contactors control motors, overloads protect motors.
    motors = refs_by_type.get("motor", [])
    for ctor in refs_by_type.get("contactor", []):
        for motor in motors:
            relationships.append(
                {
                    "source_entity_id": ctor,
                    "target_entity_id": motor,
                    "relationship_type": "controls",
                    "properties": {"derived": True},
                }
            )
    for ol in refs_by_type.get("overload", []):
        for motor in motors:
            relationships.append(
                {
                    "source_entity_id": ol,
                    "target_entity_id": motor,
                    "relationship_type": "protects",
                    "properties": {"derived": True},
                }
            )

    return {
        "schematic_type": result.schematic_type,
        "entities": entities,
        "relationships": relationships,
        "notes": result.notes,
        "parent_equipment_id": parent_equipment_id,
    }
