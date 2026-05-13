"""Anthropic Messages API wrapper for ComponentProfile extraction.

Calls Claude with the cached system prompt + tool definition from prompts.py,
forces the model to invoke `save_component_profile` via tool_choice, validates
the returned JSON against the Pydantic schema, and retries once on parse
failure with the validation error fed back to the model.

Returns a validated ComponentProfile plus per-call metadata (latency, tokens,
cache hit stats) so the Celery wrapper can persist cost telemetry.

Model selection:
  - Default model: claude-sonnet-4-6 (best speed/intelligence balance for
    high-volume document extraction). The plan's $0.20-0.60/manual cost
    estimate assumes Sonnet 4.6 pricing.
  - Override via CLAUDE_MODEL env var or `model=` argument.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass

import anthropic
from pydantic import ValidationError

from .prompts import SYSTEM_PROMPT, TOOL_DEFINITION, TOOL_NAME, build_user_message
from .schema import ComponentProfile, CopyrightHandling

logger = logging.getLogger("mira-component-profiles")

DEFAULT_MODEL = "claude-sonnet-4-6"
DEFAULT_MAX_TOKENS = 16000
DEFAULT_TIMEOUT_SECONDS = 120.0


class ExtractionError(Exception):
    """Raised when extraction fails after retries (validation or API error)."""


@dataclass
class ExtractionMetadata:
    model: str
    latency_ms: int
    input_tokens: int
    output_tokens: int
    cache_read_input_tokens: int
    cache_creation_input_tokens: int
    retry_attempted: bool

    def to_dict(self) -> dict:
        return {
            "model": self.model,
            "latency_ms": self.latency_ms,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cache_read_input_tokens": self.cache_read_input_tokens,
            "cache_creation_input_tokens": self.cache_creation_input_tokens,
            "retry_attempted": self.retry_attempted,
        }


def _extract_tool_use_input(message: anthropic.types.Message) -> dict | None:
    """Pull the save_component_profile tool input out of a response message."""
    for block in message.content:
        if block.type == "tool_use" and block.name == TOOL_NAME:
            return block.input  # type: ignore[return-value]
    return None


def _build_messages(
    user_msg: str,
    *,
    prior_assistant_content: list | None = None,
    retry_feedback: str | None = None,
) -> list[dict]:
    """Build the messages array.

    For the initial call: just the user message.
    For the retry: original user message → assistant's bad tool_use → user
    message that includes the tool_result with the validation error so Claude
    can correct itself.
    """
    messages: list[dict] = [{"role": "user", "content": user_msg}]
    if prior_assistant_content is not None and retry_feedback is not None:
        messages.append({"role": "assistant", "content": prior_assistant_content})
        # Include a tool_result tied to the failed tool_use so Claude sees its
        # own attempt and the error in one coherent turn.
        tool_use_id = next(
            (b.id for b in prior_assistant_content if getattr(b, "type", "") == "tool_use"),
            None,
        )
        if tool_use_id is not None:
            messages.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": tool_use_id,
                            "content": retry_feedback,
                            "is_error": True,
                        }
                    ],
                }
            )
        else:
            # Fallback if no tool_use id was found — plain text follow-up.
            messages.append({"role": "user", "content": retry_feedback})
    return messages


def _call_claude(
    client: anthropic.Anthropic,
    *,
    model: str,
    messages: list[dict],
    max_tokens: int,
) -> anthropic.types.Message:
    """Single Messages API call with prompt caching on system + tool definition.

    cache_control on the last system block caches BOTH the tool definition
    and the system prompt (render order is tools → system → messages). System
    + tool together is ~7-8k tokens, well over the 2048-token cache minimum
    for Sonnet 4.6, so the cache will actually populate.
    """
    return client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=[
            {
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        tools=[TOOL_DEFINITION],
        tool_choice={"type": "tool", "name": TOOL_NAME},
        thinking={"type": "adaptive"},
        output_config={"effort": "medium"},
        messages=messages,
    )


def extract_component_profile(
    manual_text: str,
    *,
    manufacturer_hint: str | None = None,
    model_hint: str | None = None,
    known_fault_codes: list[tuple[str, str, str]] | None = None,
    source_title: str | None = None,
    source_url: str | None = None,
    copyright_handling: CopyrightHandling | str = CopyrightHandling.LINK_ONLY,
    model: str | None = None,
    api_key: str | None = None,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    client: anthropic.Anthropic | None = None,
) -> tuple[ComponentProfile, ExtractionMetadata]:
    """Extract a structured ComponentProfile from manual text.

    Args:
        manual_text: docling-extracted manual text with page markers preserved.
        manufacturer_hint / model_hint: EquipmentMatch outputs (deterministic
            regex). Help Claude anchor identification.
        known_fault_codes: FaultCodeMatch priors for this manufacturer — list
            of (code, manufacturer, description) tuples.
        source_title / source_url: provenance for source_documents.
        copyright_handling: enum value for source_documents[].copyright_handling.
        model: override the default model (or set CLAUDE_MODEL env var).
        api_key: override the default API key (or set ANTHROPIC_API_KEY env var).
        max_tokens: response budget; default 16000 (allows for thinking + ~4k
            JSON output).
        timeout: per-call HTTP timeout in seconds.
        client: optional pre-built anthropic.Anthropic for testing.

    Returns:
        (profile, metadata) on success.

    Raises:
        ExtractionError: validation failed after one retry, the model did not
            call the tool, or the Anthropic API errored irrecoverably.
    """
    model = model or os.getenv("CLAUDE_MODEL", DEFAULT_MODEL)
    handling_str = (
        copyright_handling.value
        if isinstance(copyright_handling, CopyrightHandling)
        else str(copyright_handling)
    )

    user_msg = build_user_message(
        manual_text,
        manufacturer_hint=manufacturer_hint,
        model_hint=model_hint,
        known_fault_codes=known_fault_codes,
        source_title=source_title,
        source_url=source_url,
        copyright_handling=handling_str,
    )

    if client is None:
        client = anthropic.Anthropic(
            api_key=api_key or os.environ.get("ANTHROPIC_API_KEY"),
            timeout=timeout,
            # SDK defaults max_retries=2 — good for 429/5xx, no override needed.
        )

    # --- First attempt -------------------------------------------------------
    t0 = time.monotonic()
    try:
        response = _call_claude(
            client,
            model=model,
            messages=_build_messages(user_msg),
            max_tokens=max_tokens,
        )
    except anthropic.APIError as e:
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        logger.error(
            "Anthropic API error on first attempt model=%s latency_ms=%d: %s",
            model,
            elapsed_ms,
            e,
        )
        raise ExtractionError(f"Anthropic API error: {e}") from e

    tool_input = _extract_tool_use_input(response)
    if tool_input is None:
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        logger.warning(
            "Model returned no tool_use block model=%s stop_reason=%s — refusing extraction",
            model,
            response.stop_reason,
        )
        raise ExtractionError(
            f"Model did not call {TOOL_NAME} (stop_reason={response.stop_reason})"
        )

    try:
        profile = ComponentProfile.model_validate(tool_input)
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        meta = ExtractionMetadata(
            model=model,
            latency_ms=elapsed_ms,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
            cache_read_input_tokens=getattr(response.usage, "cache_read_input_tokens", 0) or 0,
            cache_creation_input_tokens=getattr(response.usage, "cache_creation_input_tokens", 0)
            or 0,
            retry_attempted=False,
        )
        logger.info(
            "EXTRACTION_OK model=%s latency_ms=%d input=%d output=%d cache_read=%d "
            "confidence=%.2f review=%s",
            meta.model,
            meta.latency_ms,
            meta.input_tokens,
            meta.output_tokens,
            meta.cache_read_input_tokens,
            profile.confidence.overall,
            profile.confidence.needs_human_review,
        )
        return profile, meta
    except ValidationError as ve:
        logger.warning("First-attempt validation failed: %s", ve)
        first_attempt_content = response.content
        first_attempt_error = str(ve)

    # --- Retry once with the validation error in a tool_result --------------
    retry_feedback = (
        "Your previous save_component_profile call failed Pydantic validation "
        "with this error:\n\n"
        f"{first_attempt_error}\n\n"
        "Call save_component_profile again with a corrected payload. Do not "
        "change facts — only fix the schema violations (missing required fields, "
        "wrong types, invalid enum values, etc.)."
    )
    try:
        retry_response = _call_claude(
            client,
            model=model,
            messages=_build_messages(
                user_msg,
                prior_assistant_content=first_attempt_content,
                retry_feedback=retry_feedback,
            ),
            max_tokens=max_tokens,
        )
    except anthropic.APIError as e:
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        logger.error(
            "Anthropic API error on retry model=%s latency_ms=%d: %s",
            model,
            elapsed_ms,
            e,
        )
        raise ExtractionError(f"Anthropic API error on retry: {e}") from e

    retry_tool_input = _extract_tool_use_input(retry_response)
    if retry_tool_input is None:
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        raise ExtractionError(
            f"Retry: model did not call {TOOL_NAME} "
            f"(stop_reason={retry_response.stop_reason})"
        )

    try:
        profile = ComponentProfile.model_validate(retry_tool_input)
    except ValidationError as ve2:
        logger.error("Retry validation also failed: %s", ve2)
        raise ExtractionError(
            f"Validation failed twice — first: {first_attempt_error}\nretry: {ve2}"
        ) from ve2

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    meta = ExtractionMetadata(
        model=model,
        latency_ms=elapsed_ms,
        input_tokens=response.usage.input_tokens + retry_response.usage.input_tokens,
        output_tokens=response.usage.output_tokens + retry_response.usage.output_tokens,
        cache_read_input_tokens=(
            (getattr(response.usage, "cache_read_input_tokens", 0) or 0)
            + (getattr(retry_response.usage, "cache_read_input_tokens", 0) or 0)
        ),
        cache_creation_input_tokens=(
            (getattr(response.usage, "cache_creation_input_tokens", 0) or 0)
            + (getattr(retry_response.usage, "cache_creation_input_tokens", 0) or 0)
        ),
        retry_attempted=True,
    )
    logger.info(
        "EXTRACTION_OK_AFTER_RETRY model=%s latency_ms=%d input=%d output=%d "
        "confidence=%.2f review=%s",
        meta.model,
        meta.latency_ms,
        meta.input_tokens,
        meta.output_tokens,
        profile.confidence.overall,
        profile.confidence.needs_human_review,
    )
    return profile, meta
