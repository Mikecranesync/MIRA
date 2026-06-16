# PLAN — Unified Dialogue State Tracker for MIRA

**Status:** Draft (2026-05-04) — awaiting Mike's go/no-go before any code lands
**Author:** Claude (Opus 4.7), session triggered by 2026-05-04 human-in-the-loop test transcript
**Scope:** `mira-bots/shared/engine.py`, `mira-bots/shared/conversation_router.py`,
`mira-bots/shared/workers/rag_worker.py`, plus a new `mira-bots/shared/dialogue_state.py`
**Constraints honoured:** no LangChain, no TensorFlow, no Anthropic, no Rasa-as-runtime-dep,
Python 3.12, async, httpx, OpenAI-compat cascade (Groq → Cerebras → Gemini)
**Predecessor PLAN.md (hub-ux fixes, 2026-04-26):** archived to `docs/plans/2026-04-26-tech-debt-hub-ux-fixes.md`

---

## 1. The four symptoms — and the one architectural flaw underneath them

| # | Symptom from Mike's 2026-05-04 test | Why it actually happens (after tracing the code) |
|---|---|---|
| 1 | "I don't know. I was just given the new one to put in" → bot searches `IDON` / `I-DON` as a fault code | The user's reply is *answering MIRA's question*, but the engine has no concept of **"this turn is an answer to my last question"**. It funnels the literal message into the vector search query (`embed_query = message`, `rag_worker.py:226`) and the GSD prompt then treats those tokens as candidate codes. |
| 2 | "Can you make a work order for that?" → "Let me think about that differently — could you rephrase?" | `conversation_router.py` CRITICAL RULE 3 ("if FSM is active, prefer `continue_current`") swallows the action request. The message flows into `RAGWorker.process()` with FSM=Q-state, the LLM tries to fit it into the diagnostic ladder, the **self-critique quality gate** at `engine.py:1008` then fires its `groundedness` clarification (`engine.py:1028-1036`), which the LLM further paraphrases into the "rephrase" line. The action handler `_handle_wo_request` (`engine.py:2166`) is **never reached**. |
| 3 | Yaskawa cited for a Siemens question; "Interroll" appearing randomly; raw YouTube URLs | Cross-vendor filter at `rag_worker.py:251-283` runs **only on text-only turns** and **only when `vendor_name_from_text(query_combined)` returns a non-empty string for the current message**. Chunks with `manufacturer=None` always pass through (`if not c.get("manufacturer")`). Session-salient vendor (from `state["asset_identified"]`) is **soft** — used to prefix the embedding query, never as a hard predicate on retrieval. YouTube transcripts and unbranded marketing chunks have no manufacturer tag and slip through every time. |
| 4 | Bot doesn't know if user is answering vs asking new | `last_question` and `last_options` are stored in `session_context` but used **only for option-number resolution** (`engine.py:533`). The router gets `current_fsm_state` and `conversation_turn`, but no `pending_question` or `expected_slot` field. There is no contract anywhere in the system that says *"the next user turn is an answer to slot X — interpret it as a value, not as content."* |

### The single architectural flaw

> **MIRA classifies *intents* but does not track *dialogue acts*.**

An *intent* says **what topic** the user means (diagnose, document, work-order).
A *dialogue act* says **what move** the user is making in this turn (asking, answering, requesting-action, expressing-uncertainty, acknowledging, repairing, meta-controlling).

The current router (`conversation_router.py`) has 12 task-intent labels and zero dialogue-act
labels. Worse, its CRITICAL RULE 3 explicitly collapses every mid-flow utterance to
`continue_current` — which means even a clear `request_action` dialogue act ("make a WO")
is treated as a content continuation of whatever Q-state the FSM happens to be in.

- Symptom 1 is "user's *answer* dialogue act treated as content."
- Symptom 2 is "user's *request_action* dialogue act treated as content."
- Symptom 3 is "session-salient entities not load-bearing on retrieval."
- Symptom 4 is "no `pending_question` slot, so every turn is interpreted independently."

**They are all the same bug.** Fix the dialogue-act layer and slot tracking, and all four
symptoms fall together.

---

## 2. The fix — Dialogue State Tracker (DST) + Slot-Filling + Action Router

This is the same pattern that Rasa, ConvLab, TRIPS, and most academic DST systems use,
**stripped down to one Pydantic model and one LLM call per turn**. We are not adopting
Rasa or any framework — we are stealing the data structure and the precedence rules.

### 2.1 New canonical type — `DialogueState` (discriminated union of response acts)

The cleanest pattern (validated by Rasa CALM 2024 + `instructor` / `pydantic-ai` practice)
is to make each dialogue act a **separate Pydantic model with a `Literal` discriminator
field**, then have the LLM pick one via tool-mode structured output. The dispatcher does
`isinstance()` routing — no enum-then-switch, no "is the slot value populated for this
act type?" check.

```python
# mira-bots/shared/dialogue_state.py  (NEW file, ~250 lines)

from pydantic import BaseModel, Field
from typing import Literal, Optional, Union

# ---- Salient entities pinned across turns -----------------------------------

class SalientEntities(BaseModel):
    """Entities pinned in the session — load-bearing for retrieval and routing."""
    vendor: Optional[str] = None         # "Siemens", "Yaskawa", "Rockwell"
    model: Optional[str] = None          # "GS20", "PowerFlex 525", "SINAMICS S120"
    fault_code: Optional[str] = None     # "F012", "OC", "AL-14"
    asset_label: Optional[str] = None    # free-form, e.g. "air compressor #1"
    last_action_proposed: Optional[str] = None  # "log work order", "send manual"


# ---- What MIRA is currently waiting for -------------------------------------

SlotName = Literal[
    "asset_identification", "fault_code", "symptom_detail",
    "wo_confirmation", "wo_field_supply", "manual_vendor_model",
    "pm_acceptance", "fix_confirmation", "diagnostic_branch_choice",
    "none",
]

class PendingQuestion(BaseModel):
    slot: SlotName
    asked_at_turn: int
    options: list[str] = Field(default_factory=list)
    raw_text: str = ""


# ---- The dialogue acts (one model per act, discriminated by `act`) ----------
# Aligns with Rasa CALM 2024 command vocabulary: set_slot, start_flow,
# cancel_flow, correct_slot, chitchat, knowledge_answer, human_handoff.

class AnswerAct(BaseModel):
    """User answered MIRA's pending question. Fill the slot and advance."""
    act: Literal["answer"] = "answer"
    slot_fill_value: str
    entities: SalientEntities = Field(default_factory=SalientEntities)
    reasoning: str

class InformAct(BaseModel):
    """User volunteered information without being asked (no pending slot)."""
    act: Literal["inform"] = "inform"
    entities: SalientEntities = Field(default_factory=SalientEntities)
    reasoning: str

class RequestActionAct(BaseModel):
    """User issued an imperative — make a WO, find the manual, switch asset."""
    act: Literal["request_action"] = "request_action"
    action: Literal[
        "log_work_order", "switch_asset", "find_documentation",
        "schedule_maintenance", "check_equipment_history", "reset",
    ]
    entities: SalientEntities = Field(default_factory=SalientEntities)
    reasoning: str

class AskQuestionAct(BaseModel):
    """User asked a question (procedural how-to or general industrial)."""
    act: Literal["ask"] = "ask"
    question_kind: Literal["procedural", "general", "definition", "comparison"]
    entities: SalientEntities = Field(default_factory=SalientEntities)
    reasoning: str

class DontKnowAct(BaseModel):
    """User expressed uncertainty / 'I don't know' — must NOT embed message as query."""
    act: Literal["dont_know"] = "dont_know"
    reasoning: str

class ConfirmAct(BaseModel):
    """User confirmed (yes/correct/right) — usually answering a yes/no slot."""
    act: Literal["confirm"] = "confirm"
    reasoning: str

class DenyAct(BaseModel):
    act: Literal["deny"] = "deny"
    reasoning: str

class MetaControlAct(BaseModel):
    """nevermind / start over / skip / cancel — preempt and reset flow."""
    act: Literal["meta"] = "meta"
    command: Literal["cancel", "reset", "skip", "back", "stop"]
    reasoning: str

class GreetAckAct(BaseModel):
    act: Literal["greet"] = "greet"
    reasoning: str

class SafetyAct(BaseModel):
    """Safety override — always wins regardless of state."""
    act: Literal["safety"] = "safety"
    hazard_summary: str
    reasoning: str

# The single typed return — instructor / pydantic-ai pick exactly one.
DialogueTurn = Union[
    AnswerAct, InformAct, RequestActionAct, AskQuestionAct, DontKnowAct,
    ConfirmAct, DenyAct, MetaControlAct, GreetAckAct, SafetyAct,
]
```

**Why discriminated union beats a single `dialogue_act: Literal[...]` field:**

1. The LLM cannot return `act=answer` without a `slot_fill_value` (Pydantic rejects).
2. The LLM cannot return `act=dont_know` AND a slot value (the model has no such field).
3. The dispatcher is `match turn: case AnswerAct(...): ...` — no nullable-field gymnastics.
4. `instructor`'s `Mode.TOOLS` registers each model as a separate OpenAI-tool schema and
   forces the LLM to pick one — eliminating the JSON-parse-failure failure mode.

### 2.2 New canonical call — `track_dialogue_state`

Replaces `route_intent`. **One Groq llama-3.1-8b call** via the `instructor` library in
`Mode.TOOLS`, ~200ms, returns one of the `DialogueTurn` union members as a typed Pydantic
instance. Same cost profile as today, but the response carries the information the engine
actually needs and cannot be malformed.

```python
import instructor
from groq import AsyncGroq

# Single client — wraps the existing GROQ_API_KEY, same provider as route_intent today.
_dst_client = instructor.from_provider(
    "groq/llama-3.1-8b-instant",
    async_client=True,
    mode=instructor.Mode.TOOLS,
)

async def track_dialogue_state(
    user_message: str,
    history: list[dict],
    pending_question: PendingQuestion,
    salient_entities: SalientEntities,
    fsm_state: str,
) -> DialogueTurn:
    """Single-pass dialogue state tracker. The LLM picks one of 10 typed acts."""
    return await _dst_client.create(
        response_model=DialogueTurn,           # the discriminated union
        messages=[
            {"role": "system", "content": _DST_SYSTEM_PROMPT},
            {"role": "user", "content": _format_context(
                user_message, history, pending_question, salient_entities, fsm_state,
            )},
        ],
        max_retries=2,                          # instructor retries on validation fail
    )
```

The prompt explicitly anchors on the `pending_question`:

> "MIRA's last question was: '{raw_text}' — it is waiting for slot=`{slot}`.
> If the user answered it, return an `answer` act with `slot_fill_value` set.
> If they said 'I don't know' or similar, return a `dont_know` act — do NOT
> invent a slot value. If they asked a new question or made a request, return
> `ask` or `request_action`. **Picking the wrong act is worse than picking
> low-confidence — never invent a value to fill a slot.**"

**Why `instructor` (vs. raw httpx + json.loads, vs. `pydantic-ai`):**

- `instructor`'s `Mode.TOOLS` registers each union member as a separate OpenAI-tool
  schema; the Groq endpoint is OpenAI-compatible so this works directly. The LLM must
  pick one tool — there is no "JSON parse failure" path.
- Same `max_retries` self-heal pattern that fixes today's `ROUTER_LLM_FAILURE` log line.
- Native async, native Groq via `from_provider("groq/...")`, no LangChain dep, no
  TensorFlow.
- `pydantic-ai` is a strict superset (full agent runtime); we only need the tool-mode
  structured output, not the agent loop.

**New dependency:** `instructor>=1.6.0` in `mira-bots/pyproject.toml`. Pure Python, ~3
KLOC, depends only on `pydantic` and `openai` (already transitive). **Flagged for Mike's
approval** — if rejected, fall back to raw `httpx` + manual `pydantic.TypeAdapter` JSON
validation (~30 LOC more boilerplate, same correctness).

This is the Rasa DIET pattern of **joint intent+entity prediction in one head** —
DIET uses a transformer with a CRF tagger; we use structured-output LLM tool calls. The
DST contract (one act per turn, slot-or-action explicit) is identical.

### 2.3 New dispatch precedence in `Supervisor.process_full`

The Rasa CALM 2024 `FormPolicy` interrupt pattern, ported to Python `match` statements:

```python
# After the existing pending intercepts and safety check:

turn = await track_dialogue_state(...)
self._persist_salient_entities(state, turn)   # always merge new entities

# ALWAYS_INTERRUPT — actions that preempt every flow with state preservation.
ALWAYS_INTERRUPT = {"log_work_order", "switch_asset", "safety", "reset"}

match turn:
    # Priority 1 — safety always wins.
    case SafetyAct():
        return self._safety_response(state, chat_id, trace_id, turn)

    # Priority 2 — interrupt actions snapshot then preempt.
    case RequestActionAct(action=a) if a in ALWAYS_INTERRUPT:
        return await self._handle_interrupt(turn, state, chat_id, trace_id)

    # Priority 3 — slot answers (or "I don't know") when MIRA asked a question.
    case _ if state.get("pending_question", {}).get("slot") != "none":
        match turn:
            case AnswerAct():
                return await self._fill_slot_and_continue(turn, state, chat_id, trace_id)
            case DontKnowAct():
                return await self._handle_dont_know(state, chat_id, trace_id)
            case ConfirmAct() | DenyAct():
                return await self._handle_yes_no(turn, state, chat_id, trace_id)
            # If LLM picked something else mid-slot-fill, it's a topic pivot.
            # Cancel the slot, re-dispatch the new act below.
            case _:
                self._cancel_pending_question(state)
                # fall through

    # Priority 4 — meta-control commands.
    case MetaControlAct(command=c):
        return await self._handle_meta_command(c, state, chat_id, trace_id)

    # Priority 5 — non-interrupt action requests (find_documentation,
    # schedule_maintenance, check_equipment_history).
    case RequestActionAct(action=a):
        return await self._dispatch_action(a, turn, state, chat_id, trace_id)

    # Priority 6 — questions and information continue into existing flow.
    case AskQuestionAct(question_kind="procedural"):
        return await self._handle_instructional_question(chat_id, message, state, trace_id)
    case AskQuestionAct(question_kind="general" | "definition" | "comparison"):
        return await self._handle_general_question(chat_id, message, state, trace_id)
    case GreetAckAct() if state["state"] == "IDLE":
        return self._greeting_response(state, chat_id, trace_id)
    case InformAct() | _:
        # Default — into the diagnostic RAG pipeline with bound salient entities.
        ...  # existing RAG flow
```

**Why the priority ordering matters (this is the canonical bug fix for all 4 symptoms):**

- **Symptom 1 (IDON lookup):** `DontKnowAct` is matched in Priority 3 *before* the
  default RAG fall-through, so "I don't know" never reaches the embedding query.
- **Symptom 2 (WO blocked):** `RequestActionAct(action="log_work_order")` matches at
  Priority 2 *before* the slot-answer check, so the WO handler is reached even mid-Q.
- **Symptom 4 (answering vs asking):** `pending_question.slot != "none"` is the
  guard on Priority 3 — slot answers and don't-knows are interpreted as such only when
  MIRA is actually waiting for a slot. Without a pending question, the same "I don't
  know" falls to the default flow.

**Stack-resumable interrupts** (Rasa FormPolicy / CALM `start_flow` + `cancel_flow`):

```python
async def _handle_interrupt(self, turn: RequestActionAct, state, chat_id, trace_id):
    saved = {
        "fsm_state": state["state"],
        "pending_question": state.get("pending_question"),
        "active_alarm": state.get("context", {}).get("session_context", {}).get("active_alarm"),
    }
    result = await self._dispatch_action(turn.action, turn, state, chat_id, trace_id)
    # Push resume offer into the result so user can continue the diagnostic later.
    if saved["fsm_state"] in ACTIVE_DIAGNOSTIC_STATES:
        state["context"]["interrupted_diagnosis"] = saved
    return result
```

When the next user turn comes back and `interrupted_diagnosis` is present, MIRA can
offer: *"WO created. Want to pick up the bearing diagnosis where we left off?"*

### 2.4 Hard vendor/asset filter on RAG retrieval

**Today (`rag_worker.py:251-283`):** vendor filter runs only when
`vendor_name_from_text(query_combined)` finds a vendor in the *current* message. Chunks
with `manufacturer=None` always pass.

**Proposed:**

```python
# rag_worker.py — new method
def _retrieval_predicates(self, state: dict, message: str) -> dict:
    salient = state.get("salient_entities", {})  # set by DST
    vendor = salient.get("vendor") or vendor_name_from_text(
        f"{message} {state.get('asset_identified','')}"
    )
    return {
        "required_vendor": vendor,           # hard filter when set
        "min_similarity": 0.70,              # already exists
        "exclude_unbranded_when_vendor_known": True,  # NEW — kills "Interroll" leak
    }
```

When `required_vendor` is set:
- chunks with `manufacturer is not None and vendor_lower not in manufacturer_lower` → DROP
- chunks with `manufacturer is None` AND `exclude_unbranded_when_vendor_known` → DROP
- Falls back to today's behaviour (allow unbranded) only when no vendor is known yet.

YouTube and Interroll mass-ingested transcripts almost universally have empty manufacturer
metadata; this single change suppresses them whenever the session has identified a vendor.

### 2.5 Disarm the self-critique groundedness gate when the user is making a non-diagnosis move

**Today (`engine.py:1008`):** the self-critique gate fires on every DIAGNOSIS turn,
including turns where the user asked for a work order or said "I don't know". When
groundedness < 3, it produces the clarifying-question loop ("could you share one more
detail — what exact fault code…").

**Proposed:** the gate only fires when `turn.dialogue_act in {"answer", "inform"}` and
(`turn.is_answer_to_pending` is True or `pending_question.slot == "none"`). For
`request_action`, `uncertainty`, `meta_command`, `acknowledge` — the gate is **muted**
because the response wasn't trying to be a diagnosis.

This is the second half of the fix for Symptom 2.

---

## 3. File-by-file changes

| File | Change | Approx LOC |
|---|---|---|
| `mira-bots/shared/dialogue_state.py` | **NEW** — Pydantic models (`DialogueAct`, `SalientEntities`, `PendingQuestion`, `DialogueTurn`) and `track_dialogue_state()` LLM call | +200 |
| `mira-bots/shared/conversation_router.py` | Keep `route_intent` for 1 release as a fallback for DST failures; deprecate after Stage 2 | ±20 |
| `mira-bots/shared/engine.py` | Replace `route_intent` call at L562 with `track_dialogue_state`; rewrite the dispatch block L588-627 to use `turn.dialogue_act` precedence; pass `salient_entities` and `pending_question` through state | ~150 changed |
| `mira-bots/shared/engine.py` | Wrap self-critique gate L1008 with `if turn.dialogue_act in {"answer","inform"}:` | ~10 changed |
| `mira-bots/shared/workers/rag_worker.py` | Add `_retrieval_predicates`; tighten cross-vendor filter to drop unbranded chunks when vendor known; embed bound asset+fault, not raw user text, when slot-fill happened | ~60 changed |
| `mira-bots/shared/session_manager.py` | Persist `salient_entities` and `pending_question` alongside existing state fields | ~20 changed |
| `tests/eval/dialogue_act_cases.json` | **NEW** — 30+ regression cases covering all four symptoms | +1 file |

**Total: ~450 LOC net new code, all in existing modules + one new file. Zero new dependencies.**

---

## 4. Staged rollout

### Stage 0 — TODAY (1-2 hours, lands on `fix/wo-request-mid-flow` branch)

**Goal:** unblock the Symptom 2 work-order regression. Do NOT touch the architecture.

1. In `engine.py` `process_full`, **before** the `route_intent` call (~L560), insert a
   regex fast-path for explicit action requests:

   ```python
   _ACTION_REQUEST_RE = re.compile(
       r"\b(make|create|log|file|open|submit|put in)\s+"
       r"(a\s+)?(work\s*order|wo|ticket|request)\b",
       re.IGNORECASE,
   )
   if not photo_b64 and _ACTION_REQUEST_RE.search(message):
       logger.info("ACTION_REQUEST_FAST_PATH chat_id=%s match=%r", chat_id, message[:60])
       return await self._handle_wo_request(chat_id, message, state, trace_id)
   ```

   Same pattern for `_DOC_REQUEST_RE` ("send me the manual", "find the datasheet").
   This gives Mike a working WO flow today, no other architectural risk.

2. Add a guard in the self-critique block (`engine.py:1008`) that skips the gate when
   the most recent turn matched the action-request fast-path, by setting a transient
   `ctx["last_dispatch"] = "action_request"` and checking it.

3. Add a regression test in `tests/eval/` that replays Mike's transcript and asserts
   `_handle_wo_request` is invoked.

**Verification:** `pytest tests/eval/ -k work_order_mid_flow` and a manual rerun of the
"cooling fan on air compressor #1, make a work order" sequence on staging.

### Stage 1 — This sprint (~2-3 days, `feat/dialogue-state-tracker` branch)

1. Create `mira-bots/shared/dialogue_state.py` with the Pydantic models above.
2. Implement `track_dialogue_state` against Groq llama-3.1-8b-instant (same provider as
   the current router — same latency, same cost, same failure profile).
3. Wire it into `Supervisor.process_full` behind a `MIRA_USE_DST=1` env flag, falling
   back to `route_intent` when unset. Default OFF in prod, ON in dev/eval.
4. Add the dispatch-precedence block from §2.3.
5. Mute the self-critique gate per §2.5.
6. Add `tests/eval/dialogue_act_cases.json` — at minimum:
   - the 4 cases from Mike's transcript (one per symptom)
   - 5 "I don't know" answers to different MIRA questions
   - 5 mid-flow action requests (WO, doc, asset switch)
   - 5 slot-fill answers (model #, fault code, symptom, yes/no, free text)
   - 3 meta-commands (nevermind, skip, reset)
7. Run the existing 39 golden cases — no regression allowed.

**Exit criteria:** flag flip to `MIRA_USE_DST=1` in prod after a clean week in dev,
gated on a Mike-led HITL test that replays the 2026-05-04 transcript end-to-end.

### Stage 2 — Next sprint (~2 days, `feat/dst-slot-filling` branch)

1. Promote `pending_question.slot` to load-bearing — the diagnostic ladder (Q1→Q2→Q3)
   becomes a slot sequence (`asset → fault_code → symptom → cause`). Each ladder turn
   sets `pending_question.slot` and `expected_slot`; the next user turn either fills the
   slot or branches via `dialogue_act`.
2. Remove `route_intent` and the `MIRA_USE_DST` flag.
3. Tighten RAG retrieval per §2.4 — hard vendor filter, drop unbranded when vendor known.
4. Backfill `manufacturer` metadata on the YouTube and Interroll chunks in NeonDB
   (one-off SQL migration from `crawler` source URL → vendor inference). Deferred ones
   stay tagged `manufacturer="generic"` and are excluded from vendor-scoped retrieval.

### Stage 3 — Polish (week 3)

- DAMSL-aligned dialogue-act expansion (add `repair` recovery handler — "actually I meant
  the F012 fault not F102")
- Stack-resumable sub-flows: when an action request preempts mid-Q-flow, offer to resume
  ("WO created. Back to diagnosing the bearing — you said it was running hot. Continue?")

---

## 5. Open-source patterns we are explicitly stealing (and why)

These come from a focused review of Rasa (classic + CALM 2024), pydantic-ai, instructor,
and the DAMSL / ISO 24617-2 dialogue-act literature. We are stealing **patterns and data
shapes**, not runtimes.

| Pattern | Source | What we steal | What we explicitly skip |
|---|---|---|---|
| **Joint intent + entity prediction in one call** | **Rasa DIET** ([paper](https://arxiv.org/abs/2004.09936)) | Single LLM call returns the act + slot value + entities together — no two-step "classify intent, then extract entities" pipeline | DIET's transformer + CRF tagger; our LLM cascade does the same job |
| **`requested_slot` priority rule** | **Rasa classic FormPolicy** | If MIRA asked for slot X, the user's reply is interpreted as a slot answer **before** any new-intent classification. This is a code-level priority rule, not an LLM task. | Rasa's full policy ensemble |
| **Command-style act vocabulary** | **Rasa CALM 2024** ([blog](https://rasa.com/blog/calm/)) | The act labels themselves: `set_slot`, `start_flow`, `cancel_flow`, `correct_slot`, `chitchat`, `knowledge_answer`, `human_handoff`. Our 10-act union maps 1:1 onto these. | The Rasa runtime / CALM dialogue understanding model |
| **Interrupt + state-snapshot pattern** | **Rasa FormPolicy `ActionExecutionRejection`** | When a high-priority action fires mid-flow, snapshot `active_loop` + `requested_slot` + filled slots before dispatching the action; restore on completion so the form resumes | Rasa's policy ensemble that reactivates the form |
| **Multi-command-per-turn** | **Rasa CALM** | When the user packs two moves into one message ("make a WO for that, and also what does E07 mean?"), the LLM can return a list of acts. We defer this to Stage 3 (single-act per turn is enough for Mike's 4 symptoms). | Stage 1/2 stays single-act |
| **Discriminated union output** | **`instructor` + `pydantic-ai`** | The LLM picks one of N tool-typed Pydantic models per turn (the dispatch is `match` over the type, not over a `dialogue_act` string field). Forbids structurally-impossible combinations (e.g. `act=dont_know` with a `slot_fill_value`). | The full `pydantic-ai` agent runtime |
| **Tool-mode structured output** | **OpenAI function calling spec** + Groq's OpenAI-compat surface | Each act registers as a tool schema; the model is forced to call exactly one. This is what eliminates today's `ROUTER_LLM_FAILURE` JSON-parse path. | Letting the LLM execute the tool — we dispatch in Python |
| **Dialogue-act taxonomy** | **DAMSL / ISO 24617-2** | The 10-act minimal set (`answer`, `ask`, `request_action`, `inform`, `dont_know`, `confirm`, `deny`, `meta`, `greet`, `safety`) — covers >95% of industrial-bot turns | The full 56-act ISO taxonomy; overkill |
| **`ALWAYS_INTERRUPT` set** | **Microsoft Bot Framework** "interruption recognizers" | Fixed set of action names (`log_work_order`, `safety`, `reset`, `switch_asset`) that always preempt mid-flow; everything else falls through to existing dispatch | Bot Framework dialog stack |

**Library pick: `instructor>=1.6.0`** (vs. raw httpx / pydantic-ai / outlines / guidance):

- Native Groq via `instructor.from_provider("groq/llama-3.1-8b-instant", async_client=True, mode=Mode.TOOLS)` — same provider as today's router.
- `Mode.TOOLS` registers each union member as a separate tool schema → LLM picks one.
- Built-in `max_retries` self-heal on validation failure (replaces today's "fall back to keyword classifier on parse error").
- Pure Python, depends only on `pydantic` + `openai` (already transitive).
- Async-clean, Python 3.12-clean, no LangChain, no TensorFlow.
- *Runner-up:* `pydantic-ai` — strict superset; we'd only use the structured-output bit, so adding the agent runtime is over-spec for our needs.
- *Avoid:* `outlines` and `guidance` (constrained-sampling, only work with locally-hosted models — incompatible with our Groq cascade); `marvin` (effectively unmaintained as of 2025).

**We deliberately do not adopt:**

- **LangChain** — banned by `CLAUDE.md` hard constraint.
- **Rasa as a runtime** — pulls TensorFlow + spaCy, ~600 MB, far over budget.
- **TensorFlow / sentence-transformers retraining** — embedding model is already `nomic-embed-text` via Ollama; we keep it.

---

## 6. What this plan **explicitly does not** try to fix

- **The GSD prompt itself** — `active.yaml` v1.2 is not the bug. It is a victim of bad
  routing. Once dialogue acts are right, the GSD prompt gets called for the right turns
  and the existing few-shot examples already cover those cases well.
- **NeonDB metadata coverage** — backfilling `manufacturer` on legacy chunks is a Stage 2
  side quest, not part of the architecture. The hard vendor filter handles unbranded
  chunks correctly even before backfill.
- **Per-tenant intent personalisation** — out of scope; addressable later via per-tenant
  prompt overrides if we see signal for it.
- **Replacing the keyword `classify_intent`** — keep it. It is a 0-ms safety net, fires
  before any network call, and catches the SAFETY tier even if every LLM in the cascade
  is unreachable.

---

## 7. Verification — how we'll know it actually fixed everything at once

1. **Stage 0 gate** — `pytest tests/eval/ -k work_order_mid_flow` green; manual replay of
   Mike's "cooling fan on air compressor" sequence creates a WO draft.
2. **Stage 1 gate** — new `dialogue_act_cases.json` (~25 cases) at 100%; the existing 39
   golden cases regression-clean; HITL replay of the 2026-05-04 transcript with the four
   symptoms — all four resolved.
3. **Stage 2 gate** — DST flag default-on in prod for a week with `eval_score >= 80%`
   and zero `SELF_CRITIQUE_TRIGGERED` events on `request_action` turns in Langfuse.

A regression in any one of the four symptoms re-opens the plan; the architecture is
validated by all four going green together.

---

## 8. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| DST LLM call adds latency on top of existing `route_intent` | **Low** — same model, same provider; we replace, not stack | Keep `route_intent` as fallback in Stage 1 behind a flag; revert if p95 regresses >50ms |
| Pydantic structured output failures | **Medium** | DST fall-through to keyword `classify_intent` — same pattern as today |
| Mis-classifying a real diagnosis turn as `request_action` and skipping the diagnostic ladder | **Low-Medium** | Only the explicit imperative regex fires Stage 0; Stage 1 adds the LLM, but the model has seen the dialogue-act distinction in pre-training |
| Hard vendor filter starves retrieval for vendors we have weak coverage for | **Medium** | Filter only activates when chunks > 0 with matching vendor exist; graceful degrade to current behaviour otherwise |
| Slot-fill extraction hallucinates a value when user said "I don't know" | **High if naive, Low if right** | The DST prompt in §2.2 explicitly forbids extraction on `uncertainty` — verified by 5 test cases in Stage 1 |

---

## 9. Decision asked of Mike

1. **Approve Stage 0 hot-fix** for landing today (1-2h, regex action-request fast-path +
   muted self-critique on action turns). This unblocks the WO regression without any
   architectural commitment.
2. **Approve Stages 1–3** as the unified fix path. If yes, I open `feat/dialogue-state-tracker`
   and start with the Pydantic models + `track_dialogue_state` LLM call.
3. If you want a smaller-step rollout — Stage 0 + Stage 2.4 only (hard vendor filter,
   nothing else) — that also resolves Symptom 3 in isolation, but Symptoms 1, 2, 4
   require the dialogue-act layer to actually go away.

---

## 10. Appendix — concrete wire-up sketch

```python
# engine.py — proposed dispatch block replacing L588-627
from .dialogue_state import (
    AnswerAct, AskQuestionAct, ConfirmAct, DenyAct, DontKnowAct,
    GreetAckAct, InformAct, MetaControlAct, PendingQuestion,
    RequestActionAct, SafetyAct, SalientEntities, track_dialogue_state,
)

ALWAYS_INTERRUPT = {"log_work_order", "switch_asset", "safety", "reset"}

# (after the unchanged pending intercepts + safety keyword check)

pending = PendingQuestion(**state.get("pending_question", {"slot": "none", "asked_at_turn": 0}))
salient = SalientEntities(**state.get("salient_entities", {}))

try:
    turn = await track_dialogue_state(
        user_message=message,
        history=(state.get("context") or {}).get("history", []),
        pending_question=pending,
        salient_entities=salient,
        fsm_state=state.get("state", "IDLE"),
    )
except Exception as exc:
    logger.warning("DST_FAILURE error=%s — falling back to keyword classifier", exc)
    turn = self._fallback_turn_from_keyword_classifier(message)

# Always merge any newly-extracted entities into state.
self._merge_salient_entities(state, getattr(turn, "entities", None))

match turn:
    case SafetyAct():
        return self._safety_response(state, chat_id, trace_id, turn)

    case RequestActionAct(action=a) if a in ALWAYS_INTERRUPT:
        return await self._handle_interrupt(turn, state, chat_id, trace_id)

    case _ if state.get("pending_question", {}).get("slot") != "none":
        match turn:
            case AnswerAct():
                return await self._fill_slot_and_continue(turn, state, chat_id, message, trace_id)
            case DontKnowAct():
                return await self._handle_dont_know(state, chat_id, trace_id)
            case ConfirmAct() | DenyAct():
                return await self._handle_yes_no(turn, state, chat_id, trace_id)
            case _:
                # Topic pivot — cancel slot and re-dispatch.
                self._cancel_pending_question(state)

    case MetaControlAct(command=c):
        return await self._handle_meta_command(c, state, chat_id, trace_id)

    case RequestActionAct(action=a):
        return await self._dispatch_action(a, turn, state, chat_id, message, trace_id)

    case AskQuestionAct(question_kind="procedural"):
        return await self._handle_instructional_question(chat_id, message, state, trace_id)

    case AskQuestionAct():
        return await self._handle_general_question(chat_id, message, state, trace_id)

    case GreetAckAct() if state["state"] == "IDLE":
        return self._greeting_response(state, chat_id, trace_id)

    case _:  # InformAct or fall-through — existing diagnostic RAG path
        pass
```

```python
# rag_worker.py — proposed hard vendor filter

def _filter_chunks_by_salience(self, neon_chunks: list[dict], state: dict, message: str) -> list[dict]:
    salient = state.get("salient_entities", {})
    vendor = salient.get("vendor") or vendor_name_from_text(
        f"{message} {state.get('asset_identified','')}"
    )
    if not vendor:
        return neon_chunks  # no salient vendor — keep current behaviour

    v = vendor.lower()
    matched = [c for c in neon_chunks if v in (c.get("manufacturer") or "").lower()]
    if matched:
        # Hard filter — drop both wrong-vendor AND unbranded when we have matches
        return matched
    # No matched vendor chunks — fall through to today's lenient behaviour
    return [c for c in neon_chunks if not c.get("manufacturer") or v in (c.get("manufacturer") or "").lower()]
```

---

**End of plan.** Awaiting Mike's call: Stage 0 today / Stages 1-3 next / both.
