# MIRA persona inventory + conflict audit

**Date:** 2026-09-22 · **Base SHA:** `ebde0ccf5b25f6322d0d8633a0b426f3f7a85508` (`origin/main`)
**Purpose:** the audit that precedes the MIRA Intelligence Contract. Every live
technician-facing system prompt, what it actually says, and where they contradict
each other.
**Method:** `git grep -n "You are MIRA"` over the tree at the base SHA, then each hit
traced to a caller to establish whether it is LIVE, LEGACY, or NON-CHAT.

---

## 1. Inventory

### 1.1 LIVE — technician-facing conversational personas

These serve a real technician turn today.

| # | Prompt | File | Surface | Reaches |
|---|---|---|---|---|
| P1 | `BASE_SYSTEM_PROMPT` | `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts:104` | Notebook chat, **grounded** mode | **Mobile (only chat path)** + Hub |
| P2 | `GENERAL_SYSTEM_PROMPT` | same file `:145` | Notebook chat, **`mode:"general"`** | Mobile + Hub |
| P3 | `SYSTEM_PROMPT` | `mira-hub/src/app/api/hub/ask/route.ts:86` | V3 web, general scope | Hub web `/v3` |
| P4 | `systemPrompt()` (asset) | `mira-hub/src/app/api/assets/[id]/chat/route.ts:183` | V3 web, machine scope; AssetChat | Hub web |
| P5 | asset fallback prompt | same file `:548` | Asset chat, no-manual branch | Hub web |
| P6 | node prompt | `mira-hub/src/app/api/namespace/node/[id]/chat/route.ts:181` | NodeChat (namespace subtree) | Hub web |
| P7 | tablet/kiosk prompt | `mira-hub/src/app/api/mira/ask/route.ts:372` | Ask MIRA kiosk/tablet | Kiosk |
| P8 | `SYSTEM_PROMPT` | `mira-hub/src/app/api/quickstart/ask/route.ts:62` | Public funnel (unauthenticated) | Marketing |
| P9 | document-grounded prompt | `mira-hub/src/lib/manual-rag.ts:735` | Shared doc-chat helper | Hub |
| P10 | `active.yaml` `system_prompt` | `mira-bots/prompts/diagnose/active.yaml:22` | Supervisor / bots cascade | Telegram, Slack |
| P11 | `engine.py` general answer | `mira-bots/shared/engine.py:6548` | Supervisor direct-answer path | Telegram, Slack |
| P12 | `engine.py` clarify | `:6511` | Supervisor, unresolved vendor | Telegram, Slack |
| P13 | `engine.py` cross-vendor | `:6641` | Supervisor, multi-vendor turn | Telegram, Slack |
| P14 | `engine.py` procedural | `:7328` | Supervisor, how-to turn | Telegram, Slack |

**Count: 14 live conversational personas.** Nine in TypeScript (Hub), five in Python
(bots). None share a single source.

### 1.2 LIVE — task-specific, non-conversational

Legitimate extensions, not competing personas. Listed so the contract can say so
explicitly rather than leaving them ambiguous.

| Prompt | File | Job |
|---|---|---|
| Schematic reader | `engine.py:1972` | Vision: read a wiring diagram |
| Photo-burst synthesis | `engine.py:2897` | Vision: summarize N photos |
| Print translator | `shared/print_translator.py:129`, `workers/print_worker.py:23` | Electrical-print explanation |
| Print workspace | `telegram/bot.py:625` | Follow-ups inside a print workspace |
| Daily briefing | `notifications/daily_briefing.py:197` | Scheduled digest, not a turn |
| Dialogue-act classifier | `shared/dialogue_acts.py:59` | Classifier — `MIRA's ...`, not `You are MIRA` |
| Query triage | `workers/query_triage.py:22` | Classifier |

### 1.3 LEGACY / DEAD — no live caller

| Prompt | File | Status |
|---|---|---|
| `GSD_SYSTEM_PROMPT` | `rag_worker.py:389` | **Fallback only** — see §2.1 |
| `v0.1-baseline`, `v0.2`, `v0.4` yaml | `mira-bots/prompts/diagnose/` | Superseded prompt revisions, kept for eval replay |
| Modelfile personas | `mira-core/Modelfile{,.staging}` | Open WebUI removed from prod |
| OWUI model personas ×3 | `tools/owui_tools/setup_owui_models.py` | Same |
| Node-RED booth demo | `mira-bridge/flows/fault-detective.json:795` | Bench booth demo; its own comment says production chat routes through the Supervisor |
| `mira-scan-monday/` ×2 | `backend/{mira_rag,vendor_rag}.py` | Separate scanner prototype |
| Docs/PRD quotes | `docs/legacy/*`, `*.docx.md` | Documentation, not runtime |

---

## 2. Conflicts found

### 2.1 Socratic-vs-direct — resolved in Python, by precedence, not by deletion

`rag_worker.py:389` still reads *"You use the Guided Socratic Dialogue method. You
**never** give direct answers."* `prompts/diagnose/active.yaml:22` reads *"Never
withhold a supported answer to satisfy a style rule."* Flatly opposite.

**Actually live:** `_active_system_prompt()` (`rag_worker.py:573`) returns
`_yaml_system_prompt() or GSD_SYSTEM_PROMPT`, so `active.yaml` wins whenever the file
is readable. The Socratic text is a fail-open fallback.

**Why it still matters.** The file's own docstring records that until 2026-08-04
`active.yaml` was read *only for version metadata* while the model received the
hardcoded Socratic constant — two prompt revisions silently never reached a
technician. The failure mode is live again the moment the YAML is unreadable: a
malformed file downgrades MIRA to "never give direct answers" with a `logger.warning`
and no other signal. A fail-open fallback that contradicts current doctrine is a
latent regression, not dead code.

### 2.2 The headline product conflict — no-chunks behavior differs by runtime

| Runtime | Zero retrieved chunks | Source |
|---|---|---|
| **Hub / TypeScript** | `insufficient_evidence`, **no provider call at all** | notebook route `:810` |
| **Bots / Python** | *"You do not have documentation for this in your knowledge base — say so up front, **then answer from general training knowledge**"* | `engine.py:6548` |

The same company's product answers a technician's unbacked question on Telegram and
refuses it on the phone app. This is the single largest divergence in the inventory,
and it is exactly the "no chunks = no intelligence" behavior the goal names.

**It is not a bug to fix by loosening the Hub gate.** See §3.

### 2.3 Citation-bracket semantics are prompt-local and mutually unsafe

P1 teaches `[n]` citation markers. P2 **bans them outright**. The route carries a
second strip-guard because the prompt rule alone was not trusted.

**Mechanism check (correction).** An earlier draft of this audit asserted that a stray
bracket renders a chip pointing at nothing. It does not: `remark-citation-marks.ts`
returns early when `knownIds` is empty and `citation-marks.ts` skips any id outside
that set, so an unknown `[1]` renders as literal text. The ban is still right — plain
`[1]` reads as a citation to a technician — but the harm is representational, not a
broken widget. Stating the wrong mechanism would have made the next reader "fix" the
renderer instead of keeping the prompt rule.

P3, P8, P6, P9 each independently re-teach `[n]`. Six prompts, six hand-written
statements of one contract. Any shared persona core that teaches `[n]` unconditionally
silently breaks P2's ban — the highest-risk regression in this refactor.

### 2.4 Answer-shape rules disagree numerically

- P1: "lead with the direct answer in the first sentence", explanation ≤2 sentences
- P2: "under about 150 words"
- P3 / P8: "4-8 short bullets max"
- P6: "concise and actionable"
- P11: "under 120 words"
- P4 / P5 / P7: no length rule at all

Six different definitions of "a technician is on a noisy plant floor".

### 2.5 Safety is stated six ways, and mostly as prose

`mira-hub/src/lib/safety-classifier.ts` is the canonical, deterministic safety seam
(`matchSafetyStop`, `SAFETY_STOP`, `ELECTRICAL_HAZARD_DIRECTIVE`) and the notebook
route calls it **before** retrieval and **before** any provider call. That is correct
and stays.

But the prompts *also* each carry their own prose safety rule, and they differ:

- P1 has a detailed **ENERGY STATE** rule that outranks brevity and requires the
  isolation clause in the same sentence as the instruction
- P2 has one line: "assume the equipment may be energized"
- P6 says stop and defer to site procedure for LOTO/arc-flash
- P3, P4, P5, P7, P8 say **nothing about safety at all**

P1's energy-state rule is the best formulation in the repo and is reachable from
exactly one of nine Hub surfaces.

### 2.6 Prompts that make MIRA less capable than the base model

| Prompt | Restriction | Justified? |
|---|---|---|
| P1 | "Answer ONLY from the numbered reference excerpts" | **Yes** — grounded mode is the cite-or-refuse contract |
| P6 | "Answer using ONLY the documentation provided below" | **Partly** — no general-mode escape hatch exists for NodeChat, so a node with thin docs is a dead end |
| P8 | Cite-or-refuse on the public corpus | **Yes** — anonymous funnel, no tenant corpus |
| P3 | **None** — see §2.9 | **n/a** — P3 already answers generally when the corpus misses |
| `GSD` fallback | "never give direct answers" | **No** — contradicts current doctrine (§2.1) |

Of the live set, only the `GSD` fail-open fallback is an outright unjustified
restriction. P6 (NodeChat) is the real remaining gap: it has no general-mode escape
hatch at all, so a namespace node with thin documentation is a dead end.

### 2.9 A third mode already exists, and it is the best one — it was just unnamed

`/api/hub/ask` (P3) is neither grounded nor general. Its rule is:

> "Answer the question. Answer it from your general maintenance and
> industrial-equipment knowledge whenever the CONTEXT has no excerpt that supports
> it — an educational or general question deserves a clear, useful answer, never a
> refusal." … "When a CONTEXT excerpt supports a claim, cite it with [n] markers …
> When the CONTEXT does not support the answer, do not cite it; say in one short
> line that their plant docs did not match, then give the general answer anyway."

That is **retrieval-augmented general reasoning**: evidence upgrades the answer,
absence of evidence does not veto it. It is the closest thing in the repo to the
golden rule, and it exists on exactly one route with no name, no shared source, and
no test protecting the property.

**Audit correction.** An earlier draft of this document listed P3 as unjustified
cite-or-refuse. That was read from a stale branch; on `origin/main` at the base SHA
P3 is the hybrid above. The contract models it as a first-class third mode
(`augmented`) rather than collapsing it into either neighbour.

### 2.7 Provider drift

`mira-hub/src/lib/inference/canonical-cascade.ts` (Groq → Cerebras → Together, matching
`router.py`) is live behind `MIRA_CANONICAL_SEAM=1`. The notebook route still carries a
legacy inline `providers()` listing **Gemini** as the flag-off fallback — Gemini is
banned by Hard Constraint #2. Personas do not vary by provider today; the drift is in
provider *selection*, and it is already fenced.

### 2.8 Identity drift

Five different self-descriptions across live prompts: "maintenance assistant for ONE
specific machine" / "an AI maintenance assistant … built by FactoryLM" / "a maintenance
intelligence assistant" / "an industrial maintenance diagnostic assistant" / "an
industrial maintenance assistant". No two Hub routes introduce MIRA the same way.

---

## 3. The reconciliation this audit hands to the contract

The goal says FactoryLM must **augment** foundation-model intelligence. The repo says,
in the target map §1, that strict grounding + zero-chunk refusal is **"Live. Preserve
exactly."** Fifteen commits and a live staging acceptance loop (ALL PASS at
`26eae84e1`, #3943–#3948, #3953) defend it.

Both hold. They reconcile through **mode, not through loosening the gate**:

- **One** identity, doctrine, safety posture, and answer-shape core — shared.
- **Evidence rules differ by mode.** Grounded mode keeps cite-or-refuse and the
  zero-chunk no-provider-call gate **byte-identical**. General mode carries the broad
  reasoning.
- The goal's own acceptance criterion F — *"existing retrieval/citation protections
  remain intact"* — is the tiebreaker whenever the two readings collide.

**Out of scope for this arc, stated explicitly:** making a blank chat reach general
reasoning *without opting in* is a route/client affordance change (today it is
`body.mode === "general"`), not a prompt change. It is named in §8 as the recommended
next migration and is deliberately not attempted here.

---

## 4. Constraints any migration must respect

1. `equipment-notebooks/__tests__/machine-evidence.test.ts:219` asserts
   `sys.indexOf("You are MIRA") < sys.indexOf("## Machine Evidence")` — the literal
   opening and its position are pinned by test.
2. `chat-canonical-seam.test.ts` and `chat-stop-persist.test.ts` also pin this route.
3. The P2 bracket ban is load-bearing (§2.3) and must be asserted, not assumed.
4. The zero-chunk gate at `route.ts:810` is not to be touched in this arc.
5. Safety classification stays where it is — `safety-classifier.ts`, before retrieval,
   before inference. The contract describes safety *posture in prose*; it never becomes
   the safety *gate*.


---

## 5. Remaining forks (the drift guard's allowlist, in words)

Enforced by `mira-hub/src/lib/__tests__/mira-contract-drift.test.ts`. Migrating one
means deleting its line there; the list can only shrink.

| Route | Mode it should take | Note |
|---|---|---|
| `equipment-notebooks/[id]/chat` | grounded / general | **Migrated.** Literals retained as the flag-off rollback path |
| `hub/ask` | augmented | **Migrated.** Same |
| `assets/[id]/chat` | grounded + augmented fallback | Two personas in one file; the `:548` branch is the no-manual case |
| `namespace/node/[id]/chat` | grounded + **needs** general | Has no general escape hatch — a thin node is a dead end (§2.6) |
| `mira/ask` | grounded | Kiosk; no safety prose today |
| `quickstart/ask` | grounded | Public funnel — cite-or-refuse is correct here and should stay |

Python (`mira-bots/`) is a separate runtime and a separate arc: `active.yaml` +
four `engine.py` personas, plus the `GSD` fail-open fallback (§2.1).

## 6. Recommended next migration

1. **`namespace/node/[id]/chat` → grounded + general.** Highest product value: it is
   the only live surface with a hard dead end and no general fallback, which is the
   golden rule's clearest remaining violation in the Hub.
2. **`assets/[id]/chat` → grounded + augmented.** Retires two personas in one file and
   brings the energy-state rule to the V3 machine-scope door.
3. **Narrow the general-mode speculation rule** before either — see the flagged case in
   `docs/proofs/2026-09-22-mira-intelligence-contract-acceptance.md`: forbid guessing
   what a specific numbered parameter ID *means*, with its own A/B.
4. **`mira/ask`** (kiosk) — currently carries no safety prose at all.
5. **Python runtime** — `active.yaml` becomes the extension over a shared core, and the
   `GSD` fail-open fallback is deleted rather than left contradicting doctrine.

`quickstart/ask` should **not** be migrated to augmented: it is anonymous and pinned to
the public OEM tenant, so cite-or-refuse is the correct contract there.
