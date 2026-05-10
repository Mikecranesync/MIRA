#!/usr/bin/env python3.12
"""Cascade health probe — test each configured provider with a minimal call.

Usage:
    doppler run -- python3.12 scripts/check_cascade_health.py

Exit codes:
    0 — all configured providers healthy
    1 — at least one provider degraded or unreachable

Reads the same env vars as the inference router so results reflect live state.
"""

from __future__ import annotations

import asyncio
import os
import sys
import time
from dataclasses import dataclass

import httpx

_PROBE_MESSAGES = [{"role": "user", "content": "Reply with exactly: OK"}]
_PROBE_MAX_TOKENS = 5
_TIMEOUT = 15.0


@dataclass
class _ProviderConfig:
    name: str
    url: str
    api_key: str
    model: str
    extra_headers: dict


def _get_providers() -> list[_ProviderConfig]:
    providers = []

    groq_key = os.getenv("GROQ_API_KEY", "")
    if groq_key:
        providers.append(_ProviderConfig(
            name="groq",
            url="https://api.groq.com/openai/v1/chat/completions",
            api_key=groq_key,
            model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
            extra_headers={},
        ))

    cerebras_key = os.getenv("CEREBRAS_API_KEY", "")
    if cerebras_key:
        providers.append(_ProviderConfig(
            name="cerebras",
            url="https://api.cerebras.ai/v1/chat/completions",
            api_key=cerebras_key,
            model=os.getenv("CEREBRAS_MODEL", "llama3.1-8b"),
            extra_headers={},
        ))

    openrouter_key = os.getenv("OPENROUTER_API_KEY", "")
    if openrouter_key:
        providers.append(_ProviderConfig(
            name="openrouter",
            url="https://openrouter.ai/api/v1/chat/completions",
            api_key=openrouter_key,
            model=os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct:free"),
            extra_headers={"HTTP-Referer": "https://factorylm.com", "X-Title": "MIRA"},
        ))

    gemini_key = os.getenv("GEMINI_API_KEY", "")
    if gemini_key:
        providers.append(_ProviderConfig(
            name="gemini",
            url="https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
            api_key=gemini_key,
            model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
            extra_headers={},
        ))

    return providers


async def _probe(provider: _ProviderConfig) -> tuple[str, str]:
    """Returns (status, detail) where status is OK / AUTH_FAIL / RATE_LIMIT / TIMEOUT / ERROR."""
    headers = {
        "Authorization": f"Bearer {provider.api_key}",
        "Content-Type": "application/json",
        **provider.extra_headers,
    }
    payload = {
        "model": provider.model,
        "max_tokens": _PROBE_MAX_TOKENS,
        "messages": _PROBE_MESSAGES,
        "temperature": 0.0,
    }
    t0 = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(provider.url, headers=headers, json=payload)
            elapsed = int((time.monotonic() - t0) * 1000)
            if resp.status_code in (401, 403):
                return "AUTH_FAIL", f"HTTP {resp.status_code} — rotate {provider.name.upper()}_API_KEY in Doppler"
            if resp.status_code == 429:
                return "RATE_LIMIT", f"HTTP 429 latency={elapsed}ms"
            resp.raise_for_status()
            return "OK", f"latency={elapsed}ms model={provider.model}"
    except httpx.TimeoutException:
        return "TIMEOUT", f">{_TIMEOUT:.0f}s"
    except Exception as e:
        return "ERROR", str(e)[:120]


async def main() -> int:
    providers = _get_providers()
    if not providers:
        print("NO_PROVIDERS — set at least one API key (GROQ_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY)")
        return 1

    results = await asyncio.gather(*[_probe(p) for p in providers])
    any_bad = False
    for provider, (status, detail) in zip(providers, results):
        icon = "✓" if status == "OK" else "✗"
        print(f"{icon} {provider.name:<12} {status:<12} {detail}")
        if status != "OK":
            any_bad = True

    if any_bad:
        print("\nAction: update failing keys via `doppler secrets set KEY=<new_value> --project factorylm --config prd`")
        print("Then restart: doppler run -- docker compose -f mira-bots/docker-compose.yml restart")
    else:
        print("\nAll providers healthy.")

    return 1 if any_bad else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
