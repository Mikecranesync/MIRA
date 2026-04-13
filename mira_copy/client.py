"""Thin Claude API client via httpx — mirrors InferenceRouter pattern."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time

import httpx

logger = logging.getLogger("mira-copy")

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"


async def complete(
    system: str,
    user: str,
    *,
    model: str | None = None,
    max_tokens: int = 4096,
    _retried: bool = False,
) -> tuple[str, dict]:
    """POST to Claude Messages API. Returns (content_str, usage_dict).

    Raises RuntimeError if ANTHROPIC_API_KEY is not set.
    Retries once on 429 / 5xx.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")

    model = model or os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")

    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }

    headers = {
        "x-api-key": api_key,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
    }

    try:
        t0 = time.monotonic()
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(ANTHROPIC_API_URL, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
        elapsed_ms = int((time.monotonic() - t0) * 1000)

        content = data["content"][0]["text"]
        usage = data.get("usage", {})
        usage_dict = {
            "input_tokens": usage.get("input_tokens", 0),
            "output_tokens": usage.get("output_tokens", 0),
        }

        logger.info(
            "CLAUDE_CALL model=%s latency_ms=%d input=%d output=%d",
            model, elapsed_ms, usage_dict["input_tokens"], usage_dict["output_tokens"],
        )
        return content, usage_dict

    except httpx.HTTPStatusError as e:
        status = e.response.status_code
        if status in (429, 500, 502, 503, 529) and not _retried:
            wait = 2.0 if status >= 500 else _parse_retry_after(e.response)
            logger.warning("Retrying in %.1fs (HTTP %d)", wait, status)
            await asyncio.sleep(wait)
            return await complete(system, user, model=model, max_tokens=max_tokens, _retried=True)
        logger.error("Claude API HTTP %d: %s", status, e.response.text[:200])
        raise

    except Exception as e:
        logger.error("Claude API error: %s", e)
        raise


def _parse_retry_after(resp: httpx.Response) -> float:
    """Extract Retry-After header or default to 5s."""
    try:
        return float(resp.headers.get("retry-after", "5"))
    except (ValueError, TypeError):
        return 5.0


def extract_json(text: str) -> dict:
    """Extract JSON from Claude response — handles ```json fences."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = lines[1:]  # skip ```json
        end = next((i for i, ln in enumerate(lines) if ln.strip() == "```"), len(lines))
        text = "\n".join(lines[:end])
    return json.loads(text)
