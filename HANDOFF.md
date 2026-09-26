# Next candidate: 2cff474bf — safety provider scope repaired

Local build gate passed; red3/green507 and real-route21 (including one new test).
Claude read-only review still running: exec35158, PID47680; stream
/tmp/mira-fireplace-localqa/review-safety-scope-stream.jsonl. Do not restart from timeout.
Current frozen backend remains b5; new repair not installed/replayed yet.
Emulator adb console says virtual device stopped, ping alive; can resume same AVD
using console after build space recovered. CDP20732 and adb9223 are waiting on
that stopped device; no restart from timeout. Private failed M run preserved.
Build logs /tmp/mira-hub-stop-build-2cff-pass.log. OpenAI accounted3.412805/8.
Next: review outcome, frozen Docker build from full2cff SHA, replace only local4450
backend, resume existing emulator, new named original/reverse-order runs, grade.
Phone remains securely locked; user unlock and web handoffs pending.

---
# Latest checkpoint — b5 comparison is not accepted

## Latest checkpoint — local build recovery and comparison review

Both the repair branch and shared workspace local build gates now pass. Its earlier failure was a full
host disk (`ENOSPC`), not a compiler error. Generated build output and downloaded
installer caches were removed; source, installed applications, private photos,
recorded failures and frozen test images were preserved. No gate was bypassed.

Candidate backend source: `b5b5314f2a4701dcd48a3a2786c15f36ae7493e4`.
The opt-in OpenAI notebook comparison has 75 passing focused checks and a passing
Docker build. Default production routing was not changed. These checks do not
prove answer quality or safety acceptance.

Claude's read-only review found that the existing safety checker builds its own
request using older parameter names. The new OpenAI selection also reaches that
checker, so the local guard rejects that request before it is sent. Code inspection
confirmed the mismatch. The checker fails closed: it cannot supply a valid verdict.
This comparison remains unaccepted pending a bounded compatibility repair and
safe/unsafe opposite controls. Tight reasoning budgets and operator flag mismatch
also need explicit validation. The review process was stopped after its findings
were saved because its stop hook repeatedly retriggered the same disk failure.

The five-photo emulator run **M is UNKNOWN/incomplete**: disk exhaustion interrupted
recording during photo 2. Its partial results and failure log were preserved; no
successful replay is claimed. Emulator and Pixel both have mobile build 15, source
`054d6c9283f7eca29a91a5a00d3812b5cd2b96c7`. The physical Pixel is securely locked,
so a fresh physical run awaits Mike unlocking it. Web continuity still needs the
existing browser handoff. Local health also reports missing `INGEST_URL`; complete
service readiness has not been established.

OpenAI accounting now reserves **$3.412805 of $8** across 43 calls,
including the earlier $1 reserve and any calls without confirmed usage. Reservations
are retained after interruption. No more calls were needed for build recovery.
Jev remains an observer, never a release or safety approval authority.

Next bounded mission: repair the comparison/safety-check request compatibility,
prove both allowed and disallowed cases, freeze again, then replay without replacing
failed evidence. The original J/K/L synthesis failures remain open. No merge,
production deployment, or safety-issue closure occurred.


---
Earlier handoff (superseded where above differs):

# Current overnight handoff — 2026-09-26 summary-input investigation

Goal remains active; do not claim a working app or mark product acceptance PASS.
See docs/proofs/fireplace-repair-20260925/OWNER-CHECKPOINT-20260926.md.
Worktree: /Users/charlienode/.codex/worktrees/fireplace-repair-loop/MIRA.
Branch codex/fireplace-repair-loop; PR3999 draft; governance PR4001 separate.

Current runtime: immutable local backend source 0b631a1c80076b9786b0db7b6dabab2d453dbfd9,
container mira-fireplace-frozen-0b631a1c8, localhost:4450 through existing TLS bridge on port 4443.
Physical Pixel serial 55081JEBF07026, staging package only, build 15 source
054d6c9283f7eca29a91a5a00d3812b5cd2b96c7, APK hash in owner report and private identity.
The installed hash was verified. Frozen backend and new mobile are explicitly
different source identities; do not relabel the full L run as a build 15 replay.

J/K/L: five original photos + summary each, diagnostic packets and private layers
grades saved; all FAIL. L fixes the voltage/current certainty wording but still
asserts an unproved drawing-to-hardware match. First demonstrated remaining layer E.
Three extra phone photos exercised. Forced upload failure -> retry, cold reopen,
original viewing, home-label repair and persisted unconfirmed-caption repair have
physical evidence. Latest caption repair: 1 failed / 45 passed before repair, 67 passing adapter checks, bundle
build, APK 15, six correct unconfirmed captions on reopened L. Hub review test
coverage strengthened: 131 focused checks. SQLAlchemy 2.1 driver default failure
reproduced; six existing declarations bounded below 2.1, five real-PG tests pass.

Actual Groq request input now captured privately during a repeated summary on L.
The Pixel repeat remains FAIL. Reconstructing its original ten-message history,
then trying no assistant history, explicit attribution, no topic hint, or higher
reasoning all failed; high reasoning at 800 tokens returns no visible answer.
Same-context OpenAI comparison more faithful once, not product acceptance.
Private evidence and manifest: overnight-runtime/summary-investigation-manifest.json.
The temporary diagnostic container is stopped; original frozen backend restored.
Claude mechanism review finished (handle 84100 terminal). Findings saved at
/tmp/mira-fireplace-localqa/review-summary-mechanism-findings.txt and private runtime.
Its stop hook had hit disk exhaustion; parent cleared generated root build output,
reran repair stop gate successfully, then review exited. No gate bypass.
Per-photo type tags, local-uncertainty LOOK wording, full-resolution image input,
and Qwen3.8 low/none comparisons all rejected. Do not repeat these variants.
Actual observation text already retains image type: no structured type was lost.
Summary packets have zero chunks: changing general-mode gating is not their fix.
Next bounded work: use that review to choose a source-supported experiment;
avoid more speculative prompt accumulation or a new architecture. The attached-photo + explicit earlier-drawing question control now PASSes reference
separation on Pixel build15; small-print correctness remains unverified. Check CI, including DeepEval offline failure whose failed-log
fetch was empty. Formal exact-head/body Codex review remains separate from Claude.
Claude reviews c8687,500cf and0b631 are informational; latest source review found
no prompt contradictions and coverage gaps now addressed. No safety issue closed.

Web continuity UNKNOWN. User has pending async requests: local browser certificate
warning decision; sign in to trusted app-staging.factorylm.com as dana@synthetic.test.
Do not bypass browser security warnings. Existing staging web is a different deployed
version, so record its identity if used. CUA stagingContinuityTab was marked handoff.

OpenAI account ledger is authoritative at private-backend-diagnostic/overnight-runtime/
openai-spend-ledger.json; /tmp/mira-fireplace-localqa/openai-spend-ledger.json symlinks
there. $3.047985 accounted (39 recorded calls + $1 earlier reserve), $8 hard ceiling.
Both host and container guards use this one ledger. No unguarded calls, no top-ups.
Jev stays existing shadow only; J/K/L summary overreach flags match observed concerns,
not an accuracy metric. Do not promote it to a safety, auth, billing or release gate.

Private evidence: ignored proof folder private-backend-diagnostic/overnight-20260926;
/tmp/mira-fireplace-localqa also has ongoing scripts and additional snapshots.
Preserve failures, original contracts and corrections. J/K/L notebook ids live in
contracts. Full L notebook: 8b6aeba6-25c5-467a-9c37-34717cab173d. Restored on phone now.
Current CDP forward tcp:9342 points at the Pixel WebView; refresh after any restart.
Use existing tools/mobile-e2e/cdp.mjs and device.py with foreground guards.
JDK/SDK for local APK builds: JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
ANDROID_HOME=/opt/homebrew/share/android-commandlinetools. Private init-gradle files
supply version and local-test TLS/API endpoint only; do not commit those overrides.

No merge, production deploy, significant architecture/schema/vendor/safety changes.
The root PLAN scope is the governing eight-item overnight contract; older handoff
below is historical and must not displace this scope.

---

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
| 5 | #3962 repeated bearing-photo follow-up tests | **DONE — 3/3 reproduced live; detector caught 1/3** | traces `36cda615…`/`5e370d24…`/`d4c53a8a…`. Sensitivity is bounded by vision variance: "bearing" appears in **0 of 4** identical LOOK calls |
| 5 | #3963 zero exemption cannot hide unsupported settings/ratings | **DONE + MEASURED** | strict narrowing verified; 57.5% → 20.0% |
| 6 | environment/build indicators + Copy diagnostics | **DONE** | `/api/observability/coverage` `copy_text`, now incl. ingress + capture rates |
| 6 | exporter outage preserves durable records, replays without duplicate turns | **DONE — proven live** | endpoint pointed at `192.0.2.1:4318`, redeployed, 2 turns: both answered, 2 distinct attempts, 1 start + 1 close each, packets persisted, no duplicates. Restored + verified |
| 7 | Jev adopt/defer/reject with measured benefit/cost/latency/privacy | **DONE** | `docs/proofs/2026-09-23-jev-evaluation-for-capture.md` |
| 8 | real website + Pixel acceptance, every attempt accounted for | **PARTIAL — server side PASS, device NOT done** | live acceptance PASS (`lost_starts: 0`, mirror positive-controlled 0→1→cleaned); **Pixel 9a not run** |
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

## BLOCKER — #3964 cannot go green without a governance decision

`migration-verify` applies **every migration the PR touched, in order, directly
against staging Neon** (`NEON_STG_DATABASE_URL`), consulting no ledger. So it
re-runs **091**, which creates `UNIQUE (attempt_id)`. Staging now holds two rows
per attempt (`started` + `closed`) — which is precisely what **092** changed the
model to — so that index **can never be created there again**:

```
ERROR: could not create unique index "decision_traces_attempt_uk"
DETAIL: Key (attempt_id)=(7c33f143-…) is duplicated.
```

`apply-and-verify` fails, and `staging-gate` then refuses to grade a schema it
knows is incomplete. Both are correct behaviour. Note this is **not** a
production risk: prod has no `attempt_id` rows, so 091→092 applies there cleanly.
It is a replay-onto-populated-data problem, and it is permanent.

The doctrine (`.claude/rules/mira-hub-migrations.md` §8) says an applied migration
is immutable and the remedy is a new next-numbered file. That remedy **cannot
work here**, because 091 runs *before* any new migration and fails first.

Three options, all requiring a human:

1. **Amend 091** to drop the doomed index creation (092 removes it two files
   later, so the net schema is unchanged). Violates the immutability rule —
   though note migration 066 is **not applied on staging**, so the content-sha
   drift detector is currently skipped there and would not catch it. That is an
   argument for asking, not for doing it quietly.
2. **Exclude 091/092 from this PR** and let them ride with #3959, where they were
   authored. Creates a merge-order dependency: #3964's code needs their columns.
3. **Change `migration-verify` to honour the ledger** (skip already-applied
   files). That is editing a release gate to make a PR pass, which I will not do
   unasked.

I did not pick one. Every path changes either an immutability rule or a gate.

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
3. **#3962 — ROOT CAUSE FOUND, fix not taken.** Six runs, one variable: without
   client `history` the follow-up answers about a drive 3/3; with it, about the
   bearing 3/3. The observation reaches the model (`observation_in_context: true`)
   but it describes a *label* — the word "bearing" appears in **0 of 4** identical
   LOOK calls, because the label is truncated at "Bea…". The identification lived
   in turn 1's **answer**, and `history_turns: 0` is where it is lost. `history`
   is entirely client-supplied; the server recalls the observation but not the
   interpretation. Fix: carry the established subject with the recalled
   observation, via `listTurns`, already on that path. Own PR, own regression test
   that withholds history. Full evidence:
   `docs/proofs/2026-09-23-3962-root-cause.md`. (Superseded note: detection is not
   the fix.)
4. **Live proof.** The staging deploy and the capture-acceptance run are the
   remaining evidence. Commands below.
5. ~~Process-crash and exporter-outage scenarios~~ — **both now proven live.**
   Process crash came free from the redeploys: `answered=24, error=9,
   abandoned=7`, zero stale starts open. Exporter outage ran with the endpoint
   pointed at a black hole and was restored byte for byte afterwards.
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

## The three claims of mine that were wrong

Recorded because each would have shipped as a result if I had not checked.

1. **"`arrived: 6` because the unauthenticated attempt is tenant-less."** No —
   it produced no rows at all. `middleware.ts` 401s `/api/*` before the route
   wrapper runs, and middleware is the edge runtime, where a `pg` write is
   impossible. The denominator is "requests that reached the route handler", now
   stated in the module, in `copy_text`, and beside the numbers in the response.
2. **"#3962 is unreachable on main-based code."** True of the sequence I ran,
   false as a claim — I had skipped the middle photo-bearing chat turn that the
   issue's own reproduction contains. Run correctly it reproduces 3/3.
3. **"#3962 reproduced under `mode:general`."** The packet said
   `observation_in_context: false` — the model had no evidence to ignore. That
   would have been a fabricated confirmation of my own detector.

And one process failure worth the same treatment: I dispatched a deploy with a
40-character SHA I **typed out from a 9-character prefix** instead of reading
`git rev-parse`. The workflow's authorization step rejected it and nothing
deployed. I have a standing note about exactly this; the gate caught what I did
not.

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

---

# FINAL STATE — 2026-09-23 02:12Z

**Head:** `0a1370a036681fc140e5d5607fc1ae67b54e3c23` · **PR #3964** · staging `8919c6979…`
**Suite:** 3291/3291 · integration 10/10 · staging acceptance 6/6 · **production untouched**

## Proven live

| scenario | surface | evidence |
|---|---|---|
| photo | **device UI** | Android picker → `756aded2` look + `3b91f71c` chat, both `closed/answered`; MIRA identified the bearing from the label |
| follow-up | device UI | two turns, one thread, both captured |
| cancel | device UI | force-stop 3 s into the stream → **`closed/cancelled`** |
| reconnect | device UI | relaunch; prior outcome already durable |
| process crash | staging | `abandoned=7`, 0 stale starts |
| exporter outage | staging | 2 turns, 2 distinct attempts, no duplicates, restored byte-for-byte |
| failed upload | API | 415, bucketed pre-accept, no phantom lost start |
| real website | **real browser** | Playwright signup → composer, trace `7d44f29bb812cce6ef4f0d888dad8db5` |

**Accounting:** operator-wide, **0 arrivals with a 2xx response and no ledger start.**
All five turns I drove are accounted for; the eight no-response arrivals are on
notebooks my emulator never touched (`9ccd3bb0`/`5184ac8b` vs `22a0a1c8`), arriving
in four-request retry bursts — concurrent third-party traffic, parked in
`no_response_recorded`.

## Defects found by probing, not by reading

1. `openTurn` dropped the whole start record on a non-UUID notebook id.
2. A 5xx with no start was filed as a pre-accept rejection — now `server_error_no_start`.
3. An idempotent replay was recorded as `error` — now `superseded`.
4. `provision-beta-gate.ts --cleanup` deleted `decision_traces` but not `turn_ingress`,
   manufacturing phantom `lost_starts` on every swept run (83 accumulated).
5. `"timeout"` is declared in `TurnOutcome` and **written by nothing** — pinned by
   `outcome-reachability.test.ts` so it cannot be misread as "no timeouts occurred".

Each has a regression test; 1, 2 and 4 were found only because the metric refused
to call an unexplained state healthy.

## HARD BLOCKERS — I am not re-attempting these

Per `.claude/skills/autonomous-run` § "Human-gated goals — stop once, do not loop"
(issue #1811): all agent-side work is done; what follows needs you, and
re-prompting on it is the bug rather than the fix.

1. **Migration replay.** `migration-verify` re-applies **091** directly against
   staging Neon, which now holds two rows per attempt — exactly what **092**
   changed the model to — so `UNIQUE(attempt_id)` can never be created there
   again. Not a production risk (prod has no such rows). Doctrine's remedy (a new
   next-numbered migration) cannot work: 091 runs first and fails first.
   → **amend 091** (breaks immutability; note 066 is not applied on staging so the
   drift detector would not catch it — a reason to ask, not to do it quietly),
   **move 091+092 to #3959** (creates a merge-order dependency), or
   **make the verifier honour the ledger** (editing a release gate to pass a PR,
   which I will not do unasked).
2. **`legacy-ui-exception` label** on #3964. The body carries the full section; an
   agent cannot clear it by design.
3. **Independent review lane.** Gate 7 ran at exact head and produced four findings
   (one refuted with evidence, three fixed). Codex is out until Sep 26 and the
   Claude-reviews-Claude carve-out expired 2026-09-13, so the lane choice is yours.
4. **Provider timeout.** Add one and wire `timeout`, or remove it from the union.
   Producing it means changing what a technician experiences mid-answer.
5. **Physical Pixel 9a.** No device is attached to CHARLIE. Cellular, real-camera
   and Play-signed-identity scenarios cannot be run from here at all.
6. **Production.** Migration/config/deploy/rollback are prepared above and
   **not executed**. Prod also still needs a build containing the recorder — the
   live prod SHA `0178b1b07` (2026-09-15) has `capabilities/observability/` absent.
