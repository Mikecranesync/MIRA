# Overnight scope — MIRA owner proxy / fireplace repair

Owner: Mike / FactoryLM. Executor: Codex CHARLIE. Date: 2026-09-26.
Branch: `codex/fireplace-repair-loop`; isolated worktree `fireplace-repair-loop/MIRA`.
PR #3999; governing PRD and mission: PR #4001. Existing source freeze: c8687ceb511b739984873ae94652504d4218a183.

## Numbered scope and success criteria

1. Reproduce and repair demonstrated photo interpretation / answer attribution failures
   in the existing notebook LOOK, chat, visual context and validation code, and affected
   tests. Success: targeted red/green checks plus faithful real-model replay on exact source.
2. Run all five original fireplace photos and a changed-order control on the Pixel;
   retain input, interpretation, context/retrieval and final answer where available.
   Success: per-layer PASS/FAIL/UNKNOWN with every failed run preserved, no guessed pass.
3. Verify original viewing, recovery, cold restart and phone → web → phone continuity.
   Repair demonstrated defects in the existing shared shell/mobile carrier only.
   Success: actual same-thread turns/evidence persist on the real surfaces.
4. Select at most three additional private industrial photo cases from the phone and
   use them as opposite/generalization controls. Success: private manifest, neutral
   prompts and observed results, no public originals or answer-key hints.
5. Obtain independent Claude read-only review, reproduce and fix applicable findings.
   Success: exact-SHA review record and honest unresolved findings; no self-attestation.
6. Assess Jev use cases using existing integration/evidence. Success: adopt/defer/reject
   matrix with evidence limits, privacy/cost/latency considerations. No new third-party
   private-content exports; no Jev safety/authorization/release gate.
7. Use OpenAI answers as an evidence-checked comparison where helpful; all further paid
   OpenAI tests including vision stay below $8. Reserve before each call and stop before
   exceeding the cap. Success: durable usage/reservation ledger; unknown cost is reserved,
   never silently zero. No top-ups, new vendors or purchase actions.
8. Publish novice-friendly progress and morning HANDOFF on GitHub with candidate
   identities, tests, real product results, costs and remaining gates. Success: reviewable
   PR evidence and accessible owner report, not an unsupported working-app promise.

## OUT of scope

No main/develop pushes, merge, production deploy/migration, OT actions, customer-data
operations, new architecture/workflows/schema/providers, broad refactoring, safety-policy
weakening, benchmark-specific production hints, issue closure without own clearing
contract, or public private-photo/transcript publication. Keep #3984 open.

## Preflight and stop rules

Worktree/branch isolated; no override variables. The current canonical hook config is
`.claude/settings.json` (the skill's `.Codex` path is historical). Stop/prod guards are
present; hook-payload suite: 56 passed. Codex tool execution does not automatically
become Claude hook execution: run relevant gates explicitly. Historical named operator
memory entries were absent from the available memory registry; current PRD, repo rules
and overnight playbook supply the constraints. Active fireplace ownership remains in
90-day plan; overlapping PRs are inventoried before editing.

Work one bounded failure at a time. Freeze again after code changes; record fixed-source
local dev-server replay separately from production-build acceptance. No further paid
calls until a hard spending bound is established. Stop at the cost cap, approval boundary,
repeated unresolved failure or completed scope and record HANDOFF. Use morning 07:00
America/New_York as the report checkpoint, not a fabricated completion deadline.

Existing root plan was inherited from merged capture-lifecycle work. Preserve that
historical content below; it is not this lane's active scope.

<details><summary>Inherited capture-lifecycle plan (historical)</summary>

# Autonomous Run Plan — Complete interaction capture (#3939)

**Date:** 2026-09-23 · **Branch:** `feat/turn-capture-lifecycle`
**Base SHA (rollback point R0):** `41539edfa` (= `origin/main` at start)
**Worktree:** `.claude/worktrees/capture-split`
**Issue:** #3939 (claim updated to this branch) · findings #3962, #3963
**Supersedes for this run:** the contract PLAN in `.claude/worktrees/mira-contract-night`
(that is PR #3959, a separate slice, blocked on two human gates).

## Why this branch and not #3959

#3959 is 77 files, BEHIND main, and blocked on a maintainer-applied
`legacy-ui-exception` label plus an independent-review-lane decision. Capture work
does not depend on the persona contract, so it must not be held hostage by it.
The three lifecycle commits were cherry-picked onto `origin/main`; the single
conflict was contract-only (SAFETY PAUSE) and was resolved to main's behaviour,
keeping just `lifecycleOutcome = "safety_stop"`. `coverage/route.ts` lost its
`miraContractEnabled()` readout for the same reason.

Second benefit: `retrieval-acceptance.yml` checks out the DEFAULT branch, so a
main-based branch is the only one its live acceptance job can actually validate.

## Objective

Every accepted turn is durably recorded from start to terminal outcome, that
record is reconstructable, and coverage is measured by something that is **not**
the recorder. Prove it live on staging and on a real Pixel 9a — not in unit tests.

## IN SCOPE — numbered, with success criteria

1. **Durable, idempotent attempt lifecycle through terminal outcome.**
   Covers rejection, refusal, timeout, cancellation, cascade exhaustion, retries,
   crashes. `endRoot` cannot guarantee closure ⇒ a **sweeper** appends `abandoned`
   to stale starts; closure is never assumed from process liveness.
   *Done when:* every exit path of the chat route sets a terminal outcome; a
   killed process leaves a start row that the sweeper closes; re-running the same
   idempotency key does not duplicate; `decision_traces` stays append-only.

2. **Independent reconciliation.** A missing start row **cannot** appear in a
   query of the ledger, so coverage needs a second counter that is not the
   recorder: an ingress-side count written before any processing.
   *Done when:* coverage reports ingress vs ledger separately; accepted turns and
   pre-accept rejections have **separate denominators**; missing starts,
   unfinished turns, write/export failures, duplicates and incomplete packets are
   each detectable; limits stated honestly.

3. **Correlation + client acknowledgement.** upload/LOOK → question → recalled
   evidence → retrieval → assembled model inputs → provider/tool calls → gates →
   generated vs persisted answer → client ack. Distinguish generated / sent /
   received. Bounded offline retry, dedup, backpressure, visible unrecoverable
   failure.
   *Done when:* one trace id joins all hops; client ack is a distinct recorded
   fact; a dropped client event retries within a bound and then surfaces.

4. **Reconstructable inputs/outputs.** Tenant-scoped content references, access
   control, redaction, retention/deletion, integrity checks. No credentials, no
   private chain-of-thought.
   *Done when:* either implemented behind tenant-scoped storage, or delivered as
   a design + explicit approval ask. **No new third-party content export.**

5. **#3962 and #3963.**
   - #3963: port the all-zero exemption from `a0318b21b` into
     `ungroundedUnitClaim()` in `anomalies.ts`; re-measure the fire rate on the
     same 40-turn window before claiming a fix.
   - #3962: anchor the recalled observation in the prompt AND add a **versioned
     mismatch assessment** recorded on the packet. It is an assessment, not a
     verdict about internal reasoning, and must not rest on noun overlap alone.
   *Done when:* #3963 fire rate re-measured and reported; #3962 shows repeated
   bearing-photo follow-ups that stay on the bearing, with the assessment
   recorded either way.

6. **Environment/build indicator + Copy diagnostics + exporter-outage proof.**
   *Done when:* the surface shows which backend/build it is on without raw JSON;
   an exporter outage preserves durable records and replays with **no duplicate
   turns**.

7. **Jev evaluation (#3957/#3958).** For every improvement above, evaluate Jev's
   actual API. Record **adopt / defer / reject** with measured benefit, cost,
   latency, privacy impact. Shadow-test first.
   *Done when:* a decision table exists with measurements, not opinions. Jev never
   replaces a deterministic safety, authorization or release gate.

8. **Acceptance.** Real browser against `app-staging.factorylm.com` AND a real
   Pixel 9a on the **staging flavor** (`com.factorylm.mira.staging`), covering
   photo, follow-up, failed upload, timeout, cancel, reconnect, process crash,
   exporter outage. Every attempt pre-registered with a client-generated id so
   never-sent is distinguishable from never-recorded. Automated deployment
   acceptance pinned to the **deployed** SHA, not the default branch.

## OUT OF SCOPE — do not touch

- **Production deploy, production flag enable, production migration apply.**
  Prepare migration/config/deploy/rollback; execute only on explicit approval.
- **Fault injection against production.** Never.
- **New third-party content export** (incl. `contentCapture: true` to Langfuse)
  without separate written approval.
- **Jev promotion out of shadow.** Do not edit Jev gating; do not let a
  probabilistic judgment gate safety, authorization or release.
- **PR #3959's persona-contract code.** Different slice, different PR.
- **OT / PLC / fieldbus writes** of any kind.
- Review/gate bypasses (`MIRA_SKIP_STOP_GATE`, `MIRA_ALLOW_PROD`, `--force`).
- Deleting any existing protection to make a test pass.
- Editing `VERSION`, `CHANGELOG.md`, `wiki/hot.md` directly.

## Coordination

- #3957 / #3958 (Jev shadow, both DRAFT) touch the same `chat/route.ts`. My edits
  are the recorder/lifecycle seam, not the Jev seam. Whoever merges second
  rebases. Do not touch their Jev code.
- #3959 touches the same file in the prompt-composition/mode-selection region.
- Claim on #3939 to be updated to this branch/worktree before the first push.

## Budget

Paid evaluation spend **≤ $1.00**, declared per lane, hard-stop at the bound.
Live staging turns use the existing free cascade.

## Rollback

R0 = `41539edfa`. Every commit pushed to the branch. Staging rollback = redeploy
the previous staging SHA. Migrations 091/092 are additive and append-only;
091 is already applied and its bytes are immutable.

## Stop conditions

All PLAN rows done · >70% budget · >200 turns · 5 turns on one failing test ·
architecture/security/privacy decision needed · any OUT-of-scope path required ·
isolation/privacy/data-loss/safety risk · remaining work human-gated → write
HANDOFF **once** and stop.

</details>

## Bounded repair after frozen replay J: summary evidence boundaries

Demonstrated problem: the J summary turned lit indicators into confirmed power
and placed drawing-only labels inside its physical-cabinet inventory. Its saved
observation rows distinguish drawings, visible indicators and unknown seating.
First failing layer for those claims: E (answer synthesis); this does not clear
separate small-print interpretation uncertainty in layer B. Existing owner:
`VISUAL_REASONING_PROMPT` in the notebook chat route, already connected to both
manual-grounded and general photo answers. Smallest repair: explicitly preserve
the evidence type for each summary claim, distinguish absent reported measurements
from actions not performed, and forbid upgrading indications to measurements.
No provider, safety-policy, architecture or retrieval changes. Opposite controls:
legitimate visible LED descriptions, printed ratings, technician-reported readings,
and photo comparisons must remain usable. Deterministic checks only prove prompt
assembly; acceptance needs a new frozen live summary replay and controls. Keep J/K
failures and exact candidate identities. Files: existing chat route, its LOOK
prompt-assembly regression tests, and owner evidence report.

## Bounded compatibility repair discovered by CI

The unit job's five visual-store tests fail because SQLAlchemy 2.1.1 silently
changes the unspecified PostgreSQL driver to psycopg 3, while MIRA's requirements
install psycopg2. Current main last passed these tests with SQLAlchemy 2.0.54.
The unchanged store reproduces the missing-driver error in a clean 2.1.1
scratch environment without connecting to a database; the same store selects
psycopg2 under 2.0.54 and all five existing disposable-Postgres tests pass.
Smallest compatibility repair: constrain the six existing Python service
SQLAlchemy requirement declarations to the supported 2.0 series. Keep each
existing lower bound, installed driver, database configuration and schema.
No new dependency or driver migration. Open/merged PR checks found no competing
SQLAlchemy compatibility repair. Acceptance: dependency resolution selects 2.0,
existing real-Postgres tenant isolation tests pass, and CI independently reruns.
This does not change the frozen Hub image being exercised on the Pixel.

## Bounded repair found while reopening L: photo confidence caption

Demonstrated problem: a live photo answer says its reading is unconfirmed, but
reopening the same stored turn displays the generic workspace-evidence caption.
The photo card still says "Verified: no"; answer text survives unchanged. First
failing layer: C/G, persisted-turn display reconstruction. Existing owner:
`hydrateMessages` already reads durable visual-observation entries and accepts
`basisLabel` in `assistantParts`, but does not supply it for stored notebook rows.
Smallest repair: reconstruct the unconfirmed photo caption only when the saved
basis is workspace evidence and a current/earlier photo exists in this loaded
thread. Keep document/machine/general bases unchanged; do not infer photos from
future turns or another thread. No schema or trust-state change. Regression:
live-vs-restored photo caption, earlier-photo summary, no-photo/other-basis controls.
Acceptance: new APK on Pixel restores L's six answers with the unconfirmed labels.

## Bounded local final-answer provider comparison (2026-09-26)

Evidence: current Groq synthesis repeatedly invents drawing-to-hardware links despite
correctly delivered observations. Source-type tags, prompt additions, history removal,
reasoning-budget changes and another Groq model did not establish a repair. One
same-context OpenAI comparison retained the source distinction. That is a hypothesis
to test through the real carrier, not a product PASS or production-provider decision.

Reuse `mira-hub/src/lib/inference/canonical-cascade.ts`: explicit opt-in OpenAI
selection with pinned model; standard existing streaming, safety gates, persistence,
and provider/usage telemetry. No alternate reasoning pipeline, source edits to safety,
or default-provider change. Tests own request compatibility, exact provider identity,
output bounds and unchanged default cascade. Local budget guard must reserve before
streaming Chat Completions requests and retain a reservation when usage is absent.

Scope: existing canonical provider module and tests, env documentation, local test
runtime/guard, frozen image and physical replay. Owner-authorized $8 total testing
ceiling applies. No production configuration change or deployment. Acceptance still
requires original-order, changed-order and opposite-control evidence; a model
comparison alone does not count as a working app. Failure preserves the old runtime.

## Review repair: keep notebook provider selection out of safety judging

Confirmed first failure: the explicit notebook comparison flag changed the shared
provider registry used by the safety judge, whose request body does not support
the comparison model. Reuse the existing registry with an explicit notebook scope;
the chat route opts in, and the unchanged safety judge retains its original cascade.
No safety prompt, verdict parser, timeout, selector or fail-closed policy changes.
Prove safe/unsafe verdict transport, fallback and exhaustion under the comparison
flag, plus continued notebook pinning and unchanged defaults. Model correctness
still requires separate frozen product replay.

## O replay repair: connection acquisition and visible unsaved readings

Demonstrated C failure: O photo2 LOOK logs a connection timeout and returns its
reading anyway; only four observations survive for five images. Reuse the tenant
transaction helper, enabling one connection-acquisition timeout retry only for
LOOK recording. Never retry BEGIN, callback or COMMIT; no duplicate writes from
uncertain commit. Preserve other callers' behavior. If saving still fails, keep
original bytes/returned reading and expose observationSaved=false. Canonical
composer retains the question/photo for its existing Try again flow and sends
no answer request until saving succeeds. Legacy responses without the new flag
remain compatible. No schema, outbox, provider, safety or rendering change.
Tests: transient/persistent acquire timeout, permission error, midtransaction
error/commit ambiguity without replay, server flag and original preservation,
mobile response parsing and retained-photo retry. Frozen fault-injection replay
and successful five-observation replay remain required product evidence.

## Q retrieval repair: catalog abbreviation is not manufacturer identity

Raw existing TS retrieval against staging reproduced Q turn2's exact four source
IDs. Stored photo text contains CAT.NO. as a catalog label. The corpus-name matcher
selects CAT from that label, and manufacturer ILIKE %CAT% broadens to unrelated
Equipment Fabricators/CAT/Caterpillar/CATTRON records. First demonstrated layer D.
REUSE existing manufacturerFromObservationText; REPAIR only catalog-label false
identity, with generic catalog-number variants and genuine CAT opposite controls.
CONNECT unchanged notebook route; FINISH raw retrieval comparison, independent
Claude review and frozen replay. No new matcher service, ranking overhaul, schema,
private corpus mutation or benchmark equipment labels in production logic.
Files: manual-rag.ts and its existing tests; this plan/evidence reports.
Acceptance: catalog-only labels yield no CAT identity; real CAT name still routes;
other actual brands remain available; exact raw Q rerun excludes the four unrelated
references; frozen product evidence required before overall acceptance.
