# First Customer Level 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A technician completes a useful, supported maintenance job on phone and web, and leaves trustworthy machine state and outcome evidence for the next technician.

**Architecture:** Reuse the shared FactoryLM UI, equipment notebooks, confirmed identity, evidence contracts, UNS, machine-memory reads and guided procedures. Complete the loop from a confirmed technician observation through the canonical FactoryLM state owner back to MIRA. Keep operational observations separate from model inference and from permission to operate equipment.

**Tech Stack:** Existing TypeScript/React/Next.js Hub and shared UI, Android client, Python services, tenant-scoped Postgres, Vitest, Playwright and existing capability-closure tooling. No new framework or message bus is proposed.

**Spec:** [November 1 vision benchmark](../../benchmarks/2026-11-01-mira-vision-benchmark.md). Evidence snapshot: MIRA main `5691a00cbcc91f0dfd008d68ceacccc38eb41489`, FactoryLM main `3037d10f4725902bae1b274c055b8e3918b5f7cb`; PR/status reads approximately 09:54–10:04 EST, November 1. Refresh these before execution. This document proposes work and acceptance thresholds; it does not claim they have passed.

## Global Constraints

- Level 3 means “passes defined representative acceptance.” Level 4 requires repeatable customer use with demonstrated value. A merged component or healthy server alone satisfies neither.
- Every mandatory journey step passes separately; averaging scores cannot conceal a broken step.
- Start with one explicitly qualified machine family, manual revision and maintenance task. CAT 3520 is a development fixture, not proof that a 5CP6120 is covered. Add the real pilot asset only after exact applicability qualifies.
- Preserve the existing phone/web same-thread acceptance. A physical Android test is required; desktop viewport emulation cannot substitute.
- Technician input is a first-class state source. PLC connectivity is not required for this milestone.
- Reuse canonical UNS builders and identity bindings. Chat asset-specific advice requires confirmed context; preserve documented UNS-certified direct-connection rules and immediate safety handling.
- Preserve source, time, uncertainty, units, authorship and verification method. “Repair reported” never automatically means “healthy,” “root cause proven,” or “safe to operate.”
- Five approved organizations, up to five seats each, receive a free 30-day pilot from approval. Paid continuation is separately agreed; no automatic paid renewal.
- Automatic CMMS/OT writes, experimental retrieval and unqualified QR/photo-table features stay outside the offer and exposed UI until separately accepted.
- Existing review, CI, migration and production authorization gates remain. Existing paid-run authority is not a renewable allowance: the one-run cumulative cap is $11.52 across all lanes and retries; preserve incurred costs and reservations. Fresh paid work needs valid authority.
- Execute in isolated worktrees after verifying claims. Existing owners implement; this plan dispatches no assignments or new agents. Follow `AGENTS.md`, current framework docs and required version bumps at execution.

## Review Focus

1. A component nameplate mistaken for the whole machine, or a similar model/revision: require correct scope and applicability (Task 3).
2. An old, contradictory, negated or duplicate technician report: preserve provenance, avoid silent overwrite and duplicate state transitions (Task 5).
3. A page break, caption or lowercase unit removes a safety prerequisite: retain the complete instruction or mark it Unknown (Tasks 4 and 6).
4. A phone keyboard, Back action, cold restart or 502 loses work/session: preserve the correct thread and recover safely (Task 2).
5. Two workers, a retry or an unavailable cost report exceed the budget: reserve atomically before calls and retain unknown charges against the cap (Task 8).

## The customer promise and acceptance matrix

Proposed first offer: **“For the qualified equipment and jobs listed, MIRA helps your technician find the right evidence, prepare the work and record what happened, so the next person starts informed.”** Publish the exact supported model/revision/task list beside the pilot offer. No universal repair or autonomous-control claim.

| First feature the customer touches | Practical change | Evidence required for Level 3 | Task |
|---|---|---|---|
| Offer, request access, approval, crew invite | Reconcile seven-day/30-day/retired pricing copy; bind consent to the displayed version; preserve bounded pilot access | New, invited, pending, expired and declined users see correct terms/access; organization/seat concurrency and expiry pass | 1 |
| Sign in, HOME, Project and thread | Current shared UI; fix composer, Back, overflow and misleading 502 handling | Real Pixel completes the journey; cold restart and phone→web→phone retain the same user's exact thread once | 2 |
| Identify machine/component | Propose identity, let technician correct it, bind to the confirmed asset; clear carryover on asset change | Correct model/variant/revision; wrong/ambiguous component and cross-tenant attempts cannot silently bind | 3 |
| Add manual or photo evidence | Show upload/readiness/failure; confirm applicability; distinguish observed image facts from generated explanation | Known passage is searchable and opens; failed upload/LOOK sends no false claim; unsupported scans produce an honest limitation | 3 |
| Ask a question and open its source | Preserve complete conditions and critical numbers; abstain when evidence cannot support the instruction | Correct passage supports the actual claim; all critical facts/applicability/safety assertions pass; useful-answer threshold below passes | 4 |
| See safety information | Close page-label and wording gaps; keep OEM prerequisites and structured safety behavior consistent | Known omission cases pass; positive hazard, healthy-negation, educational and poisoned-source controls pass live and after reload | 4 |
| Report an observation and see machine state | Preview normalized meaning; confirm; persist once; project into the canonical asset state; display source/time/status | Trace raw input→confirmed event→state version→later answer; another asset is unchanged; stale/conflicting/duplicate reports behave correctly | 5 |
| Prepare/edit/save a Work Packet | Finish the existing parser; distinguish source facts, technician edits and Unknowns; preserve printed/exported safety | Accepted packet for one supported task; wrong-model/partial instructions never Verified; real Pixel PDF retains sources and conditions | 6 |
| Record work and verify result | Extend fix recording with before/after evidence and verification method; support unresolved/escalated outcomes | Self-report remains self-report; measurement/attestation is inspectable; “could not verify” cannot become resolved automatically | 7 |
| Return later / hand over to another technician | Read shared asset history with appropriate access while preserving private conversations | Technician B gets the approved asset facts and unresolved issues without access to A's private thread; revised/conflicting evidence remains visible | 5, 7 |
| Retry, recover, sign out, reach pilot end | Idempotent writes, recoverable errors, enforced access and cost boundaries | Timeout/cancel/retry yields no duplicate event or charge; sign-out/expiry enforced; no unauthorized maintenance-system write | 1, 2, 8 |

Optional controls may be hidden until qualified. Observation→UNS→state and useful later recall are mandatory to this milestone, so hiding them cannot produce the claimed Level 3 product.

## File and responsibility map

Paths below are in MIRA unless marked FactoryLM. They are existing seams, except files explicitly proposed as new.

| Slice | Files / responsibility |
|---|---|
| Pilot/consent | `mira-hub/src/capabilities/{pilot-access,trial-access}.ts`; their `__tests__`; signup page and `tests/e2e/signup-flow.spec.ts`; migrations 109/110 and the existing pilot-request handler identified in Task 1 |
| Shared phone UI | `packages/factorylm-ui/src/assistant/AssistantThread.tsx`, `FactoryLMShell.tsx`, `parts.tsx`, `conversation.css`; canonical Hub/mobile adapters only |
| Identity/sources | `mira-hub/src/lib/nameplate/evidence.ts`; notebook `nameplate/confirm/route.ts` and its tests; `mira-hub/src/lib/manual-rag.ts`; existing acquisition/source-readiness paths |
| Answer/safety | Notebook `chat/route.ts`; `src/lib/safety-classifier.ts`; `src/capabilities/{manual-safety-chapter,isolation-advisory,manual-safety-statement}.ts` and existing tests |
| UNS/state | `mira-crawler/ingest/uns.py`, `mira-bots/shared/uns_resolver.py`; `mira-hub/src/lib/{asset-uns-path,machine-memory}.ts`; asset machine-memory API; existing outbox migration 111/112 and `cmms-dispatch/enqueue.ts` for reference, without enabling CMMS dispatch |
| Outcome | `mira-hub/src/capabilities/fix-records.ts` and its tests; `diagnostic-plan/{types,guided,runner}.ts`; existing asset/history response |
| Packet | PR #5062's `mira-hub/src/capabilities/work-packet/`, notebook work-packet route and `WorkPacketPanel.tsx`; one coordinated host mount |
| Proof | `.github/workflows/ci.yml`; `mira-hub/tests/stranger-walk/`; `docs/architecture/convergence/CAPABILITY_CLOSURE.yaml`; existing release-evidence conventions |

**State boundary still needs verification:** the reviewed field-observation route test proves prompt policy, not a persisted UNS state update. Existing relay `/api/v1/tags/ingest` is a tag contract; do not invent PLC values from prose or assume it is the human-observation API. Task 0 must pin the actual canonical writer/projector and its file paths before that slice is implemented. This is an architectural discovery gate, not permission to build a duplicate state service.

## Ordered implementation tasks

Each task ends with a focused commit and independent review at its exact head. Run affected offline tests first; do not dispatch paid tests from these commands. Commit commands operate only on the owning isolated worktree and explicit files, never `git add .` on a shared tree.

### Task 0: Freeze scope and prove the state boundary (0.5–1 engineer-day)

**Files:** Read the file map, UNS rules, FactoryLM state/snapshot contracts and current ownership records. Create a short implementation-contract note under the existing convergence unit evidence directory; update the existing capability record rather than creating a second release registry.

**Interfaces:** Consumes current notebook→asset→UNS identity and machine-memory reads. Produces the exact writer/projector/readback paths, owning service, event mapping and a single asset-bound test trace consumed by Task 5.

- [ ] List the offered model/manual/task and web/Android client paths; record exact current claims and one integration owner.
- [ ] Trace one existing confirmed observation/fix into storage and every current state consumer. Record each real link or absent link, with code references.
- [ ] Freeze the minimum human-evidence fields below, mapping existing equivalents before adding fields. Record canonical storage, atomic publish/projection strategy, access rules and migration requirements.
- [ ] Use a synthetic, provider-free observation to demonstrate the existing path, or a failing integration test proving the absent link. Review and commit this bounded contract before Task 5 starts.

### Task 1: Make entry and access coherent (1–2 engineer-days)

**Files:** Pilot/trial modules, their tests, signup E2E, current offer/Terms surfaces, migrations 109/110 and existing consent request writer. **Interfaces:** Existing `approvePilotTenant`, `reservePilotSeat`, `admitPilotInvite`, `endPilotTenant`; authenticated tenant/user identity.

- [ ] Add failing assertions: pilot starts at approval, lasts 30 days; sixth organization/seat is refused at the applicable limit; concurrent claims cannot exceed limits; resend/reapproval does not reset entitlement.
- [ ] Add consent rollout tests for old/new schema and exact displayed text hash; missing required consent cannot silently succeed.
- [ ] Reconcile copy using Mike-approved dated Terms/offer text (#5014); repair schema ordering/compatibility (#4935) through the governed migration flow.
- [ ] Run affected pilot/trial suites with `npm --prefix mira-hub test -- src/capabilities/__tests__/pilot-access.test.ts src/capabilities/__tests__/trial-access.test.ts`; run DB concurrency tests against a disposable integration DB and signup E2E. Commit after pass.

### Task 2: Make the offered phone journey reliable (1–3 engineer-days)

**Files:** Shared UI and canonical adapters in the map; existing phone acceptance suite. **Interfaces:** Existing Project/thread IDs, citation-sheet close action, session state and persisted turn idempotency keys.

- [ ] Resolve claims for #5074/#5069/#5068 through #3626: verify both claim and branch inactivity before stale takeover; record evidence. Escalate only a genuine live ownership conflict.
- [ ] Reproduce keyboard-hidden Send, citation Back→login, long-URL overflow and 502-as-sign-in (#5080) on current code. Add focused regressions in the owning shared components/adapters.
- [ ] Fix those paths without a second shell. Network failure preserves draft/session, retry reconciles turn status, and explicit sign-out actually removes access.
- [ ] Run regression tests and rebuild the current Android candidate. On the physical Pixel, test keyboard, Back, long source, photo cancel/return, network loss, cold restart with >20 threads, and phone→web→phone continuity. Record APK/bundle/backend identities separately. Commit/review and attach device evidence.

### Task 3: Qualify identity and evidence ingestion (1–2 engineer-days)

**Files:** Nameplate evidence/confirmation/tests, manual retrieval/acquisition and source-readiness UI. **Interfaces:** Existing recognition→confirmation and notebook source IDs; canonical asset/UNS binding.

- [ ] Add opposite-direction tests for similar models, component versus parent machine, changed asset mid-thread, unreadable photo and tenant mismatch.
- [ ] Preserve explicit correction/confirmation and citable identity. Manual-only educational queries remain honestly scoped; asset-specific troubleshooting cannot borrow guessed context.
- [ ] Test duplicate upload, delayed indexing, failed parsing/LOOK, cancelled picker and unavailable manual. Show readiness/recovery before promising grounded answers.
- [ ] Run nameplate confirmation/evidence and source route tests; use one unseen supported manual and a conflicting revision in the physical journey. Commit after pass. Keep bot-only QR work out of the offered phone scan claim.

### Task 4: Close answer and safety failures (2–4 engineer-days)

**Files:** Safety/answer files in the map; tests beside them; existing walk required-fixes files. **Interfaces:** Existing citations, model applicability, numeric-support and structured warning frames.

- [ ] Refresh #5078/#5076 exact-head review/CI. Reuse accepted fixes; do not reimplement #5064 or #5059. #5078 targets the page17A/page17 selection defect (#5066).
- [ ] Pin the five previously missing notices and required OEM conditions as regressions. Include chapter numbering duplicates, revised labels, units, negation, educational controls and instructions already containing isolation steps.
- [ ] Resolve #5075 without weakening stop behavior. Recommend a bounded wordlist correction plus negative controls as a short-term fix; obtain Mike's explicit exception if the standing “no phrase rounds” instruction still applies. A warning box alone is not proof that the full safe instruction survived.
- [ ] Preserve complete OEM conditions or refuse the unsupported instruction. Run classifier, chapter, isolation, citation and streaming/hydration tests before commit/review.
- [ ] Put offline walk unit tests in an enabled required CI job (#5076); keep paid live dispatch separate. Record actual job execution, not merely YAML presence.

### Task 5: Complete technician input → UNS → machine state → next turn (3–6 engineer-days if the bridge is missing)

**Files:** Task 0's frozen canonical writer/projector map; existing machine-memory read/response and chat context seam. Add narrowly scoped observation/projector tests beside their actual owner. **Interfaces:** Task 0's confirmed event contract → canonical projection → existing asset-state readback. Do not introduce an unreviewed endpoint signature in a consumer.

Minimum semantic fields: stable event/request ID; server-authorized tenant/user; confirmed equipment ID and canonical UNS path; raw-report/source reference; observed and recorded times; typed fact/value/unit where applicable; verification method (`self_reported`, `attested`, or `machine` using existing outcome types); uncertainty; correction/supersession reference; projector version. Keep inferred diagnoses separate. Resolve organization-approved sharing without exposing raw private chat.

- [ ] Add failing integration assertions for one confirmed observation changing only its intended fact, retry deduplication, wrong tenant/asset, contradiction, old arrival and crash between persist/project/readback.
- [ ] Persist the confirmed event durably and publish/project idempotently with recoverable pending/failed status. Reuse the existing outbox pattern if transport needs it; never repurpose enabled CMMS dispatch as this path.
- [ ] Derive a fact-based state, with source/time/verification visible. Missing evidence is Unknown; contradictory current claims remain contested until resolved; corrections append rather than erase history. A delayed report cannot silently replace newer evidence.
- [ ] Invalidate/refetch the affected asset context after acknowledgment. A later MIRA turn cites the new fact/state version; stale UI is marked until readback, not falsely shown saved/current. Shared records are readable only under appropriate tenant/role rules.
- [ ] Run a provider-free real-store integration with two assets and two tenants, then record the full trace on staging. Expect exactly one durable event and intended projection, no change to the control asset, and correct later recall. Commit/review before feature enablement.

Concrete acceptance scenario: Technician A confirms Pump-07, reports an observed seal leak at 09:10, and reviews MIRA's interpretation. Pump-07 shows “leak reported by A, observed 09:10”; no root cause is asserted. A retry creates no second event. An older “no leak seen” report is retained without erasing the later observation. Technician B asks what changed and gets that evidence and uncertainty. A repaired-seal report updates maintenance history but does not clear operational/safety status automatically.

### Task 6: Qualify the existing Work Packet (2–4 engineer-days)

**Files:** Existing PR #5062 paths in the map; no parallel packet implementation. **Interfaces:** Confirmed identity and approved source spans → editable sourced packet → saved/exported packet; technician edits remain identified.

- [ ] Refresh the exact head. At the planning snapshot, review round 8 on `4561ab7a` still has HIGH F15: lowercase-unit safety continuations can be dropped as captions.
- [ ] Add held-out page-break/caption/table cases and a mutation that removes a prerequisite. Require the mutation to fail; a surviving fragment cannot remain Verified. Never read sealed answers to tune this change.
- [ ] Fix the parser conservatively; preserve scope, prerequisites, units, conflicting values and provenance, or emit Unknown. Do not expand supported model coverage to rescue pass rates.
- [ ] Run parser/route/PDF regressions, clear changed-file lint errors, and obtain clean exact-head review. Then prove edit/save/reopen/Save-as-PDF on the physical Pixel. Inspect the saved PDF's critical conditions and sources, not just page count. Commit and enable only through the governed environment path.

### Task 7: Record verified outcomes and prove later reuse (1–3 engineer-days)

**Files:** Fix records/tests, guided diagnostic types/runner, canonical asset-history consumer; governed additive migration only if required. **Interfaces:** Existing `ValidatedFixInput`/`insertFixRecord` and guided verification outcomes; Task 5's event/state mapping.

- [ ] Add failing tests for measured before/after values, attested versus self-reported success, unsuccessful/unverified outcomes, idempotent retry and private-thread protection.
- [ ] Preserve the existing fix record; add/link verification evidence, source task/manual revision and unresolved issues. Extend existing contracts rather than creating a separate workflow engine.
- [ ] Publish the accepted outcome through Task 5. Store a reported fix as a scoped experience; never promote it automatically to universal causal knowledge.
- [ ] Run outcome/history integration tests. Technician B opens the asset from a different authorized account, recovers approved facts and verification evidence, and sees a subsequent contradictory/revised report without receiving A's private thread. Commit after pass.

### Task 8: Make evaluation and customer calls bounded (1–2 engineer-days)

**Files:** Existing inference run-budget/accounting modules and walk `accounting.test.ts`; the owner of #5081 records the single ledger implementation path before editing. **Interfaces:** Reserve → paid call → settle/reconcile, keyed by persistent run ID across providers/processes/retries.

- [ ] Test two concurrent reservations near the cap, restart/resume, missing usage, failed calls, mixed lanes and a next-call estimate exceeding the remaining allowance.
- [ ] Use a durable atomic reservation/settlement ledger shared by every participating paid lane. Retain conservative supported reservations for unknown bills; do not treat unknown as zero or invent prices (#5053).
- [ ] Run concurrency/crash tests with fake providers and zero spend. A cap failure happens before dispatch, and replay cannot reset cumulative spending. Verify the same guard also bounds offered customer inference under its configured allowance. Commit/review.

### Task 9: Freeze and accept one release (1–2 engineer-days plus technician availability)

**Files:** Enabled CI, existing closure registry and release evidence; new journey E2E cases in the existing Hub test suite. **Interfaces:** All accepted tasks → exact web/backend/APK/OTA identity → one signed acceptance decision.

- [ ] Freeze one candidate with model/manual/task scope, flags, schema versions and rollback target. Final-head reviews and required CI must correspond to it; independent merges cannot silently move the target.
- [ ] Prove offline gates are enabled/executed, runtime flags actually reach containers, and device/client/backend identities match the intended pair. Run schema drift checks without bypassing migration authority.
- [ ] With valid budget authority and enforced preflight, complete the existing 50-question regression on that candidate. Report assessed/omitted cases explicitly; a missing or budget-refused case does not pass. Keep retrieval-page accuracy separate from instruction correctness. Broader-family limitations remain documented rather than disappearing from the denominator.
- [ ] Run the five-technician protocol below and the existing physical same-thread Golden Conversation. Review all safety, cross-tenant, state-integrity and recovery controls.
- [ ] Update the existing capability registry with code/runtime/device evidence and rollback. Request the final production decision against this concrete bundle, then perform authorized deployment and production readback before calling it customer-ready.

## Acceptance protocol and proposed release bars

Use five representative technicians, a supported job and realistic documents. Include at least one technician who did not build the product. Freeze the task sheet and success criteria before the run. Observe safely: simulated/reviewed maintenance evidence is sufficient to test software; actual hazardous maintenance follows the site's qualified procedures.

1. Enter through the actual pilot offer; sign in, create/select the asset and confirm identity.
2. Upload/select its manual, inspect readiness, ask the supported question and open the supporting passage.
3. Add a real observation/photo, correct the interpretation if needed, confirm, then inspect UNS/state readback.
4. Prepare and edit a packet, inspect prerequisites, save/reopen and export it.
5. Record the outcome and how it was verified, including a deliberately unresolved case.
6. Cold restart; continue the same private thread on web and phone. Have another authorized technician recover the shared asset facts and later answer.
7. Exercise error/retry, conflicting evidence, expired/pending access and sign-out. Verify control asset/tenant and prohibited-write boundaries.

**Non-negotiable:** zero wrong-asset/wrong-tenant writes, private-thread leaks, duplicate state transitions, unsupported critical values/instructions, lost safety prerequisites or false safety clearance. All mandatory feature gates and applicable existing stricter gates pass. No unresolved blocker/HIGH on the offered path. Failure stops qualification and routes to its owner.

**Proposed usefulness bars:** on a frozen representative set for the offered scope, at least 90% of answered citation checks open a passage that actually supports the claim, and at least 80% of supported tasks yield a useful grounded result rather than an abstention. All critical assertions are checked individually; page ±1 alone is insufficient. Use at least 30 distinct in-scope task/question cases including normal, ambiguous, conflicting and unavailable-evidence conditions, with unseen cases owned independently. These are proposed bounded-pilot criteria, not claims of statistical reliability or reductions of existing gates.

**Technician bars:** at least 4/5 complete the supported journey without operator rescue; at least 3/5 show measured benefit versus a comparable manual-only task. Log assistance and corrections even when the final answer is right. Counterbalance task order; include source-search, waiting and correction time. Record unresolved cases, factual corrections, time, completion and capped cost per completed job. Five technicians give practical acceptance evidence, not broad market proof.

**Level 4 follow-up:** at least 2/5 voluntarily use it for a second supported job within 14 days, with retained benefit and no critical failures. Track during the five organizations' existing 30-day free pilots; continuation is separately agreed. Repeat use is not misrepresented as already proven at Level 3.

## Proposed owners, order and effort

These are assignments to propose to existing owners, not dispatched instructions or a verified listing of three running sessions.

| Existing lane | Proposed responsibility | Write boundary |
|---|---|---|
| BRAVO safety/release owner | Integration coordinator; Tasks 0, 4, 5, 8 and candidate freeze | Own shared chat/context integration; delegate no overlapping writer; sequence reviewed contributions |
| Charlie session 2 | Tasks 1, 2 and independent physical/cross-surface acceptance | Shared UI claims resolved first; preserve Pixel account/data; one canonical host mount owner |
| Existing Work Packet/knowledge owner | Tasks 3, 6, 7 | Parser, evidence and outcome modules; consume frozen state interface; host mounts through coordinator |

Start Task 0 immediately alongside offline reproduction/claim checks for Tasks 1–4 and 6. Freeze the event/state boundary before Tasks 5 and 7 integrate. Land independent fixes in order; enable only after Task 9. The coordinator owns the exact candidate, not all component code.

Planning range: **about 15–30 engineer-days**, approximately **2–3 working weeks** with three available lanes, existing infrastructure reusable and timely review/device/customer access. Task 0 may shorten the state estimate if the full bridge already exists, or reveal additional work. These are effort estimates, not a promise. A fresh safety-qualified staging candidate can precede the whole milestone; today's deadline cannot establish all these customer/state gates by itself.

First half-day deliverables: a named coordinator and supported-scope sheet; actual state trace/contract; current reproductions and claim dispositions; the exact remaining safety/packet failures; an enabled offline-CI plan; no new architecture program.

Only essential Mike decisions: approve the precise first supported equipment/job and truthful offer/Terms; resolve #5075's standing wording constraint if still applicable; authorize any fresh paid evaluation within its enforceable cap; approve governed migrations/deployments and the final exact-candidate production decision. Engineers should resolve ordinary file ownership through current claim evidence and existing protocol.

## Supporting evidence and remaining blockers

- [Benchmark](../../benchmarks/2026-11-01-mira-vision-benchmark.md): includes independent walk counts, runtime identities and machine-state proof limits.
- [#5078](https://github.com/Mikecranesync/MIRA/pull/5078), [#5076](https://github.com/Mikecranesync/MIRA/pull/5076): reviewed fixes still open/draft at this planning snapshot; local tests are not enabled GitHub execution.
- [#5062 review](https://github.com/Mikecranesync/MIRA/pull/5062#issuecomment-6559050210): current-head instruction-fidelity HIGH at the snapshot.
- [#5075](https://github.com/Mikecranesync/MIRA/issues/5075), [#5081](https://github.com/Mikecranesync/MIRA/issues/5081), [#5014](https://github.com/Mikecranesync/MIRA/issues/5014), [#4935](https://github.com/Mikecranesync/MIRA/issues/4935): wording, budget, offer/Terms and consent-rollout gaps.
- [Existing customer-ready contract](https://github.com/Mikecranesync/MIRA/blob/5691a00cbcc91f0dfd008d68ceacccc38eb41489/docs/mira/CUSTOMER_READY_UNIFIED_EXPERIENCE.md): canonical physical-phone/same-thread acceptance; its September status table is historical, not today's live state.

Plan preparation is complete. Product Level 3 remains unproven until the gates above pass. No implementation, paid run, agent dispatch, merge or deployment was performed by preparing this plan.
