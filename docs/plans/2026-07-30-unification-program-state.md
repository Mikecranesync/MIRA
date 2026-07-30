# Sprint State — Unification Program ("One Technician Brain")

**Updated:** 2026-07-30 · **Program milestone: M1** (M0 shipped; M1 = Mike accepts ADR-0033 + PRD)

Any agent picking this up: read in this order —
1. `docs/prd/2026-07-30-mira-unification-program.md` — the program (G1–G6, WS1–WS6, M0–M5)
2. `docs/adr/0033-one-technician-brain.md` — the decision (**status: Proposed**)
3. `docs/plans/2026-07-30-unification-path-forward.md` — the execution order + owner per line
4. This file (`docs/plans/2026-07-30-unification-program-state.md`) — what is actually true right now

---

## The one thing that reorders the work

The training-readiness blockers are **not** a flat list. `docs/zta/technician-unified/eval-manifest.md`
says slice 13 (task-mode consistency) is *"blocked on runtime adoption"*, so:

```
WS1: context contract wired into ONE serving path
   └─> eval slice 13 buildable        [today: UNFILLED]
        └─> eval-slice manifest freezable
             └─> training authorization has an acceptance bar
```

**WS1 adoption is therefore on the critical path to spending money**, not a parallel nicety.
Verified 2026-07-30 (morning): `evidence_from_prior_decisions()`
(`materialized_evidence/context_contract.py:658`) had **zero production call sites** — referenced
only from `tests/test_context_contract.py`.

**Status change 2026-07-30 (evening): PR #3032 opens the first production call site.** It wires the
contract through `Supervisor` (the path `mira-pipeline`, Telegram and Slack all share): prior
`decision_traces` → `evidence_from_prior_decisions` → validated `TechnicianContext` → prompt block →
`decision_traces.context_manifest` (migration 071). Flag-gated `MIRA_CONTEXT_CONTRACT`, **default
off**; the flag is read per call so slice 13 can run one process both ways. **Slice 13 becomes
buildable when #3032 merges** — it does NOT require the flag to default on.

## Shipped (verified, not asserted)

| What | Where | Evidence |
|---|---|---|
| Unification PRD | #3020 | on `main` |
| Path-forward execution plan | #3026 | on `main` |
| General-behavior family scaled | #3022, v3.234.0 | compile **180 → 760** records, 55.0% general+bridge, manifest `410e779e…`; caps green |
| Fold path for agent-written variants | #3022 | `unified_compile.fold_general_generated` — fail-closed on eval-family / gate / real-OEM token / dup suffix / near-dup |
| Parquet packing contract + design | #3001 | pins Together's contract from primary sources; specifies a **$0 6-test proof suite** (not yet built) |
| `decision_traces` slug-tenant fix | #3027, v3.234.2 | migration **070** UUID→TEXT (both tables) + writer cast removed |
| Slug-tenant RLS regression | #3028, v3.234.3 | **4 tests RAN and PASSED on staging Neon** under `factorylm_app` (17 passed total), incl. a negative control proving the suite reproduces #3003 |
| Prod Tailscale outage | #3014 | **CLOSED** — `TAILSCALE_KEY` (not the dead `TS_AUTH_KEY`) re-authed; same IP `100.68.120.99`; `mira-ask` `Up (healthy)`, `/health` 200; deploy-vps green |

## Open — needs Mike (in this order)

1. **Accept ADR-0033 + the PRD (M1).** A read, not a project. Accepting means: one conversational
   policy; specialists below the conversation; majority-general corpus by structural cap. It
   forecloses per-product conversational adapters (absent the ADR rule-1 ladder) and a second
   context schema.
2. **ONE review-by-exception sitting** on manifest `410e779e…`. ⚠️ **Not schedulable yet** — see
   the agent blocker below. Do it once, on the final compile.
3. **Pick the packing resolution** once the $0 proof suite reports.
4. **Sign a single-use training authorization** — only after 1–3 and the eval slices. $4 LoRA +
   ~$1.50–2.50 eval. Acceptance bar is set BEFORE the run: per-slice base-vs-adapter, **no slice regresses**.

## Open — agent work, no human needed

| # | Task | Note |
|---|---|---|
| A1 | **WS1: wire the context contract into ONE serving path** | **IN REVIEW — PR #3032.** Prior-decision family only: retrieval still reaches the prompt through the RAG worker's reference block, so G6 holds for contract-sourced evidence and **not yet** for retrieval. Unifying that rendering is the next slice. |
| A2 | **Unblock the review sitting** | Two defects: `tools/factorylm_ai/review_console_v2/server.py` defaults to `C:\wt-wire\…\technician-dataset-v0\…` (Windows path, stale worktree, **v0** dataset); **and** `compiled_manifest.json` writes only 4 summary keys while the console requires `manifest["entries"]` with per-record `record_id`+`content_hash`. `unified_compile.main()` *computes* the full manifest via `v0.candidate_manifest_for()` then discards the entries on write. Fix both, then generate the exception queue. |
| A3 | Build the **$0 6-test packing proof suite** from #3001 | Flips the stop-gate from NOT PROVEN. |
| A4 | Build **eval slice 11** (chat-shaped graph-reasoning fixtures) | Buildable now; no dependency. |
| A5 | Slice 13 | **Unblocked the moment #3032 merges** (the flag may stay off — the slice sets it itself). |
| A6 | Adjacent: **#2987** staging migration drift · **#2952** eval-fixer grades wrong branch | Both corrupt signals this program depends on. |
| A7 | Tailnet-reachability probe | #3014 follow-up — an expiring auth key is a scheduled outage with no alarm. |

## Standing rules that do not bend

- No paid inference outside a budget-declared validation of the artifact under test.
- **No corpus re-scale before the sitting** — it happens once, on the final compile.
- No training run without a fresh single-use signed authorization.
- Per-slice acceptance bar set before the run, never after.

## Environment notes for the next agent

- `TS_AUTH_KEY` was **deleted** from Doppler 2026-07-30 (it was expired and the #3014 runbook
  pointed at it). **`TAILSCALE_KEY`** is the live credential, present in `prd`/`stg`/`dev`.
- CHARLIE's **Colima VM is wedged** (`failed to run attach disk "colima", in use by instance
  "colima"`), so ephemeral-Postgres clean-room repros can't run locally; use
  `migration-verify.yml` against staging, which is the sanctioned path for `mira-hub/db/migrations/`.
- `install/smoke_test.sh` probes **localhost** (CHARLIE dev stack), not prod — its failures are
  not a prod signal. Use the public endpoints + container status instead.
- The shared `~/MIRA` checkout regularly carries **another session's** in-flight commits and
  modified files on local `main`. Work in a worktree; never `git add -A`.

---

## WS1 / PR-2 design — verified against the real code (2026-07-30)

Recorded so the next session does **not** re-derive this. Every claim below was checked
against the tree, with a **READY** CodeGraph preflight (see the tooling gotcha at the end).

**The serving path (confirmed, not assumed).** `mira-pipeline/main.py` imports `Supervisor`
from `shared.engine` (line 38), instantiates it (line 256) and calls `engine.process(...)`
(line 661). `Supervisor.process_full` is `mira-bots/shared/engine.py:2305`. This is the shared
route — deliberately **not** an Ignition-only or PrintSense-only entry, which would recreate the
forked context lane the program exists to remove.

**The contract to build on (do NOT fork it).** `materialized_evidence/context_contract.py`:
- `TechnicianContext` (line 197): `contract_version`, `task_mode`, `tenant_id`, `environment`,
  `asset`, `question`, `conversation_state`, `evidence[]`, `live`, `contradictions`,
  `unknowns[]`, `allowed_actions[]` (defaults to `ALLOWED_ACTION_VOCAB`), `authorization_state`
  (defaults `"read_only"`).
- `EvidenceItem` (line 110): `trust` defaults to **`"candidate"`** — so requirement 4 (prior
  decisions never promoted to truth) is satisfied by construction; do not override it.
- `evidence_from_prior_decisions()` (line 658) — **the adapter already exists.** CodeGraph
  reports "3 callers"; a grep confirms all three are in `tests/test_context_contract.py`.
  **Production call sites: 0.** That gap is exactly what PR 2 closes.

**The audit seam.** `mira-bots/shared/decision_trace.py`: `write_trace(**kwargs)` →
`build_trace_row(**kwargs)` (pure, unit-testable) → `_insert(row)`. `write_trace` has 3 callers,
all in `engine.py` via `_schedule_decision_trace`. `build_trace_row` already carries
`tag_evidence` / `manual_evidence` / `kg_evidence` JSONB. For G6, **the same manifest object that
built the prompt must be what the trace records** — add a manifest/hash field rather than
re-deriving evidence at trace time, or the two can silently diverge (that divergence is the whole
point of G6).

**Fail-open precedent to mirror, with one change.** `decision_trace.py` is explicitly fail-open
(never raises; 2 s timeout; no-op when `NEON_DATABASE_URL` is unset). The prior-decisions READ
must be equally fail-open **but** requirement 6 says a failed lookup must produce an *explicit
observable unknown*, not silence — so on failure append to `TechnicianContext.unknowns` (e.g.
`"prior_decisions_unavailable"`) instead of silently returning an empty list. Silence and "no
prior context" must not be indistinguishable.

**Tenant safety.** The read must bind the tenant the same way the writer does —
`SET LOCAL app.current_tenant_id` — and `decision_traces.tenant_id` is **TEXT** since migration
070, so bot slug tenants work and **no `::uuid` cast belongs anywhere near it** (#3003/#3027).
`tests/integration/test_rls_tag_trace_tables.py` already has the slug-tenant + isolation
pattern to copy (#3028).

**CI gating (explicit requirement).** `mira-pipeline/tests` is **not** a reliably gated suite —
the proof tests must run in a required job. `tests/integration/**` is already both a
`migration-verify.yml` trigger path *and* explicitly invoked by that workflow, which is how
#3028's tests were actually proven to execute rather than skip. Prefer that lane, or add the new
tests to an existing required job; verify by reading the run log that they **ran**, not skipped.

**Tooling gotcha (cost me a cycle — do not repeat).** `tools/codegraph-preflight.sh` reported
**STALE** purely because `.codegraph/.last-sync` records the HEAD it was written at. Running
`npx @colbymchenry/codegraph index --force` **does not** refresh that marker — only the hooks and
the wrapper `tools/codegraph-force-reindex.sh` call `cg_write_sync_marker`. Run the **wrapper**;
the raw npx command leaves the preflight permanently STALE even though the index is fine
(canary healthy at 20 callers of `resolve_uns_path` throughout).
