"""Multi-provider LLM client — Cerebras (free) → Groq (free) → Claude (paid).

Uses OpenAI-compatible API for Cerebras and Groq, Anthropic Messages API for Claude.
Provider selected by COPY_PROVIDER env var: "cerebras" (default), "groq", "claude".
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time

import httpx

logger = logging.getLogger("mira-copy")

PROVIDERS = {
    "cerebras": {
        "url": "https://api.cerebras.ai/v1/chat/completions",
        "key_env": "CEREBRAS_API_KEY",
        "model_default": "qwen-3-235b-a22b-instruct-2507",
    },
    "groq": {
        "url": "https://api.groq.com/openai/v1/chat/completions",
        "key_env": "GROQ_API_KEY",
        "model_default": "qwen/qwen3-32b",
    },
    "claude": {
        "url": "https://api.anthropic.com/v1/messages",
        "key_env": "ANTHROPIC_API_KEY",
        "model_default": "claude-sonnet-4-6",
    },
}


async def complete(
    system: str,
    user: str,
    *,
    model: str | None = None,
    max_tokens: int = 4096,
    _retried: bool = False,
) -> tuple[str, dict]:
    """Call LLM provider. Returns (content_str, usage_dict).

    Provider cascade: COPY_PROVIDER env → cerebras → groq → claude.
    """
    provider_name = os.getenv("COPY_PROVIDER", "cerebras")
    provider = PROVIDERS.get(provider_name)
    if not provider:
        raise RuntimeError(f"Unknown provider: {provider_name}")

    api_key = os.getenv(provider["key_env"], "")
    if not api_key:
        raise RuntimeError(f"{provider['key_env']} not set")

    model = model or os.getenv("COPY_MODEL", provider["model_default"])

    if provider_name == "claude":
        return await _call_claude(system, user, api_key, model, max_tokens, _retried)
    return await _call_openai_compat(
        provider["url"], api_key, system, user, model, max_tokens, _retried
    )


async def _call_openai_compat(
    url: str,
    api_key: str,
    system: str,
    user: str,
    model: str,
    max_tokens: int,
    _retried: bool,
) -> tuple[str, dict]:
    """OpenAI-compatible API (Cerebras, Groq)."""
    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        t0 = time.monotonic()
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
        elapsed_ms = int((time.monotonic() - t0) * 1000)

        content = data["choices"][0]["message"]["content"]
        # Strip thinking tags if present (Qwen3)
        if "<think>" in content:
            import re

            content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()

        usage = data.get("usage", {})
        usage_dict = {
            "input_tokens": usage.get("prompt_tokens", 0),
            "output_tokens": usage.get("completion_tokens", 0),
        }
        logger.info(
            "LLM_CALL model=%s latency_ms=%d in=%d out=%d",
            model,
            elapsed_ms,
            usage_dict["input_tokens"],
            usage_dict["output_tokens"],
        )
        return content, usage_dict

    except httpx.HTTPStatusError as e:
        status = e.response.status_code
        if status in (429, 500, 502, 503) and not _retried:
            wait = 5.0
            logger.warning("Retrying in %.1fs (HTTP %d)", wait, status)
            await asyncio.sleep(wait)
            return await _call_openai_compat(
                url, api_key, system, user, model, max_tokens, True
            )
        logger.error("LLM API HTTP %d: %s", status, e.response.text[:200])
        raise


async def _call_claude(
    system: str,
    user: str,
    api_key: str,
    model: str,
    max_tokens: int,
    _retried: bool,
) -> tuple[str, dict]:
    """Anthropic Messages API."""
    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    try:
        t0 = time.monotonic()
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages", headers=headers, json=payload
            )
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
            "CLAUDE_CALL model=%s latency_ms=%d in=%d out=%d",
            model,
            elapsed_ms,
            usage_dict["input_tokens"],
            usage_dict["output_tokens"],
        )
        return content, usage_dict

    except httpx.HTTPStatusError as e:
        status = e.response.status_code
        if status in (429, 500, 502, 503, 529) and not _retried:
            wait = 5.0
            logger.warning("Retrying in %.1fs (HTTP %d)", wait, status)
            await asyncio.sleep(wait)
            return await _call_claude(system, user, api_key, model, max_tokens, True)
        logger.error("Claude API HTTP %d: %s", status, e.response.text[:200])
        raise


def extract_json(text: str) -> dict:
    """Extract JSON from LLM response — handles ```json fences and thinking tags."""
    text = text.strip()
    # Strip thinking tags
    if "<think>" in text:
        import re

        text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    # Strip code fences
    if text.startswith("```"):
        lines = text.split("\n")
        lines = lines[1:]  # skip ```json
        end = next((i for i, ln in enumerate(lines) if ln.strip() == "```"), len(lines))
        text = "\n".join(lines[:end])
    return json.loads(text)
