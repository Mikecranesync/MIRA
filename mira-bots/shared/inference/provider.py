"""The MIRA-1000 inference-provider seam.

One interface, two editions:

    InferenceProvider.respond(...)
        ├── CascadeProvider          # Groq → Cerebras → Together (default, free-tier)
        └── OpenAIResponsesProvider  # Cloud Gold — NOT BUILT YET (P0003+)

**Why this lives ABOVE `InferenceRouter` and not inside it.**
`InferenceRouter.complete()` is ``(messages, max_tokens, session_id, sanitize) ->
(str, dict)`` and has 11 production call sites (``engine.py`` ×7, ``pm_extractor``,
``quality_gate``, ``nameplate_worker``, ``query_triage``, ``rag_worker``). Tools,
policy and streaming cannot be added to that signature without breaking all of
them. Wrapping preserves every one, and both editions inherit the richer contract
once. See ``docs/architecture/mira-1000/CURRENT_TO_TARGET_MAP.md`` §5.

**This module is behavior-preserving by construction.** ``CascadeProvider``
delegates to the existing router and adds nothing: the same PII sanitization,
retry/backoff, provider budget tracking, gibberish detection and usage logging
run unchanged. ``tools`` and ``policy`` are accepted and **ignored** here, because
the free cascade cannot honor them — that is a documented limitation of this
provider, not of the interface.

**No FactoryLM business logic belongs in this file** (MIRA-1000 PRD §12). Context
assembly, permission evaluation, evidence validation, citation compliance and
tool execution all stay above or around the provider, where they already live.

Doctrine: paid providers on the chat/diagnosis path are governed by **ADR-0037**.
The free cascade is the default for every edition; Cloud Gold is opt-in and never
the fallback.
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from .events import TurnEnvelope, envelope_from_completed_text
from .router import InferenceRouter

#: Selects the active provider. Default is today's behavior, byte-for-byte.
PROVIDER_ENV = "MIRA_INFERENCE_PROVIDER"
DEFAULT_PROVIDER = "cascade"


@dataclass(frozen=True)
class ToolCall:
    """A model's *request* to call a tool. Never a record that one ran.

    Execution, permission evaluation and audit are FactoryLM's job. A model
    statement that something happened is never proof that it happened
    (MIRA-1000 PRD §18).
    """

    id: str
    name: str
    arguments: dict


@dataclass(frozen=True)
class TurnResult:
    """One provider turn.

    Expresses what ``-> str`` cannot: tool calls, provider identity, usage and a
    finish reason. ``text`` is the assistant's reply and stays first so callers
    that only want the string keep reading naturally.
    """

    text: str
    provider: str
    usage: dict = field(default_factory=dict)
    tool_calls: tuple[ToolCall, ...] = ()
    finish_reason: str = "stop"
    #: The P0003 conversation-event view of this same turn. Providers that cannot
    #: stream emit one ASSISTANT_TEXT + USAGE + FINAL; they must NOT fabricate
    #: deltas from a completed string (see events.py).
    events: TurnEnvelope = field(default_factory=TurnEnvelope)

    @property
    def ok(self) -> bool:
        """True when the turn produced something actionable.

        An empty cascade result (every provider exhausted) is ``False`` — the
        same condition ``complete()`` signals by returning ``("", {})``.
        """
        return bool(self.text) or bool(self.tool_calls)


class InferenceProvider(ABC):
    """Supplies intelligence. Supplies nothing else."""

    #: Stable identifier used in telemetry and provider selection.
    name: str = "abstract"

    @abstractmethod
    async def respond(
        self,
        conversation: list[dict],
        *,
        context: dict | None = None,
        tools: list[dict] | None = None,
        policy: dict | None = None,
        metadata: dict | None = None,
    ) -> TurnResult:
        """Produce one turn.

        Args:
            conversation: OpenAI-shaped message list.
            context: assembled FactoryLM context. Providers MUST NOT assemble it.
            tools: tool schemas the model may call. A provider that cannot honor
                tools MUST ignore them and say so in its docstring — never
                silently pretend to support them.
            policy: caller-supplied constraints (budget, service tier, effort).
            metadata: transport details — ``session_id``, ``max_tokens``,
                ``sanitize``.
        """
        raise NotImplementedError


class CascadeProvider(InferenceProvider):
    """Today's Groq → Cerebras → Together cascade, unchanged.

    **Limitations, stated rather than hidden:**

    * ``tools`` are accepted and **ignored** — the cascade has no tool-calling
      path. A caller that needs tools must select a provider that supports them.
    * ``policy`` is accepted and **ignored** — there is no service tier or spend
      control to apply to a free-tier cascade.
    * ``context`` is accepted and **ignored** — on this path the engine has
      already folded context into ``conversation`` before calling.

    Everything else is the existing router: sanitization, retries, budget
    tracking, gibberish rejection and usage logging all still happen inside
    ``InferenceRouter.complete()``.
    """

    name = "cascade"

    def __init__(self, router: InferenceRouter | None = None) -> None:
        # Injectable for contract tests; defaults to a real router so callers
        # need no wiring.
        self._router = router if router is not None else InferenceRouter()

    @property
    def router(self) -> InferenceRouter:
        """The wrapped router — exposed so callers mid-migration can still reach it."""
        return self._router

    async def respond(
        self,
        conversation: list[dict],
        *,
        context: dict | None = None,
        tools: list[dict] | None = None,
        policy: dict | None = None,
        metadata: dict | None = None,
    ) -> TurnResult:
        md = metadata or {}
        text, usage = await self._router.complete(
            conversation,
            max_tokens=md.get("max_tokens", 1024),
            session_id=md.get("session_id", "unknown_unknown_unknown"),
            sanitize=md.get("sanitize", True),
        )
        # `complete()` returns ("", {}) when every provider is exhausted, and
        # ("", last_error) when the last one returned empty content. Both are
        # "no usable text" — surfaced as finish_reason="empty" rather than an
        # exception, matching the router's own non-raising contract.
        provider_name = usage.get("provider") or self.name
        return TurnResult(
            text=text,
            provider=provider_name,
            usage=usage,
            finish_reason="stop" if text else "empty",
            # Coarse-but-honest: the cascade hands back a finished string, so the
            # envelope carries one ASSISTANT_TEXT (or a recoverable error when the
            # cascade was exhausted) plus usage. stream_was_incremental stays False.
            events=envelope_from_completed_text(
                text,
                usage=usage or None,
                error=None if text else "cascade_exhausted",
            ),
        )


def turn_telemetry(turn: TurnResult) -> dict:
    """Project a TurnResult onto the per-turn telemetry fields (migration 078).

    ADR-0037 makes per-turn spend telemetry a PRECONDITION for Cloud Gold traffic.
    This is the one place a provider result becomes those columns, so the runtime
    and the trace writer cannot drift apart.

    Deliberately narrow — counts, identity and status only. The provider's `usage`
    dict is read by explicit key, so if a provider ever returns prompt text or a
    credential in it, nothing here carries that to the database.

    `status` distinguishes the three real outcomes so a spend query can tell them
    apart: a served turn, an exhausted cascade, and a turn that never ran.
    """
    u = turn.usage or {}
    return {
        "provider": turn.provider,
        "model_used": u.get("model"),
        "input_tokens": u.get("input_tokens"),
        # The free cascade does not report cache hits; Cloud Gold will
        # (usage.input_tokens_details.cached_tokens, verified 2026-08-19).
        "cached_input_tokens": u.get("cached_input_tokens"),
        "output_tokens": u.get("output_tokens"),
        "tool_call_count": len(turn.tool_calls),
        "status": "ok" if turn.text else "empty",
        # Which edition served the turn and why. Explicit so ADR-0037's
        # "Cloud Gold is never silently selected" is auditable per row.
        "route_reason": f"{turn.provider}:{os.getenv(PROVIDER_ENV) or DEFAULT_PROVIDER}",
    }


def get_provider(
    name: str | None = None,
    *,
    router: InferenceRouter | None = None,
) -> InferenceProvider:
    """Return the configured provider. Defaults to today's behavior.

    Selection order: explicit argument, then ``MIRA_INFERENCE_PROVIDER``, then
    ``cascade``. An unknown name raises rather than silently falling back — a
    deployment that asked for Cloud Gold and quietly got the free cascade would
    be a spend/quality bug that hides itself.

    ``router`` is the caller's already-constructed :class:`InferenceRouter`. It
    MUST be threaded through rather than letting the cascade build its own,
    because the runtime's router carries per-process state the callers depend on
    — the session→model cache (``last_model_for``, which the decision trace reads),
    the hourly provider budget counters, and the enabled/backend flags. A second
    router would silently fork all of that.

    This parameter is what makes provider selection real on the runtime path: a
    caller that holds a router can still honor ``MIRA_INFERENCE_PROVIDER`` instead
    of hardcoding one edition.
    """
    requested = (name or os.getenv(PROVIDER_ENV) or DEFAULT_PROVIDER).strip().lower()
    if requested == "cascade":
        return CascadeProvider(router=router)
    raise ValueError(
        f"unknown inference provider {requested!r} "
        f"(available: 'cascade'; Cloud Gold is not implemented yet — see ADR-0037)"
    )
