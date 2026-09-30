# Jev Decision Fabric — the export, before it is enabled

**Required by the goal before enabling any new export.** This documents the exact
payload, the endpoint, redaction, tenant isolation, latency and cost. The one thing
it does **not** establish is vendor-side retention — see § Open, which is why this
is authorized for **staging only**.

## Endpoint

`POST https://api.typesafe.ai/v1/systemone`, model pin `jev-1.13.0`.
Auth: `Authorization: Bearer $JEV_API_KEY`, read from the environment at call time
and never logged. Same endpoint and key already used by the sufficiency shadow
(`MIRA_JEV_SHADOW`), so this adds a payload, not a vendor.

Flag: **`MIRA_JEV_DECISION=1`**, default off, and deliberately a *different* flag
from `MIRA_JEV_SHADOW`. The decision fabric sends a strictly larger payload — it
adds the delivered answer and the photo observations — so enabling the smaller
export must never silently enable the larger one.

## The exact payload

Produced by `buildDecisionRequest()` and reproducible with
`bun tools/qa/jev_decision_probe.ts`. The `state` string below is the **entire**
technician-derived content of the request; everything else is the fixed
12-question set (`JEV_DECISION_QUESTIONS`, versioned `decision-fabric-v1`).

```
TECHNICIAN QUESTION:
  the screen is blank on this panel, what do I check first

EQUIPMENT IDENTITY THE SYSTEM BELIEVES:
  SIEMENS TP700 Comfort

PHOTO OBSERVATIONS IN CONTEXT:
  [observation 1] A panel nameplate reads SIEMENS SIMATIC HMI TP700 Comfort,
  6AV2124-0GC01-0AX0. Panel IP [IP], S/N [SN].

RETRIEVED EVIDENCE:
  [1 family=SINAMICS G120 src=SINAMICS G120 List Manual] r0949 Fault value. The DC
  link voltage r0026 should read approximately 1.35 x line voltage.

ANSWER MIRA DELIVERED:
  Check the DC bus voltage first. If the DC bus reads 0 V the rectifier is not
  supplying the inverter.
```

Total request: **3,385 bytes**, ~1,000 input tokens.

## What is sent, and why each field is necessary

| Field | Why the judgment is impossible without it |
|---|---|
| question | Every question is "did the answer do X *for what was asked*". |
| asset identity | #3966 is a mismatch between this and the evidence family. |
| photo observations | #3962 is an answer that drifts off the observed subject. |
| evidence excerpts + family | The thing the answer is judged against. |
| delivered answer | The object under judgment. |
| deterministic gate outcomes | So the judge can be **scored against** the gates, not substituted for them. |

## What is NOT sent

Credentials, cookies, session or bearer tokens. Tenant id, user id, email, owner
id, notebook id or notebook name. Unrelated conversation history — only the
observation that was actually in this turn's context. File bytes or images. The
model's private reasoning. Every one of these is asserted by a test that has been
**negative-controlled**: `jev-decision.test.ts` "carries no tenant, user, notebook
or credential field" fails when a tenant id is planted in the state and passes
when it is removed (run 2026-09-23).

Correlation ids (`trace_id`, `attempt_id`) exist on the `TurnDecisionState` type
for local joining and are **not rendered into the state string** — confirmed by
the byte dump above.

## Redaction

`turn-decision-state.ts` passes every string through `scrubForVendor()` — the same
IPv4 / MAC / serial-number scrub the sufficiency shadow uses — *before* the text
reaches `jev-decision.ts`. Visible in the dump: the nameplate's `192.168.1.50`
became `[IP]` and `ABC1234567` became `[SN]`.

Caps: question 600, answer 1,800, observation 900 (max 3), evidence excerpt 500
(max 6 chunks), identity 160. A long answer is truncated, not dropped — the judge
sees less, never more.

**Known residual.** The scrub is shape-based. A nameplate photograph legitimately
contains a manufacturer, a model and an order number (`6AV2124-0GC01-0AX0` above),
and those are *the content being judged* — removing them would make the judgment
meaningless. So: this export carries equipment identifiers by design. It does not
carry who owns them.

## Tenant isolation

The payload contains no tenant identifier, so one call cannot be attributed to a
tenant by the vendor. Within MIRA, the result is written to the packet of the turn
that produced it, which is already tenant-scoped by `decision_traces` RLS — no new
read path and no new table.

## Retention and logging

- **MIRA side:** the verdicts (11 probabilities, one class + distribution, model,
  latency, tokens, question-set version) land in `decision_traces.packet` under
  `jev_decision`. **No question, answer, observation or evidence text is stored** —
  the packet has never carried text and this does not change that. Server logs get
  nothing: there is no `console.log` of the payload.
- **Vendor side:** see § Open.

## Latency and cost

Measured against the live API 2026-09-23, 12 questions, ~1,000 input tokens:

| | |
|---|---|
| p50 | **276 ms** |
| p95 | **293 ms** |
| input tokens / turn | ~1,000 (mean 1,005 over 4 states) |
| turn-latency impact | **zero by construction** |

Zero is a structural claim, not a measurement: the call is made inside
`finishAndPersist`, which every caller reaches *after* `controller.close()`. The
answer bytes and the `[DONE]` frame are already on the wire before the request is
built. A Jev timeout, outage or 4xx therefore cannot delay or fail delivery, and
`evaluateTurnDecision` never throws — it returns a record with `skipped_reason`,
so an outage is a value in the data rather than a gap.

## Open — resolve before ANY production enablement

1. **Vendor retention and training use of request bodies is not established.** No
   written statement has been obtained about how long TypeSafe AI retains request
   payloads or whether they inform training. Until that exists in writing, the
   flag stays staging-only, where content is synthetic or Mike's own bench
   equipment.
2. **Data-processing terms** for a second inference vendor handling customer
   equipment text have not been reviewed.
3. Production enablement requires Mike's explicit approval and is **not** requested
   by this work.

## Cross-references

- `mira-hub/src/capabilities/observability/turn-decision-state.ts` — the payload builder
- `mira-hub/src/capabilities/observability/jev-decision.ts` — the question set + client
- `mira-hub/src/capabilities/observability/__tests__/jev-decision.test.ts` — the assertions above
- `.claude/rules/materialized-evidence.md` rule 9 — model output never self-promotes
