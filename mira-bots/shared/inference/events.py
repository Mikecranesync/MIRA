"""The provider-independent MIRA conversation/event contract (MIRA-1000 P0003 Part C).

This is the vocabulary every MIRA client renders and every provider emits. It is
deliberately **not** OpenAI's event vocabulary: `response.output_text.delta` and
friends are one vendor's wire format, and P0003 forbids exposing them as the
public FactoryLM client contract. A provider adapter translates *into* this.

**What this is for.** `Supervisor.process()` returns a bare `str`; `process_full()`
returns four keys. Neither can express a citation, a tool call, an approval
request, or a token delta — which is exactly what the conversation-first MIRA
client (P0004) has to render. Declaring the vocabulary now means P0004 does not
force another runtime rewrite.

**Honesty rule — no fake streaming.** The Cascade provider returns a completed
string. It therefore emits ONE `ASSISTANT_TEXT` event, not a synthetic run of
`ASSISTANT_TEXT_DELTA`. Chopping a finished reply into fake deltas would make the
telemetry and the client lie about what the provider did. When a provider gains
real incremental output it emits `ASSISTANT_TEXT_DELTA`; until then it must not.
`stream_was_incremental` on `TurnEnvelope` records which happened, so a reader can
tell the difference without guessing.

**Extension rule.** `EventType` is the closed vocabulary; `payload` is an open
mapping. Adding a *kind* of event means adding an `EventType` member (a contract
change, reviewed). Adding a *field* to an existing event does not. That keeps the
contract stable while leaving room for tools, approvals and attachments to land in
later slices without re-cutting the runtime.

Serialization is deterministic (sorted keys, no floats coerced) so an event stream
can be hashed, replayed, and diffed in tests — see
`mira-bots/tests/test_conversation_event_contract.py`.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Mapping


class EventType(str, Enum):
    """The closed set of MIRA conversation events.

    Every member is part of the public client contract. Members that no provider
    emits *yet* are declared deliberately: the point of P0003 Part C is that P0004
    can build against the final vocabulary instead of a moving one.
    """

    # ── assistant output ────────────────────────────────────────────────
    ASSISTANT_TEXT = "assistant.text"            # one complete message
    ASSISTANT_TEXT_DELTA = "assistant.text.delta"  # real incremental output ONLY

    # ── grounding ───────────────────────────────────────────────────────
    CITATION = "citation"                        # an evidence reference
    CONTEXT_CHANGED = "context.changed"          # active asset/UNS/notebook moved

    # ── tools (emitted from P0005) ──────────────────────────────────────
    TOOL_CALL_STARTED = "tool.call.started"
    TOOL_CALL_PROGRESS = "tool.call.progress"
    TOOL_CALL_COMPLETED = "tool.call.completed"
    TOOL_CALL_FAILED = "tool.call.failed"
    TOOL_RESULT = "tool.result"                  # typed result payload

    # ── approvals (emitted from P0006) ──────────────────────────────────
    APPROVAL_REQUIRED = "approval.required"
    APPROVAL_ACCEPTED = "approval.accepted"
    APPROVAL_REJECTED = "approval.rejected"

    # ── attachments ─────────────────────────────────────────────────────
    ATTACHMENT = "attachment"

    # ── accounting + lifecycle ──────────────────────────────────────────
    USAGE = "usage"                              # tokens/cost for one provider call
    FINAL = "final"                              # the turn completed
    ERROR_RECOVERABLE = "error.recoverable"      # turn continues
    ERROR_FATAL = "error.fatal"                  # turn is over


#: Events after which no further event may be emitted in the same turn.
TERMINAL_EVENTS = frozenset({EventType.FINAL, EventType.ERROR_FATAL})


@dataclass(frozen=True)
class MiraEvent:
    """One event in a turn. Immutable — an emitted event is a record, not a buffer."""

    type: EventType
    seq: int
    payload: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {"type": self.type.value, "seq": self.seq, "payload": dict(self.payload)}

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> MiraEvent:
        return cls(
            type=EventType(d["type"]),
            seq=int(d["seq"]),
            payload=dict(d.get("payload") or {}),
        )


@dataclass(frozen=True)
class TurnEnvelope:
    """The full event sequence for one turn, plus what actually produced it.

    `stream_was_incremental` is the anti-fake-streaming marker: True only when the
    provider genuinely emitted `ASSISTANT_TEXT_DELTA` as output arrived. A client
    may use it to decide whether a typing animation is honest.
    """

    events: tuple[MiraEvent, ...] = ()
    stream_was_incremental: bool = False

    # ── derived views (no recomputation of provider state) ──────────────
    @property
    def text(self) -> str:
        """The assistant's message, whether it arrived whole or as deltas."""
        whole = [e.payload.get("text", "") for e in self.events if e.type is EventType.ASSISTANT_TEXT]
        if whole:
            return "".join(whole)
        return "".join(
            e.payload.get("text", "")
            for e in self.events
            if e.type is EventType.ASSISTANT_TEXT_DELTA
        )

    @property
    def usage(self) -> dict[str, Any]:
        for e in reversed(self.events):
            if e.type is EventType.USAGE:
                return dict(e.payload)
        return {}

    @property
    def is_terminal(self) -> bool:
        return bool(self.events) and self.events[-1].type in TERMINAL_EVENTS

    def to_json(self) -> str:
        """Deterministic: sorted keys, stable separators. Safe to hash or diff."""
        return json.dumps(
            {
                "events": [e.to_dict() for e in self.events],
                "stream_was_incremental": self.stream_was_incremental,
            },
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        )

    @classmethod
    def from_json(cls, raw: str) -> TurnEnvelope:
        d = json.loads(raw)
        return cls(
            events=tuple(MiraEvent.from_dict(e) for e in d.get("events") or ()),
            stream_was_incremental=bool(d.get("stream_was_incremental", False)),
        )


def envelope_from_completed_text(
    text: str,
    *,
    usage: Mapping[str, Any] | None = None,
    error: str | None = None,
) -> TurnEnvelope:
    """Build the coarse envelope a non-streaming provider produces.

    P0003 explicitly permits this shape: "one final text event plus usage while the
    contract remains ready for real deltas later." `stream_was_incremental` stays
    False because nothing streamed — the provider handed back a finished string.

    An empty `text` is not silently dressed as success: the cascade returning ""
    (every provider exhausted) yields `ERROR_RECOVERABLE` + `FINAL`, so a client can
    tell "MIRA had nothing to say" from "MIRA said nothing because it broke".
    """
    events: list[MiraEvent] = []
    seq = 0
    if text:
        events.append(MiraEvent(EventType.ASSISTANT_TEXT, seq, {"text": text}))
        seq += 1
    elif error is not None:
        events.append(MiraEvent(EventType.ERROR_RECOVERABLE, seq, {"reason": error}))
        seq += 1
    if usage:
        events.append(MiraEvent(EventType.USAGE, seq, dict(usage)))
        seq += 1
    events.append(MiraEvent(EventType.FINAL, seq, {"ok": bool(text)}))
    return TurnEnvelope(events=tuple(events), stream_was_incremental=False)
