"""PrintSense interpretation — Anthropic Claude (multimodal) -> PrintSynth graph.

This is the "multimodal Claude interpretation -> strict typed JSON" stage of the
production pipeline. Claude reads the print image(s)/PDF and returns a
``PrintSynthGraph``; MIRA owns validation, evidence, persistence, and approval.

⚠️ **ISOLATED, owner-authorized Anthropic reintroduction (print-vision ONLY).**
Mike explicitly overrode the repo's No-Anthropic rule for the print interpreter
(2026-07-12). This module is the *only* place Anthropic is called. It is **NOT**
wired into ``mira-bots/shared/inference`` — the Groq -> Cerebras -> Together
free-tier cascade stays No-Anthropic. Gated on
``PRINT_VISION_PROVIDER=anthropic`` + ``ANTHROPIC_API_KEY`` (Doppler); inert
without the key. The ``anthropic`` SDK (MIT) is imported lazily, so this module
imports without it and tests mock the client.
"""

from __future__ import annotations

import base64
import json
import logging
import os

from .models import PrintSynthGraph

logger = logging.getLogger("printsense.interpret")

# Owner decision (2026-07-12): default to the latest, most-capable Claude model
# for print perception. Configurable, never silently downgraded for cost.
DEFAULT_MODEL = os.getenv("PRINT_VISION_MODEL", "claude-opus-4-8")
PROVIDER = os.getenv("PRINT_VISION_PROVIDER", "anthropic")
MAX_TOKENS = int(os.getenv("PRINT_VISION_MAX_TOKENS", "32000"))
EFFORT = os.getenv("PRINT_VISION_EFFORT", "high")

_SYSTEM = (
    "You are a senior industrial-controls engineer and maintenance electrician "
    "interpreting an electrical print (schematic, wiring diagram, PLC I/O map, "
    "terminal plan, or panel layout).\n\n"
    "Interpret EVERY observable electrical object and relationship into a typed "
    "PrintSynth graph: devices, terminals, conductors, cables, contacts, power "
    "domains, PE bonds, off-page/continuation references, PLC I/O channels, and "
    "industrial-network links. Read the title block (drawing number, cabinet, "
    "sheet). German terms: Versorgung=supply, Heizung=heater, Montageplatte="
    "mounting plate, Klixon=thermal switch, Klemme/Eingangsklemme/Ausgangsklemme="
    "terminal/input/output terminal.\n\n"
    "GROUNDING DOCTRINE (non-negotiable):\n"
    "- Ground every fact ONLY in what is visibly legible in the image. Use the "
    "printed designations verbatim.\n"
    "- NEVER invent a tag, terminal, rating, manufacturer model, cross-reference, "
    "contact logic, or connection. An unreadable/unclear item goes in "
    "`unresolved` with the specific issue and the crop/retake needed. "
    '"Unreadable" is a valid, superior result to a plausible guess.\n'
    "- Keep protective earth (PE) in `pe_bonds`, SEPARATE from current-carrying "
    "conductors — never mix PE into a line/neutral path.\n"
    "- Every entity carries `evidence` (what text/region supports it) and a "
    '`confidence` 0-1. Set `trust` to "proposed" on EVERYTHING (nothing is '
    "verified yet).\n"
    "- Distinguish visible fact from rule-derived inference; hedge inferences.\n\n"
    "OUTPUT: return ONLY a single JSON object that conforms to the PrintSynth "
    "schema below. No prose, no explanation, no markdown code fences — JSON only."
)


class PrintVisionUnavailable(RuntimeError):
    """The Anthropic print-vision provider is not configured (flag/key/SDK missing)."""


def _client():
    """Build the isolated Anthropic client, or raise PrintVisionUnavailable."""
    if PROVIDER != "anthropic":
        raise PrintVisionUnavailable(f"PRINT_VISION_PROVIDER={PROVIDER!r} is not 'anthropic'")
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise PrintVisionUnavailable("ANTHROPIC_API_KEY is not set (add it to Doppler)")
    try:
        import anthropic  # noqa: PLC0415 — lazy MIT SDK, isolated to this path
    except ImportError as exc:  # pragma: no cover
        raise PrintVisionUnavailable("the `anthropic` SDK is not installed") from exc
    return anthropic.Anthropic()


def _source_block(data: bytes, media_type: str) -> dict:
    b64 = base64.standard_b64encode(data).decode("ascii")
    src = {"type": "base64", "media_type": media_type, "data": b64}
    block_type = "document" if media_type == "application/pdf" else "image"
    return {"type": block_type, "source": src}


def _user_prompt(package_context: dict | None, question: str | None) -> str:
    schema = json.dumps(PrintSynthGraph.model_json_schema(), separators=(",", ":"))
    parts = [
        "Interpret this electrical print into a PrintSynth graph.",
        f"Package context (may be empty): {json.dumps(package_context or {})}",
        "Emit ONLY a single JSON object conforming to this JSON Schema:",
        schema,
    ]
    if question and question.strip():
        parts.append(
            f"The technician specifically asked: {question.strip()} — make sure the "
            "graph directly supports answering it, grounded only in the print."
        )
    return "\n\n".join(parts)


def _first_text(message) -> str:
    for block in message.content:
        if getattr(block, "type", None) == "text":
            return block.text
    raise ValueError("no text block in the Anthropic response")


def _strip_fences(raw: str) -> str:
    s = raw.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else s
        if s.endswith("```"):
            s = s.rsplit("```", 1)[0]
    return s.strip()


def interpret_print(
    pages: list[tuple[bytes, str]],
    *,
    package_context: dict | None = None,
    question: str | None = None,
    model: str = DEFAULT_MODEL,
) -> PrintSynthGraph:
    """Interpret one print (one or more page images/PDFs) into a validated graph.

    ``pages`` is a list of ``(bytes, media_type)`` — e.g.
    ``[(jpg_bytes, "image/jpeg")]`` or ``[(pdf_bytes, "application/pdf")]``.
    Every entity comes back ``trust="proposed"``. Raises
    :class:`PrintVisionUnavailable` when the provider isn't configured; Anthropic
    API errors propagate (the SDK auto-retries 429/5xx).
    """
    client = _client()
    content: list[dict] = [_source_block(data, mt) for data, mt in pages]
    content.append({"type": "text", "text": _user_prompt(package_context, question)})
    # Adaptive thinking + high effort for the hard perception task; stream because
    # a full package graph can exceed the non-streaming max_tokens timeout guard.
    with client.messages.stream(
        model=model,
        max_tokens=MAX_TOKENS,
        system=_SYSTEM,
        thinking={"type": "adaptive"},
        output_config={"effort": EFFORT},
        messages=[{"role": "user", "content": content}],
    ) as stream:
        message = stream.get_final_message()
    data = json.loads(_strip_fences(_first_text(message)))
    logger.info("PRINT_INTERPRETED model=%s devices=%d", model, len(data.get("devices") or []))
    return PrintSynthGraph.model_validate(data)
