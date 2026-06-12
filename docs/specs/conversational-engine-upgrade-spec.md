# Conversational Engine Upgrade Specification

**Version:** 1.0 (draft)
**Last Updated:** 2026-05-25
**Owner:** Mike Harper / FactoryLM
**Status:** Proposed — surgical upgrade to `mira-bots/shared/engine.py`
**Parent doctrine:** `docs/THEORY_OF_OPERATIONS.md`
**Related specs:**
- `docs/specs/dialogue-state-tracker-spec.md` — Stage-1 FSM the upgrade plugs into
- `docs/specs/maintenance-namespace-builder-spec.md` — UNS gate the upgrade hands off to
- `docs/specs/uns-message-resolver-spec.md` — resolver the upgrade reads from
- `docs/specs/mira-qa-regression-routine-spec.md` — boundary regression suite that scores success
- `.claude/rules/uns-confirmation-gate.md` — non-negotiable gate rules
- `.claude/rules/karpathy-principles.md` — surgical-change discipline

---

## 1. Problem Statement

MIRA is solid at grounded troubleshooting once the UNS Location-Confirmation Gate has fired and a context is locked in. It falls over before that point.

Three concrete failure modes observed in production transcripts and the
2026-05-18 GS11 demo (memory `project_recall_embedding_gate`):

1. **General questions get treated as troubleshooting.** "What is a VFD?" is a Level-1 conversational ask; today it can route into RAG retrieval, return a cited-but-overweight response, or worse, ask for asset confirmation that the technician doesn't have because they're not at a machine.
2. **Equipment-adjacent intent with no context gets bounced.** "I have a fault" with no asset reference today either (a) triggers the UNS gate with a generic "what equipment?" question that feels canned and robotic, or (b) returns a generic safety/troubleshooting reply that ignores the missing context.
3. **Unsupported input gets a stiff fallback.** A photo dropped with no caption today produces a vision-OCR dump or a generic "I see an electrical drawing" message instead of a natural "what would you like to know about this?" — the kind of opening every technician expects from a modern chat assistant.

Underneath all three: `classify_intent` in `mira-bots/shared/guardrails.py` is a regex-and-keyword router that returns one of `safety | help | industrial | instructional | documentation | greeting | off_topic`. It has no concept of *conversational state* or *clarification need*. Anything that smells industrial is industrial; anything below 20 characters that contains a greeting word is a greeting; everything else defaults to `industrial` ("a maintenance bot should attempt to help").

That default is the right safety bias for a grounded engine. It is the wrong default for the front door. Technicians coming off ChatGPT, Gemini, and Claude expect conversational fluency *before* the specialist takes over.

This spec defines a surgical 3-layer upgrade that:

- Adds conversational fluency without weakening any existing groundedness invariant.
- Treats Layer 1 (conversational LLM) as advisory, not authoritative — it cannot make equipment-specific claims.
- Preserves the UNS gate, citation compliance, KB retrieval, safety guardrails, and the FSM **exactly as they exist today**.

This is a docs-only spec. No code changes.

---

## 2. Architecture: the 3-layer model

```
┌───────────────────────────────────────────────────────────────────┐
│  LAYER 1 — Conversational LLM (front desk)                        │
│  • Greetings, small talk, education ("what is a VFD")             │
│  • Clarifying questions when intent is unclear                    │
│  • "Can you tell me more about that?" style probes                │
│  • System prompt: warm, maintenance-aware, NEVER claims about     │
│    specific equipment / fault codes / procedures                  │
│  • Uses existing InferenceRouter cascade (Groq → Cerebras → Gemini)│
└────────────────────────────┬──────────────────────────────────────┘
                             ▼
┌───────────────────────────────────────────────────────────────────┐
│  LAYER 2 — Router / Classifier (upgraded)                         │
│  • Existing classify_intent + new shift-detection                 │
│  • Reads conversation history, photo presence, UNSContext         │
│  • Decides: stay in Layer 1 | escalate to Layer 3 | clarify       │
│  • Emits a routing decision, not a reply                          │
└────────────────────────────┬──────────────────────────────────────┘
                             ▼
┌───────────────────────────────────────────────────────────────────┐
│  LAYER 3 — Grounded MIRA (specialist) — UNCHANGED                 │
│  • UNS resolver → UNS Location-Confirmation Gate                  │
│  • RAGWorker (BM25 + pgvector + RRF)                              │
│  • citation_compliance.py                                         │
│  • FSM (IDLE → Q1 → Q2 → Q3 → DIAGNOSIS → FIX_STEP → RESOLVED)    │
│  • Existing prompts/diagnose/active.yaml                          │
└───────────────────────────────────────────────────────────────────┘
```

### 2.1 Transitions

| From | To | Trigger |
|---|---|---|
| (start) | Layer 1 | Greeting, general knowledge, education, small talk |
| (start) | Layer 2 → Layer 3 | Industrial intent with sufficient context |
| (start) | Layer 2 → Layer 1 (clarify) | Industrial intent without sufficient context |
| (start) | Layer 3 (safety bypass) | Any tier-1 safety keyword — no Layer 1 detour |
| Layer 1 | Layer 3 | User pivots to specific equipment / fault / asset |
| Layer 1 | Layer 1 | Continued general or educational thread |
| Layer 3 | Layer 1 | User explicitly disengages ("nevermind", "thanks", "later"); or RESOLVED with general follow-up |
| Anywhere | Layer 3 (safety bypass) | Safety keyword fires at any time |

The safety bypass is the only "everything stops, go here now" path. Tier-1 safety
(`SAFETY_KEYWORDS_IMMEDIATE` in `guardrails.py`) skips Layer 1 entirely; tier-2
safety follows the existing educational-question carve-out (`what is arc flash`
still routes to industrial RAG).

### 2.2 Why three layers, not one big LLM call

A single LLM call with a long system prompt ("be conversational but also
ground everything in citations and never claim about specific equipment
without UNS confirmation but also be helpful and warm but...") fails on
both axes — the model relaxes the grounding rule under conversational
pressure, or it stays rigid and feels canned. The 3-layer split keeps the
*conversational* and *grounded* prompts physically separate, so neither can
contaminate the other.

It also keeps the change additive. Layer 3 is unmodified. Layer 2 gets a new
routing branch. Layer 1 is a new entry path with its own system prompt and
its own cascade call. If Layer 1 is buggy or hallucinates, Layer 2 routes
around it; if Layer 1 is disabled (feature flag), the engine behaves
identically to today.

---

## 3. Intent classification upgrade

### 3.1 New intents

Current set in `guardrails.classify_intent`:

```
greeting | help | industrial | instructional | documentation | safety | off_topic
```

Proposed additions (extend, don't replace — existing call sites stay valid):

| New intent | Fires when | Routes to |
|---|---|---|
| `general_knowledge` | Educational question with no specific asset context (`"what is a VFD"`, `"how does PID work"`, `"what's the difference between PNP and NPN"`) | Layer 1 |
| `small_talk` | Conversational opener beyond a single greeting word (`"hey, how's it going"`, `"good morning, anything new?"`) | Layer 1 |
| `clarification_needed` | Equipment-adjacent intent without an asset (`"I have a fault"`, `"something's wrong"`, `"the line is down"`) | Layer 2 generates a natural clarifying question via Layer 1 |
| `attachment_only` | Photo or document arrives with no caption, or caption is `"?"`, `".jpg"`, an emoji, etc. | Layer 2 generates a natural "what would you like to know about this?" via Layer 1 |
| `disengage` | User wraps up (`"thanks"`, `"nevermind"`, `"later"`, `"got it"`) | Layer 1 with a short acknowledgment; FSM moves toward IDLE on next message |

### 3.2 How the classifier decides

`classify_intent_v2` (additive helper, does not replace `classify_intent`):

```python
def classify_intent_v2(
    message: str,
    *,
    photo_present: bool,
    uns_ctx: UNSContext | None,
    fsm_state: str,
    session_followup: bool,
) -> str:
    # 1. Safety short-circuit — unchanged from v1
    if _is_safety_tier1(message):
        return "safety"

    # 2. Attachment with no signal
    if photo_present and len(_clean(message)) < 5:
        return "attachment_only"

    # 3. In-session follow-up — defer to FSM, do not re-classify
    if session_followup and fsm_state not in ("IDLE", "RESOLVED"):
        return "industrial"

    # 4. Run existing v1 classifier
    v1 = classify_intent(message)

    # 5. Refine v1 result:
    # - greeting + nothing else → small_talk (length > 1 word)
    # - greeting alone → greeting (unchanged)
    # - industrial WITHOUT uns_ctx.confidence > 0.5 AND
    #   without prior ctx in this session → clarification_needed
    # - industrial that is a pure definition ask → general_knowledge
    # - everything else → v1 verdict
    ...
```

Three rules govern the refinement, in order:

1. **Definition asks beat industrial.** If `v1 == "industrial"` AND the message
   matches `_DEFINITION_PHRASES = ["what is", "what does", "what's a",
   "what's the difference", "how does ... work", "explain"]` AND no specific
   equipment token is present in the message OR prior session, return
   `general_knowledge`. This is the "what is a VFD" path.

2. **Industrial-without-context beats industrial.** If `v1 == "industrial"`
   AND `uns_ctx` is `None` or `uns_ctx.confidence < 0.5` AND there is no
   prior `asset_identified` in session, return `clarification_needed`. The
   technician described a fault but didn't say where. Layer 2 will use
   Layer 1 to generate a natural clarifying question.

3. **Small talk beats greeting.** If `v1 == "greeting"` AND the message is
   longer than 1 word AND contains conversational tokens (`how`, `whats up`,
   `you doing`, `morning`, `evening`), return `small_talk`. Layer 1 handles
   warmly; FSM stays in IDLE.

If none of the new rules fire, return the v1 verdict unchanged. Existing
adapters and tests that read `classify_intent` continue to work.

### 3.3 Decision: stay general vs. need grounding vs. clarify

The router (Layer 2) maps intent → layer:

| Intent | Layer | Layer 3 entry? |
|---|---|---|
| `safety` | Layer 3 (existing safety path) | Yes, immediate |
| `industrial` (with context) | Layer 3 | Yes, through UNS gate |
| `instructional`, `documentation` | Layer 3 | Yes, existing paths |
| `general_knowledge` | Layer 1 | No |
| `small_talk` | Layer 1 | No |
| `greeting` | Layer 1 (was: greeting handler) | No |
| `help` | Layer 1 | No |
| `clarification_needed` | Layer 1 (generates the clarifying question) | No — gates Layer 3 entry on the reply |
| `attachment_only` | Layer 1 (generates the "what about this?" prompt) | No — gates Layer 3 entry on the reply |
| `off_topic` | Layer 1 with a graceful redirect | No |
| `disengage` | Layer 1, short ack | No |

---

## 4. Clarification state

When Layer 2 returns `clarification_needed`, the engine takes Layer 1 — not a
canned template — to generate the clarifying question. The Layer 1 system
prompt for this branch reads (sketch, not final text):

> You are MIRA, a maintenance assistant. The technician said something that
> sounds equipment-related but didn't tell you which machine or what symptoms.
> Ask a single, natural, conversational clarifying question to find out
> what they're looking at. Do NOT propose a diagnosis. Do NOT invent
> specific fault codes, brands, models, or procedures (see echo-vs-claim
> rule in §4.0.1 — you may echo values from `uns_context` or
> `vision_ocr_cache`, but not invent ones that are absent). Do NOT list
> every possible question — ask one. Be brief. One or two sentences max.

This is **not** the troubleshooting prompt. It is a constrained
conversational prompt whose only job is "ask one good clarifying question."

### 4.0.1 The echo-vs-claim distinction (load-bearing)

The "never claim specifics" rule has one carve-out, and the spec must be
explicit about it because §5 and §6.3 depend on it:

- **Echo** = read back a brand / model / fault code that was already
  extracted by a deterministic, non-LLM source (the UNS resolver's
  `UNSContext` fields, or the vision-OCR cache on conversation state).
  Layer 1 **may** echo these. Echoing is not a claim — it is a
  read-back of what the resolver / OCR has already established as fact.
- **Claim** = invent or infer a brand / model / fault code that is NOT in
  `UNSContext` and is NOT in the OCR cache. Layer 1 **must not** do this.
  No "sounds like a PowerFlex" if the resolver returned `manufacturer=None`.
  No "probably an F0004" if no fault token has been extracted.

The Layer 1 prompts receive `UNSContext` and `vision_ocr_cache` as
context fields. Wording: *"You may reference values present in
`uns_context` or `vision_ocr_cache`, but you must not invent or infer
values that are not in those fields."*

This is the rule §10.1's stripper enforces: any specific brand / model /
fault code in a Layer 1 reply that is **not present** in `uns_context`
or `vision_ocr_cache` is stripped. Echoes pass through. Inventions do
not.

The generated question is returned as the bot's reply. The FSM stays in IDLE
(or its prior pre-troubleshooting state). On the **next** user message, the
classifier runs again with the updated context — if the technician supplies an
asset reference, Layer 3 takes over via the UNS gate; if not, Layer 1 can
clarify once more; after two clarification turns with no progress, the FSM
transitions to a soft "I'm not sure what you're looking at — drop a photo of
the nameplate or tell me the line and machine" prompt (still Layer 1).

### 4.1 What "natural" looks like in practice

Examples the spec is designed to produce (Layer 1 generated, not templates):

- User: *"I have a fault"* → MIRA: *"Got it — which machine are you at, and what's the fault code if you can see one?"*
- User: *"Line's down"* → MIRA: *"Which line? And was anyone working on it when it went down, or did it just trip on its own?"*
- User: *"motor won't start"* → MIRA: *"Which motor — do you have a tag number or the drive it's running off? Photo of the drive screen helps too."*

Examples the spec is designed to **prevent**:

- ❌ *"Please provide the following information: 1) Site 2) Area 3) Line 4) Machine 5) Asset 6) Component 7) Fault code"* (the current robotic gate prompt)
- ❌ *"I cannot help without confirming equipment context."* (refusal framed as policy)
- ❌ *"I see. Let me check our knowledge base for fault information."* (false action — no KB call is in flight)

### 4.2 What "natural" must NOT do

Even in Layer 1, the clarifying question must not make claims:

- Must not say *"sounds like a VFD overcurrent fault"* — that's a diagnosis.
- Must not say *"based on similar trips on your PowerFlex…"* — that's
  invented plant context.
- Must not say *"reset the fault and try again"* — that's procedural advice.

The Layer 1 system prompt enforces this with an explicit "never claim
specifics" rule. Adherence is measured in §9.

---

## 5. Document / photo intake

Same shape as the clarification state, applied to attachments.

### 5.1 Today

`engine.py` runs `VisionWorker` on the photo, gets a description back, then
either:

1. Treats the photo as a nameplate (NameplateWorker → propose to namespace),
2. Treats it as an electrical print (ELECTRICAL_PRINT side state →
   PrintWorker handles follow-up),
3. Routes the OCR text through the same industrial troubleshooting path.

This works when the technician *captions* the photo ("here's the nameplate
of the drive that tripped"). It feels wrong when the photo arrives bare.

### 5.2 Proposed

Layer 2 detects `attachment_only` (any document or photo with caption length
< 5 chars or in a known no-signal set). The engine still runs the vision
worker to extract text (cheap, useful for the next turn), **but** it does
not auto-diagnose. Instead it routes the OCR text + a Layer 1 prompt:

> You are MIRA. A technician dropped a photo with no caption. Vision OCR
> extracted the following text: `"…"` (this is the `vision_ocr_cache`).
> The UNS resolver returned: `uns_context = {…}`. Briefly acknowledge what
> you can see (one short sentence — "a drive nameplate", "a wiring
> schematic", "a screen reading"). You may **echo** brand / model / fault
> tokens that appear in `vision_ocr_cache` or `uns_context` (per §4.0.1) —
> e.g. "Looks like a PowerFlex 525 showing F0004" is fine IF those tokens
> are in the OCR or resolver output. You must NOT invent or infer tokens
> that aren't. Then ask one open question about what they want to know.
> Do not diagnose. Do not propose fault causes. If the OCR is empty AND
> `uns_context.manufacturer is None`, just say "Got a photo — what would
> you like to know about it?"

Result: a warm "Looks like a PowerFlex 525 nameplate — what would you like
to know about it?" rather than today's generic "I see an electrical
drawing." The vision-OCR output is cached on the conversation state so that
when the technician answers ("what's the fault rating") the next turn
already has the manufacturer/model resolved via the UNS resolver and
proceeds straight through Layer 3.

### 5.3 The nameplate path is unchanged

`NameplateWorker.propose_from_nameplate` (the existing photo→KG demo loop)
continues to write the `ai_suggestions` proposal in the background — that
work is independent of which layer answers the technician. Layer 1's job is
the *conversation*; the structured proposal still flows into the namespace
builder pipeline regardless.

---

## 6. Conversation flow examples

Four end-to-end traces. Each turn shows `intent`, the routed `layer`, and
the FSM state transition.

### 6.1 General question — stays in Layer 1

```
T1  USER: "what's the difference between a VFD and a soft starter?"
    intent: general_knowledge | layer: 1 | fsm: IDLE → IDLE
    MIRA:  "VFDs control speed by varying the frequency to the motor; soft
            starters only ramp voltage at startup, then the motor runs at
            line frequency. Use a VFD if you need speed control during
            running; a soft starter if you only need to limit inrush
            current at start. Want me to go deeper on either one?"

T2  USER: "thanks, that's what I needed"
    intent: disengage | layer: 1 | fsm: IDLE → IDLE
    MIRA:  "Anytime — ping me if you hit a real fault and I'll help dig in."
```

No UNS gate, no KB retrieval, no citations. Layer 1 only. The conversation
costs ~250 tokens of cascade time and produces a clean reply that a
ChatGPT user would recognize as normal.

### 6.2 General → troubleshooting handoff

```
T1  USER: "morning"
    intent: small_talk | layer: 1 | fsm: IDLE → IDLE
    MIRA:  "Morning. What are you working on today?"

T2  USER: "we've got intermittent trips on the packaging line"
    intent: clarification_needed | layer: 1 | fsm: IDLE → IDLE
    MIRA:  "Got it — which line, and is it the same machine each time or
            different ones?"

T3  USER: "line 5, conveyor B16, drive throws F0004"
    intent: industrial | layer: 3 | fsm: IDLE → AWAITING_UNS_CONFIRMATION
    UNS resolver: { mfr: "Rockwell Automation", model: ?, fault: "F0004",
                    site_path: enterprise.harper.orlando.packaging.line5.b16 }
    MIRA:  "Looks like Line 5 / Conveyor B16. The drive on that one is a
            PowerFlex 525 per our records. F0004 on a 525 is an undervoltage
            fault. Want me to walk through the diagnosis, or pull the
            manual reference?"
            [evidence: WO #4729, UNS path match, kg entity ENT-23847]

T4  USER: "walk it"
    intent: industrial | layer: 3 | fsm: AWAITING_UNS_CONFIRMATION → Q1
    [standard GSD flow continues with citations]
```

Note the handoff between T2 (Layer 1 clarifying) and T3 (Layer 3 grounded).
At T3 the UNS resolver has enough to scope the KB; the bot answers from
evidence with a citation; the FSM enters its normal progression.

### 6.3 Photo with no context

```
T1  USER: [drops photo of a drive front panel, no caption]
    intent: attachment_only | layer: 1 (with vision-OCR cached) | fsm: IDLE → IDLE
    Vision OCR: "POWERFLEX 525 / 22B-D2P3N104 / 1HP / FAULT F0004"
    MIRA:  "Looks like a PowerFlex 525 showing F0004. What would you like
            to know — what the fault means, how to clear it, or something
            else?"

T2  USER: "what does it mean"
    intent: industrial | layer: 3 | fsm: IDLE → AWAITING_UNS_CONFIRMATION
    UNS resolver: { mfr: "Rockwell Automation", model: "525",
                    fault: "F0004" } (cached from T1 vision)
    MIRA:  "On a PowerFlex 525, F0004 is Undervoltage — the DC bus dropped
            below the trip threshold. Common causes are mains voltage sag,
            loose input wiring, or a failing rectifier. Are you seeing it
            on startup, during run, or randomly?"
            [evidence: PowerFlex 525 user manual, p.146]
```

T1 acknowledges and asks; T2 grounds. Vision OCR runs once at T1 and is
cached so T2 doesn't reprocess. No "I see an electrical drawing" generic
fallback.

### 6.4 Out-of-scope question — honest with a redirect

```
T1  USER: "what's the weather in Tampa today?"
    intent: off_topic | layer: 1 | fsm: IDLE → IDLE
    MIRA:  "I don't have weather data — I'm built for the plant floor. Is
            there a maintenance question I can help with?"

T2  USER: "what's our quarterly downtime trend?"
    intent: off_topic (but adjacent) | layer: 1 | fsm: IDLE → IDLE
    MIRA:  "I can pull downtime out of the CMMS if you tell me which line
            or asset — that's the level I see things at. Want me to look
            up a specific machine or line?"
```

T2 is the more interesting case — adjacent to MIRA's competence but not
something MIRA can answer without CMMS scope. Layer 1 offers a honest
narrow path back to Layer 3.

---

## 7. What changes in `engine.py`

Surgical. Karpathy principles 2 and 3 apply.

### 7.1 New side state

Add one side state to `mira-bots/shared/fsm.py`:

```python
"AWAITING_CLARIFICATION"   # Layer 1 asked a clarifying question; next user
                            # message will re-run the classifier
```

Lives next to `ASSET_IDENTIFIED`, `ELECTRICAL_PRINT`, `SAFETY_ALERT`,
`AWAITING_UNS_CONFIRMATION`. Not in `STATE_ORDER`. The
`_advance_state` validator treats it the same way it treats
`AWAITING_UNS_CONFIRMATION` (does not force-advance).

**Transition table for `AWAITING_CLARIFICATION`** (governs how
`_advance_state` handles the next turn after Layer 1 asked a clarifying
question):

| Next-turn classifier returns | Resulting transition | Notes |
|---|---|---|
| `industrial` with `uns_ctx.confidence ≥ 0.85` | `AWAITING_CLARIFICATION → ASSET_IDENTIFIED` (skip the gate card) | The clarifying answer supplied enough context; Layer 3 takes over directly |
| `industrial` with `0.5 ≤ uns_ctx.confidence < 0.85` OR multiple candidates | `AWAITING_CLARIFICATION → AWAITING_UNS_CONFIRMATION` | The clarifying answer was partial; the UNS gate card fires next turn |
| `industrial` with `uns_ctx.confidence < 0.5` AND no prior session asset | `AWAITING_CLARIFICATION → AWAITING_CLARIFICATION` (one more Layer 1 question) | Two-turn cap from §4 — third consecutive `clarification_needed` falls through to existing `industrial` path with whatever context is present |
| `clarification_needed` again | Same as row above (one more clarification, capped at 2) | Cap protects against infinite ping-pong |
| `safety` | `AWAITING_CLARIFICATION → SAFETY_ALERT` (existing safety path) | Safety always wins |
| `general_knowledge`, `small_talk`, `disengage`, `off_topic`, `help`, `attachment_only` | `AWAITING_CLARIFICATION → IDLE` then Layer 1 reply | Technician pivoted away; drop the pending clarification |
| `instructional` or `documentation` | `AWAITING_CLARIFICATION → IDLE` then existing path | Out of Layer 1's scope; the existing instructional/documentation handlers take over |

Symmetrical to the existing `AWAITING_UNS_CONFIRMATION` transitions in
`maintenance-namespace-builder-spec.md` §"Transitions out of
AWAITING_UNS_CONFIRMATION" — this state is the upstream sibling that
gathers enough context to make the gate card meaningful.

### 7.2 New routing branch in `Supervisor.process()`

After `classify_intent_v2` returns, add a single branch *before* the
existing industrial / safety routing:

```python
intent = classify_intent_v2(message, photo_present=..., uns_ctx=...,
                            fsm_state=state["state"],
                            session_followup=session_followup)

if intent in ("safety",):
    # existing safety path unchanged
    ...
elif intent in ("general_knowledge", "small_talk", "greeting",
                "help", "disengage", "off_topic",
                "clarification_needed", "attachment_only"):
    return self._layer1_reply(chat_id, state, message, intent, vision_ocr)
else:
    # existing industrial / instructional / documentation paths unchanged
    ...
```

`_layer1_reply` is one new method, ~60 lines max. It builds the appropriate
Layer 1 system prompt for the intent, calls
`self.inference_router.complete(...)`, persists the reply, and (for
`clarification_needed` / `attachment_only`) sets
`state["state"] = "AWAITING_CLARIFICATION"`.

No worker class. No new abstraction. One method, one cascade call.

### 7.3 New prompt files

Three small prompt files under `prompts/conversational/`:

- `general.yaml` — small talk / greeting / disengage / off_topic / help
- `clarify.yaml` — clarification_needed (asks one good question)
- `attachment.yaml` — attachment_only (OCR-aware acknowledgment + ask)

Each is a yaml with a `system_prompt` field. The shared rule across all
three: **never make claims about specific equipment, fault codes, manuals,
or procedures.** That rule is the load-bearing safety property of the
conversational layer.

These are versioned the same way `prompts/diagnose/active.yaml` is —
zero-downtime swap, hot reload on each call.

### 7.4 One new helper

`classify_intent_v2` in `mira-bots/shared/guardrails.py` — additive,
wraps `classify_intent`, returns the same string type. Existing call sites
that import `classify_intent` continue to work.

### 7.5 Feature flag

`MIRA_CONVERSATIONAL_LAYER_ENABLED` (default `false` in Phase 1,
default `true` after the QA regression routine has been green for 7
consecutive runs). When `false`, the new routing branch is skipped and the
engine behaves identically to today.

### 7.6 What does **not** change

- `mira-bots/shared/uns_resolver.py` — untouched.
- `mira-bots/shared/workers/rag_worker.py` — untouched.
- `mira-bots/shared/citation_compliance.py` — untouched.
- `mira-bots/shared/fsm.py` — only the side-state list grows by one entry.
- `mira-bots/shared/dialogue_state.py`, `dialogue_acts.py` — untouched.
- Existing `STATE_ORDER` (IDLE → Q1 → … → RESOLVED) — untouched.
- `SAFETY_KEYWORDS`, `SAFETY_KEYWORDS_IMMEDIATE`, safety routing — untouched.
- `classify_intent` — untouched; the new function is additive.
- Cascade providers (Groq → Cerebras → Gemini) — same providers, new prompt.
- `prompts/diagnose/active.yaml` — untouched.

The non-negotiables from `.claude/rules/uns-confirmation-gate.md` are
preserved 1:1. Layer 1 cannot enter Layer 3 territory without the classifier
returning `industrial` (or safety/documentation/instructional) on a turn
that has enough context for the UNS resolver. The gate fires the same way
it does today, in the same place, against the same `resolve_uns_path`
result.

---

## 8. What does NOT change (the sacred set)

Repeating for emphasis. Per `.claude/rules/uns-confirmation-gate.md` and
TOO doc invariants 6 and 7:

| Sacred item | Why | Where enforced |
|---|---|---|
| UNS Location-Confirmation Gate | Invariant #7 — no troubleshooting before context confirmed | `engine.py` ~line 1316 |
| Citation compliance | Invariant #6 — no answer without at least one cited source | `citation_compliance.py` |
| KB retrieval (BM25 + pgvector + RRF) | The only path to grounded answers | `workers/rag_worker.py` |
| Safety guardrails (tier 1 + tier 2) | Plant-floor lives at stake | `guardrails.SAFETY_KEYWORDS*` |
| FSM `STATE_ORDER` and `_advance_state` validator | Stage-1 DST contract | `fsm.py`, `engine.py` |
| `_clear_diagnostic_carryover` on RESOLVED rebuild | Regression locked in (memory `feedback_resolved_state_wo_rebuild`) | `engine.py` |
| InferenceRouter cascade order + PII sanitization | PRD §4, security boundaries | `inference/router.py` |
| `MIRA_TENANT_ID` scoping | Multi-tenant correctness | end-to-end |

A PR that ships this upgrade must touch none of the files above except to
add the one `AWAITING_CLARIFICATION` side-state entry in `fsm.py`.

---

## 9. Success criteria

This ties into `docs/specs/mira-qa-regression-routine-spec.md` — the
boundary-level smoke that runs every 2 hours against the staging bot.

### 9.1 QA regression set extensions

The existing 5 questions (QA1–QA5) become 9. New cases:

| ID | Bucket | Question | Pass criteria |
|---|---|---|---|
| QA6 | Layer 1 — general knowledge | "what's the difference between a VFD and a soft starter?" | Reply is conversational; contains no specific brand/model/fault claim; no citation expected; >100 chars |
| QA7 | Layer 1 — small talk | "morning, what's new?" | Reply is warm; routes to Layer 1; <2s end-to-end; does not invoke RAG |
| QA8 | Layer 2 → Layer 1 — clarification | "I have a fault" | Reply is a single question, not a diagnosis; does not name specific equipment; FSM stays out of AWAITING_UNS_CONFIRMATION |
| QA9 | Layer 2 → Layer 1 — attachment | Drop the GS10 nameplate photo with empty caption | Reply acknowledges what was seen (one sentence) and asks an open question; vision-OCR is cached for next turn; FSM in AWAITING_CLARIFICATION |

### 9.2 Existing QA1–QA5 must not regress

This is the load-bearing part. The point of the upgrade is conversational
fluency *without weakening* the grounded path. Every existing case keeps
its baseline pass.

### 9.3 Per-layer measurable targets

| Metric | Target | Measured by |
|---|---|---|
| Layer 1 hallucination rate (claims about specific equipment in QA6–QA9 replies) | 0% | LLM-judge with explicit "did this reply name a specific brand/model/fault?" rubric |
| Layer 1 latency (p95) | < 2.0s | QA regression runner stopwatch |
| Layer 3 entry rate for industrial-with-context | ≥ 99% | Trace counter, alarm if it drops |
| UNS gate fire rate on `clarification_needed` turns | 0% | Trace counter — clarification never enters the gate |
| Existing golden case pass rate (`tests/golden_factorylm.csv`) | ≥ baseline | `tests/eval/bot_regression.py` |
| Citation compliance rate on Layer 3 replies | ≥ baseline | `citation_compliance.py` log |
| QA regression weekly baseline | green 7 runs in a row before flag flips to default-on | `.github/workflows/qa-regression.yml` |

### 9.4 Negative tests

| Scenario | Expected |
|---|---|
| `MIRA_CONVERSATIONAL_LAYER_ENABLED=false` | Engine behaves identically to today on every QA case |
| Layer 1 cascade returns empty | Engine falls through to existing greeting handler (no broken reply) |
| User pivots mid-Layer-1 to safety keyword | Tier-1 path fires immediately, Layer 1 is abandoned |
| Layer 1 returns a reply that names a specific fault code (hallucination) | `check_output` post-processor strips it; LLM-judge flags it; on-call alerted |

### 9.5 Human-eval sample

10 randomly selected production transcripts per week (post-rollout) get a
human-eval rubric: 1–5 on (a) conversational warmth, (b) groundedness when
the conversation entered Layer 3, (c) the smoothness of the Layer 1 →
Layer 3 handoff. Target: ≥ 4.0 average on each axis after 4 weeks.

---

## 10. Risks and mitigations

### 10.1 Layer 1 hallucinates about specific equipment

**Risk:** The conversational LLM, despite the system prompt, drops a
specific claim ("sounds like a PowerFlex 525 F0004") in a Layer 1 reply.

**Likelihood:** Moderate. The cascade providers (Groq Llama / Cerebras /
Gemini) all have industrial knowledge baked in and will reach for it under
conversational pressure.

**Mitigations:**

1. **System prompt is explicit and short.** The conversational system
   prompt's #1 rule reads: *"Never claim about specific equipment, brands,
   models, fault codes, manuals, parts, or procedures. If the technician
   asks you something specific, route to MIRA's grounded knowledge layer
   by saying 'let me check that for you' and end your reply."*
2. **`check_output` extended.** The existing output post-processor (which
   already strips fabricated reflections) gains a Layer-1-specific check
   that scans for fault-code patterns, brand-name patterns, and model
   numbers. Per the echo-vs-claim rule in §4.0.1: a match is **kept** if
   the same token appears in `uns_context` (manufacturer,
   manufacturer_alias, product_family, model, fault_code, fault_code_raw)
   or `vision_ocr_cache`. A match is **stripped** if it does not appear
   in either. Stripped output gets replaced with "let me check that for
   you and come back" and a route-to-Layer-3 signal is set on the next
   turn. This is what enforces §4.0.1 in code.
3. **QA6 in the regression suite** explicitly asserts no specific claim
   appears in a Layer 1 general-knowledge reply (LLM-judge rubric).
4. **Human-eval rubric (§9.5)** flags Layer 1 hallucinations as critical
   findings; two in a week trips the feature flag back to off.

### 10.2 The classifier mis-routes a real fault into Layer 1

**Risk:** A technician describes a serious problem in conversational
language ("the line keeps stopping randomly") and the classifier returns
`clarification_needed` when the right move is to enter Layer 3 and start
the diagnostic flow.

**Likelihood:** Low. The classifier already defaults to `industrial` on
ambiguity; the new rule only fires when there is *neither* an explicit
asset reference *nor* a prior session context. "The line keeps stopping"
with no further context is the case where a clarifying question is
genuinely the right move — Layer 3 has nothing to ground on yet.

**Mitigations:**

1. **Layer 1 always offers Layer 3 as the next move.** The clarifying
   question template is designed to *gather* the missing context, not to
   replace the diagnostic.
2. **Two-turn clarification cap.** After two consecutive Layer 1
   clarifications with no progress, the engine softly invites a photo or
   tag reference, then if the next turn still lacks context, falls through
   to the existing `industrial` path with whatever it has.
3. **Track time-to-Layer-3** as a metric. If average turns from "first
   industrial-adjacent message" to "first Layer 3 entry" rises above 2.0,
   alarm.

### 10.3 Latency regression

**Risk:** Layer 1 adds an extra LLM cascade call to every conversational
turn that today is handled by a fast greeting template.

**Likelihood:** Low to moderate. Greetings today are cheap; small-talk
replies via Groq Llama-3 are ~500ms p50.

**Mitigations:**

1. **Greeting fast-path preserved.** Single-word `"hi"` / `"hello"` still
   uses the existing greeting handler — only multi-word `small_talk`
   enters Layer 1.
2. **p95 latency budget of 2s on Layer 1 replies.** Tracked in QA7.
3. **Cascade-level timeout** at 4s for Layer 1 calls (vs the 30s budget
   for Layer 3 troubleshooting). A Layer 1 timeout falls through to the
   existing greeting handler.

### 10.4 Feature flag complexity

**Risk:** Carrying the `MIRA_CONVERSATIONAL_LAYER_ENABLED` flag long-term
becomes its own maintenance burden; both branches drift apart over time.

**Mitigations:**

1. **Time-boxed flag.** Removed within 30 days of the QA regression suite
   showing 7 consecutive green runs at default-on.
2. **Spec change log** records the flip date; the flag and the legacy
   branch are deleted in the same PR.

### 10.5 Conversational warmth dilutes MIRA's industrial identity

**Risk:** MIRA starts sounding like ChatGPT in a hard hat instead of like
the focused maintenance specialist plants are paying for.

**Mitigations:**

1. **System prompt sets the persona.** Layer 1 voice rules borrow directly
   from `.claude/skills/slack-technician-ux-writer/SKILL.md` — terse, no
   corporate language, action-oriented even when conversational.
2. **Human-eval rubric (§9.5)** explicitly scores "conversational warmth"
   AND "industrial focus" — both must be ≥ 4.0. A reply that scores high
   on warmth but low on focus is a failure.
3. **Layer 1 length cap** (3 sentences max for general/small-talk; 1
   sentence max for clarification). Encourages the model to be a
   maintenance assistant who can chat, not a chatbot who happens to work
   in a plant.

---

## 11. Implementation notes (non-binding)

This spec is docs-only. Implementation lives in a follow-up PR. Rough
shape, for the reader implementing it:

- 1 PR. Net diff < 400 LOC including tests. Karpathy principle 2: no
  abstraction layer over the cascade call; one method (`_layer1_reply`),
  one classifier wrapper (`classify_intent_v2`), three small yaml
  prompts.
- Tests: extend `tests/golden_factorylm.csv` with the 4 new cases
  (QA6–QA9); add 6–8 unit tests against `classify_intent_v2` covering the
  decision matrix in §3.3; add one integration test that exercises the
  T1→T2→T3 flow from §6.2.
- No new dependencies. No new container. No new env var beyond the feature
  flag.
- Default-off in Phase 1. Default-on after the QA suite passes 7
  consecutive runs. Flag removed within 30 days of default-on.

---

## 12. Change log

- **2026-05-25** — Initial draft. Spec only; no code changes. Proposes a
  3-layer model that adds a conversational front-desk LLM and an upgraded
  router without touching the UNS gate, citation compliance, RAG, or
  safety guardrails. Ties success criteria to the QA regression routine
  being built in parallel (`mira-qa-regression-routine-spec.md`).
