"""MIRA Inference Router — Feature-flagged Claude API backend.

When INFERENCE_BACKEND=claude and ANTHROPIC_API_KEY is set, routes LLM
reasoning calls to Claude instead of local Open WebUI / Ollama.
Vision (GLM-OCR, VisionWorker) stays local regardless of this setting.

Falls back gracefully — returns ("", {}) on any error so caller can
fall through to the Open WebUI path.

Uses httpx directly (no Anthropic SDK) — httpx is already in requirements
and the Messages API is a simple POST.
"""

import logging
import os
import re
import sqlite3
import time
from pathlib import Path

import httpx
import yaml

logger = logging.getLogger("mira-gsd")

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"

_PROMPT_PATH = Path(__file__).parent.parent.parent / "prompts" / "diagnose" / "active.yaml"


def get_system_prompt() -> str:
    """Load system prompt from prompts/diagnose/active.yaml on each call.

    Loading on every request enables zero-downtime prompt rollouts — swap
    active.yaml and the next inference call picks up the new prompt.
    Falls back to empty string if file is missing or malformed.
    """
    try:
        with open(_PROMPT_PATH) as f:
            data = yaml.safe_load(f)
        return data.get("system_prompt", "")
    except FileNotFoundError:
        logger.warning("active.yaml not found at %s — using empty system prompt", _PROMPT_PATH)
        return ""
    except Exception as e:
        logger.error("Failed to load active.yaml: %s", e)
        return ""
ANTHROPIC_VERSION = "2023-06-01"

# Regex patterns for PII / sensitive data sanitization
_IPV4_RE = re.compile(
    r"\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b"
)
_MAC_RE = re.compile(
    r"\b(?:[0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}\b"
)
_SERIAL_RE = re.compile(
    r"\b(?:S/?N|SER(?:IAL)?(?:\s*(?:NO|NUM|NUMBER)?)?)[:\s#]*[A-Z0-9\-]{4,20}\b",
    re.IGNORECASE,
)


class InferenceRouter:
    """Routes LLM completion calls to Claude API when enabled.

    Enabled only when:
      INFERENCE_BACKEND=claude  AND  ANTHROPIC_API_KEY is non-empty.

    Falls back to Open WebUI path on any error (caller checks empty string).
    Follows the same self.enabled / graceful-fallback pattern as NemotronClient.
    """

    def __init__(self):
        self.backend = os.getenv("INFERENCE_BACKEND", "local")
        self.api_key = os.getenv("ANTHROPIC_API_KEY", "")
        self.model = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")
        self.enabled = self.backend == "claude" and bool(self.api_key)

        if self.enabled:
            logger.info(
                "InferenceRouter enabled (model=%s)", self.model
            )
        else:
            logger.info(
                "InferenceRouter disabled — INFERENCE_BACKEND=%s, api_key=%s",
                self.backend,
                "set" if self.api_key else "not set",
            )

    @staticmethod
    def sanitize_context(messages: list[dict]) -> list[dict]:
        """Strip IPs, MACs, serial numbers from message content before sending to Claude."""
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
        self, messages: list[dict], max_tokens: int = 1024
    ) -> tuple[str, dict]:
        """POST to Claude Messages API via httpx.

        Returns (content_str, usage_dict).
        usage_dict = {"input_tokens": N, "output_tokens": N}
        Returns ("", {}) on any error — caller must handle fallback.
        """
        if not self.enabled:
            return "", {}

        # Convert OpenAI-style image_url blocks to Claude image blocks
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
                        new_blocks.append({
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": b64,
                            },
                        })
                    else:
                        new_blocks.append(block)
                converted.append({**msg, "content": new_blocks})
            else:
                converted.append(msg)

        # Split system message from conversation turns
        system_prompt = None
        turns = []
        for msg in converted:
            if msg["role"] == "system":
                system_prompt = msg["content"] if isinstance(msg["content"], str) \
                    else " ".join(
                        b.get("text", "") for b in msg["content"]
                        if isinstance(b, dict) and b.get("type") == "text"
                    )
            else:
                turns.append(msg)

        if not turns:
            return "", {}

        payload: dict = {
            "model": self.model,
            "max_tokens": max_tokens,
            "messages": turns,
        }
        if system_prompt:
            payload["system"] = system_prompt

        headers = {
            "x-api-key": self.api_key,
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
                self.model,
                elapsed_ms,
                usage_dict["input_tokens"],
                usage_dict["output_tokens"],
            )
            return content, usage_dict

        except httpx.HTTPStatusError as e:
            logger.error(
                "InferenceRouter HTTP error: %s %s",
                e.response.status_code,
                e.response.text[:200],
            )
            return "", {}
        except Exception as e:
            logger.error("InferenceRouter error: %s", e)
            return "", {}

    @staticmethod
    def log_usage(usage: dict) -> None:
        """Log token usage and estimated cost for a Claude API call."""
        inp = usage.get("input_tokens", 0)
        out = usage.get("output_tokens", 0)
        cost = (inp * 0.000003) + (out * 0.000015)
        logger.info(
            "CLAUDE_USAGE: input=%d output=%d est_cost=$%.5f", inp, out, cost
        )

    @staticmethod
    def write_api_usage(
        session_id: str,
        usage: dict,
        model: str,
        has_image: bool,
        response_time_ms: int,
    ) -> None:
        """Write one row to the api_usage table in mira.db.

        Table is created if missing (idempotent). Session ID format:
        {tenant_id}_{platform}_{user_id} — platform extracted from middle segment.
        """
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
                    tenant_id, platform, session_id,
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
