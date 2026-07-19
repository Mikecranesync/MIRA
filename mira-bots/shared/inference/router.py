"""MIRA Inference Router — Multi-provider LLM cascade.

Cascade order: Groq → Cerebras → Together → (caller falls back to Open WebUI).

Each provider is tried in sequence. On any failure (rate limit, billing,
timeout, service error), the next provider is attempted. The caller
(rag_worker._call_llm) treats an empty-string return as "all cloud
providers failed" and falls through to the local Open WebUI/Ollama path.

Provider enablement is key-based: if GROQ_API_KEY is set, Groq is in the
cascade. Same for CEREBRAS_API_KEY and TOGETHERAI_API_KEY. Order is fixed.

INFERENCE_BACKEND controls the master switch:
  "cloud" → run the cascade (default when any cloud key is set)
  "local" → skip cascade entirely, go straight to Open WebUI

Uses httpx directly — no provider SDKs.
"""

from __future__ import annotations

import asyncio
import json
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


def _json_parseable(text: str) -> bool:
    """Fenced or bare JSON object/array parses -> structured output, never gibberish."""
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t[3:]
        t = t.rstrip()
        if t.endswith("```"):
            t = t[:-3]
    t = t.strip()
    if not t.startswith(("{", "[")):
        return False
    try:
        json.loads(t)
    except (ValueError, TypeError):
        return False
    return True


def _is_gibberish(text: str, threshold: float = 0.3) -> bool:
    """Detect garbled vision model output (multilingual garbage, hallucination loops).

    Valid JSON (fenced or bare) is accepted BEFORE the repetition heuristics:
    JSON is structurally repetitive ('[],' etc.), so the token-repetition rule
    false-positives on terse-but-correct structured replies (e.g. an honest
    empty graph for a blurred page).
    """
    if not text or len(text) < 20:
        return False
    if _json_parseable(text):
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
    timeout: float = 60.0
    vision_model: str = ""  # If set, use this model for image requests

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)


def _build_providers() -> list[_Provider]:
    """Build the ordered provider list from environment variables.

    Cascade order: Groq → Cerebras → Together.
    Groq leads because it's fastest and most reliable. Together AI is the
    third provider (replaced Gemini, which was 403-blocked in Doppler) via
    its OpenAI-compatible serverless endpoint.
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
                timeout=30.0,
                # Groq removed ALL vision-capable models on 2026-07-18 (llama-4
                # scout/maverick delisted; /v1/models lists nothing multimodal),
                # so the default is empty — image requests skip Groq instead of
                # burning a guaranteed 404 + latency on every photo turn. The
                # env knob stays so ops can re-enable without a deploy if Groq
                # ever re-adds a vision model.
                vision_model=os.getenv("GROQ_VISION_MODEL") or "",
            )
        )

    cerebras_key = os.getenv("CEREBRAS_API_KEY", "")
    if cerebras_key:
        providers.append(
            _Provider(
                name="cerebras",
                api_url="https://api.cerebras.ai/v1/chat/completions",
                api_key=cerebras_key,
                model=os.getenv("CEREBRAS_MODEL", "gpt-oss-120b"),
                timeout=30.0,
            )
        )

    together_key = os.getenv("TOGETHERAI_API_KEY", "")
    if together_key:
        providers.append(
            _Provider(
                name="together",
                api_url="https://api.together.xyz/v1/chat/completions",
                api_key=together_key,
                model=os.getenv("TOGETHERAI_MODEL", "meta-llama/Llama-3.3-70B-Instruct-Turbo"),
                # Together is the LAST text-cascade provider AND the ONLY vision
                # provider (no fallback exists for vision). The 2026-07-19 bench
                # measured successful theory calls at 13.9-28.6s, with 2/10 runs
                # crossing the old hardcoded 30s and losing an already-computed
                # answer to "together timeout after 30s" — the #2804 2000-token
                # theory budget + #2805 evidence-contract prompt ate the old
                # margin. Raised to 90s. The `or` form is MANDATORY: compose maps
                # ${TOGETHERAI_TIMEOUT:-}, which delivers an EMPTY STRING
                # in-container; a bare float(os.getenv(...)) on "" raises and
                # crash-loops the bot at import (same trap as
                # TOGETHERAI_VISION_MODEL below — this has bitten the repo twice).
                timeout=float(os.getenv("TOGETHERAI_TIMEOUT") or "90"),
                # google/gemma-3n-E4B-it is the ONLY vision-capable model this
                # account can reach serverless (verified live 2026-07-18: every
                # Qwen-VL / Llama-4 / Kimi / GLM-4.5V id in the catalog rejects
                # with "non-serverless model" — including the per-token-priced
                # ones, so catalog pricing does NOT imply serverless access).
                # Same free-credits basis as the default text model above. The
                # `or` form is load-bearing: compose maps
                # ${TOGETHERAI_VISION_MODEL:-}, which delivers an EMPTY STRING
                # in-container; a plain getenv default would leave vision dead.
                vision_model=os.getenv("TOGETHERAI_VISION_MODEL") or "google/gemma-3n-E4B-it",
            )
        )

    return providers


class InferenceRouter:
    """Multi-provider LLM cascade with automatic failover.

    Enabled when INFERENCE_BACKEND is "cloud" and at least one provider API
    key is set. Tries providers in order: Groq → Cerebras → Together. Returns
    ("", {}) only when ALL providers fail — caller then falls through to
    Open WebUI.
    """

    # Soft hourly call limits per provider — log warning at 80%
    _PROVIDER_HOURLY_LIMITS: dict[str, int] = {
        "groq": 1800,  # 30 RPM × 60 min
        "cerebras": 1800,
        "together": 600,  # ~10 RPM × 60 min (free-tier guidance)
    }

    def __init__(self):
        self.backend = os.getenv("INFERENCE_BACKEND", "local")
        self.providers = _build_providers()
        self.enabled = self.backend == "cloud" and len(self.providers) > 0
        # {provider_name: [monotonic_timestamps_of_calls]}
        self._provider_call_windows: dict[str, list[float]] = {}
        # {session_id: "provider/model"} — last model that answered each session.
        # Keyed by session_id (NOT a shared scalar) so concurrent tenants don't
        # clobber each other's attribution (#1704). Bounded to the most recent
        # sessions. Read by the engine's trace site via last_model_for().
        self._last_model_by_session: dict[str, str] = {}

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

    _MODEL_CACHE_MAX = 512

    def _record_session_model(self, session_id: str | None, model: str | None) -> None:
        """Cache the model that answered ``session_id`` (bounded, last-writer-wins).

        Keyed by session so the engine can attribute a turn's model #1704-safely.
        No-op when session_id or model is missing. Evicts oldest when over cap.
        """
        if not session_id or not model:
            return
        cache = self._last_model_by_session
        cache[session_id] = model
        if len(cache) > self._MODEL_CACHE_MAX:
            # Drop the oldest insertion (dicts preserve insertion order).
            for old in list(cache.keys())[: len(cache) - self._MODEL_CACHE_MAX]:
                cache.pop(old, None)

    def last_model_for(self, session_id: str | None) -> str | None:
        """Return the last model ("provider/model") that answered ``session_id``.

        ``None`` when unknown (e.g. the answering call passed no session_id, or
        the turn fell back to Open WebUI). Used by the engine's trace site.
        """
        if not session_id:
            return None
        return self._last_model_by_session.get(session_id)

    @staticmethod
    def sanitize_text(text: str) -> str:
        """Strip IPs, MACs, serial numbers from a single string.

        Shares the same regex set as sanitize_context() so the conversation
        logger and any other plain-string call sites stay aligned with what
        the cascade sees. Returns the input unchanged if it's not a string.
        """
        if not isinstance(text, str):
            return text
        text = _IPV4_RE.sub("[IP]", text)
        text = _MAC_RE.sub("[MAC]", text)
        text = _SERIAL_RE.sub("[SN]", text)
        return text

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
        sanitize: bool = True,
    ) -> tuple[str, dict]:
        """Try each provider in cascade order. Return first successful response.

        Messages are PII-sanitized by default (IPv4, MAC, serial numbers stripped).
        Pass `sanitize=False` only for offline evals that need to verify the
        sanitizer itself or test PII-detection paths.

        Returns (content_str, usage_dict) on success.
        Returns ("", {}) when all providers fail.
        """
        if not self.enabled:
            return "", {}

        if sanitize:
            messages = self.sanitize_context(messages)

        has_image = _has_image(messages)
        last_error: dict = {}

        for provider in self.providers:
            # For image requests, skip providers that lack a vision model
            if has_image and not provider.vision_model:
                continue

            try:
                content, usage = await self._call_openai_compat(
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
                    self._record_session_model(session_id, usage.get("model"))
                    return content, usage
                # Empty/None content (e.g. a reasoning model that spent its whole
                # token budget on reasoning) is NOT an exception, so the cascade
                # would otherwise fall through to the next provider silently. Log
                # it so a degrading provider is visible — see the provider-health
                # canary (docs/runbooks/provider-health-canary.md).
                logger.warning(
                    "EMPTY_RESPONSE provider=%s — empty content, trying next provider",
                    provider.name,
                )
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

    async def _call_openai_compat(
        self,
        provider: _Provider,
        messages: list[dict],
        max_tokens: int,
        session_id: str,
        has_image: bool,
    ) -> tuple[str, dict]:
        """Call an OpenAI-compatible provider (Groq, Cerebras, Together)."""
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
                "model": f"{provider.name}/{model}",
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

    @staticmethod
    def log_usage(usage: dict) -> None:
        """Log token usage. All current providers (Groq/Cerebras/Together) are free-tier."""
        inp = usage.get("input_tokens", 0)
        out = usage.get("output_tokens", 0)
        provider = usage.get("provider", "unknown")
        logger.info(
            "LLM_USAGE provider=%s input=%d output=%d est_cost=$0.00000",
            provider,
            inp,
            out,
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
