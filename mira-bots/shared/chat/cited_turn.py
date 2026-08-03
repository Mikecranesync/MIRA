"""The Cited Technician Turn — one response shape for every front door.

PRD: `docs/prd/2026-08-03-cited-technician-turn.md`, slice 0.

A technician-facing answer is not free text. It is a small set of named states,
each with required content and prohibited content:

    context confirmation   — a candidate asset, its evidence, and explicit controls
    direct certified       — the surface already proved WHERE; answer with citations
    confirmed grounded     — the chat gate was confirmed; answer with citations
    evidence gap           — an honest limit, not a plausible guess
    safety STOP            — a pause with a hazard category, never steps
    human handoff          — a reviewable draft, never an automatic send

This module BUILDS those states. It does not decide which one applies — that is
the engine's job (safety precedence, the location gate, grounding policy). Keep
it that way: a formatter that makes policy decisions becomes a second engine,
and `.claude/CLAUDE.md` forbids exactly that.

Two design choices worth knowing before editing:

* **`text` is derived from the blocks, never written by hand.** A renderer that
  cannot draw a block still shows its content, and a block added without a text
  equivalent is impossible rather than merely discouraged.
* **`data` payloads extend the existing keys, they do not replace them.** The
  live Slack/Google Chat/Teams renderers already read `text`, `pairs`,
  `buttons`, `source`, `suggestions`. A citation carries its richer fields
  ALONGSIDE the flat `source` string those renderers consume today, so this is
  additive. PRD §6.1: do not create a competing per-surface response schema.

Read-only by construction: nothing here writes, and no builder emits a control
action. `MIRA is read-only troubleshooting intelligence` (NORTH_STAR.md).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .types import NormalizedChatResponse, ResponseBlock

# Bump when a `data` payload changes shape. Renderers may key off this.
CONTRACT_VERSION = "factorylm.cited-turn.v1"

SourceType = Literal[
    "manual",  # OEM manual / documentation chunk
    "work_order",  # CMMS history
    "live_tag",  # telemetry read through a certified connection
    "kg",  # verified knowledge-graph relationship
    "drive_pack",  # per-drive intelligence pack
    "standard",  # OSHA / NFPA / ISA reference
    "technician",  # a technician's own confirmation, per provenance rules
]

# How current the evidence is. `static` is reference material that does not go
# stale; the rest describe live context. PRD §5.4 requires this be visible.
Freshness = Literal["static", "live", "stale", "simulated", "unavailable"]

# Context resolution band. Deliberately NOT a numeric score — PRD §11.1:
# "The technician never sees a numeric LLM confidence score."
Band = Literal["high", "medium", "low"]

ContextState = Literal["confirmed", "certified", "needs_confirmation"]


@dataclass
class Citation:
    """One piece of evidence, with enough detail to go look it up.

    `locator` is the part that makes a citation checkable rather than
    decorative: a page, a section, a work-order id, a tag plus timestamp.
    A citation without one is not evidence, and `build` rejects it.
    """

    source_type: SourceType
    label: str
    locator: str
    freshness: Freshness = "static"
    status: Literal["verified", "proposed", ""] = ""

    def flat(self) -> str:
        """The one-line form the existing renderers already draw."""
        parts = [self.label, self.locator]
        if self.freshness not in ("static", "live"):
            parts.append(self.freshness)
        if self.status == "proposed":
            parts.append("proposed")
        return " — ".join(p for p in parts if p)

    def payload(self) -> dict:
        return {
            "v": CONTRACT_VERSION,
            "source": self.flat(),  # what slack_blocks/gchat/teams read today
            "source_type": self.source_type,
            "label": self.label,
            "locator": self.locator,
            "freshness": self.freshness,
            "status": self.status,
        }


@dataclass
class TurnContext:
    """Where the technician is working, and how we know."""

    asset: str = ""
    site: str = ""
    area: str = ""
    line: str = ""
    component: str = ""
    fault: str = ""
    state: ContextState = "needs_confirmation"
    band: Band = "low"
    uns_path: str = ""
    source: str = ""  # e.g. "direct_connection", "chat_resolver"

    def summary(self) -> str:
        """Site -> asset -> component -> fault, in that order (PRD §7.1)."""
        parts = [p for p in (self.site, self.area, self.line, self.asset, self.component) if p]
        head = " / ".join(parts) if parts else "unknown asset"
        return f"{head} — {self.fault}" if self.fault else head

    def label(self) -> str:
        return {
            "confirmed": "Confirmed",
            "certified": "Certified connection",
            "needs_confirmation": "Needs confirmation",
        }[self.state]


@dataclass
class Action:
    label: str
    action: str
    value: str = ""

    def payload(self) -> dict:
        return {"label": self.label, "action": self.action, "value": self.value}


# ── block helpers ────────────────────────────────────────────────────────────


def _header(text: str) -> ResponseBlock:
    return ResponseBlock(kind="header", data={"text": text})


def _para(text: str) -> ResponseBlock:
    return ResponseBlock(kind="paragraph", data={"text": text})


def _kv(pairs: list[tuple[str, str]]) -> ResponseBlock:
    return ResponseBlock(kind="key_value", data={"pairs": [list(p) for p in pairs]})


def _bullets(items: list[str]) -> ResponseBlock:
    return ResponseBlock(kind="bullet_list", data={"items": list(items)})


def _warn(text: str) -> ResponseBlock:
    return ResponseBlock(kind="warning", data={"text": text})


def _buttons(actions: list[Action]) -> ResponseBlock:
    return ResponseBlock(kind="button_row", data={"buttons": [a.payload() for a in actions]})


def _cite(c: Citation) -> ResponseBlock:
    return ResponseBlock(kind="citation", data=c.payload())


def _context_blocks(ctx: TurnContext) -> list[ResponseBlock]:
    pairs = [("Context", ctx.summary()), ("Status", ctx.label())]
    if ctx.state == "needs_confirmation":
        pairs.append(("Match confidence", ctx.band))
    return [_kv(pairs)]


# ── text fallback ────────────────────────────────────────────────────────────


def _block_text(b: ResponseBlock) -> str:
    """The accessible text equivalent of one block.

    Every kind in the `ResponseBlock` Literal must appear here. A kind that
    falls through returns "" and its content silently disappears from the
    fallback — the conformance suite asserts against exactly that.
    """
    d = b.data
    if b.kind in ("header", "paragraph", "warning"):
        return str(d.get("text", ""))
    if b.kind == "key_value":
        return "\n".join(f"{k}: {v}" for k, v in d.get("pairs", []))
    if b.kind == "bullet_list":
        return "\n".join(f"- {i}" for i in d.get("items", []))
    if b.kind == "citation":
        return f"[Source: {d.get('source', '')}]"
    if b.kind == "button_row":
        return " | ".join(btn.get("label", "") for btn in d.get("buttons", []))
    if b.kind == "suggestion_chips":
        return " | ".join(d.get("suggestions", []))
    if b.kind == "code":
        return str(d.get("code", ""))
    if b.kind == "image":
        return str(d.get("alt", "")) or "[image]"
    if b.kind == "divider":
        return ""
    return ""


def build(blocks: list[ResponseBlock], thread_id: str = "") -> NormalizedChatResponse:
    """Assemble a response and derive its plain-text fallback from the blocks."""
    for b in blocks:
        if b.kind == "citation" and not b.data.get("locator"):
            raise ValueError(f"citation without a locator is not evidence: {b.data!r}")
    text = "\n\n".join(t for t in (_block_text(b) for b in blocks) if t)
    return NormalizedChatResponse(text=text, blocks=list(blocks), thread_id=thread_id)


# ── the six turn states ──────────────────────────────────────────────────────


def context_confirmation(
    ctx: TurnContext,
    evidence: list[str],
    thread_id: str = "",
) -> NormalizedChatResponse:
    """Asset-specific chat with a candidate, before any troubleshooting.

    The gate: no confirmed namespace context, no troubleshooting. This card
    proposes a context and hands back explicit controls. It must not contain a
    diagnosis, a reset instruction, or a next step.
    """
    blocks = [
        _header("Which machine is this?"),
        *_context_blocks(ctx),
    ]
    if evidence:
        blocks.append(_bullets(evidence[:3]))  # three bullets max (PRD §5.4)
    blocks.append(
        _buttons(
            [
                Action("Confirm this asset", "context.confirm", ctx.uns_path or ctx.asset),
                Action("Different asset", "context.reject"),
                Action("Clarify", "context.clarify"),
            ]
        )
    )
    return build(blocks, thread_id)


def grounded_answer(
    ctx: TurnContext,
    answer: str,
    next_check: str,
    citations: list[Citation],
    thread_id: str = "",
) -> NormalizedChatResponse:
    """A cited answer on confirmed or certified context.

    Covers both `confirmed grounded` and `direct certified` — they differ only
    in how context was established, which `ctx.state` already carries. Refusing
    to fork them here is deliberate: two builders would drift.
    """
    if ctx.state == "needs_confirmation":
        raise ValueError("a grounded answer requires confirmed or certified context")
    if not citations:
        raise ValueError("a grounded answer requires at least one citation; use evidence_gap()")

    blocks = [
        *_context_blocks(ctx),
        _para(answer),
        _kv([("Next safe check", next_check)]),
        *[_cite(c) for c in citations[:3]],
    ]
    actions = [
        Action("View evidence", "evidence.open"),
        Action("Resolved", "outcome.resolved"),
        Action("Still need help", "outcome.unresolved"),
        Action("Source is wrong", "evidence.dispute"),
    ]
    blocks.append(_buttons(actions))
    return build(blocks, thread_id)


def evidence_gap(
    ctx: TurnContext,
    can_verify: str,
    cannot_verify: str,
    smallest_request: str,
    citations: list[Citation] | None = None,
    thread_id: str = "",
) -> NormalizedChatResponse:
    """An honest limit. This is a successful outcome, not a failure.

    It says what is known, what is not, and the single most useful missing
    fact. It must not pad itself out with generic advice.
    """
    blocks = [
        *_context_blocks(ctx),
        _warn("I don't have enough evidence to answer this safely."),
        _kv([("What I can verify", can_verify), ("What I can't", cannot_verify)]),
        _para(f"Most useful next input: {smallest_request}"),
    ]
    blocks.extend(_cite(c) for c in (citations or [])[:3])
    blocks.append(
        _buttons(
            [
                Action("Send that detail", "gap.provide"),
                Action("Draft handoff", "handoff.draft"),
            ]
        )
    )
    return build(blocks, thread_id)


def safety_stop(
    hazard: str,
    standard: str,
    thread_id: str = "",
) -> NormalizedChatResponse:
    """A hard pause. Safety is evaluated before context or answer behavior.

    No steps, no numbered list, no troubleshooting — and no control action. An
    acknowledgement may be recorded but it does not unlock anything; a fresh
    non-safety message is required to start a new safe path.
    """
    blocks = [
        _header("Stopping here"),
        _warn(f"This involves {hazard}. I can't give steps for this work."),
        _kv([("Hazard category", hazard), ("Applicable standard", standard)]),
        _para(
            "A qualified person needs to take this over, following your site's "
            "lockout/tagout and permit procedures."
        ),
        _buttons(
            [
                Action("Escalate to a qualified person", "safety.escalate"),
                Action("I understand", "safety.acknowledge"),
            ]
        ),
    ]
    return build(blocks, thread_id)


def human_handoff(
    ctx: TurnContext,
    attempts: list[str],
    open_question: str,
    citations: list[Citation] | None = None,
    thread_id: str = "",
) -> NormalizedChatResponse:
    """A reviewable summary. Draft only — a human decides whether it is sent."""
    blocks = [
        _header("Handoff summary (draft)"),
        *_context_blocks(ctx),
    ]
    if attempts:
        blocks.append(_bullets([f"Tried: {a}" for a in attempts]))
    blocks.append(_kv([("Open question", open_question)]))
    blocks.extend(_cite(c) for c in (citations or [])[:3])
    blocks.append(
        _buttons(
            [
                Action("Draft handoff", "handoff.draft"),
                Action("Keep troubleshooting", "handoff.cancel"),
            ]
        )
    )
    return build(blocks, thread_id)


def uns_required(thread_id: str = "") -> NormalizedChatResponse:
    """A direct-connection turn arrived without a resolvable identity.

    The adapter should reject with `{"error": "uns_required"}` before reaching
    here. This exists so a surface that must render something renders a
    rejection — never a chat-gate question, which would silently downgrade a
    certified surface into free text (`direct-connection-uns-certified.md`).
    """
    return build(
        [
            _warn("This connection didn't identify which machine it's on."),
            _para(
                "I can't answer for an unidentified asset. The connection needs to "
                "supply a UNS path, asset context, or equipment id."
            ),
        ],
        thread_id,
    )
