# MIRA-1000 Living History

This file is append-only in spirit. Correct an earlier entry with a later entry rather than rewriting history to make the sequence look cleaner.

## 2026-08-19 — H0001 — Divergence decision

**Decision:** create MIRA Cloud Gold as the online reference-intelligence path using OpenAI, while preserving the existing local-inference work as the On-Prem/no-cloud-inference line.

**Critical qualification:** do not fork FactoryLM into two products internally. Fork at the inference/provider boundary and reuse the deterministic platform, context, evidence, tools, policy, memory, audit, and client contracts.

**Reason:** rebuilding general conversational intelligence is not the differentiating value of FactoryLM. FactoryLM's moat is trustworthy industrial context, retrieval, evidence, deterministic validation, tools, integrations, and safe execution.

**Gold target:** MIRA should be conversationally comparable to a high-quality ChatGPT experience and superior on FactoryLM-specific questions because it has authorized plant context.

**On-Prem target:** same product contract and eval families, with local inference and explicit capability gaps where cloud-only features cannot be reproduced.

## 2026-08-19 — H0002 — Cost architecture added

Four distinct cost mechanisms were separated:

1. prompt caching for repeated stable context in interactive chat;
2. model routing only after Gold evals exist;
3. Flex for slower lower-priority request workloads;
4. Batch for large asynchronous grouped work.

Gold quality remains the first milestone; cost optimization follows measurement.

## 2026-08-19 — H0003 — Prompt-control surface established

MIRA-1000 now uses:

- immutable prompt IDs under `prompts/`
- `CURRENT.md` for the active next slice
- `TRACKER.yaml` for machine-readable state
- this file for narrative history
- child PRs that cite the MIRA-1000 prompt ID they execute

The first active prompt is P0001: discovery/convergence mapping.

## 2026-08-19 — H0004 — P0001 discovery completed in PR #3340

P0001 found that the divergence is materially smaller than the original green-field architecture implied:

- all major clients already converge on `Supervisor.process()`;
- the repository already has 26 MCP tools;
- the OpenAI SDK and key plumbing already exist for another narrow use case;
- `TechnicianContext`/context-contract work already exists but is not adopted on the production turn path;
- current "streaming" is a complete reply emitted as one SSE chunk, not token streaming;
- the existing usage telemetry is per-container and lacks the fields required to govern Cloud Gold spend.

The recommended seam is `InferenceProvider` above `InferenceRouter`, preserving the current router and its production call sites.

PR #3340 contains the repo-backed current-to-target map. It is in review and not yet merged at this history entry.

## 2026-08-19 — H0005 — P0002 provider seam built, honestly PARTIAL, PR #3341

P0002 introduced the behavior-preserving `InferenceProvider` seam with `CascadeProvider` wrapping today's inference path. Unknown provider names fail loudly; the Cascade provider explicitly does not claim tool capability; immutable provider results are treated as records rather than editable buffers.

ADR-0037 resolved the standing doctrine conflict by authorizing Cloud Gold as a distinct, budget-capped, telemetry-enforced edition rather than a general permission for paid inference.

Closure remains **PARTIAL**:

- BUILT: yes
- TESTED: yes
- ENABLED/default-safe: yes
- CONNECTED: no
- PROVEN on a real runtime turn: no
- OBSERVABLE to Cloud Gold's required per-turn cost standard: no

That gap becomes P0003.

## 2026-08-20 — H0006 — Product surfaces converged: Hub control plane, existing native app becomes MIRA

Repository inspection changed the UI recommendation.

The existing `mira-mobile` application is not a disposable prototype. It already contains the native/auth/session/deep-link/QR/offline/files/notebook/citation/nameplate/work-order/schedule foundation required by a field technician application. Building a new chat-native client would recreate solved infrastructure.

**Decision:**

- FactoryLM Hub remains the desktop configuration/governance/control plane.
- MIRA becomes the primary technician-facing intelligent product.
- The existing `mira-mobile` codebase is refactored into MIRA's primary native interface.
- Do not create a third `mira-chat` / `mira-technician-v2` application merely to achieve a cleaner shell.
- The target native experience is minimal and conversation-first, in the family of ChatGPT/Claude.
- Existing Workorders, Schedule, Assets, Files, QR/nameplate, and Notebook capabilities are retained as secondary browse/manage surfaces and/or server-backed tools/context.
- Notebook becomes a persistent machine/incident/research context primitive instead of a mandatory source-selection front door to all intelligence.

The detailed decision is now `PRODUCT_SURFACES.md`.

Sequencing was also corrected: P0003 remains backend-first (connect the seam, close telemetry, establish the provider-independent event contract). The native shell convergence is P0004 so runtime and UI changes do not become one unreviewable slice.

## 2026-08-20 — H0007 — P0003: the seam is connected, telemetry is real

**Claim:** posted on #3339 before editing; re-read confirmed no competing claim.

**Preflight findings worth keeping.** #3340 went `CONFLICTING` when the parent moved —
the conflict surface is exactly the three ledger files (`CURRENT.md`, `HISTORY.md`,
`TRACKER.yaml`), no code. P0002 is **not** in the parent, so this branch stacks from
P0002's head per the prompt rather than reimplementing it. Four open PRs touch
`engine.py` (#3191, #2985, #2984, #2983); only #3191 touches `router.complete`.

**Part A — connected at `RAGWorker._call_llm`.** That is the primary technician answer
path, and deliberately **not** `engine.py`, whose four open PRs make it the wrong place
to wire a seam this week. Blast radius is one function. The provider wraps the *same*
injected router, so default behavior is byte-identical; what changes is that the call
now yields a `TurnResult` + event envelope, and one place decides which edition serves
the turn. The Open WebUI fallback (the On-Prem line) is preserved and tested.

**Part B — reused `decision_traces`; did NOT create a second ledger.** It was already the
append-only, RLS-scoped, per-turn record written non-blocking from the bot runtime, and
it already carried the identity half (tenant/session/trace_id/platform/model/latency/ts).
Migration **078** adds only the accounting half: `provider`, `route_reason`, `principal`,
`input_tokens`, `cached_input_tokens`, `output_tokens`, `cost_usd_estimate`,
`tool_call_count`, `status`. `cached_input_tokens` is separate because cached input bills
at ~0.1x and folding it in would overstate spend by up to 10x. Cost is stored as
**inputs, not a frozen total**, because provider prices change. The projection is an
**allowlist** — a provider payload cannot inject `tenant_id` or smuggle a prompt into the
billing columns, and both properties are mutation-tested.

**Part C — the conversation/event contract.** `mira-bots/shared/inference/events.py`:
a 17-member `EventType`, an immutable `MiraEvent`, and a `TurnEnvelope` with
deterministic JSON. No OpenAI wire names (a test asserts none start with `response.`).
**No fake streaming:** the cascade returns a finished string, so it emits ONE
`ASSISTANT_TEXT`, never fabricated deltas; `stream_was_incremental` records which
actually happened so a client cannot be misled.

**Part D — inspected only, no UI work.** Today's client contract is
`sources → content* → status → [DONE]` (`mira-mobile/src/lib/sse.ts`). Mapping and the
six event kinds the client has no equivalent for are recorded under P0004's
`inputs_from_p0003` in `TRACKER.yaml`.

**A qualification to a P0001 finding.** `sse.ts` documents the Hub chat frames as
supporting *incremental* content delivery. P0001's "nothing token-streams" measured the
**mira-pipeline** `/v1/chat/completions` path (`main.py:1034`, one whole-reply chunk).
Whether the Hub endpoint actually emits incrementally today was **not verified here** —
verify before designing P0004's streaming UX.

**Paid inference spent:** $0.00. Credit remains $9.25.

**Closure:** BUILT ✅ CONNECTED ✅ TESTED ✅ OBSERVABLE ✅ PROVEN ✅ — a real
`_call_llm` turn flows through the seam with only the network stubbed. Cloud Gold itself
remains unproven and unbuilt, which is correct for this slice.

**Next:** P0004 — converge the existing `mira-mobile` information architecture onto the
conversation-first shell, reusing the native foundation. Not authorized by this prompt.

## 2026-08-20 — H0008 — P0003 closure pass: two gaps, one of them my overclaim

The owner reviewed #3342 and found two genuine closure gaps. Both are recorded here
as corrections rather than quietly folded into H0007.

**Gap 1 — provider selection was not real on the connected path.** `RAGWorker`
constructed `CascadeProvider(router=router)` directly, so `MIRA_INFERENCE_PROVIDER`
governed `get_provider()` in isolation but **never the technician path that was
actually wired**. A deployment could ask for Cloud Gold and silently keep getting the
free cascade — the exact self-hiding spend/quality bug the fail-loud rule exists to
prevent. Fixed: `get_provider()` now accepts the caller's `InferenceRouter` and the
worker selects through it. The router MUST be threaded rather than letting the cascade
build its own, because the runtime's router carries the session→model cache
(`last_model_for`, which the decision trace reads) and the hourly budget counters; a
second router would silently fork both.

**Gap 2 — telemetry was built but not connected, and `observable: true` was an
OVERCLAIM.** Migration 078 and `build_trace_row()` existed, and a real turn went
through the seam, but the turn's usage never reached `decision_traces` — it stopped at
`_last_turn`. H0007 recorded `observable: true` on the strength of the schema existing.
That was wrong and is corrected here.

Fixed by threading the snapshot **per turn**: `_call_llm(usage_sink=...)` writes into
this turn's `state` dict, the engine pops it onto the result
(`parsed["_turn_usage"]` → `_make_result` → `result["_turn_usage"]`), and
`_schedule_decision_trace` maps it onto the 078 columns.

**`_last_turn` was removed, not merely bypassed.** Caching the turn on the shared
`RAGWorker` was the same `#1704` cross-tenant bleed this module already documents for
`_last_sources`: the singleton is shared across tenants and the engine reads telemetry
back *after* an await, so a concurrent turn can overwrite it first. A test now asserts
the attribute does not exist.

**engine.py was touched — deliberately, and minimally.** Six one-line insertions, each
adjacent to the identical existing `_context_manifest` pattern. #3191's `engine.py`
hunks sit at ~36/952/960/2704; the nearest of mine is ~160 lines away.

**Evidence.** 37 P0003 proofs pass (25 → 37). Three new mutations all caught:
reverting to the hardcoded provider, dropping the snapshot in the engine, and the
worker not writing the sink. `ruff` clean.

**Paid inference spent:** $0.00. Credit remains $9.25.

**Closure:** BUILT ✅ CONNECTED ✅ TESTED ✅ OBSERVABLE ✅ PROVIDER-SELECTABLE ✅
PROVEN ✅.

## 2026-08-20 — H0009 — P0003 regression proof: both extra failures were real, and mine

The suite delta was **not** order dependence. My earlier hypothesis that it might be
was **wrong**, and no appeal to collection-order flakiness was needed in the end.

**The two extra failures, both caused by this slice, both fixed:**

1. `tests/test_engine.py::TestMakeResult::test_basic_result` — asserts the EXACT
   `_make_result` dict, and P0003 added `_turn_usage` to that contract. The test was
   doing its job. Fixed by updating the expected shape, not by loosening the assertion.
2. `tests/test_engine_no_embedding_gs11.py::test_gs11_modbus_query_grounded_when_embedding_fails`
   — the grounding regression suite installed after the embed-sidecar demo failure. I
   had threaded `usage_sink=` through `_call_llm`, whose fake stubs `(messages,
   model=None)`. Investigating showed `_call_llm` is **also passed as a callable in
   production** (`engine.py:2263`, `llm_call=rag._call_llm`), so its signature is a
   wider contract than it looks. Fixed by carrying the snapshot on a `ContextVar` with
   a `capture_turn_usage()` helper — zero signature change, and per-asyncio-task
   isolation gives the same `#1704` property the sink was for.
   `test_p2_call_llm_signature_is_unchanged` is now a standing guard.

**Name-level proof (not aggregate counts).**

```
baseline  8c4bf57c7 (P0002 head, #3341): 56 failed, 2483 passed, 17 skipped (30:07)
branch    6adb915c0 (P0003 head, #3342): 56 failed, 2521 passed, 17 skipped (29:50)

py -3 -m pytest tests/ -q -p no:randomly   --ignore=tests/test_gchat_adapter.py --ignore=tests/test_slack_relay.py   --ignore=tests/test_teams_adapter.py -rf --tb=no
```

Diffing the two 56-name `FAILED` lists: **zero names only on the branch, zero names
only on the baseline — byte-identical.** Passes reconcile exactly: 2483 + 38 new
P0003 tests = 2521. The baseline was run in a throwaway detached worktree at the
P0002 head under the same selection and environment, then removed.

None of the 56 pre-existing failures touch a file this slice changed — they are
`test_email_adapter` (39), `test_slack_runtime_diagnostics` (7),
`tools/test_active_learner` (3), `test_slack_fast_paths` (2), `test_slack_doctor` (2),
`test_drive_pack_truth_pins` (2), `test_visual_region_schema` (1).

**Process note worth keeping.** The first two full-suite runs captured only `tail -2`.
That summary line is what let a real regression hide behind an aggregate count for two
rounds. Runs now capture the complete `FAILED` list, and closure is judged on names.

**Paid inference spent:** $0.00. Credit remains $9.25.

**P0003 closure: GREEN.** BUILT ✅ CONNECTED ✅ PROVIDER-SELECTABLE ✅ OBSERVABLE ✅
TESTED ✅ REGRESSION-FREE ✅ PROVEN ✅.

Cloud Gold itself remains unbuilt and unproven — correct for this slice. Next is P0004
(conversation-first `mira-mobile` convergence), which is **not** authorized by P0003.
