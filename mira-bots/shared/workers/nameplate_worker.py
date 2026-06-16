"""Nameplate Worker — Vision-based extraction of equipment nameplate fields.

Sends a photo (base64-encoded JPEG) to the inference router or, on failure,
to a local Open WebUI vision model. Returns a structured dict of nameplate
fields: manufacturer, model, serial, voltage, fla, hp, frequency, rpm.

Missing fields are set to None; total parse failure returns {"parse_error": ...}.
"""

from __future__ import annotations

import json
import logging
import os
import re

import httpx

from ..inference.router import InferenceRouter as _InferenceRouter

logger = logging.getLogger("mira.nameplate_worker")

# Fields we always include in the returned dict (absent → None).
NAMEPLATE_FIELDS: tuple[str, ...] = (
    "manufacturer",
    "model",
    "serial",
    "voltage",
    "fla",
    "hp",
    "frequency",
    "rpm",
)

_EXTRACTION_PROMPT = (
    "You are an industrial nameplate OCR assistant. "
    "Examine the nameplate in this image and extract the following fields exactly as printed: "
    "manufacturer, model, serial, voltage, fla (full-load amps), hp (horsepower), "
    "frequency (Hz), rpm. "
    "Respond ONLY with a single JSON object — no prose, no markdown, no code fences. "
    "Use null for any field not visible or unreadable. Never guess or infer values. "
    'Example: {"manufacturer": "AutomationDirect", "model": "GS1-45P0", '
    '"serial": "AD2024-78956", "voltage": "460V", "fla": "12A", "hp": "5", '
    '"frequency": "60Hz", "rpm": null}'
)

# Regex to pull the first {...} block out of a response that contains extra prose.
_JSON_BLOCK_RE = re.compile(r"\{[^{}]*\}", re.DOTALL)


def _normalise(raw: dict) -> dict:
    """Return a dict guaranteed to contain every NAMEPLATE_FIELDS key (None if absent)."""
    return {field: raw.get(field) for field in NAMEPLATE_FIELDS}


def _try_parse(text: str) -> dict | None:
    """Attempt JSON parse; on failure try to extract first {...} block."""
    stripped = text.strip()
    # Direct parse
    try:
        data = json.loads(stripped)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass

    # Regex fallback — grab first top-level {...}
    match = _JSON_BLOCK_RE.search(stripped)
    if match:
        try:
            data = json.loads(match.group())
            if isinstance(data, dict):
                logger.warning("nameplate_worker: used regex fallback to extract JSON")
                return data
        except json.JSONDecodeError:
            pass

    return None


class NameplateWorker:
    """Extract structured nameplate fields from an equipment photo.

    Parameters
    ----------
    openwebui_url:
        Base URL for the local Open WebUI / Ollama endpoint (fallback only).
    api_key:
        Bearer token for Open WebUI (may be empty when using the cloud cascade).
    vision_model:
        Model name to pass to Open WebUI if the inference router is unavailable.
    """

    def __init__(
        self,
        openwebui_url: str = "",
        api_key: str = "",
        vision_model: str = "",
    ) -> None:
        self._openwebui_url = openwebui_url.rstrip("/") if openwebui_url else ""
        self._api_key = api_key
        self._vision_model = vision_model or os.getenv("VISION_MODEL", "qwen2.5vl:7b")
        self._router = _InferenceRouter()

    async def extract(self, photo_b64: str) -> dict:
        """Extract nameplate fields from a base64-encoded JPEG.

        Returns a dict with keys from NAMEPLATE_FIELDS (values are strings or
        None).  On total failure returns {"parse_error": "<reason>"}.
        """
        messages = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{photo_b64}",
                        },
                    },
                    {
                        "type": "text",
                        "text": _EXTRACTION_PROMPT,
                    },
                ],
            }
        ]

        raw_text = await self._call_inference(messages)
        if not raw_text:
            logger.warning("nameplate_worker: all inference paths returned empty response")
            return {"parse_error": "empty response from all inference backends"}

        parsed = _try_parse(raw_text)
        if parsed is None:
            logger.warning("nameplate_worker: could not parse JSON from response: %.120s", raw_text)
            return {"parse_error": f"unparseable response: {raw_text[:120]}"}

        result = _normalise(parsed)
        logger.info(
            "nameplate_worker: extracted fields — manufacturer=%s model=%s serial=%s",
            result.get("manufacturer"),
            result.get("model"),
            result.get("serial"),
        )
        return result

    async def _call_inference(self, messages: list[dict]) -> str:
        """Try the cloud cascade first; fall back to Open WebUI if unavailable."""
        content, usage = await self._router.complete(messages)
        if content:
            _InferenceRouter.log_usage(usage)
            return content

        # Cloud cascade returned empty — fall through to local Open WebUI
        if not self._openwebui_url:
            logger.warning("nameplate_worker: cloud cascade empty and no openwebui_url configured")
            return ""

        return await self._call_openwebui(messages)

    async def _call_openwebui(self, messages: list[dict]) -> str:
        """Call the local Open WebUI vision endpoint."""
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        payload = {
            "model": self._vision_model,
            "messages": messages,
            "options": {"temperature": 0.0},
        }

        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    f"{self._openwebui_url}/api/chat/completions",
                    headers=headers,
                    json=payload,
                )
                resp.raise_for_status()
                data = resp.json()
            return data["choices"][0]["message"]["content"]
        except httpx.HTTPStatusError as e:
            logger.error(
                "nameplate_worker: Open WebUI HTTP %d: %s",
                e.response.status_code,
                e.response.text[:200],
            )
            return ""
        except httpx.TimeoutException:
            logger.error("nameplate_worker: Open WebUI request timed out")
            return ""
        except Exception as e:
            logger.error("nameplate_worker: Open WebUI unexpected error: %s", e)
            return ""
