# Product runtime harness — design review

**Status:** research and planning only. No code changed. Implementation, migrations, paid calls, publication, merge and deploy each need separate approval.
**Input:** *MIRA Product Runtime Blueprint* (durable record, replaceable controller, authorized tools).
**Code read at:** `main` `f83e9df25` (blueprint snapshot `2f7c1953` + #4302).
**Method:** four read-only code traces; the load-bearing claims were re-checked by hand (marked ✔).

---

## 1. The short answer

The blueprint fits MIRA, and most of the parts already exist. They live in the wrong shape:

| Blueprint part | What exists today | Shape problem |
|---|---|---|
| **Durable record** | `equipment_notebook_turns`: claim + replay + fenced completion (`lib/equipment-notebooks.ts` L1284-1559, migrations 073-089) | One mutable row per turn. No step, sequence or "what is pending". Recovery = re-run the whole turn after a 10-min lease. |
| **Controller** | `handleChatTurn` in `app/api/equipment-notebooks/[id]/chat/route.ts` L845-4090 | One ~3,250-line function. Its state lives in mutable closures. |
| **Authorized tools** | `validateChatSources`, `retrieveNodeChunks` / `retrieveManualChunks`, `buildCitations`, `validateAnswer`, `semanticSafetyCheck`, `recordTurn`, manual acquisition | They already exist as functions. Scope is mostly enforced inside the service (tenant + doc scope in SQL). |

**The most important finding is not about durability.** The F004 field report ("525 manual ready", yet the answer was general guidance) points to **truthfulness gaps between what the UI says and what the turn actually did**. A harness would not fix those by itself. They are small, and they should come first (§4, Slice A).

---

## 2. One turn, end to end (exact map)

| Stage | Where (route.ts unless noted) | Notes |
|---|---|---|
| Ingress | `POST` L4120-4169 | `attemptId`, `x-client-request-id`, `turn_ingress` arrival/response (fail-open) |
| Auth + tenant | `sessionOr401` L850 | tenant from the session, never from the body |
| Body + mode | L858-940 | `general = body.mode === "general"` L911 is **client-chosen** |
| Idempotent claim | L1212-1259 → `claimNotebookTurnRequest` | key `(tenant, notebook, owner, client_request_id)`, bound to the exact payload; outcomes replay / in_progress 409 / mismatch 409 |
| Source authorization | L1292-1349 → `validateChatSources` (lib L1154-1231) | fail-closed; `match_state ∈ {user_confirmed, verified}`, enabled, not superseded |
| Photo / asset / machine scope | L1359-1727 | bound asset, identity dispute, machine history refusals (422/503) |
| Retrieval | L1751-2010 | `notebookRetrieval = !(general \|\| nodeId===null)` L1765 ✔. Notebook path = **pure BM25**, tenant + `ingest_route='v2'` + `doc_id = ANY` (`manual-rag.ts` L845-1125). Notebook errors → 500. OEM errors → silently `[]`. |
| Decline gate | L2599-2749 | zero chunks + grounded → `insufficient_evidence`, no model call |
| Prompt assembly | L2760-3015 | evidence goes in the user message with an untrusted-data frame; the asset UNS path and filenames are model-visible; no tenant/auth data in the prompt |
| Model call | L3099-3382 | raw `fetch` streaming cascade; 30 s per provider; no retry within a provider; `MIRA_CANONICAL_SEAM` picks the provider list only |
| Validation | L3512-3680 | refusal regex; `validateAnswer`; semantic judge; citation filter `citationsUsedInAnswer` |
| Persist → stream | L3857-4026 | gate on: `recordTurn` **before** the first content frame; gate off: streams first |
| Observability | `finishAndPersist` L1105-1193 | `decision_traces` + evidence packet; fail-open; nothing reads it back |
| Reload | `GET .../[id]` → `listTurns` (lib L1635-1731) | complete rows only; evidence JSONB survives; passage re-resolved live by `doc_id + page` |

### Facts the extraction must preserve exactly (and owner decisions to make)

1. **The semantic judge fails open** (Mike, 2026-09-27, #4022) ✔. The comment at L3582-3585 still says "Fail-closed" and is stale. Fix the comment, keep the behaviour.
2. **`unsafe_answer` is dead.** `validateAnswer` never returns it; it appears only in a type (`answer-validation.ts:43`) ✔. That makes five withhold branches unreachable (L3719, 3873, 3887, 3921, 3957). *Decision:* delete them or re-wire them. Do not "preserve" them silently.
3. **General mode skips the notebook's own selected manuals** (L1765) ✔.
4. **Retrieved but uncited is labelled "General guidance — not grounded in this machine's documents"** (L3826-3851) ✔.
5. **Persist asymmetry.** With no `clientRequestId`, a failed `recordTurn` is logged and the answer still streams, but it is never stored (L3890-3916).
6. **Gate-off ordering.** With `NOTEBOOK_ANSWER_GATE=0`, content streams before it is persisted.
7. **Notebook chat does not use vectors.** The #4292 embedder fix does not affect this journey; it matters for other surfaces.

---

## 3. Contract-by-contract gaps

### Task record
| Property | Status |
|---|---|
| Task / request / principal / tenant IDs | **Exists** (turn id, `client_request_id` + payload binding, `owner_user_id`, RLS tenant) |
| Selected equipment | **Partial.** Written at completion only; absent on pending rows and on reload |
| Schema / controller version | **Partial.** Only on `decision_traces` (packet v2, `git_sha`); not on the turn |
| Ordered events, step ids | **Absent** |
| Pending operation | **Absent.** Only pending/complete |
| Expected revision + dedup | **Partial.** Dedup key yes, claim-token CAS yes, revision no |
| Intent before side effect | **Partial.** Coarse claim only; no provider checkpoint (manual acquisition already does it right: `notebook-manual-acquisition.ts` L240-330, L616-700) |
| Resume / reconcile | **Absent for turns.** A stale pending row is re-run in full, so the provider is paid twice. The `decision_traces` reconciler is off by default, waits 15 min vs the 10-min lease, and can mislabel a completed turn "abandoned" |

**What happens on a crash, at each point today:**
- **After the claim:** a 409 for 10 min, then a full re-run.
- **After the model call, before persist:** the tokens are lost and charged twice.
- **After persist, before the ack:** replays correctly. The spend row may be lost.

### Evidence
| Requirement | Status |
|---|---|
| Source id, page locator, quote | **Exists** (`EvidenceCitation`) |
| Document version / content hash on the citation | **Absent.** Hash only on `hub_uploads.content_sha256`; reload re-reads live chunks by `doc_id + page` |
| Processing ≠ readiness ≠ grounding | **Conflated.** "Manual is ready" = membership + chunk count, no query run (`notebook-manual-acquisition.ts` L1077-1086 ✔). The readiness count lacks retrieval's `ingest_route='v2'` and approval predicates. The message is attached to the *last* assistant turn regardless of that turn's basis |
| Nothing found vs failed vs inaccessible | **Partial.** Recorded in `zero_result_reason`; the user sees one generic text; OEM failure is swallowed |
| Citations resolve to retrieved sources | **Partial.** Unmatched `[n]` are silently dropped; no support check |

### Controller
- Already a bounded, deterministic workflow (good: matches the blueprint's "start predictable").
- Provider policy lives in `lib/inference/canonical-cascade.ts`. That is a *provider* seam, not the controller seam.
- No typed "next step"; no separation between trusted context and model-visible text, beyond by-convention.

### Tools
- Tenant and doc scope are enforced in SQL inside the services ✔ (meets "model arguments never grant permission").
- Results are not typed outcomes: retrieval returns an array or throws; there is no `denied / unavailable / transient / unknown` distinction.

### One contract (TechnicianContext)
- The Python contract (`materialized_evidence/context_contract.py`) is the canonical shape. **The Hub never builds or writes it.** `decision_traces.context_manifest` is always NULL for Hub turns.
- The flag `MIRA_CONTEXT_CONTRACT` is off by default and not forwarded to mira-pipeline.
- ADR-0033 is still **Proposed**, and the unification PRD is DRAFT.
- Adoption path: **manifest-only** (below). No TS hand mirror, no Hub→Python call.

---

## 4. Proposed plan (four slices, each separately approvable)

### Slice 0 — Measure and classify F004 (read-only, staging; needs approval to read the deployed DB)
- **F004:** read the two F004 turns' `/turns/{id}/diagnostics` (retrieval `candidate_count`, `zero_result_reason`, `returned_doc_ids`). Check whether the "Line 1 drive" notebook is asset-bound, and whether an `insufficient_evidence` row precedes each general answer.
  - **Candidate causes, ranked:**
    - (1) The phone's silent re-ask in general mode on an unbound notebook (`mira-mobile/src/screens/NotebookScreen.tsx` L399-409 ✔).
    - (2) Retrieved but uncited, so labelled "general".
    - (3) Stale or empty scope sent as `mode:"general"`.
    - Lexical miss and embedder: low.
- **Baseline over 14 days** of staging `decision_traces.evidence_packet` via `db-inspect.yml`:
  - p50/p95 turn latency by stage
  - zero-result rate
  - basis distribution when sources were selected
  - share of retrieved-but-uncited turns
  - provider attempts per turn
  - cost per answer
  - orphaned `started` lifecycles
  - stale pending turn rows

### Slice A — Truthful readiness and basis (R2; small; behaviour changes marked ⚠)
1. ⚠ **"Ready" means retrieval works.** In `currentManualSearchStatus`, run one authorized `retrieveNodeChunks` probe (topK 1, same predicates as chat) before saying "ready".
2. ⚠ **Show the phone fallback.** Make the re-ask visible ("Not found in the 525 manual — general guidance:"), or remove it for notebooks with an enabled manual.
3. ⚠ **Give retrieved-but-uncited answers their own basis/label.** For example "Manual searched — answer not cited". Do this instead of "General guidance", or re-prompt once for citations.
4. Bind the readiness message to a turn only when that turn's basis matches.
5. Fix the stale fail-closed comment. Decide on the dead `unsafe_answer` branches.

**Tests:** a readiness probe that is red with the source un-retrievable; a mobile fallback test; route tests for the uncited-retrieval basis; F004-shaped fixture through the real route.

### Slice B — Durable turn (R2 code + R3 additive migration)
1. A stale pending turn becomes an explicit `interrupted` terminal state instead of a silent re-run. Align the reconciler window with the lease. The reconciler skips completed `client_request_id`s. (Code only.)
2. Add a `client_request_step` column (`claimed → retrieving → generating → validating → persisting`) plus `attempt_id` and `provider_response_id` on the turn row. Update them by CAS on the claim token, copying the manual-acquisition fence pattern. This needs an additive migration (`ADD COLUMN IF NOT EXISTS`).
3. Write the equipment snapshot at claim time. Stamp `record_version` and `controller_version`.
4. Rename the stale-worker error (`NotebookNotFoundError` at lib L1553 → lease lost → `superseded`).
5. Every turn gets a server-minted request id, so the no-`clientRequestId` "streamed but never stored" path disappears. ⚠

**Tests:** interrupt before the tool call, after the provider returns, and after commit before the ack. Each must resume or reconcile with no duplicate turn and no second provider charge.

### Slice C — Extract one controller (R2; R3 if it touches validation / safety / tenant filters)
Use branch-by-abstraction behind a flag (convergence Gate 5). Cut along the existing seams into `mira-hub/src/capabilities/notebook-turn/` (new code cannot go under `src/lib/**`):

| Function | Replaces | Returns a typed outcome |
|---|---|---|
| `resolveTurnScope` | L1292-1727 | scope or refusal |
| `retrieveEvidence` | L1751-2010 | `{chunks, strategy, outcome: found\|empty\|failed\|denied}` |
| `decidePolicy` | L2104-2627 | answer / decline / acquire |
| `buildModelView` | L2760-3015 | messages (trusted context kept separate) |
| `generate` | L3134-3382 | `{text, model, usage, attempts, outcome}` |
| `validateCandidate` | L3512-3680 | `{answer, status, citations, hazards}` |
| `commitTurn` | `recordTurn` call sites | committed record |
| `projectFrames` | L3801-4026 + `replayNotebookTurnResponse` | SSE frames (one projector for live and replay) |

- No provider, prompt or autonomy changes.
- Replay parity: run the same fixture through the old and new paths and compare contracts, citations and policy outcomes (not wording).
- Shadow mode must not double-write or double-charge.

### Slice D — One context contract (R3; blocked on ADR-0033 acceptance)
- **Manifest-only adoption.** The Hub emits a `TechnicianContext.to_dict()`-shaped manifest into the existing `decision_traces.context_manifest` (migration 071; no new migration), behind a flag. Prompt bytes stay unchanged.
- **Python stays the source of truth.** Add a generated JSON schema and golden fixtures under `contracts/`, plus a cross-language parity test: a TS-built fixture must pass Python `validate_context` and produce the same sha (watch the JSON separator and question-sanitization differences).
- First settle `EvidenceItem.trust` as an enum, and add the Hub notebook route to the unification PRD's WS1 list.

---

## 5. Acceptance (blueprint §"before enabling the new path") → test home

| Blueprint test | Where it would live |
|---|---|
| Exact-manual journey on phone | `tools/mobile-e2e/run.sh` with a known `--expect-page` (emulator) + `tests/beta/beta_ready_upload_retrieval_citation.py` |
| Source boundaries (cross-tenant, revoked, wrong equipment, prompt override) | Hub route tests around `validateChatSources` + `retrieveNodeChunks`; extend `knowledge-entries` hybrid-read tests |
| Honest fallback states | New route tests: empty / failed / inaccessible / uncited each produce a distinct status + label |
| Recovery at three interrupt points | New `notebook-turn` tests on ephemeral Postgres (pattern: migrations 091-094 job) |
| Compatibility | Existing frame-order tests (`chat-stop-persist`, `chat-safety-stop`, `visual-evidence-abstain`, `jev-route-invariant`) unchanged |
| Replaceability | Fixture replay old vs extracted controller |

Every new test is shown red against its regression before it counts (`.claude/rules/prove-the-test-fails.md`).

---

## 6. Risks and rollback

| Risk | Mitigation |
|---|---|
| Extraction silently changes safety behaviour | Preserve the actual branches; owner decision on dead code before the move; R3 review if `answer-validation` / `safety-classifier` move |
| Readiness probe adds latency to every notebook GET | topK 1, single BM25 query; cache per (doc, ingest time); measure in Slice 0 |
| Migration drift on staging (rule: applied migrations are immutable) | Additive columns only; develop against ephemeral DB before adding the file |
| Hash mismatch Python ↔ TS | Golden-fixture parity test before any manifest is trusted |
| Two runtimes (Python Supervisor vs Hub) diverge further | Slice D makes them emit one comparable artifact; does not pick a winner |

**Rollback:** each slice sits behind its own flag. Turning the flag off returns the legacy path; history rows are kept. Slice B's columns are additive and nullable.

---

## 7. Decisions needed from Mike

1. Approve **Slice 0** (read-only staging diagnostics + baseline via `db-inspect.yml`).
2. For the retrieved-but-uncited case: a new label, or one re-prompt for citations?
3. The phone's silent general re-ask: make it visible, or remove it when a manual is enabled?
4. The dead `unsafe_answer` withhold branches: delete or re-wire?
5. ADR-0033: accept, or re-scope to include the Hub notebook route (gates Slice D)?
6. Risk class and owner for Slices B and C (migration = R3 → Codex GREEN + your merge).

## 8. Coordination
- **#4292 (embedder):** independent of this journey (notebook retrieval is BM25); still open on test gaps.
- **#4300 (`sharp`):** unblocks Docker Build Check everywhere.
- **#4298 (phone drawer):** merging.
- **#4301 / #4302:** merged (basis-chip caption). Slice A's label change touches the same chip; reuse their caption mapping.
