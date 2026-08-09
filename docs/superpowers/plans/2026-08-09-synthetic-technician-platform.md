# Synthetic-technician testing platform — architecture + implementation plan

**Date:** 2026-08-09
**Status:** Slice 1 SHIPPED (real replay). Slices 2-5 designed, not built.
**Audit this builds on:** the offline lab is a detector rescan, not a replay — see
`tests/regime1_telethon/campaign/offline_lab.py` module docstring (corrected 2026-08-09).

## The shift

Today `runner.py` *is* the definition of a campaign: a campaign is "a Telethon
conversation". That makes Telegram the foundation of the test pyramid, which is
backwards — it is the slowest, most credential-bound, most variable transport we
have.

The target abstraction is a **scenario + synthetic technician**, runnable across
three transports:

| Lane | Transport | Cost | Purpose |
|---|---|---|---|
| **Replay** | none — in-process `Supervisor` | free | regression; deterministic orchestration |
| **Direct** | in-process / Celery, no Telegram | inference only | scale; hundreds of conversations |
| **Telethon** | `@Mira_stagong_bot` | inference + wall-clock | end-to-end certification only |

## What shipped (slice 1)

| File | Role |
|---|---|
| `tests/regime1_telethon/campaign/replay.py` | **real replay.** `technician_turns()` extracts `role=="tech"` records; `stubbed_supervisor()` builds a REAL `Supervisor` with the six workers patched; `replay_conversation()` drives `process_full()` turn by turn |
| `tests/regime1_telethon/campaign/evidence.py` | `TurnEvidence` / `ConversationEvidence` — the flight-recorder object detectors will unify on |
| `tests/regime1_telethon/test_replay.py` | 7 tests incl. a **mutation test** that adds `Q1` to `PIVOT_EXEMPT_STATES` and proves the replay notices |

Proof it executes MIRA rather than reading text, on real c7 data:

```
 i  fsm before   fsm after    markers
 1  IDLE         Q1           ROUTER
 2  Q1           Q1           ROUTER
 3  Q1           DIAGNOSIS    ROUTER,CTX_FRESH_THREAD_PIVOT,CTX_FRESH_THREAD
    uns: model='525' fault=None      <- CTX-001d cleared the dead fault
```

Engine markers and FSM transitions cannot come from a ledger. `ConversationEvidence.transcript()`
returns the exact shape `gates.check_conversation()` already consumes, so every
existing detector runs against replayed output with no adapter.

**Deliberate non-goals, stated in the module docstring:** replay does not
reproduce prose (inference is a fixture), and does not exercise retrieval
(`recall_knowledge` returns `[]` without `NEON_DATABASE_URL`).

## Slice 2 — the scenario abstraction

Proposed `campaign/scenario.py`, a frozen dataclass carrying **hidden truth MIRA
must not see**:

```
Scenario:
  id, seed
  equipment_truth: vendor, model, asset_tag, uns_path
  fault_truth: code, description
  knows: facts the technician volunteers freely
  withholds: facts released only when asked correctly
  misinformation: facts the technician states WRONGLY
  knowledge_level, persona, objective
  challenge_policy, asset_switch_at, stop_conditions
```

Migration path that avoids a rewrite: `mutators.generate()` and
`state_attacks.generate()` already return `{"id", "turns":[{send,expect,forbid}]}`.
A `Scenario.scripted_turns()` producing that shape lets `runner.scripted_conversation()`
consume scenarios unchanged. `PERSONAS` (`personas.py`) becomes the `persona`
field rather than a parallel concept.

**Strict role separation to preserve** (currently correct, easy to lose):
technician model = `probe.py`; MIRA's model = the deployed engine; judge =
`judge.py`. All three currently share `llm.py`'s cascade — acceptable, but they
must never share a *prompt* or an object.

## Slice 3 — ledger v2 as a flight recorder

`ledger.py` records only wire-visible facts, and says so. The census: 1,631 turn
records carry `{kind, conv, tier, i, role, text, ts}` plus `grade`/`notes` (507)
and `strategy` (308). No state, no routing, no sources.

Add to `ledger.turn()` as **optional** keys (old ledgers stay readable; readers
must treat missing as "not observed", never "absent"):

```
trace_id, scenario_id, seed, backend
router_intent, router_confidence, dispatch_kind
fsm_before, fsm_after, uns_{manufacturer,model,fault_code,confidence}
retrieved_ids[], retrieved_meta[] (source_type/page/manufacturer — NEVER content)
citations[], guard_decisions[], provider, model, latency_ms
```

**Capture seam, no new coupling:** `process_full()` already returns
`{reply, confidence, trace_id, next_state, dispatch_kind, route, model, ...}`
(`engine.py:2134` `_make_result`). The direct lane gets this for free. The
Telethon lane cannot — it only sees the wire — so it must correlate by
`trace_id` from container logs, or accept lower fidelity. **Do not couple the
Telethon harness to application internals to close that gap.**

Hard constraint: no secrets, no prompts, no embeddings, no corpus content, no
cross-tenant data. Retrieval evidence is **identifiers and metadata only** — that
is what makes grounding verifiable without copying the corpus into a test file.

## Slice 4 — Celery for the direct lane

Celery already exists: one app, `mira-crawler/celery_app.py:40`, config in
`celeryconfig.py`, tasks registered explicitly in `_TASK_MODULES` with
per-module failure isolation. **Do not add a second framework.**

Fit is good — scenario executions are independent, isolated by `seed` +
`chat_id`, and already idempotent-ish via `ledger.completed_convs()` resume.
Open question to settle before building: the crawler worker image does not ship
`mira-bots/`, so a `run_scenario` task would need either a new queue on an image
that does, or the direct lane runs in-process under `pytest`/a CLI and Celery is
reserved for genuinely large batches. **Measure first** — the in-process direct
lane may be fast enough that Celery is premature.

## Slice 5 — defect lifecycle

Detector fires → replay reproduces → minimise (drop turns while the invariant
still fails) → dedupe against existing issues (`issues.py` already does
fingerprint dedupe via an HTML-comment marker) → build a defect package →
*propose* an issue.

Package: scenario id, minimal conversation, invariant violated, actual behaviour,
backend, MIRA SHA, seed, state transitions, retrieval evidence, detector finding,
and **which lanes reproduce it** (offline / direct / Telethon). A defect that
reproduces offline is a permanent fixture; one that reproduces only on Telethon
is a deployment/transport issue and belongs in a different bucket.

Keep the existing rule: nothing files automatically without a reproduction.

## Cross-layer invariants the evidence model enables

Not built — but `TurnEvidence` is shaped for them:

1. a citation must belong to material compatible with the resolved asset;
2. retrieved evidence must correspond to the active equipment context;
3. an asset switch must update state without destroying unrelated escalation
   counters (**this is exactly CON-004c** — `_clear_diagnostic_carryover`
   wiping `uns_gate_attempts`);
4. UNS resolution, routing and retrieval must agree on equipment identity;
5. a parameter may exist globally yet be unsupported by *this turn's* sources
   (CIT-006's strict form — blocked on retrieval telemetry);
6. repeated clarification must be judged against what the technician supplied;
7. safety must be evaluated on deterministic lanes too (`check_safety_routing`
   is offline-capable today but is **not** in `CONVERSATION_GATES`).

Invariant 3 is the proof this model is right: it is a state bug that no
single-layer detector could see, and it took three live iterations to find.

## Next three highest-leverage steps

1. **Ledger v2 optional telemetry + direct lane** — unlocks invariants 1/2/4/5
   and makes CIT-006 enforceable at production strictness.
2. **`Scenario` with hidden truth + withheld facts** — turns graders from
   substring matching into "did MIRA extract what the technician was hiding?",
   which is the actual product question.
3. **Wire `check_safety_routing` into the offline sweep** — safety is currently
   the largest offline blind spot and needs no new infrastructure.
