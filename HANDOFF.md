# HANDOFF — complete interaction capture (#3939)

**PR:** [#3964](https://github.com/Mikecranesync/MIRA/pull/3964) · **Branch:** `feat/turn-capture-lifecycle`
**Base / R0:** `41539edfa` (= `origin/main` at start) · **Worktree:** `.claude/worktrees/capture-split`
**Issues:** #3939 (claim updated to this branch), #3962, #3963

---

## Read this first: the branch moved, and why

The work was claimed on `feat/mira-intelligence-contract` (PR #3959). That PR is
77 files, BEHIND main, and blocked on a maintainer-applied `legacy-ui-exception`
label **plus** the independent-review-lane decision — both of which a previous
session already escalated once. Capture does not depend on the persona contract,
so it should not wait on it.

The three lifecycle commits cherry-picked onto `main` with exactly one conflict,
and that conflict was entirely contract code (the SAFETY PAUSE branch) — which is
itself the evidence that the two slices separate cleanly.

Second reason, operational: **`retrieval-acceptance.yml` checks out the DEFAULT
branch**, so the live acceptance job can only ever validate a main-descended tree.
On #3959's branch it structurally cannot.

**Consequence you should know about:** staging now runs *this* branch, not #3959's
RC. That is a deliberate swap, not a no-op. #3959's live evidence is already
captured in `docs/proofs/2026-09-22-staging-acceptance/` and on its PR; nothing was
lost, but its RC is no longer the deployed one.

---

## Coverage matrix

| # | goal requirement | state | evidence |
|---|---|---|---|
| 1 | durable, idempotent attempt lifecycle to terminal outcome | **DONE (chat + LOOK)** | 091/092; LOOK had none until this PR; every exit path closes via `endRoot`; unhandled throws close `error` |
| 1 | rejection / refusal / timeout / cancellation / cascade exhaustion / retries | **DONE in code** | `TurnOutcome` union; route sets each; `ON CONFLICT` absorbs retries |
| 1 | reconcile stale starts after process death; `endRoot` cannot guarantee closure | **DONE + CONNECTED** | `reconcileStaleTurns` + `startTurnReconciler` from the instrumentation hook, flag `MIRA_TURN_RECONCILER` |
| 1 | atomicity + compatibility preserved | **DONE** | append-only (092); `lifecycle` defaults `closed` so every pre-091 writer keeps its exact meaning |
| 2 | independently reconcile ingress vs durable records | **DONE** | 093 `turn_ingress`, written before auth/validation; `ingressReconciliation` |
| 2 | *a missing start row cannot appear in a query of that ledger* | **DONE, and pinned in a test** | `lifecycleCoverage` asserted **blind** to a lost start the mirror sees |
| 2 | detect missing starts / unfinished / write failures / duplicates / incomplete packets | **DONE** | `lost_starts`, `accepted_unfinished`, `starts_without_arrival`, failure counters, `with_packet` |
| 2 | separate accepted turns from pre-accept failures; define denominators + limits | **DONE** | `pre_accept_rejections` has its own bucket; `start_capture_rate` excludes 4xx **and** unjudgeable arrivals; limits stated in the module header |
| 3 | correlate upload/LOOK → question → evidence → retrieval → inputs → provider → gates → answer → client ack | **PARTIAL** | one trace id joins the hops; `citations_shipped` added. **Client ACK is not implemented** — see gaps |
| 3 | bounded offline retry, dedup, backpressure, visible unrecoverable failure | **NOT DONE** | see gaps — this is client-side and was not reached |
| 4 | tenant-scoped content references, access control, redaction, retention, integrity | **NOT DONE — design decision owed** | nothing new stored; `contentCapture` still `false`; see gaps |
| 5 | #3962 evidence/answer consistency checks | **DONE (detection)** | `DOCUMENTS_IN_CONTEXT_UNCITED` + `ANSWER_IGNORED_VISUAL_EVIDENCE`; **prompt anchoring NOT done** |
| 5 | #3962 repeated bearing-photo follow-up tests | **NOT DONE live** | harness written; needs the staging run |
| 5 | #3963 zero exemption cannot hide unsupported settings/ratings | **DONE + MEASURED** | strict narrowing verified; 57.5% → 20.0% |
| 6 | environment/build indicators + Copy diagnostics | **DONE** | `/api/observability/coverage` `copy_text`, now incl. ingress + capture rates |
| 6 | exporter outage preserves durable records, replays without duplicate turns | **PARTIAL** | `exporter-down.test.ts` proves it never blocks a turn; **live outage not yet run** |
| 7 | Jev adopt/defer/reject with measured benefit/cost/latency/privacy | **DONE** | `docs/proofs/2026-09-23-jev-evaluation-for-capture.md` |
| 8 | real website + Pixel acceptance, every attempt accounted for | **NOT DONE** | harness written (`tools/qa/capture_acceptance.py`); needs the deploy + a device |
| 8 | automated deployment acceptance | **DONE** | acceptance now audits the DEPLOYED SHA and re-confirms at verdict time |

---

## What I found that was not in the brief

**1. The acceptance loop was auditing the wrong code.** `retrieval-acceptance.yml`
uses `workflow_run`, which checks out the default branch — so `main`'s harness was
run against whatever SHA staging served. Run `35801948313` went red with nothing
wrong: staging served `959262b05`, whose route legitimately reports
`system_prompt_kind = augmented`, while main's line 280 still asserted
`("grounded","machine")`. **A green deploy plus a red acceptance, and neither was
about the product.** Fixed; it now also reports SUPERSEDED if the deploy moves
mid-audit.

**2. With the right tree audited, #3962 reproduced with documents.** Run
`35802785827`, scenarios 2 and 3: 6 OEM chunks and 1 notebook chunk reached the
prompt, zero citations shipped, `general_reasoning` badge. The same scenarios cited
correctly eleven minutes earlier on the same SHA. With the five runs from
2026-09-22 (`2 → 4/5`, `3 → 3/5`) that is seven runs of consistent evidence.

**3. LOOK had no lifecycle at all** — the route #3962's reproduction *starts* with.

**4. The new counter had the symmetric blind spot of the one it fixed.** Every
bucket derived from `turn_ingress`, so a systematic arrival-write failure would
read `arrived=0` — perfectly healthy, counting nothing. Closed by
`starts_without_arrival`.

---

## Gaps — open, with owners

1. **Client acknowledgement + offline retry (goal item 3).** Not implemented. The
   server now distinguishes generated from persisted; it does **not** know what the
   client received. Needs a client-side ack endpoint and a bounded offline queue in
   `mira-mobile`. Not started — do not read the trace id on the first SSE frame as
   an ack; it proves the server sent, not that the phone received.
2. **Content references (goal item 4).** Deliberately untouched: enabling
   `contentCapture` today would send customer content to Langfuse, which #3939
   forbids without separate approval. The correct design — content in tenant-scoped
   FactoryLM storage, only references to the exporter — is a design + approval ask,
   not a code change I should make unilaterally.
3. **#3962's prompt half.** Detection is not the fix. Anchoring the recalled
   observation as the SUBJECT of the turn lives in the prompt-composition region of
   `chat/route.ts` — #3959's territory — and interacts with the open
   augmented-vs-grounded decision, which is Mike's.
4. **Live proof.** The staging deploy and the capture-acceptance run are the
   remaining evidence. Commands below.
5. **Process-crash and exporter-outage scenarios** need a container restart /
   a redirected OTLP endpoint on staging. Both safe there, neither run yet.
6. **Pixel 9a.** Must use `com.factorylm.mira.staging` — the production flavour
   points at `app.factorylm.com`, which has **no recorder**. A Pixel test on the
   prod flavour produces zero capture evidence, which is exactly how the original
   relay-photo turn became unrecoverable.
7. **"Real website".** `app.factorylm.com` has no recorder either. Under current
   authority, browser testing means `app-staging.factorylm.com` in a real browser.
   Saying otherwise would be a substitution, not a result.

---

## Production: prepared, NOT executed

Nothing production-facing was touched. To roll this out later:

- **Migration:** `093_turn_ingress.sql` via `apply-migrations.yml` (`target=prod`,
  `mode=dry-run` then `apply`). Additive; creates one table + 3 indexes + 2 grants.
- **Config:** `MIRA_TURN_RECONCILER=1` in `factorylm/prd` (optional — off is inert).
  Do **not** set `MIRA_OTEL_CAPTURE_CONTENT`.
- **Deploy:** `deploy-vps.yml` after the normal gate.
- **Rollback:** revert the branch; the table is additive so no down-migration is
  needed, and unsetting the flag makes the reconciler inert.
- **Approval still required.** Production capture also requires a prod build that
  *contains* the recorder — the live prod SHA `0178b1b07` (2026-09-15) has
  `capabilities/observability/` **absent**.

---

## Reproduce

```bash
# unit + integration
cd mira-hub && npx vitest run                     # 3281/3281
docker run -d --name pg -e POSTGRES_PASSWORD=p -e POSTGRES_DB=p -p 55433:5432 postgres:16
MIRA_TEST_DB_CONFIRM=DISPOSABLE \
TEST_DATABASE_URL=postgres://postgres:p@127.0.0.1:55433/p \
MIRA_INTEGRATION_MIGRATIONS="019_sessions_and_signals.sql,032_decision_traces.sql,055_decision_trace_confidence_and_feedback.sql,070_decision_traces_tenant_text.sql,080_decision_traces_provider_usage.sql,090_decision_traces_turn_packet.sql,091_decision_traces_turn_lifecycle.sql,092_decision_traces_lifecycle_append_only.sql,093_turn_ingress.sql" \
  node scripts/setup-integration-db.mjs
TEST_DATABASE_URL=… npx vitest run --config vitest.integration.config.ts   # 8/8

# live capture acceptance (staging only)
export ACCEPT_BASE=https://app-staging.factorylm.com ACCEPT_COOKIE='next-auth.session-token=…'
python3 tools/qa/capture_acceptance.py --notebook <uuid> --photo <jpg>
```
