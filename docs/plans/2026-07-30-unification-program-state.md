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
Verified 2026-07-30: `evidence_from_prior_decisions()` (`materialized_evidence/context_contract.py:658`)
has **zero production call sites** — referenced only from `tests/test_context_contract.py`.
The contract and its adapters exist; nothing in a live answer path consumes them yet.

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
| A1 | **WS1: wire the context contract into ONE serving path** | The critical path (§ above). Highest value available. |
| A2 | **Unblock the review sitting** | Two defects: `tools/factorylm_ai/review_console_v2/server.py` defaults to `C:\wt-wire\…\technician-dataset-v0\…` (Windows path, stale worktree, **v0** dataset); **and** `compiled_manifest.json` writes only 4 summary keys while the console requires `manifest["entries"]` with per-record `record_id`+`content_hash`. `unified_compile.main()` *computes* the full manifest via `v0.candidate_manifest_for()` then discards the entries on write. Fix both, then generate the exception queue. |
| A3 | Build the **$0 6-test packing proof suite** from #3001 | Flips the stop-gate from NOT PROVEN. |
| A4 | Build **eval slice 11** (chat-shaped graph-reasoning fixtures) | Buildable now; no dependency. |
| A5 | Slice 13 | **Blocked on A1.** |
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
