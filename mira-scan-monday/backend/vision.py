from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

import httpx

from .models import AssetPlate

logger = logging.getLogger("mira-scan.vision")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
VISION_MODEL = os.getenv("VISION_MODEL", "gpt-4o")

EXTRACTION_PROMPT = """You are a precision OCR system for industrial equipment nameplates.
Read the nameplate in the image and return ONLY valid JSON matching this schema:

{
  "make": "manufacturer (e.g. Baldor, Siemens, ABB)",
  "model": "model / catalog number",
  "serial": "serial number or null",
  "voltage": "voltage rating with units (e.g. '460V') or null",
  "hp": "horsepower or kW (e.g. '5HP') or null",
  "rpm": "rated RPM or null",
  "hz": "frequency (e.g. '60Hz') or null",
  "frame": "NEMA / IEC frame size or null",
  "confidence": 0.0 to 1.0
}

Rules:
- Output ONLY the JSON object, no prose, no markdown fences.
- If a field is unreadable, use null (not an empty string).
- confidence reflects overall plate readability.
- Preserve units exactly as printed.
""".strip()


def _strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    return text.strip()


def _coerce(payload: dict[str, Any]) -> AssetPlate:
    def _str_or_none(v: Any) -> str | None:
        if v is None:
            return None
        s = str(v).strip()
        return s or None

    try:
        confidence = float(payload.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))

    return AssetPlate(
        make=str(payload.get("make") or "").strip(),
        model=str(payload.get("model") or "").strip(),
        serial=_str_or_none(payload.get("serial")),
        voltage=_str_or_none(payload.get("voltage")),
        hp=_str_or_none(payload.get("hp")),
        rpm=_str_or_none(payload.get("rpm")),
        hz=_str_or_none(payload.get("hz")),
        frame=_str_or_none(payload.get("frame")),
        confidence=confidence,
    )


async def extract_asset_plate(image_base64: str, mime_type: str = "image/jpeg") -> AssetPlate:
    if not OPENAI_API_KEY:
        logger.warning("OPENAI_API_KEY not set — returning empty AssetPlate")
        return AssetPlate(confidence=0.0)

    data_url = f"data:{mime_type};base64,{image_base64}"
    body = {
        "model": VISION_MODEL,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": EXTRACTION_PROMPT},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        ],
    }
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{OPENAI_BASE_URL}/chat/completions",
            headers=headers,
            json=body,
        )
        resp.raise_for_status()
        data = resp.json()

    content = data["choices"][0]["message"]["content"]
    cleaned = _strip_fences(content)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        logger.exception("Vision response was not valid JSON: %s", cleaned[:500])
        return AssetPlate(confidence=0.0)

    return _coerce(parsed)
