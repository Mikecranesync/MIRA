"""Dialogue State — typed data shapes for MIRA's Stage 1 dialogue tracker.

This module emulates LangGraph's `MessagesState` / `StateGraph` data shapes
without taking a LangGraph dependency. Key patterns lifted (and reasons):

* **Typed state object** (LangGraph `MessagesState`): one canonical dict-of-
  dicts that flows through pure-function nodes. `DialogueState` here.
* **Discriminated-union "commands"** (Rasa CALM 2024 `set_slot` / `start_flow`
  vocabulary): each dialogue act is its own dataclass, distinguished by a
  `Literal` `act` field. The dispatcher does `match` over the type — never a
  nullable-field check.
* **Persistent "checkpointer"** state (LangGraph `BaseCheckpointSaver`): all of
  this serialises to JSON and rides on the existing SQLite
  `conversation_state.context` blob via `to_dict()` / `from_dict()`.

Pure data; no I/O, no HTTP, no DB. Importing this module must stay free of
side effects so the engine and the tests can both pull it in cheaply.

PLAN.md §2 — "Dialogue State Tracker (DST) + Slot-Filling + Action Router".
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal, Optional, Union

# ---------------------------------------------------------------------------
# Slot vocabulary — what MIRA can be waiting for
# ---------------------------------------------------------------------------

SlotName = Literal[
    "asset_identification",
    "fault_code",
    "symptom_detail",
    "wo_confirmation",
    "wo_field_supply",
    "manual_vendor_model",
    "pm_acceptance",
    "fix_confirmation",
    "diagnostic_branch_choice",
    "none",
]

# The 10-act minimal taxonomy. Aligns with Rasa CALM 2024 commands and the
# DAMSL / ISO 24617-2 act categories. We deliberately keep it small — the
# full ISO taxonomy is 56 acts; >95% of industrial-bot turns fit the 10.
DialogueActName = Literal[
    "answer",
    "inform",
    "request_action",
    "ask",
    "dont_know",
    "confirm",
    "deny",
    "meta",
    "greet",
    "safety",
]

# Actions the user can request that MIRA performs. Subset of the existing
# `conversation_router.INTENTS` lifted into the dialogue-act layer.
ActionName = Literal[
    "log_work_order",
    "switch_asset",
    "find_documentation",
    "store_documentation",
    "schedule_maintenance",
    "check_equipment_history",
    "reset",
]

# Action requests in this set always preempt the active flow (Microsoft Bot
# Framework "interruption recognizer" pattern). Everything else falls through
# to existing dispatch.
ALWAYS_INTERRUPT_ACTIONS: frozenset[str] = frozenset({"log_work_order", "switch_asset", "reset"})

# Meta-control commands.
MetaCommand = Literal["cancel", "reset", "skip", "back", "stop"]

# Question kinds — used by the AskQuestion act so the engine can route
# procedural how-to questions to the same handler the keyword classifier
# already uses today.
QuestionKind = Literal["procedural", "general", "definition", "comparison"]


# ---------------------------------------------------------------------------
# Salient entities — pinned across turns, load-bearing for retrieval
# ---------------------------------------------------------------------------


@dataclass
class SalientEntities:
    """Entities held in session memory across turns. Used to:

    * Hard-filter RAG retrieval to the salient vendor (Stage 2.4 — not yet wired)
    * Carry context across an action interrupt (e.g. WO request mid-Q2)
    * Provide the LLM with a stable view of "what we've established so far"
    """

    vendor: Optional[str] = None
    model: Optional[str] = None
    fault_code: Optional[str] = None
    asset_label: Optional[str] = None
    last_action_proposed: Optional[str] = None

    def merge(self, other: SalientEntities) -> SalientEntities:
        """Return a new SalientEntities with `other`'s non-empty fields layered
        over `self`. Empty / None values in `other` never overwrite a populated
        slot in `self`."""
        return SalientEntities(
            vendor=other.vendor or self.vendor,
            model=other.model or self.model,
            fault_code=other.fault_code or self.fault_code,
            asset_label=other.asset_label or self.asset_label,
            last_action_proposed=other.last_action_proposed or self.last_action_proposed,
        )

    def to_dict(self) -> dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v is not None}

    @classmethod
    def from_dict(cls, data: Optional[dict[str, Any]]) -> SalientEntities:
        if not data:
            return cls()
        # Accept anything; ignore unknown keys to stay forward-compatible.
        return cls(
            vendor=data.get("vendor"),
            model=data.get("model"),
            fault_code=data.get("fault_code"),
            asset_label=data.get("asset_label"),
            last_action_proposed=data.get("last_action_proposed"),
        )


# ---------------------------------------------------------------------------
# Pending question — what MIRA last asked the user
# ---------------------------------------------------------------------------


@dataclass
class PendingQuestion:
    """The slot MIRA is currently waiting on. `slot="none"` means MIRA is not
    blocking on a user reply (the next turn is interpreted from scratch)."""

    slot: SlotName = "none"
    asked_at_turn: int = 0
    options: list[str] = field(default_factory=list)
    raw_text: str = ""

    @property
    def is_pending(self) -> bool:
        return self.slot != "none"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Optional[dict[str, Any]]) -> PendingQuestion:
        if not data:
            return cls()
        slot = data.get("slot", "none")
        # Coerce unknown slot values back to "none" so a corrupt SQLite blob
        # never crashes the tracker.
        if slot not in {
            "asset_identification",
            "fault_code",
            "symptom_detail",
            "wo_confirmation",
            "wo_field_supply",
            "manual_vendor_model",
            "pm_acceptance",
            "fix_confirmation",
            "diagnostic_branch_choice",
            "none",
        }:
            slot = "none"
        return cls(
            slot=slot,
            asked_at_turn=int(data.get("asked_at_turn", 0) or 0),
            options=list(data.get("options") or []),
            raw_text=str(data.get("raw_text", "") or ""),
        )


# ---------------------------------------------------------------------------
# Dialogue acts — discriminated union over `act` field
# ---------------------------------------------------------------------------
#
# Each act is its own dataclass. The `act` field is a `Literal` so type-aware
# tools (and the dispatcher's `match` statement) can exhaustively check the
# union. Forbidden combinations (e.g. `act=dont_know` with a `slot_fill_value`)
# are structurally impossible.


@dataclass(frozen=True)
class AnswerAct:
    """User answered MIRA's pending question. Fill the slot and advance."""

    slot_fill_value: str
    reasoning: str = ""
    entities: SalientEntities = field(default_factory=SalientEntities)
    act: Literal["answer"] = "answer"


@dataclass(frozen=True)
class InformAct:
    """User volunteered information without being asked. No pending slot to fill."""

    reasoning: str = ""
    entities: SalientEntities = field(default_factory=SalientEntities)
    act: Literal["inform"] = "inform"


@dataclass(frozen=True)
class RequestActionAct:
    """User issued an imperative — make a WO, find a manual, switch asset."""

    action: ActionName
    reasoning: str = ""
    entities: SalientEntities = field(default_factory=SalientEntities)
    act: Literal["request_action"] = "request_action"

    @property
    def is_interrupt(self) -> bool:
        return self.action in ALWAYS_INTERRUPT_ACTIONS


@dataclass(frozen=True)
class AskQuestionAct:
    """User asked a question (procedural how-to or general industrial)."""

    question_kind: QuestionKind = "general"
    reasoning: str = ""
    entities: SalientEntities = field(default_factory=SalientEntities)
    act: Literal["ask"] = "ask"


@dataclass(frozen=True)
class DontKnowAct:
    """User expressed uncertainty. MUST NOT be embedded as a vector query."""

    reasoning: str = ""
    act: Literal["dont_know"] = "dont_know"


@dataclass(frozen=True)
class ConfirmAct:
    """User confirmed (yes/right/correct) — usually answering a yes/no slot."""

    reasoning: str = ""
    act: Literal["confirm"] = "confirm"


@dataclass(frozen=True)
class DenyAct:
    """User denied (no/incorrect/that's wrong)."""

    reasoning: str = ""
    act: Literal["deny"] = "deny"


@dataclass(frozen=True)
class MetaControlAct:
    """nevermind / start over / skip / cancel — preempt and reset flow."""

    command: MetaCommand
    reasoning: str = ""
    act: Literal["meta"] = "meta"


@dataclass(frozen=True)
class GreetAck:
    """hi / hello / thanks — pure pleasantry, not a real task request."""

    reasoning: str = ""
    act: Literal["greet"] = "greet"


@dataclass(frozen=True)
class SafetyAct:
    """Safety override. Always wins, regardless of FSM state."""

    hazard_summary: str = ""
    reasoning: str = ""
    act: Literal["safety"] = "safety"


# Discriminated union — the single typed return of the classifier.
DialogueTurn = Union[
    AnswerAct,
    InformAct,
    RequestActionAct,
    AskQuestionAct,
    DontKnowAct,
    ConfirmAct,
    DenyAct,
    MetaControlAct,
    GreetAck,
    SafetyAct,
]


_ACT_REGISTRY: dict[str, type] = {
    "answer": AnswerAct,
    "inform": InformAct,
    "request_action": RequestActionAct,
    "ask": AskQuestionAct,
    "dont_know": DontKnowAct,
    "confirm": ConfirmAct,
    "deny": DenyAct,
    "meta": MetaControlAct,
    "greet": GreetAck,
    "safety": SafetyAct,
}


def turn_from_dict(data: Any) -> Optional[DialogueTurn]:
    """Reconstruct a typed DialogueTurn from a JSON-decoded value.

    Accepts `Any` because the input is the result of `json.loads` on a model
    response — type discipline starts here, not before. Returns None when the
    payload is malformed or the act is unknown so callers can fall back to
    the keyword classifier or default flow.
    """
    if not isinstance(data, dict):
        return None
    act_name = data.get("act")
    cls = _ACT_REGISTRY.get(act_name) if isinstance(act_name, str) else None
    if cls is None:
        return None

    entities = SalientEntities.from_dict(data.get("entities"))
    reasoning = str(data.get("reasoning", "") or "")[:300]

    try:
        if cls is AnswerAct:
            return AnswerAct(
                slot_fill_value=str(data.get("slot_fill_value", "") or "")[:200],
                reasoning=reasoning,
                entities=entities,
            )
        if cls is InformAct:
            return InformAct(reasoning=reasoning, entities=entities)
        if cls is RequestActionAct:
            action = data.get("action")
            if action not in {
                "log_work_order",
                "switch_asset",
                "find_documentation",
                "store_documentation",
                "schedule_maintenance",
                "check_equipment_history",
                "reset",
            }:
                return None
            return RequestActionAct(action=action, reasoning=reasoning, entities=entities)
        if cls is AskQuestionAct:
            qk = data.get("question_kind", "general")
            if qk not in {"procedural", "general", "definition", "comparison"}:
                qk = "general"
            return AskQuestionAct(question_kind=qk, reasoning=reasoning, entities=entities)
        if cls is DontKnowAct:
            return DontKnowAct(reasoning=reasoning)
        if cls is ConfirmAct:
            return ConfirmAct(reasoning=reasoning)
        if cls is DenyAct:
            return DenyAct(reasoning=reasoning)
        if cls is MetaControlAct:
            cmd = data.get("command", "cancel")
            if cmd not in {"cancel", "reset", "skip", "back", "stop"}:
                cmd = "cancel"
            return MetaControlAct(command=cmd, reasoning=reasoning)
        if cls is GreetAck:
            return GreetAck(reasoning=reasoning)
        if cls is SafetyAct:
            return SafetyAct(
                hazard_summary=str(data.get("hazard_summary", "") or "")[:200],
                reasoning=reasoning,
            )
    except (TypeError, ValueError):
        return None
    return None


def turn_to_dict(turn: DialogueTurn) -> dict[str, Any]:
    """Serialise a DialogueTurn back to a JSON-safe dict (for logging / storage)."""
    out: dict[str, Any] = {"act": turn.act, "reasoning": turn.reasoning}
    if isinstance(turn, AnswerAct):
        out["slot_fill_value"] = turn.slot_fill_value
        out["entities"] = turn.entities.to_dict()
    elif isinstance(turn, InformAct):
        out["entities"] = turn.entities.to_dict()
    elif isinstance(turn, RequestActionAct):
        out["action"] = turn.action
        out["entities"] = turn.entities.to_dict()
    elif isinstance(turn, AskQuestionAct):
        out["question_kind"] = turn.question_kind
        out["entities"] = turn.entities.to_dict()
    elif isinstance(turn, MetaControlAct):
        out["command"] = turn.command
    elif isinstance(turn, SafetyAct):
        out["hazard_summary"] = turn.hazard_summary
    return out


# ---------------------------------------------------------------------------
# DialogueState — the canonical state object that flows through the tracker
# ---------------------------------------------------------------------------
#
# This is the LangGraph `MessagesState` analogue: one typed object that every
# tracker node reads from and writes to. `to_dict()` / `from_dict()` make it
# JSON-safe so the existing `session_manager.save_state` SQLite path can carry
# it on the existing `context` blob — no schema migration needed.


@dataclass
class DialogueState:
    """The canonical conversation state. Subordinate to (not replacing) the
    existing FSM in engine.py — the FSM tracks WHERE we are in the diagnosis
    ladder; this tracks WHAT the user is doing right now, plus persistent
    salient entities and any pending interrupt to resume."""

    chat_id: str = ""
    fsm_state: str = "IDLE"
    pending_question: PendingQuestion = field(default_factory=PendingQuestion)
    salient_entities: SalientEntities = field(default_factory=SalientEntities)
    last_dialogue_act: Optional[str] = None
    # When an interrupt action preempts an active diagnosis, snapshot enough
    # state to resume: FSM state + pending question. The next Inform/Answer
    # turn after the interrupt completes can offer a resume prompt.
    interrupted_thread: Optional[dict[str, Any]] = None
    # Last 6 turns. Engine still owns the full history; this is a working
    # copy passed into the classifier's prompt.
    history_snippet: list[dict[str, str]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """JSON-safe serialisation. Lives under `state.context["dialogue"]`."""
        return {
            "fsm_state": self.fsm_state,
            "pending_question": self.pending_question.to_dict(),
            "salient_entities": self.salient_entities.to_dict(),
            "last_dialogue_act": self.last_dialogue_act,
            "interrupted_thread": self.interrupted_thread,
        }

    @classmethod
    def from_engine_state(cls, chat_id: str, engine_state: dict[str, Any]) -> DialogueState:
        """Rehydrate a DialogueState from the existing engine state dict.

        Pulls `dialogue` out of `context` if present, otherwise reconstructs
        from `session_context.last_question` (so existing chats migrate
        seamlessly when the flag flips on)."""
        ctx = engine_state.get("context") or {}
        dialogue_blob = ctx.get("dialogue") or {}

        if dialogue_blob:
            return cls(
                chat_id=chat_id,
                fsm_state=engine_state.get("state", "IDLE"),
                pending_question=PendingQuestion.from_dict(dialogue_blob.get("pending_question")),
                salient_entities=SalientEntities.from_dict(dialogue_blob.get("salient_entities")),
                last_dialogue_act=dialogue_blob.get("last_dialogue_act"),
                interrupted_thread=dialogue_blob.get("interrupted_thread"),
                history_snippet=_take_history(ctx),
            )

        # First-time migration: build a minimal pending_question from the
        # existing session_context so we don't lose the "MIRA just asked X"
        # signal on the first turn after the flag flips.
        sc = ctx.get("session_context") or {}
        last_q = str(sc.get("last_question", "") or "").strip()
        last_options = list(sc.get("last_options") or [])
        pending = PendingQuestion()
        if last_q:
            # Slot inference is approximate — we don't know which slot the
            # legacy code was waiting on. Use a conservative default and let
            # the classifier infer the user's act from the question text.
            pending = PendingQuestion(
                slot="diagnostic_branch_choice" if last_options else "symptom_detail",
                asked_at_turn=int(engine_state.get("exchange_count", 0)),
                options=last_options,
                raw_text=last_q,
            )

        salient = SalientEntities()
        # Prefer the canonical UNS context when present (one source of truth
        # per turn). Stored under engine_state["context"]["uns_context"] so it
        # round-trips through SQLite via session_manager.save_state. Fall back
        # to parsing asset_identified for legacy state rows.
        uns_ctx = (engine_state.get("context") or {}).get("uns_context") or {}
        asset = engine_state.get("asset_identified") or ""
        vendor: str | None = uns_ctx.get("manufacturer") or None
        if not vendor and asset:
            from .uns_resolver import resolve_uns_path  # local import: avoid cycle

            vendor = resolve_uns_path(asset).manufacturer or None
        if vendor or asset:
            salient = SalientEntities(vendor=vendor, asset_label=asset[:120])

        return cls(
            chat_id=chat_id,
            fsm_state=engine_state.get("state", "IDLE"),
            pending_question=pending,
            salient_entities=salient,
            last_dialogue_act=None,
            interrupted_thread=None,
            history_snippet=_take_history(ctx),
        )

    def write_to_engine_state(self, engine_state: dict[str, Any]) -> None:
        """Persist this DialogueState back onto the engine state dict.

        Mutates `engine_state["context"]["dialogue"]` in place. Caller is
        responsible for the SQLite save (engine does this already)."""
        ctx = engine_state.get("context") or {}
        ctx["dialogue"] = self.to_dict()
        engine_state["context"] = ctx


def _take_history(ctx: dict[str, Any], max_turns: int = 6) -> list[dict[str, str]]:
    """Return a JSON-safe history snippet bounded to `max_turns` user/bot pairs."""
    history = ctx.get("history") or []
    snippet: list[dict[str, str]] = []
    for msg in history[-max_turns * 2 :]:
        role = str(msg.get("role", "")).lower()
        content = str(msg.get("content", ""))[:300]
        if role and content:
            snippet.append({"role": role, "content": content})
    return snippet


__all__ = [
    # Vocabularies
    "SlotName",
    "DialogueActName",
    "ActionName",
    "MetaCommand",
    "QuestionKind",
    "ALWAYS_INTERRUPT_ACTIONS",
    # Data classes
    "SalientEntities",
    "PendingQuestion",
    # Acts
    "AnswerAct",
    "InformAct",
    "RequestActionAct",
    "AskQuestionAct",
    "DontKnowAct",
    "ConfirmAct",
    "DenyAct",
    "MetaControlAct",
    "GreetAck",
    "SafetyAct",
    "DialogueTurn",
    # Helpers
    "turn_from_dict",
    "turn_to_dict",
    "DialogueState",
]
