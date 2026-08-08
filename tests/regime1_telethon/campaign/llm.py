"""Free-cascade LLM client for the campaign's probe + judge agents.

Groq -> Cerebras -> Together, OpenAI-compatible, JSON-mode. Harness-only —
never a product path. No Anthropic (repo law).
"""

from __future__ import annotations

import json
import os

import httpx

PROVIDERS = [
    (
        "groq",
        "https://api.groq.com/openai/v1/chat/completions",
        "GROQ_API_KEY",
        "llama-3.3-70b-versatile",
    ),
    (
        "cerebras",
        "https://api.cerebras.ai/v1/chat/completions",
        "CEREBRAS_API_KEY",
        "llama-3.3-70b",
    ),
    (
        "together",
        "https://api.together.xyz/v1/chat/completions",
        "TOGETHERAI_API_KEY",
        "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    ),
]


def complete_json(system: str, user: str, max_tokens: int = 500) -> dict:
    """One JSON-object completion through the cascade. Raises on total failure."""
    errors = []
    for name, url, key_env, model in PROVIDERS:
        key = os.getenv(key_env, "")
        if not key:
            continue
        try:
            resp = httpx.post(
                url,
                timeout=45,
                headers={"Authorization": f"Bearer {key}"},
                json={
                    "model": model,
                    "temperature": 0.7,
                    "max_tokens": max_tokens,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                },
            )
            resp.raise_for_status()
            text = resp.json()["choices"][0]["message"]["content"]
            return json.loads(text)
        except Exception as exc:  # noqa: BLE001 — cascade fallthrough by design
            errors.append(f"{name}: {type(exc).__name__}")
            continue
    raise RuntimeError(f"all providers failed: {errors}")
