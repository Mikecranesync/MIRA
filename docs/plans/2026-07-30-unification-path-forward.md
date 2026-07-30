# Path Forward — closing every open item on the Unification / training path (2026-07-30)

**Scope:** the items left open after v3.234.1 — the prod Tailscale outage (#3014) and the five
gates standing between today's 760-record corpus and a justified training run. Written as an
execution order with an explicit owner per line, because the blocking set is a *mix* of human
decisions and unbuilt prep work, and conflating them is why the readiness report has sat still.

> ## ⚠️ This document is an EXECUTION ORDER, not a status board
>
> **For current status, read `docs/plans/2026-07-30-unification-program-state.md` — that file is
> operational truth and is updated as work lands.** This plan describes *what to do and in what
> order*; it deliberately does not track completion, so it cannot silently rot into a runbook that
> tells an agent to redo finished work. If the two ever disagree, **the live-state document wins.**
>
> Items already closed as of 2026-07-30 and intentionally left described-but-marked-DONE below,
> so the reasoning stays readable: **#3014** (prod restored), **#3001** (merged), **#3003/#3027**
> (slug-tenant migration shipped), **#3028** (its regression proof).

**Companion docs:** `docs/prd/2026-07-30-mira-unification-program.md` (the program),
**`docs/plans/2026-07-30-unification-program-state.md` (live status — read this for "what is true now")**,
`docs/zta/technician-unified/training-readiness-report.md` (the NOT-READY decision this closes out),
`docs/zta/technician-unified/eval-manifest.md` (slice status), `docs/adr/0033-one-technician-brain.md`.

---

## 0. The dependency that reorders everything

The readiness report lists its blockers as a flat ranked list. They are not flat — one is a
**chain**, and it changes what "do the cheap things first" means:

```
WS1 context-contract wired into ONE serving path
      └─> eval slice 13 (task-mode consistency) becomes buildable   [today: UNFILLED, "blocked on runtime adoption"]
              └─> eval-slice manifest can be frozen
                      └─> training authorization has an acceptance bar to be judged against
```

`eval-manifest.md` says slice 13 "requires the context contract wired into a serving path first."
So **WS1 adoption is on the critical path to spending money**, not a parallel nice-to-have. Every
other blocker (sitting, packing proof, slice 11) is independent and can run concurrently.

Corollary: the single highest-value autonomous task available is WS1 adoption — wiring the
already-built contract (`materialized_evidence/context_contract.py`, adapters landed in #3011/#3016)
into one real answer path. Nothing about that requires Mike.

---

## Track A — Unblock production (#3014). ✅ **DONE 2026-07-30 — issue CLOSED, nothing to do here.**

**Outcome:** production is restored. `mira-ask-saas` is `Up (healthy)` bound
`100.68.120.99:8011->8011/tcp`, `/health` returns 200, `deploy-vps.yml` is green again (run
`30582030527` — the first success since 2026-07-29T14:01Z), and the `prod` Tailscale SSH alias
works. The node re-joined on the **same** IP, so the `docker-compose.saas.yml:471` /
`RELAY_BIND_ADDR` hazard never materialised and no compose change was needed.

> ### 🔑 CREDENTIAL CORRECTION — read before touching Tailscale again
> The original remedy in this plan named **`TS_AUTH_KEY`**. That key was **expired/revoked**
> (`invalid key: API key does not exist`) and has since been **DELETED from Doppler** (all three
> configs, by Mike, 2026-07-30). **Do not look for it, and do not tell anyone to use it.**
> The live credential is **`TAILSCALE_KEY`**, present in `factorylm/{prd,stg,dev}`.
> Having two auth keys with one dead — and the runbook pointing at the dead one — is what turned
> a two-minute fix into a multi-attempt investigation.

**Open hardening follow-up (agent, separate issue — do NOT bundle):** the logout went unnoticed
~10 h because a logged-out tailnet surfaces only as a deploy error at the final bind step. An
expiring auth key is a scheduled outage with no alarm. Add a tailnet-reachability probe to the
self-healer/canary, and/or use a non-expiring key.

---

## Track B — The five gates, in dependency order

### Gate 1 — Accept ADR-0033 + the PRD (M1)

- **Owner:** Mike. **Blocked on:** reading two documents. **Exit:** ADR-0033 `Proposed` →
  `Accepted`, PRD `DRAFT` → `ACTIVE`.
- **Note:** nothing downstream *hard*-blocks on this, but shipping WS1/WS4 work against an
  unaccepted ADR risks rework. Cheapest gate; open it first.

#### 📋 Gate-1 decision brief — what you are actually deciding

**You are accepting three things:**

1. **One conversational policy.** One base model carrying at most one general technician
   behaviour adapter. Drive Commander, PrintSense, graph reasoning, live-state diagnosis and
   work-order assistance become `task_mode` **metadata on a shared contract** — not separate
   conversational models, not separate system-prompt identities, not stacked adapters.
2. **Specialists stay *below* the conversation.** OCR, print decoding, drive-pack resolution,
   PLC/tag parsing, classifiers, graph traversal, retrieval/reranking and safety gates remain
   deterministic or narrow systems that **emit typed evidence with provenance and confidence**
   into the shared contract. They never answer the technician directly.
3. **The corpus stays majority-general by structural cap**, enforced by the compiler, not by
   good intentions: ≥50% general/cross-domain, ≤25% any product family, ≤10% any real OEM,
   ≤20% any template family. This is the guard against "the Drive Commander model".

**What acceptance forecloses:**

- **Per-product conversational adapters**, unless the ADR rule-1 ladder is exhausted first and
  documented: better context assembly → better task metadata → dataset rebalancing → prompt
  cleanup → more diverse general records, *then* lineage-clean evidence of negative transfer.
- **A second runtime context schema.** The versioned `EvidenceManifest` (ADR-0029) is extended;
  it is never forked. Untyped producers adapt **in**; they are not themselves extended.

**What acceptance does NOT authorize** — each of these still needs its own separate gate:

- ❌ No training spend. That needs a **fresh single-use signed authorization** (Gate 5).
- ❌ No corpus re-scale. The review sitting happens **once**, on the final compile (Gate 2).
- ❌ No schema break, migration, or deploy.
- ❌ No paid provider call of any kind.
- ❌ No promotion of model output to trusted truth — evidence stays `candidate` until a human
  approves it through the existing approval systems (ADR-0017).

**Cost of *not* deciding:** WS1/WS4 work proceeds against an unaccepted ADR, so any rework
risk is carried by the agent side, not by you. Nothing downstream is hard-blocked — this gate
is cheap, and opening it mainly removes ambiguity for every future session.

### Gate 2 — ONE review-by-exception sitting on manifest `410e779e…`

- **Owner:** Mike (the decisions). **Blocked on:** a working console — and it is **currently
  broken for this manifest**, which is the real reason this gate hasn't opened.
- **Verified defect (2026-07-30):** `tools/factorylm_ai/review_console_v2/server.py` defaults to
  `C:\wt-wire\docs\zta\technician-dataset-v0\candidate_manifest.json` — a Windows path, in a stale
  worktree, pointing at the **v0** dataset. It cannot see the unified compile without env
  overrides that are not documented in the RUNBOOK.
- **Prep (agent, before the sitting):**
  1. Repoint the console defaults at `docs/zta/technician-unified/` (repo-relative, platform-neutral),
     keeping `MIRA_REVIEW_V2_DIR` and friends as overrides. Update `RUNBOOK.md` in the same PR.
  2. Smoke-test end-to-end against manifest `410e779e…`: load 760 candidates, record a decision,
     re-load and confirm it persisted and that the manifest-hash + per-record content-hash binding
     still rejects a tampered row.
  3. Generate the **review-by-exception queue** — the sitting should surface the stratified sample
     and the outliers, not 760 rows. Target: a 1–2 h sitting, as the readiness report scoped.
- **Exit:** decisions recorded against `410e779e…`, imported via `import_review_decisions_v2`,
  approved count reported. **Do not re-scale the corpus before this sitting** — the report is
  explicit that it must happen once, on the final compile.

### Gate 3 — Packing × completion-loss-mask proof

- **Owner:** Mike picks the resolution; an agent builds the proof.
- **State:** the design is done and **#3001 is MERGED** (`docs/zta/2026-07-29-together-parquet-contract.md`
  + `…-parquet-pretokenized-path-design.md`). It pins Together's Parquet contract from primary
  sources: `-100` masking PROVEN honored, server-side packing PROVEN a no-op on Parquet, and it
  specifies a **6-test local proof suite** at $0.
- **Remaining agent work — this is the ONLY open item in this gate:** implement that 6-test suite
  ($0, tokenizer-level assertions, **no provider calls in CI**) so "packing is a no-op / the mask
  is honored" is mechanically proven rather than argued from documentation. Do **not** re-merge
  or re-litigate #3001.
- **Open sub-item flagged in the design:** unpacked EOS-terminated rows still want a **$0 billing
  discriminator probe**. That probe is the only piece that touches a provider, and it is
  cost-free — but it is still a provider call and therefore declared, not sneaked in.
- **Exit:** the stop-gate row in the readiness report flips from NOT PROVEN to PROVEN, with the
  test suite green in CI.

### Gate 4 — Fill or formally accept the two unfilled eval slices

Two slices, **different blockers** — treat them separately:

- **Slice 11, graph/path reasoning — buildable now, no dependency.** `eval-manifest.md`: ontology
  fixtures are validator-only; no chat-shaped graph eval exists. An agent can build a frozen,
  chat-shaped KG eval fixture set from existing `kg_entities`/`kg_relationships` + the SHACL
  fixture pairs, deterministic-scored, eval-only (never trained), lineage-frozen like the other
  slices. **This is ordinary work, not a decision.**
- **Slice 13, task-mode consistency — blocked on WS1** (see §0). It becomes buildable the moment
  the context contract is wired into one serving path, because the slice tests that `task_mode`
  survives the round trip and that `allowed_actions` still rejects write verbs at the serving edge.
- **Exit:** either both filled, or slice 13 **formally accepted as a declared gap** with the
  reason recorded — the manifest's own doctrine is "an aggregate gain never hides a domain
  regression," so an unfilled slice must be named, never quietly dropped.

### Gate 5 — Signed single-use training authorization

- **Owner:** Mike, unchangeable. Two-key ceremony, fresh single-use authorization, none pre-signed.
- **Precondition:** gates 1–4 closed. **Spend:** one LoRA SFT at Together's $4.00 minimum; eval
  ≈ $1.50–2.50. Declared balance 2026-07-28 was $12.21.
- **Acceptance bar (set BEFORE the run, not after):** per-slice base-vs-adapter; **no slice
  regresses**. That bar is the whole reason gate 4 exists.

---

## Track C — Adjacent defects that sit on this path (found in triage, 2026-07-30)

These are not the five gates, but they touch the same surfaces and will bite the work above.

| Item | Why it belongs here | Owner | Action |
|---|---|---|---|
| ~~**#3003** `decision_traces.tenant_id` UUID rejects bot slug tenants~~ | ✅ **DONE — do not re-open as a migration task.** Migration **070** (both `decision_traces` and `decision_trace_feedback`) + the writer's `CAST(:tenant_id AS UUID)` removal shipped in **#3027** (v3.234.2); the slug-tenant RLS regression that actually proves the repaired path shipped in **#3028** (v3.234.3) and **ran green on staging Neon** under `factorylm_app`. | — | **Nothing.** Note for G6: this made `decision_traces` *able to accept writes*; it did **not** make it a context-contract consumer — that is WS1/PR-2. |
| **#2987** migration drift on staging — merged migrations not applied | Staging is the gate for engine/RAG work; drift makes every staging verdict suspect. | Agent | Reconcile via `apply-migrations.yml` dry-run → apply against staging; confirm the content-sha ledger (066) shows no drift afterward. |
| **#2952** eval-fixer grades whatever branch is checked out, not main | Corrupts the eval signal this whole track depends on. | Agent | Pin the harness to `origin/main` (or an explicit ref) and record the ref in every run's output. |
| Tailnet-reachability probe | The #3014 hardening above. | Agent | New issue; do not bundle with the fix. |

---

## Execution order (what happens next, concretely)

**Now, unattended, no human needed** (status lives in the live-state doc, not here):
1. **WS1 adoption** — wire `context_contract` into one serving path: `mira-pipeline/main.py` →
   `GSDEngine.process()` → `mira-bots/shared/engine.py`. **Critical path — unblocks slice 13.**
   Deliberately *not* an Ignition-only or PrintSense-only route: a product-specific first
   adoption would recreate the forked context lane this program exists to remove.
2. **Unblock the sitting** — the review console has **two** defects (repo-relative default path,
   **and** `compiled_manifest.json` must retain per-record `record_id`+`content_hash`); then
   generate the exception queue.
3. Build the **6-test packing proof suite** ($0) — #3001 is already merged.
4. Build **slice 11** (chat-shaped graph-reasoning eval fixtures). Slice 13 only **after** item 1.
5. Reconcile **#2987**; pin **#2952**; file the tailnet-reachability probe. *Separate PRs — do
   not bundle these with the program work.*

~~Fix #3003~~ ✅ shipped (#3027/#3028). ~~Merge #3001~~ ✅ merged. ~~Write the Gate-1 brief~~ ✅
above in Gate 1.

**Needs Mike, in this order:**
- ~~**A1** — Tailscale re-auth~~ ✅ **DONE** (#3014 closed; prod restored).
- **Gate 1** — accept ADR-0033 + PRD (a read; brief above).
- **Gate 2** — the sitting (1–2 h, once the console + manifest prep above lands).
- **Gate 3** — pick the packing resolution once the proof suite reports.
- **Gate 5** — sign the single-use authorization, only after the others are closed.

**Standing rules that do not bend for any of the above:** no paid inference outside a
budget-declared validation of the artifact under test; no corpus re-scale before the sitting; no
training run without a fresh single-use signed authorization; per-slice acceptance set before the
run, not after.

---

## Definition of done for this plan

- ✅ #3014 closed with live evidence; `mira-ask` `Up`; a `deploy-vps` run green end-to-end.
- **WS1 minimum runtime adoption demonstrated** on a real serving call site — one manifest is
  both the prompt's context source and the audit row's source (G1 + G6). *This is a precondition
  of the training run, not a follow-up to it — see the PRD's corrected milestone table.*
- ADR-0033 `Accepted`, PRD `ACTIVE`.
- Sitting decisions recorded against manifest `410e779e…`.
- Packing stop-gate PROVEN in CI.
- Eval-slice manifest frozen — slices 11 and 13 filled, or 13 accepted as a declared gap.
- A signed authorization exists, the run has executed, and **no eval slice regressed** — or the
  run is deliberately deferred with the reason recorded.
