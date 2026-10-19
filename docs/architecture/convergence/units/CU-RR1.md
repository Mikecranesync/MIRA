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

## Step 3 measurement (2026-10-19, real hook, zero-token replay)
The production pool is **24**, not 50: the hook reranks `hybridRanked.slice(0, rerankPool())`, and
`hybridRanked` holds only the retrieval pool, `max(4·topK, 24)` = 24 at the route's `topK = 6`.
Measured at that pool, replay call `topK = 6` only, **0 reranker fallbacks** in every rerank-on run
(the client timeout was raised locally for the measurement only, so latency could not contaminate quality).

| corpus / mode | answer visible in the six (off → on) | right page in the six (off → on) |
|---|---|---|
| public-50 lexical (staging's mode) | 31 → **34** (0 lost) | 37 → 39 |
| public-50 hybrid | 36 → **41** (0 lost) | 41 → 46 |
| real-32 lexical | 15 → **21** (1 lost: tq-18) | 23 → 26 |
| real-32 hybrid | 17 → **25** (0 lost) | 26 → 30 |

Flag off reproduces Phase 0 exactly (public lexical: 50/50 identical top-six pages).

**Service defect found and fixed (c46239d99):** OOM-killed under a 768 MiB cap — the ONNX arena grew
481 MiB → 1.4 GiB over 20 requests, and one 24-pair batch spiked past the cap. Arena off + batches of 8:
flat ~300 MiB over 50 pool-50 requests; scores within 6.2e-6, top-six order unchanged 25/25.

**Latency risk (open):** ONNX fp32 on CHARLIE's ARM cores at 2 threads is p50 ≈ 1.6 s per pool-24
request — above the Hub's 1.5 s timeout (offline 0.43 s was PyTorch with Apple matrix units, not
comparable). The staging host is x86 with different kernels; its p95 must be measured before the walk
is read. Host checked read-only: 6 vCPU Intel Haswell, AVX2, **no AVX-512 VNNI**, load ~0.1, 8 GB free — so the
staging service gets `cpus: 3` with 3 threads. Fallback if over budget: the AVX2 int8 model file (not the
VNNI one), pinned by sha256, re-measured for quality first.

## Step 4 walk result (2026-10-19, staging `2aae7250d`, rerank on, hybrid off)
Three stranger walks, public-50, `NOTEBOOK_RERANK_TIMEOUT_MS=4000` so latency could not mask quality.

| | baseline (5 walks, no rerank) | reranker (3 walks) |
|---|---|---|
| CORRECT | 28.6 mean (28–30) | **31.7 mean** (32, 32, 31) |
| WRONG_PAGE | 12–14 | **11.0 mean** (12, 10, 11) |
| ABSTAINED | — | 7.3 mean |

**Quality gate (CORRECT ≥ 30.6, WRONG_PAGE ≤ 14): PASS** — every rerank walk beat the best baseline walk.
Fallbacks: 13 of 136 calls (9.6%, all timeouts at 4 s), under the 10% validity cutoff.

**Latency gate (p95 added ≤ 1.5 s): FAIL** with the fp32 model on the staging host (6 vCPU Haswell, `cpus: 3`):
p50 2.6 s, p95 4.1 s, max 5.6 s over 123 served calls. A first attempt at the 1.5 s timeout was aborted
after 5 of 8 calls fell back. Next phase: the AVX2 int8 model file (speed), quality re-measured first.

## Speed phase — int8 (AVX2) model (2026-10-19)
`onnx/model_quint8_avx2.onnx` from the same pinned revision (sha256 `c80a8b34…61bf9`), baked in beside fp32 and
selected by `RERANKER_MODEL` (staging compose default `int8-avx2`; rollback `RERANKER_MODEL=fp32`, no rebuild).

Quality, zero-token replay at the production pool (24), 0 fallbacks, answer-visible-in-six (fp32 → int8):
public-50 lexical 34 → **34**; real-32 lexical 21 → **20** (lost tq-07); public hybrid 41 → 40; real hybrid 25 → 26.
Gate written before measuring (within 1 of fp32 on both lexical sets): **PASS**.
Speed on CHARLIE (ARM, 8 threads, pool 24): p50 955 → **243 ms**. The deciding number is staging p95 after deploy.

## License exception (owner-approved 2026-10-19)
Root `CLAUDE.md` Hard Constraint 1 allows Apache-2.0 or MIT only. Codex review r2/r3 (#4535, F4) found the image
ships packages outside that. The **complete installed tree of the built image** was audited with pip-licenses
(34 distributions); Mike approved a recorded exception for exactly the 14 that are neither MIT nor Apache:

| license | packages | why they are here |
|---|---|---|
| BSD-3-Clause | numpy, sympy, mpmath, protobuf | onnxruntime's own runtime dependencies (numpy, sympy, protobuf) and sympy's (mpmath) |
| BSD-3-Clause | uvicorn, starlette, click | the ASGI server and FastAPI's core; already shipped in production by mira-pipeline, mira-mcp, mira-ingest |
| BSD-3-Clause | httpx, httpcore, idna, fsspec | pulled by tokenizers via huggingface_hub; httpx is the repo's mandated HTTP client |
| MPL-2.0 | certifi, tqdm (MPL-2.0 AND MIT) | file-level copyleft; obligations arise only if those files are modified, which this service never does |
| PSF-2.0 | typing-extensions | pydantic and FastAPI dependency |

None is GPL or AGPL. **Enforced at build time:** `mira-reranker/check_licenses.py` runs as a Dockerfile step
after every install and fails the image build if any installed distribution is neither MIT/Apache by its own
metadata nor on this list (proved: removing `sympy` from the list fails the build at that step). Adding any
package outside the list needs a new owner approval and an edit to that file.

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
