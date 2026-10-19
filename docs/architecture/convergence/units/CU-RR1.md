# Convergence Unit — CU-RR1: a cross-encoder reranker for notebook retrieval

**Status:** IN PROGRESS (Gates 0–4 recorded; implementation starting) · **Owner:** CHARLIE orchestrator session
**Authorization:** Mike, 2026-10-19 — "do all those recommendations" (item 4: the reranker runs as its own small container).
**Spec:** `.planning/retrieval-spec/RETRIEVAL-CORE-SPEC-2026-10-19.md` §5.2 Phase 3 (L3 rerank); decision D2 resolved as **sidecar**.

## Current behavior (pre-change)
`mira-hub/src/lib/manual-rag.ts` `retrieveNodeChunks` builds a candidate pool (lexical passes, exact-code lanes, optional
vector lane behind `NOTEBOOK_HYBRID_RETRIEVAL`), orders it with the deterministic `rerankChunks` boosts (+ RRF with the
vector order when hybrid is on), lets `prioritizeCurrentCodeEvidence` lead with the code the technician just named, and
returns the first 6 (or a page-diverse, facet-guaranteed slice for broad questions). No learned relevance model is used.

## Why this change exists
Phase 0 measured that the walk tracks **answer-text-visible@6** — whether the anchor text is in the model-visible prefix of a
delivered chunk — not page-in-six: public-50 lexical 31 (walks 28–30), hybrid 36, ceiling in the top 100: 46. An offline
cross-encoder over the hybrid top 100 raised visible@6 to 39 and page-in-six to 45. In-app runtimes failed the latency
budget (Hub image is Alpine: native ONNX runtime does not load; WebAssembly 2.5–3.5 s/question), so the model runs in a
separate container (native CPU ≈ 0.4–0.7 s/question on 2 cores at a pool of 24–50).

## Canonical implementation
- `mira-reranker/` — new single-purpose service: FastAPI + `onnxruntime` (MIT) + `tokenizers` (Apache-2.0), model
  `cross-encoder/ms-marco-MiniLM-L-6-v2` (Apache-2.0) pinned at revision `233902d25c440f23af6f7d6e94d2946bac0bee0a`,
  files baked into the image at build time with sha256 verification. No runtime downloads, no torch.
- `mira-hub/src/capabilities/reranker.ts` — the only Hub client. Behind `NOTEBOOK_RERANK` (default off). Tight timeout,
  any failure returns `null` and the caller keeps today's order (a logged reason, never an error to the technician).
- The hook in `retrieveNodeChunks`: rerank the ordered pool BEFORE `prioritizeCurrentCodeEvidence`, so the code the
  technician named still leads the final cut (#4360). Broad questions are not reranked (their facet guarantee stays).

## Old implementation
None replaced. With the flag off the code path is byte-for-byte today's.

## Affected modules
`mira-reranker/**` (new) · `mira-hub/src/capabilities/reranker.ts` (new) · `mira-hub/src/lib/manual-rag.ts` (hook) ·
`docker-compose.staging-vps.yml` (staging service + flag forwarding; guarded root compose) ·
`docs/architecture/convergence/REGISTRY.yaml` (service entry) · tests on both sides.
**Not in this unit:** `docker-compose.saas.yml` (prod). Staging and prod share one VPS; prod's compose starts every service
on deploy. Prod gets the service only after staging shows p95 within budget and the walk gate below passes.

## Contracts/invariants
1. Flag off ⇒ identical chunks, identical order (pinned by test and by the zero-token replay).
2. Flag on and service down / slow / malformed ⇒ identical to flag off, plus a logged `reranker_fallback` reason.
3. The code the technician named leads the final cut with the flag on (a test where the reranker scores the code chunk low).
4. Broad questions are never reranked.
5. Tenant scoping is unchanged: the service receives only passage text already admitted for this caller, holds no state,
   and is reachable only on the internal network.
6. The service never downloads at runtime; a wrong sha256 fails the image build.

## Risk classification
Medium: new service on the shared staging/prod host (CPU/memory contention), and a change to which chunks the model sees.
Mitigations: staging only, hard `cpus`/`mem_limit`, flag default off, fallback on every failure. Gate 7 at the full Codex tier.

## Behavior-lock tests (Gate 3)
- Zero-token replay (PR #4534, branch `feat/retrieval-phase0` @ `6d44228f0726dd7a26388d245ba256aafd68f956`): with the flag
  off the replay must reproduce the Phase 0 numbers exactly (public-50 lexical recall@6 37, visible@6 31; real-32 lexical 23).
- Unit tests for invariants 1–4 in `mira-hub`; service tests for scoring parity and input limits in `mira-reranker`.

## R0 SHA/checkpoint
`29c62700cee10e863774e9e3947f508de951f61b` (main, after #4531). Prod runs `bf477cbe7d6d0fc39cf1fd5afae46a8a2a3aa4cb`.
Recovery: abandon branch `feat/notebook-reranker`; R0 restores fully (no schema, no data).

## Implementation plan
1. Service + its tests (delegated under `.planning/retrieval-phase0/TASK-reranker-service.md`, isolated worktree;
   every introduced symbol and dependency verified before commit).
2. Hub client + hook + invariant tests.
3. Measure through the replay with the real hook, production-sized pool, local service: lexical and hybrid, recall@6 and
   visible@6. If the production pool loses the offline gain, widening the pool when rerank is on is decided here.
4. Staging compose (limits, internal only) → deploy → p95 latency on staging.

## Shadow-validation plan (Gate 8)
Staging with `NOTEBOOK_RERANK=1`, replay against staging + one stranger walk at a fixed configuration.

## Walk gate (written before measurement)
Against the Phase 0 baseline (public-50 CORRECT 28.6, WRONG_PAGE 12–14): **CORRECT ≥ 30.6 and WRONG_PAGE ≤ 14**, with
p95 added latency ≤ 1.5 s. The walk asks right after upload; readiness gating (document not "Ready" until embedded) is
sequenced as the next unit and lands before the gating walk, or the walk is read with per-question coverage recorded.

## Human approval requirement
Gate 9 = Mike GO for (a) enabling on staging (covered by item 4), (b) the prod compose service and prod flag (separate GO).

## Promotion plan
PR → required checks → Codex review (full tier) → merge → `deploy-staging.yml` → measure → separate prod PR.

## R1 SHA/checkpoint
_pending_

## Evidence required for GO
Replay numbers flag-off (= R0) and flag-on (lexical, hybrid); staging p95; walk gate result; Codex GREEN on the exact head.
