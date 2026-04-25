"""MIRA Inference Router — Multi-provider LLM cascade.

Cascade order: Gemini → Groq → Cerebras → Claude → (caller falls back to Open WebUI).

Each provider is tried in sequence. On any failure (rate limit, billing,
timeout, service error), the next provider is attempted. The caller
(rag_worker._call_llm) treats an empty-string return as "all cloud
providers failed" and falls through to the local Open WebUI/Ollama path.

Provider enablement is key-based: if GEMINI_API_KEY is set, Gemini is in the
cascade. Same for GROQ_API_KEY, CEREBRAS_API_KEY and ANTHROPIC_API_KEY.
Order is fixed.

INFERENCE_BACKEND controls the master switch:
  "cloud"  → run the cascade (default when any cloud key is set)
  "claude" → legacy alias, same as "cloud"
  "local"  → skip cascade entirely, go straight to Open WebUI

Uses httpx directly — no provider SDKs.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

import httpx
import yaml

logger = logging.getLogger("mira-gsd")

_PROMPT_PATH = Path(__file__).parent.parent.parent / "prompts" / "diagnose" / "active.yaml"
_PROMPT_CACHE_TTL = float(os.getenv("MIRA_PROMPT_CACHE_TTL", "60"))
_prompt_cache: tuple[str, float] | None = None  # (content, monotonic_time)

# PII sanitization patterns
_IPV4_RE = re.compile(
    r"\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b"
)
_MAC_RE = re.compile(r"\b(?:[0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}\b")
_SERIAL_RE = re.compile(
    r"\b(?:S/?N|SER(?:IAL)?(?:\s*(?:NO|NUM|NUMBER)?)?)[:\s#]*[A-Z0-9\-]{4,20}\b",
    re.IGNORECASE,
)

# Warn when any LLM call exceeds this threshold — indicates context bloat
_LATENCY_WARN_MS = int(os.getenv("MIRA_LATENCY_WARN_MS", "15000"))

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"


def get_system_prompt() -> str:
    """Load system prompt from prompts/diagnose/active.yaml with a 60s TTL cache.

    Zero-downtime rollout: MIRA_PROMPT_CACHE_TTL=0 forces reload every call.
    """
    global _prompt_cache
    now = time.monotonic()
    if _prompt_cache is not None and (now - _prompt_cache[1]) < _PROMPT_CACHE_TTL:
        return _prompt_cache[0]
    try:
        with open(_PROMPT_PATH) as f:
            data = yaml.safe_load(f)
        prompt = data.get("system_prompt", "")
    except FileNotFoundError:
        logger.warning("active.yaml not found at %s — using empty system prompt", _PROMPT_PATH)
        prompt = ""
    except Exception as e:
        logger.error("Failed to load active.yaml: %s", e)
        prompt = _prompt_cache[0] if _prompt_cache else ""
    _prompt_cache = (prompt, now)
    return prompt


def _classify_http_error(status_code: int) -> str:
    if status_code == 429:
        return "rate_limit"
    if status_code in (401, 403):
        return "auth"
    if status_code == 400:
        return "billing"
    if status_code in (500, 502, 503, 529):
        return "service"
    return "unknown"


def _parse_retry_after(response: httpx.Response) -> float:
    header = response.headers.get("retry-after", "")
    try:
        return min(float(header), 30.0) if header else 5.0
    except ValueError:
        return 5.0


def _is_gibberish(text: str, threshold: float = 0.3) -> bool:
    """Detect garbled vision model output (multilingual garbage, hallucination loops)."""
    if not text or len(text) < 20:
        return False
    non_ascii = sum(1 for c in text if ord(c) > 127)
    if non_ascii / len(text) > threshold:
        return True
    words = text.split()
    if len(words) > 10:
        from collections import Counter

        most_common_count = Counter(words).most_common(1)[0][1]
        if most_common_count > len(words) * 0.15:
            return True
    return False


# ---------------------------------------------------------------------------
# Provider definitions
# ---------------------------------------------------------------------------


@dataclass
class _Provider:
    name: str
    api_url: str
    api_key: str
    model: str
    format: str  # "openai" or "anthropic"
    timeout: float = 60.0
    vision_model: str = ""  # If set, use this model for image requests

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)


def _build_providers() -> list[_Provider]:
    """Build the ordered provider list from environment variables.

    Cascade order: Groq → Cerebras → Gemini → Claude.
    Groq leads because it's fastest and most reliable. Gemini moved to third
    position after persistent 503s in prod (2026-04-21 latency audit).
    """
    providers: list[_Provider] = []

    groq_key = os.getenv("GROQ_API_KEY", "")
    if groq_key:
        providers.append(
            _Provider(
                name="groq",
                api_url="https://api.groq.com/openai/v1/chat/completions",
                api_key=groq_key,
                model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
                format="openai",
                timeout=30.0,
                vision_model=os.getenv(
                    "GROQ_VISION_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct"
                ),
            )
        )

    cerebras_key = os.getenv("CEREBRAS_API_KEY", "")
    if cerebras_key:
        providers.append(
            _Provider(
                name="cerebras",
                api_url="https://api.cerebras.ai/v1/chat/completions",
                api_key=cerebras_key,
                model=os.getenv("CEREBRAS_MODEL", "llama3.1-8b"),
                format="openai",
                timeout=30.0,
            )
        )

    gemini_key = os.getenv("GEMINI_API_KEY", "")
    if gemini_key:
        gemini_model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
        providers.append(
            _Provider(
                name="gemini",
                api_url="https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
                api_key=gemini_key,
                model=gemini_model,
                format="openai",
                timeout=30.0,
                vision_model=os.getenv("GEMINI_VISION_MODEL", gemini_model),
            )
        )

    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")
    if anthropic_key:
        providers.append(
            _Provider(
                name="claude",
                api_url=ANTHROPIC_API_URL,
                api_key=anthropic_key,
                model=os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6"),
                format="anthropic",
                timeout=60.0,
            )
        )

    return providers


class InferenceRouter:
    """Multi-provider LLM cascade with automatic failover.

    Enabled when INFERENCE_BACKEND is "cloud" or "claude" and at least one
    provider API key is set. Tries providers in order: Gemini → Groq →
    Cerebras → Claude. Returns ("", {}) only when ALL providers fail —
    caller then falls through to Open WebUI.
    """

    # Soft hourly call limits per provider — log warning at 80%
    _PROVIDER_HOURLY_LIMITS: dict[str, int] = {
        "groq": 1800,  # 30 RPM × 60 min
        "cerebras": 1800,
        "gemini": 900,  # 15 RPM × 60 min
        "claude": 5000,  # generous; real limit depends on tier
    }

    def __init__(self):
        self.backend = os.getenv("INFERENCE_BACKEND", "local")
        self.providers = _build_providers()
        self.enabled = self.backend in ("cloud", "claude") and len(self.providers) > 0
        # {provider_name: [monotonic_timestamps_of_calls]}
        self._provider_call_windows: dict[str, list[float]] = {}

        if self.enabled:
            names = [p.name for p in self.providers]
            vision = [f"{p.name}:{p.vision_model}" for p in self.providers if p.vision_model]
            logger.info("InferenceRouter enabled — cascade: %s", " → ".join(names))
            if vision:
                logger.info("InferenceRouter vision: %s", ", ".join(vision))
        else:
            logger.info(
                "InferenceRouter disabled — INFERENCE_BACKEND=%s, providers=%d",
                self.backend,
                len(self.providers),
            )

    def _track_provider_call(self, provider_name: str) -> None:
        """Record a call to provider_name and warn when approaching hourly limit."""
        now = time.monotonic()
        window = [
            ts for ts in self._provider_call_windows.get(provider_name, []) if now - ts < 3600
        ]
        window.append(now)
        self._provider_call_windows[provider_name] = window

        hourly_limit = self._PROVIDER_HOURLY_LIMITS.get(provider_name, 0)
        if hourly_limit and len(window) >= int(hourly_limit * 0.8):
            logger.warning(
                "PROVIDER_BUDGET_WARNING provider=%s calls_1h=%d limit=%d (%.0f%%)",
                provider_name,
                len(window),
                hourly_limit,
                100 * len(window) / hourly_limit,
            )

    @staticmethod
    def sanitize_context(messages: list[dict]) -> list[dict]:
        """Strip IPs, MACs, serial numbers from message content before sending."""
        sanitized = []
        for msg in messages:
            content = msg.get("content", "")
            if isinstance(content, str):
                content = _IPV4_RE.sub("[IP]", content)
                content = _MAC_RE.sub("[MAC]", content)
                content = _SERIAL_RE.sub("[SN]", content)
                sanitized.append({**msg, "content": content})
            elif isinstance(content, list):
                new_blocks = []
                for block in content:
                    if block.get("type") == "text":
                        text = block["text"]
                        text = _IPV4_RE.sub("[IP]", text)
                        text = _MAC_RE.sub("[MAC]", text)
                        text = _SERIAL_RE.sub("[SN]", text)
                        new_blocks.append({**block, "text": text})
                    else:
                        new_blocks.append(block)
                sanitized.append({**msg, "content": new_blocks})
            else:
                sanitized.append(msg)
        return sanitized

    async def complete(
        self,
        messages: list[dict],
        max_tokens: int = 1024,
        session_id: str = "unknown_unknown_unknown",
    ) -> tuple[str, dict]:
        """Try each provider in cascade order. Return first successful response.

        Returns (content_str, usage_dict) on success.
        Returns ("", {}) when all providers fail.
        """
        if not self.enabled:
            return "", {}

        has_image = _has_image(messages)
        last_error: dict = {}

        for provider in self.providers:
            # For image requests, skip OpenAI-format providers that lack a vision model
            if has_image and provider.format == "openai" and not provider.vision_model:
                continue

            try:
                content, usage = await self._call_provider(
                    provider,
                    messages,
                    max_tokens,
                    session_id,
                    has_image,
                )
                if content:
                    if has_image and _is_gibberish(content):
                        logger.warning(
                            "VISION_GIBBERISH provider=%s len=%d — trying next",
                            provider.name,
                            len(content),
                        )
                        last_error = usage
                        continue
                    self._track_provider_call(provider.name)
                    return content, usage
                last_error = usage
            except _ProviderSkip:
                continue

        logger.warning(
            "All providers exhausted — cascade returned empty (providers=%s, last_error=%s). "
            "Check API keys in Doppler and INFERENCE_BACKEND env var.",
            [p.name for p in self.providers],
            last_error,
        )
        return "", last_error

    async def _call_provider(
        self,
        provider: _Provider,
        messages: list[dict],
        max_tokens: int,
        session_id: str,
        has_image: bool,
    ) -> tuple[str, dict]:
        """Call a single provider. Returns (content, usage) or raises _ProviderSkip."""
        if provider.format == "anthropic":
            return await self._call_anthropic(provider, messages, max_tokens, session_id, has_image)
        return await self._call_openai_compat(provider, messages, max_tokens, session_id, has_image)

    async def _call_openai_compat(
        self,
        provider: _Provider,
        messages: list[dict],
        max_tokens: int,
        session_id: str,
        has_image: bool,
    ) -> tuple[str, dict]:
        """Call an OpenAI-compatible provider (Groq, Cerebras)."""
        # Use vision model for image requests if available
        model = provider.vision_model if (has_image and provider.vision_model) else provider.model
        payload: dict = {
            "model": model,
            "max_tokens": max_tokens,
            "messages": messages,
            "temperature": 0.1,
        }
        # Note: response_format=json_object omitted — Groq requires "json" in system prompt
        # to use that mode, and Cerebras occasionally rejects it. The system prompt already
        # instructs JSON output; _parse_response has 3 extraction strategies as fallback.
        headers = {
            "Authorization": f"Bearer {provider.api_key}",
            "Content-Type": "application/json",
        }

        try:
            t0 = time.monotonic()
            async with httpx.AsyncClient(timeout=provider.timeout) as client:
                resp = await client.post(provider.api_url, headers=headers, json=payload)
                resp.raise_for_status()
                data = resp.json()
            elapsed_ms = int((time.monotonic() - t0) * 1000)

            content = data["choices"][0]["message"]["content"]
            usage = data.get("usage", {})
            usage_dict = {
                "input_tokens": usage.get("prompt_tokens", 0),
                "output_tokens": usage.get("completion_tokens", 0),
                "provider": provider.name,
            }

            logger.info(
                "LLM_CALL provider=%s model=%s latency_ms=%d input=%d output=%d",
                provider.name,
                model,
                elapsed_ms,
                usage_dict["input_tokens"],
                usage_dict["output_tokens"],
            )
            if elapsed_ms > _LATENCY_WARN_MS:
                logger.warning(
                    "SLOW_LLM_CALL provider=%s latency_ms=%d input_tokens=%d — "
                    "consider trimming context",
                    provider.name,
                    elapsed_ms,
                    usage_dict["input_tokens"],
                )

            self.write_api_usage(
                session_id=session_id,
                usage=usage_dict,
                model=f"{provider.name}/{model}",
                has_image=has_image,
                response_time_ms=elapsed_ms,
            )

            return content, usage_dict

        except httpx.HTTPStatusError as e:
            status = e.response.status_code
            error_type = _classify_http_error(status)
            body = e.response.text[:300]
            logger.warning(
                "%s HTTP %d (%s): %s",
                provider.name,
                status,
                error_type,
                body,
            )

            if error_type == "rate_limit":
                wait = _parse_retry_after(e.response)
                logger.info("%s rate limited — waiting %.1fs", provider.name, wait)
                await asyncio.sleep(min(wait, 30.0))
                # Single inline retry — no recursion
                try:
                    async with httpx.AsyncClient(timeout=provider.timeout) as rc:
                        r2 = await rc.post(provider.api_url, headers=headers, json=payload)
                        r2.raise_for_status()
                        d2 = r2.json()
                    return d2["choices"][0]["message"]["content"], {
                        "input_tokens": d2.get("usage", {}).get("prompt_tokens", 0),
                        "output_tokens": d2.get("usage", {}).get("completion_tokens", 0),
                        "provider": provider.name,
                    }
                except Exception:
                    pass

            raise _ProviderSkip(provider.name, error_type)

        except httpx.TimeoutException:
            logger.warning("%s timeout after %.0fs", provider.name, provider.timeout)
            raise _ProviderSkip(provider.name, "timeout")

        except Exception as e:
            logger.warning("%s unexpected error: %s", provider.name, e)
            raise _ProviderSkip(provider.name, "unknown")

    async def _call_anthropic(
        self,
        provider: _Provider,
        messages: list[dict],
        max_tokens: int,
        session_id: str,
        has_image: bool,
    ) -> tuple[str, dict]:
        """Call Claude Messages API (custom format)."""
        converted = _convert_images_for_claude(messages)

        system_parts: list[str] = []
        turns: list[dict] = []
        for msg in converted:
            if msg["role"] == "system":
                c = msg["content"]
                if isinstance(c, str):
                    system_parts.append(c)
                elif isinstance(c, list):
                    system_parts.append(
                        " ".join(
                            b.get("text", "")
                            for b in c
                            if isinstance(b, dict) and b.get("type") == "text"
                        )
                    )
            else:
                turns.append(msg)

        if not turns:
            raise _ProviderSkip(provider.name, "no_turns")

        payload: dict = {
            "model": provider.model,
            "max_tokens": max_tokens,
            "messages": turns,
        }
        if system_parts:
            payload["system"] = "\n\n".join(system_parts)

        headers = {
            "x-api-key": provider.api_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        }

        try:
            t0 = time.monotonic()
            async with httpx.AsyncClient(timeout=provider.timeout) as client:
                resp = await client.post(provider.api_url, headers=headers, json=payload)
                resp.raise_for_status()
                data = resp.json()
            elapsed_ms = int((time.monotonic() - t0) * 1000)

            content = data["content"][0]["text"]
            usage = data.get("usage", {})
            usage_dict = {
                "input_tokens": usage.get("input_tokens", 0),
                "output_tokens": usage.get("output_tokens", 0),
                "provider": "claude",
            }

            logger.info(
                "LLM_CALL provider=claude model=%s latency_ms=%d input=%d output=%d",
                provider.model,
                elapsed_ms,
                usage_dict["input_tokens"],
                usage_dict["output_tokens"],
            )
            if elapsed_ms > _LATENCY_WARN_MS:
                logger.warning(
                    "SLOW_LLM_CALL provider=claude latency_ms=%d input_tokens=%d — "
                    "consider trimming context",
                    elapsed_ms,
                    usage_dict["input_tokens"],
                )

            self.write_api_usage(
                session_id=session_id,
                usage=usage_dict,
                model=provider.model,
                has_image=has_image,
                response_time_ms=elapsed_ms,
            )

            return content, usage_dict

        except httpx.HTTPStatusError as e:
            status = e.response.status_code
            error_type = _classify_http_error(status)
            body = e.response.text[:300]
            logger.warning(
                "claude HTTP %d (%s): %s",
                status,
                error_type,
                body,
            )

            if error_type in ("rate_limit", "service"):
                wait = 2.0 if error_type == "service" else _parse_retry_after(e.response)
                logger.info("claude retrying in %.1fs (%s)", wait, error_type)
                await asyncio.sleep(min(wait, 30.0))
                # Single inline retry — no recursion
                try:
                    async with httpx.AsyncClient(timeout=provider.timeout) as rc:
                        r2 = await rc.post(provider.api_url, headers=headers, json=payload)
                        r2.raise_for_status()
                        d2 = r2.json()
                    return d2["content"][0]["text"], {
                        "input_tokens": d2.get("usage", {}).get("input_tokens", 0),
                        "output_tokens": d2.get("usage", {}).get("output_tokens", 0),
                        "provider": provider.name,
                    }
                except Exception:
                    pass

            raise _ProviderSkip("claude", error_type)

        except httpx.TimeoutException:
            logger.warning("claude timeout after %.0fs", provider.timeout)
            raise _ProviderSkip("claude", "timeout")

        except Exception as e:
            logger.warning("claude unexpected error: %s", e)
            raise _ProviderSkip("claude", "unknown")

    @staticmethod
    def log_usage(usage: dict) -> None:
        """Log token usage and estimated cost."""
        inp = usage.get("input_tokens", 0)
        out = usage.get("output_tokens", 0)
        provider = usage.get("provider", "unknown")
        if provider == "claude":
            cost = (inp * 0.000003) + (out * 0.000015)
        elif provider in ("groq", "cerebras", "gemini"):
            cost = 0.0
        else:
            cost = 0.0
        logger.info(
            "LLM_USAGE provider=%s input=%d output=%d est_cost=$%.5f",
            provider,
            inp,
            out,
            cost,
        )

    @staticmethod
    def write_api_usage(
        session_id: str,
        usage: dict,
        model: str,
        has_image: bool,
        response_time_ms: int,
    ) -> None:
        """Write one row to the api_usage table in mira.db."""
        db_path = os.getenv("MIRA_DB_PATH", "/data/mira.db")
        if not db_path or not os.path.exists(db_path):
            return

        parts = session_id.split("_", 2)
        tenant_id = parts[0] if len(parts) >= 1 else "unknown"
        platform = parts[1] if len(parts) >= 2 else "unknown"

        try:
            con = sqlite3.connect(db_path, timeout=5)
            con.execute("PRAGMA journal_mode=WAL")
            con.execute("""
                CREATE TABLE IF NOT EXISTS api_usage (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    tenant_id TEXT NOT NULL,
                    platform TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    input_tokens INTEGER,
                    output_tokens INTEGER,
                    model TEXT,
                    has_image BOOLEAN,
                    response_time_ms INTEGER,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """)
            con.execute(
                """INSERT INTO api_usage
                   (tenant_id, platform, session_id, input_tokens, output_tokens,
                    model, has_image, response_time_ms)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    tenant_id,
                    platform,
                    session_id,
                    usage.get("input_tokens", 0),
                    usage.get("output_tokens", 0),
                    model,
                    1 if has_image else 0,
                    response_time_ms,
                ),
            )
            con.commit()

            # --- Daily spend monitor (Claude only) ---
            if "claude" in model.lower():
                row = con.execute(
                    """SELECT SUM(input_tokens), SUM(output_tokens), COUNT(*)
                       FROM api_usage
                       WHERE model LIKE '%claude%'
                         AND DATE(timestamp) = DATE('now')""",
                ).fetchone()
                if row and row[0]:
                    day_in, day_out, day_calls = row
                    day_cost = (day_in * 0.000003) + (day_out * 0.000015)
                    logger.info(
                        "CLAUDE_DAILY_SPEND calls=%d input=%d output=%d est_cost=$%.4f",
                        day_calls,
                        day_in,
                        day_out,
                        day_cost,
                    )
                    daily_cap = float(os.getenv("CLAUDE_DAILY_SPEND_CAP", "1.00"))
                    if day_cost > daily_cap:
                        logger.warning(
                            "CLAUDE_SPEND_ALERT daily=$%.4f exceeds cap=$%.2f",
                            day_cost,
                            daily_cap,
                        )

            con.close()
        except Exception as e:
            logger.warning("api_usage write failed: %s", e)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _ProviderSkip(Exception):
    """Signal to skip to next provider in the cascade."""

    def __init__(self, provider: str, reason: str):
        self.provider = provider
        self.reason = reason
        super().__init__(f"{provider}: {reason}")


def _has_image(messages: list[dict]) -> bool:
    return any(
        isinstance(msg.get("content"), list)
        and any(
            b.get("type") in ("image", "image_url") for b in msg["content"] if isinstance(b, dict)
        )
        for msg in messages
    )


def _convert_images_for_claude(messages: list[dict]) -> list[dict]:
    """Convert OpenAI-style image_url blocks to Claude's base64 image format."""
    converted = []
    for msg in messages:
        content = msg.get("content")
        if isinstance(content, list):
            new_blocks = []
            for block in content:
                if block.get("type") == "image_url":
                    url = block["image_url"]["url"]
                    if url.startswith("data:"):
                        media_type = url.split(";")[0].replace("data:", "")
                        b64 = url.split(",", 1)[1] if "," in url else url
                    else:
                        media_type = "image/jpeg"
                        b64 = url
                    new_blocks.append(
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": b64,
                            },
                        }
                    )
                else:
                    new_blocks.append(block)
            converted.append({**msg, "content": new_blocks})
        else:
            converted.append(msg)
    return converted
