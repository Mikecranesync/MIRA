# MIRA-1000 / P0003 — First Connected Caller, Cost Telemetry, and Conversation Event Contract

**Program:** MIRA-1000  
**Prompt ID:** P0003  
**State:** ACTIVE  
**Issued:** 2026-08-20  
**Parent architecture:** PR #3339  
**Upstream work:** P0001 PR #3340; P0002 PR #3341  
**Product-surface decision:** `docs/architecture/mira-1000/PRODUCT_SURFACES.md`

## Goal

Close the exact gap P0002 deliberately left open without prematurely building the OpenAI Cloud Gold provider or redesigning the native UI.

This slice must:

1. connect the `InferenceProvider` seam to a real MIRA runtime caller while preserving today's Cascade behavior;
2. close the per-turn cost/route telemetry gap that ADR-0037 makes a precondition for Cloud Gold traffic;
3. establish a provider-independent MIRA conversation/event contract capable of supporting the future minimal ChatGPT/Claude-style technician interface and tool/approval events;
4. prove the path with real repository tests/evidence;
5. leave paid OpenAI runtime traffic disabled.

## Product direction you must preserve

Read `PRODUCT_SURFACES.md` before implementation.

The product decision is now explicit:

- FactoryLM Hub remains the desktop configuration/governance/control plane.
- Existing `mira-mobile` becomes the primary technician-facing MIRA application.
- Do **not** create a third chat/native client.
- The future native UI is conversation-first and minimal; Workorders/Schedule/Assets/Files/Notebook remain reusable secondary surfaces and server-backed tools/context.
- Notebook is a persistent workspace/context primitive, not a mandatory RAG setup step before ordinary MIRA conversation.

P0003 is backend-first. **Do not perform the broad mobile UI convergence in this slice.** That is P0004.

## Mandatory preflight

Before editing:

1. Follow the repository global multi-session/session-discipline protocol.
2. Inspect current `main`, worktrees, open PRs, and claims.
3. Read PR #3340 and PR #3341 in full and verify their current head SHAs; do not rely on the SHA written in this prompt if either PR moved.
4. Verify no other session owns the same provider/telemetry/runtime files.
5. Read:
   - root `CLAUDE.md`
   - `.claude/rules/zero-token-architecture.md`
   - `.claude/rules/mira-1000-cloud-gold.md`
   - ADR-0037
   - `docs/architecture/mira-1000/CURRENT_TO_TARGET_MAP.md`
   - `docs/architecture/mira-1000/PRODUCT_SURFACES.md`
   - `docs/architecture/mira-1000/TRACKER.yaml`
6. Re-derive the exact runtime seam and telemetry stores from the branch you will edit.

If P0002 is not available on your branch, stack from its current head or stop and report the dependency. Do not reimplement P0002 independently.

## Budget and inference rule

**Target paid inference spend for this slice: $0.00.**

Use hermetic fixtures and the existing Cascade path for implementation and tests. P0003 does not authorize the OpenAI Cloud Gold provider or paid validation traffic.

ADR-0037 still governs any later paid lane.

## Part A — connect the provider seam

P0002's closure state is explicit: BUILT/TESTED/ENABLED, but not CONNECTED or PROVEN.

Connect the seam at the smallest shared runtime point supported by current repository evidence.

P0001 found all major clients converge on `Supervisor.process()` / `process_full()`. Prefer a shared-runtime connection that benefits all clients **only if** behavior can remain equivalent under the default Cascade provider and the blast radius is properly tested.

Requirements:

- default behavior remains today's Cascade path;
- provider selection is explicit and fail-closed for unknown names;
- no provider-specific OpenAI logic enters business/context/evidence code;
- existing PII sanitization, retry/backoff, budgets, citation/evidence behavior, and provider failure semantics remain intact unless an independently justified fix is required;
- do not bypass existing callers with a parallel MIRA orchestrator;
- rollback must remain obvious and low-risk.

If wiring every Supervisor call at once would create unsafe blast radius, wire the narrowest real path that establishes the contract and document why broader convergence belongs in a follow-up. Do not fake "connected" with a test-only caller.

## Part B — cost and route telemetry is a hard gate

ADR-0037 says no Cloud Gold traffic without per-turn cost telemetry sufficient to enforce spend budgets.

P0001 found the existing usage store cannot answer the required questions and is per-container SQLite.

At minimum the durable telemetry model must be capable of recording or deriving:

- tenant
- user/principal
- conversation
- request/run ID
- provider
- model
- route reason / selected edition
- input tokens
- cached input tokens
- output tokens
- estimated/actual cost inputs
- tool-call count or references when tools arrive
- latency
- success/failure/status
- timestamp

### Reuse-before-create requirement

Search the repo for an existing durable tenant-scoped run/audit/usage table that can be safely extended or reused. Do not create another canonical run ledger if one already exists.

If a new schema object is actually required:

- make it additive;
- tenant-scope it correctly;
- use the existing migration path;
- document retention and what is/is not stored;
- never log secrets or raw OAuth/provider credentials;
- make budget enforcement possible before Cloud Gold enablement.

Do not put the full prompt or sensitive retrieved data into a billing table merely because it is convenient.

## Part C — establish the MIRA conversation/event contract

The new technician UI direction requires a richer runtime contract than a final `str`, but P0001 proved true token streaming does not yet exist end-to-end.

Define the provider-independent event/result vocabulary now so the provider and clients converge on one contract.

The contract must be able to express, now or by compatible extension:

- assistant text or text delta
- citation/evidence reference
- active-context/asset change
- tool-call started
- tool-call progress where useful
- tool-call completed
- tool-call failed
- typed tool result
- approval required
- approval accepted/rejected
- attachment/file event
- usage/cost event
- final response/status
- recoverable error
- fatal error

### Rules

- Do not expose raw OpenAI Responses API event names as the public FactoryLM client contract.
- Do not fabricate token streaming from a completed reply and call that true streaming.
- It is acceptable for the current Cascade adapter to emit a coarse event sequence such as one final text event plus usage while the contract remains ready for real deltas later.
- Preserve backwards compatibility for existing callers unless a migration plan and tests prove the change.
- Keep provider output immutable where P0002's `TurnResult` contract intends immutability.

The contract should make P0004 possible without rewriting the runtime again.

## Part D — mobile/UI compatibility, without the UI rewrite

Inspect the current `mira-mobile` chat/notebook resource layer to ensure the new event contract can support its migration, but **do not build a new app and do not broadly redesign `mira-mobile` in P0003**.

The future P0004 client needs to render:

- normal assistant messages
- citations
- inline asset/work-order/tool cards
- approval prompts
- attachment/camera events
- context changes
- tool failures honestly
- cost/usage only where appropriate for the user's role

Record any client contract gaps discovered for P0004.

## Tests and evidence

At minimum prove:

1. the default Cascade provider still produces behavior equivalent to the pre-seam path for representative calls;
2. one real runtime request flows through `InferenceProvider` — not merely a unit-test fake;
3. unknown provider selection still fails loudly rather than silently falling back;
4. PII sanitization remains active on the Cascade path;
5. telemetry records the required route/usage identity for success and failure cases;
6. tenant/user/request boundaries cannot be overwritten by model/user prose;
7. event contract serializes/deserializes deterministically and does not require OpenAI-specific types;
8. existing clients continue working or the exact intentionally affected client path is documented and gated;
9. mutation/negative controls exist for the load-bearing invariants where practical.

Run the relevant existing test suites. If the full suite has pre-existing failures, compare against a clean baseline and document exact deltas rather than claiming "all green."

## Explicit non-goals

Do not in this slice:

- implement `OpenAIResponsesProvider` for production use;
- provision or modify `OPENAI_API_KEY`;
- raise Cloud Gold spend budgets;
- send paid OpenAI test traffic;
- redesign the native app shell;
- create a new `mira-chat` / `mira-technician-v2` project;
- add Gmail/Slack/calendar writes;
- create generic autonomous PLC/VFD writes;
- replace existing retrieval/KG/evidence systems;
- claim true streaming if the provider only returns a completed string.

## Closure requirements

Do not call P0003 complete until the ledger can honestly state:

- BUILT
- CONNECTED
- TESTED
- OBSERVABLE
- rollback documented
- default Cascade behavior preserved/proven

`PROVEN` for P0003 means a real MIRA request has passed through the seam and telemetry path using the existing non-paid provider route. It does **not** mean Cloud Gold itself has been proven.

Update `TRACKER.yaml` and append `HISTORY.md` in the child PR.

## Expected follow-up

Recommend the exact P0004 slice based on evidence. The intended direction is:

> Refactor the existing `mira-mobile` information architecture so MIRA conversation becomes the root technician experience, while reusing the existing native foundation, files, notebooks, citations, assets, QR/deep links, offline work-order handling, and other proven field capabilities.

Do not execute P0004 unless it is separately issued/authorized under the MIRA-1000 ledger.
