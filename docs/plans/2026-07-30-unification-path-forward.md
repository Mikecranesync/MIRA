# Path Forward — closing every open item on the Unification / training path (2026-07-30)

**Scope:** the items left open after v3.234.1 — the prod Tailscale outage (#3014) and the five
gates standing between today's 760-record corpus and a justified training run. Written as an
execution order with an explicit owner per line, because the blocking set is a *mix* of human
decisions and unbuilt prep work, and conflating them is why the readiness report has sat still.

**Companion docs:** `docs/prd/2026-07-30-mira-unification-program.md` (the program),
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

## Track A — Unblock production (#3014). One human action, ~2 minutes.

**State:** the VPS has been logged out of Tailscale since between 14:01Z and 00:55Z on 2026-07-29.
`mira-ask-saas` binds `100.68.120.99:8011` by design (tailnet-only exposure,
`docker-compose.saas.yml:471`), so it cannot start; every `deploy-vps.yml` run deploys all other
services successfully and *then* reports failure on that bind. The kiosk surface is down.

**Why an agent cannot finish it:** re-auth requires presenting `TS_AUTH_KEY` (Doppler
`factorylm/prd`) to the prod host. Two attempts were permission-gated this session — correctly,
per the standing rule not to route around a credential gate. This is Mike's, once.

| Step | Owner | Action |
|---|---|---|
| A1 | **Mike** | On the VPS: `tailscale up --auth-key=<TS_AUTH_KEY from Doppler factorylm/prd>` |
| A2 | Agent | Verify: `tailscale status` reports logged-in AND `ip -4 addr show tailscale0` returns **100.68.120.99** |
| A3 | Agent | **If the node re-joined on a different tailnet IP**, that IP is hardcoded in two places — `docker-compose.saas.yml:471` (`mira-ask` port bind) and `RELAY_BIND_ADDR`. Update both in one PR before redeploying, or the bind fails identically. |
| A4 | Agent | `gh workflow run deploy-vps.yml -f services="mira-ask"` → confirm the container is `Up` and the run is green |
| A5 | Agent | Close #3014 with the container status + green run id as evidence |

**Hardening follow-up (agent, after A5):** the failure was silent for ~10 h because a logged-out
tailnet only surfaces as a deploy error at the very last step. Add a tailnet-reachability probe to
the existing self-healer/canary so the *next* logout pages within minutes rather than being found
by accident during an unrelated ship. Track as its own issue; do not bundle into the fix.

---

## Track B — The five gates, in dependency order

### Gate 1 — Accept ADR-0033 + the PRD (M1)

- **Owner:** Mike. **Blocked on:** reading two documents. **Prep an agent can do:** produce a
  one-page decision brief that states the three decisions actually being accepted (one
  conversational policy; specialists stay below the conversation as typed-evidence producers;
  majority-general corpus enforced structurally) and the two things acceptance forecloses
  (per-product conversational adapters without the rule-1 ladder; a second context schema).
- **Exit:** ADR-0033 status `Proposed` → `Accepted`, PRD status `DRAFT` → `ACTIVE`.
- **Note:** nothing downstream *hard*-blocks on this, but shipping WS1/WS4 work against an
  unaccepted ADR risks rework. Cheapest gate; open it first.

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
- **State:** the design is **already done** — PR **#3001** (`docs/zta/2026-07-29-together-parquet-contract.md`
  + `…-parquet-pretokenized-path-design.md`) pins Together's Parquet contract from primary sources:
  `-100` masking PROVEN honored, server-side packing PROVEN a no-op on Parquet, and it specifies a
  **6-test local proof suite** at $0. The PR is docs-only and merely `BEHIND`.
- **Prep (agent):** merge #3001, then implement its 6-test suite (`$0` — tokenizer-level assertions,
  no provider calls) so the "packing is a no-op / mask is honored" claim is mechanically proven in
  CI rather than argued from documentation.
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
| **#3003** `decision_traces.tenant_id` UUID rejects bot slug tenants — every staging trace insert fails | **Same bug class as migration 069**, which this session already fixed for the `visual_*` tables (bot surfaces produce TEXT slugs; the column was declared UUID). PRD goal **G6** makes `decision_traces` a *consumer* of the context contract — it must accept writes first. Confirmed live on staging last night. | Agent | Next-numbered migration, `UUID → TEXT`, mirroring 069's ordering (drop policy → drop indexes → ALTER → recreate → RLS compares in-type, no cast). High-confidence, pattern already proven. |
| **#2987** migration drift on staging — merged migrations not applied | Staging is the gate for engine/RAG work; drift makes every staging verdict suspect. | Agent | Reconcile via `apply-migrations.yml` dry-run → apply against staging; confirm the content-sha ledger (066) shows no drift afterward. |
| **#2952** eval-fixer grades whatever branch is checked out, not main | Corrupts the eval signal this whole track depends on. | Agent | Pin the harness to `origin/main` (or an explicit ref) and record the ref in every run's output. |
| Tailnet-reachability probe | The #3014 hardening above. | Agent | New issue; do not bundle with the fix. |

---

## Execution order (what happens next, concretely)

**Now, unattended, no human needed:**
1. **WS1 adoption** — wire `context_contract` into one serving path. *Critical path; unblocks slice 13.*
2. Fix **#3003** (069 pattern) — small, proven, and G6 depends on it.
3. Merge **#3001**, then build its 6-test packing proof suite ($0).
4. Repoint + smoke-test the **review console** against `410e779e…`; generate the exception queue.
5. Build **slice 11** (chat-shaped graph-reasoning eval fixtures).
6. Write the **Gate-1 decision brief** (one page).
7. Reconcile **#2987**; pin **#2952**.

**Needs Mike, in this order:**
- **A1** — Tailscale re-auth (2 min, unblocks prod + every deploy run's red status).
- **Gate 1** — accept ADR-0033 + PRD (a read).
- **Gate 2** — the sitting (1–2 h, once the console prep above is done).
- **Gate 3** — pick the packing resolution once the proof suite reports.
- **Gate 5** — sign the authorization, only after 1–4 are closed.

**Standing rules that do not bend for any of the above:** no paid inference outside a
budget-declared validation of the artifact under test; no corpus re-scale before the sitting; no
training run without a fresh single-use signed authorization; per-slice acceptance set before the
run, not after.

---

## Definition of done for this plan

- #3014 closed with live evidence; `mira-ask` `Up`; a `deploy-vps` run green end-to-end.
- ADR-0033 `Accepted`, PRD `ACTIVE`.
- Sitting decisions recorded against manifest `410e779e…`.
- Packing stop-gate PROVEN in CI.
- Eval-slice manifest frozen — slices 11 and 13 filled, or 13 accepted as a declared gap.
- A signed authorization exists, the run has executed, and **no eval slice regressed** — or the
  run is deliberately deferred with the reason recorded.
