# FactoryLM product convergence: acceptance and recovery crosswalk

Prepared 2026-11-27 for the documentation mission in
[#5232](https://github.com/Mikecranesync/MIRA/issues/5232#issuecomment-7218731903).
Risk: R3 — coordination doctrine. Draft until independently reviewed and adopted.
The operating plan and reporting template live in [DELIVERY.md](../../DELIVERY.md#product-convergence-operating-loop).
The [resource inventory](2026-11-27-product-convergence-inventory.md) records observed
sources, session visibility, branch/worktree evidence and exact candidate revisions.

## Authority and interpretation

Use existing authority rather than another plan hierarchy:

| Source | What it controls | Treatment here |
|---|---|---|
| [NORTH_STAR](../../NORTH_STAR.md), [Theory of Operations](../THEORY_OF_OPERATIONS.md), [approved Technician Copilot PRD](../prd/2026-08-25-technician-copilot-prd.md) and its [constitution](../specs/mira-technician-app-dogfood-system.md) | Product purpose, confirmation/provenance, general versus grounded evidence, one conversation and read-only equipment boundaries. | Approved requirements; the PRD sequences doctrine and gives its constitution precedence. Historical implementation statements are not current proof. |
| [DELIVERY](../../DELIVERY.md), [#5232](https://github.com/Mikecranesync/MIRA/issues/5232) | Full integrated milestone, assignments, owner reports and dependency order. | One queue. This crosswalk neither closes issues nor awards acceptance. |
| [Level 3 report at immutable #5086 revision](https://github.com/Mikecranesync/MIRA/blob/5b9aaf30184763b3d64dbcd99eda5f7f4b9a3c31/docs/benchmarks/2026-11-05-level-3-gap-closure-report.md) and [controlling implementation plan](https://github.com/Mikecranesync/MIRA/blob/5b9aaf30184763b3d64dbcd99eda5f7f4b9a3c31/docs/superpowers/plans/2026-11-01-first-customer-level-3.md) | Nine capabilities C1–C9, eight pains P1–P8, eleven steps J1–J11 and closure G01–G12 referenced by #5232. | #5086 remains an open draft; #5232 explicitly preserves its scope. Numerical thresholds are proposed, not newly approved by this PR. These files are absent from current main; the pinned links are intentional. |
| CHARLIE `Mira/.planning/2026-11-10-garage-pilot/PILOT-ACCEPTANCE-LEDGER.md` | Pilot results L1–L14 and their exact criteria, exceptions, denominators, builds and history. | Read in place over existing SSH; do not copy private rows into this public repository. Its old build results cannot qualify a new candidate. See inventory digest/date. |
| [Capability closure](../architecture/convergence/CAPABILITY_CLOSURE.yaml), [registry](../architecture/convergence/REGISTRY.yaml), [UI cutover](../architecture/convergence/UNIFIED_UI_CUTOVER.md), [SDLC](../architecture/mira-sdlc-v1.md) and [environments](../environments.md) | Existing capability/architecture ownership, shared UI writing lease, review and promotion. | No duplicate registry or new infrastructure; every stricter applicable gate persists. |
| [Gate and Blocker Register](../GATE_AND_BLOCKER_REGISTER.md), [customer punch list #4372](https://github.com/Mikecranesync/MIRA/issues/4372), [proposed trust gates #4875](https://github.com/Mikecranesync/MIRA/pull/4875) | Existing product/stranger gates, customer blockers and owner decisions; T-1–T-5 proposed fixture crosswalk. | Historical statuses are not current results. Reuse original fixtures and decision records; this PR neither adopts the draft nor relaxes a pass bar. |
| [Proposed FIND roadmap #5628](https://github.com/Mikecranesync/MIRA/blob/b07057c6255b4608faa243ca59becdc3b706456a/docs/plans/capability-roadmap.md), [FIND-01–10 contract](https://github.com/Mikecranesync/MIRA/blob/b07057c6255b4608faa243ca59becdc3b706456a/docs/plans/find-the-right-equipment.md) and [step template](https://github.com/Mikecranesync/MIRA/blob/b07057c6255b4608faa243ca59becdc3b706456a/docs/plans/capability-step-template.md) | Existing proposed capability sequencing and reusable development template. | Preserve proposal/owner and its complete checks. Do not silently replace it with a second roadmap or assume its draft is adopted. |

When sources conflict, record the exact requirement and decision owner in #5232.
Do not make a proposed threshold an approval, use an old product-state paragraph as
runtime truth, or waive a mandatory journey step to make a smaller demo pass.
The W0–W5 definitions referenced by DELIVERY were not located in the inspected main
or linked Level 3 texts; the coordinator must link their authoritative definition
before evaluating them. Do not reinterpret the April MVP calendar's similarly named weeks.

## Prioritized acceptance matrix

P0 means necessary to the offered journey, not authorization to begin editing.
Rows below are a crosswalk; #5232 and the original requirement/ledger own status.
**No row is certified as a current end-to-end pass by this documentation PR.**
Paths identify reusable source inspected on the inventory's main revision; they are
not evidence that the offered deployed surface exercises it. PR states and exact
heads are in the inventory. Re-read them and the owner claim before work.

| Priority / outcome | Existing implementation and historical work to recover | Requirements, dependencies and remaining gap | Required verification before acceptance |
|---|---|---|---|
| P0 — Access and useful first conversation | Notebook CRUD/chat API; `mira-hub/src/factorylm-ui/`; general mode and basis persistence; proposed onboarding #4960; pilot-access capability. | G01/G07/G10, J1–J2/J11, C7–C9; approved CONV/PLAT laws. Freeze truthful offer, supported scope, consent/access/seat limits and support path. Do not turn equipment onboarding into a prerequisite for explicitly general help. | Fresh supported sign-in; new/invited/pending/expired/declined users; sign-out; no implicit grounded→general fallback; labels survive reload. Real offered client; tenant and concurrent-seat negatives; commercial evidence separate. |
| P0 — Equipment photo identification | `mira-hub/src/lib/nameplate/`, capabilities `nameplate-identity-adoption.ts`, `notebook-manual-identity.ts`; merged #5746; existing #5671/#5764 and #6104. | G03, J3–J4, C1, P5; ledger L1/L9; EVID-1..7/IDNT-1. Confirm model/catalog/variant/revision; photo of another machine must not inherit the notebook's identity. Combined #5671 already includes #5764 work: no second implementation. | Actual camera/picker→LOOK→proposal→human confirmation→persisted card on the offered device. Ambiguous, rotated/poor image, MIME failure, sibling model, correction, cancelled capture and wrong-tenant controls. Confirm all intended photos were saved. |
| P0 — Applicable manual acquisition | `notebook-manual-acquisition.ts`, `manual-acquisition.ts`, existing source/readiness state; merged photo→manual→answer repair #5746; recovery draft #5544; capability `notebook_manual_acquisition`. | G03/G08, J4–J5, C2, P1/P5; ledger L2/L10/L13; confirmed identity precedes applicability. Partial PDFs, generic MIME, lost glyphs and stale source IDs remain explicit qualification cases. | Fresh notebook, approved exact OEM document/hash/revision, truthful partial/indexing/searchable state, retained file and sources after reload. Known passage is searchable/openable; first question carries correct source IDs. Failed/empty ingest cannot appear ready. Preserve the ledger's large-manual case. |
| P0 — Accurate cited maintenance answers | `mira-hub/src/lib/manual-rag.ts`, `notebook-query.ts`, table ingestion/claim verifier; merged #5510/#5615; existing #6030, #6025, #6028, #5646 and #6090. | G04, J5, C2–C3, P1/P4; ledger L3–L5/L8/L14; GRND-1..5. Correct row/column, units, conditions, printed versus PDF page and useful abstention. Open drafts are recovery candidates, not fixed behavior. | Fresh actual PDF→ingest→SQL→retrieval→answer→clicked source. Independently read the exact applicable row/column; critical values checked individually. Include zero values, decimals, multi-model tables, unsupported questions, corruption and honest missing evidence; reuse regression corpora. |
| P0 — Conversational continuity, including #6106 | `conversation-history.ts`, `conversation-subject.ts`, `mira-hub/src/lib/notebook-query.ts` (`buildRetrievalQuery`) and notebook chat route; approved CONV-1..4; historical #3201/#3202/#3219 and #4360; recovery #5669. | G04/G07/G08, J2/J5/J10–J11, C3/C7. [#6106](https://github.com/Mikecranesync/MIRA/issues/6106) is OPEN: vague follow-up after leaving/returning gets an unsupported/manual-add reply. Existing deterministic augmentation and optional vocabulary rewrite already exist; the issue's suggested rewrite is not yet a proven root cause or mandate for another model call. | Reproduce X80 800 Ω versus 600 Ω answer, leave thread/idle about six minutes, reopen, ask “huh so wat do i do then”. Retain correct AMO 0210 subject and cited limit (PDF p.13 / printed p.161); clarify when evidence ends. Compare sent/persisted history, server-selected context and retrieval query. Include “and that one?”, typos, prior refusal recovery, explicit machine change, reload, two manuals, another tenant and a genuinely absent source. |
| P0 — Equipment identity and unified namespace | `equipment-browser/`, `bench-components/`, knowledge-graph asset bridge, UNS resolver; merged #5602/#5614/#5625; [asset-identity findings](../architecture/convergence/ASSET_IDENTITY.md); existing ontology stack #5530/#5539/#5543/#5558. | G02/G03/G10, J3/J7/J10, C1/C4. Reconcile tenant, notebook, CMMS asset, KG entity and installed component IDs through existing mappings. No new parallel identity scheme. Preserve selected-component/manual compatibility and human approval. | FIND-01–10 as defined in proposed #5628 if adopted, plus actual deployed find→explicit select→correct workbench. Exact resolution, paging/no-link/foreign-tenant negatives, stale/corrected relationship exclusion, non-mutation, and asset-change carryover tests. A fixture-only ontology pass is insufficient. |
| P0 — Notebook persistence and context | `mira-hub/src/lib/equipment-notebooks.ts`, `conversation-history.ts`, capabilities `observations/`, `living-sheet/`, `work-packet/job-record.ts`, field-report context; #5669, #5874 and existing #5212/#5033. | G02/G05/G06/G08, J2/J7–J11, C4–C7, P7/P8. Preserve one private conversation, raw reports, correction/approval status, unresolved results, original retry context and eligible shared asset facts. | Save question/answer/photo/note/job, reload/cold restart, switch phone→web→phone; exactly one saved exchange/event/charge across retry/cancel/failure. Trace original report→confirmed event→state version→later scoped answer. Technician B gets approved asset facts without A's private thread; rejected/unverified facts remain unverified. Apply the [existing continuity negative control](2026-10-09-field-maintenance-acceptance.md#continuity-qualification-control). |
| P0 — Safety and document applicability | `manual-applicability.ts`, `answer-validation.ts`, safety classifier, bypass advisory and stored safety frames; current-main #6056/#6084/#6088/#6089/#6091; existing #6015/#5671/#6081/#6082. | G03/G04/G10, J5–J6/J11, C3/C5, P1/P4; ledger L6–L9. Identity match is not interchangeability; current/replayed answers must preserve OEM warning and immediate-danger behavior. Redraft budget/accounting remains bounded. | Original hazardous wording plus paraphrases, each hazardous clause, negation/educational controls, bypass requests, poisoned text, unrelated manual and wrong model. Inspect live/reloaded/exported stop and warning, exact source applicability and no invented safety clearance. Zero unsupported critical instructions; no real control writes. |
| P0 — Complete deployed staging technician workflow | Current shared shell/host adapters, existing [stranger walk](../../mira-hub/tests/stranger-walk/README.md), merged Level-3 harness #5794, mobile emulator harness and candidate/version receipts. | G07/G11, J1–J11, C7; all preceding applicable rows. Preserve the entire integrated milestone in DELIVERY: source page, illustrated guide, saved job/photo/note, restart, later reuse and second-technician steps. | One frozen manifest: main/candidate/client/backend SHA, review/body hash, image, schema/flags, exact manuals and device. Run fresh supported sign-in through every offered step on staging, desktop and offered phone/tablet; record failures/recovery and cleanup. Emulator first; physical camera/cellular/release identity require authorized leased hardware. Automated personas do not establish human acceptance. |
| P0 — Useful work packet and verified learning | Existing `work-packet/`, `living-sheet/`, observation/outcome state and approved-context readers. Recover #5089 and existing packet/outcome claims rather than a new job system. | G02/G05/G06, J7–J10, C4–C6, P2/P4/P6/P7. Editable packet, prerequisites, source/correction provenance, verification method and later authorized reuse are mandatory to Level 3. | Prepare/edit/save/reopen/export real-phone PDF, including unknowns, warnings and exclusions. Attach before/after evidence and verification method; unsuccessful/unverified outcomes never become resolved. Fresh authorized B retrieves the right approved facts after restart. |
| P0 — Permissions, recovery and bounded cost | Existing tenant context/RLS, observation outbox/idempotency, inference budget/reservation and stranger-walk spend ledger. Reuse #6081/#6082 with #5669 and G10 owner records. | G01/G08/G10, J1/J7/J10–J11, all evidence workflows; P6/P8. Test process/retry/restart concurrency; preserve applied migrations and reconciled schema. | Wrong-user/tenant/asset, expired access, sign-out/private-thread leaks, duplicate transitions/charges, cancelled-after-commit and provider redraft accounting. Save offline payload through navigation/reload/reconnect. Zero prohibited writes; no claim of complete offline reasoning from recoverable storage. |
| P0 — Existing pilot trust and stranger gates | Gate and Blocker Register's 27 P0 cases/Z-1; original #4793 retrieval/safety, #4870 number calibration, #4122 isolation and #3786/#3785 injection/leak fixtures; proposed #4875 T-1–T-5. | G04/G07/G10–G12, #4372 customer punch list and owner decisions. Historical fixture scores and “unowned” labels must be refreshed. Preserve original thresholds/owner exceptions; reconcile the draft's adoption explicitly. | Candidate-bound original safety/benign, LOTO, injection/leak, unsupported-number calibration and real-wording retrieval results; applicable regression collection and actual unassisted stranger walk. No pilot readiness claim from merged repairs or averages hiding a critical failure. |
| P0 if offered — Optional CMMS actions | Existing Atlas adapter and notebook event outbox; #5209/#5210/#5216/#5223, `notebook_event_outbox_cmms_dispatch`. | G09, J8–J11, C8, P6. Mike decides offer/licence/sync limits; complete standalone journey with CMMS off remains required. | Confirmed destination/action, permissioned send, independent full destination read-back, failure/retry/concurrency/capacity/scan bounds and no duplicate order/note. No automatic writes inferred from a drafted packet. |
| P0 — Representative pilot acceptance and support | Existing private ledger, #5232 combined summary, frozen cases/receipts and supported install/recovery runbooks; #5086 acceptance protocol. | G01/G11/G12, C9, P1–P8; all J steps. Name supported scope and human assessors, preserve all L1–L14 criteria/exceptions and existing W0–W5 scope once located. Offer and paid continuation are Mike's decisions. | Independently observed real technicians on unfamiliar in-scope material; log operator help, corrections, time, failure, cost and usefulness. Apply original denominators and approved decision; distinguish staging, production, field verification, customer demand and payment. |
| Scope-dependent follow-on — Live evidence, disconnected profile and distribution | Existing relay/UNS/tag freshness, machine-memory observer, local runtime, release/OTA and store work; LIVE-1..2/PLAT requirements in the approved PRD. | Full approved product requirements stay visible; supported offer determines pilot inclusion. Separately qualify any offline/local offer already required by DELIVERY. Do not count simulated/replayed signals as live or broaden cloud/provider exceptions. | Fresh versus stale/unavailable basis and age, read-only equipment; for offline offer fresh local auth, monitored isolation/positive detector controls, cold reboot auto-start and long-duration evidence per DELIVERY. Release/store identity and support/rollback receipts are separate from debug/emulator success. |

## Full Level 3 coverage check

This mapping preserves the original scope. Detailed bars and maturity evidence stay
in the pinned report and private ledger; a named mapping is not a passed test.

Private-ledger row mapping: L1/L9 → photo/identity; L2/L10/L13 → manual acquisition;
L3–L5/L8/L14 → cited answers; L6–L7 → safety; L11 → deployed usability, including
dark-mode readability/contrast; L12 → persistence and verified learning. Execute
each row's original criteria and exceptions in place, not a reduced crosswalk bar.

The approved Technician Copilot PRD's remaining requirements also stay in view:

| Approved requirement IDs | Existing outcome / additional acceptance to preserve |
|---|---|
| CONV-1–5 | Access and continuity: opt-in labelled general mode, persisted basis, bounded same-thread phone history, owner disposition of existing #3224 evidence-derived chips, and no setup-precondition copy. |
| EVID-1–7 | Photo/manual rows: truthful MIME and byte sniffing, distinct intake errors, photograph/scanned-page searchable evidence with honest quality, actual camera capture, identity before any notebook, and the existing beyond-QR scanner comparison/owner decision on real-device evidence. Reuse the single ingest/identity path. |
| GRND-1–5 | Cited answers/manual intake: zero-chunk grounded refusal without a provider call, unknown-vendor metadata, shared structure-aware/table ingestion, measured large-manual completeness and explicit embed coverage/retry or documented BM25-only policy. No silent embedding-readiness claim. |
| IDNT-1–3 | Identity/UNS and verified learning: identify without setup, progressive component/assembly proposals promoted only by human confirmation, and an editable reviewable work-order draft from the existing conversation/work surface. Drafting does not authorize a CMMS write. |
| LIVE-1–2 | Scope-dependent live evidence: freshness/quality/provenance and explicit stale/unavailable state; join server-side only after equipment resolution, read-only. |
| PLAT-1–4 | Supported distribution: owner-only store identity and signing decisions, governed OTA with rollback, blank-WebView recovery and picker round-trip stability. Debug/emulator results do not certify release identity. |

Phase labels in that PRD sequence delivery; they do not establish today's state or
authorize deferred hardware, vendor, release or inference actions.

| Original requirement | Matrix outcomes that carry it |
|---|---|
| G01 scope/offer/access; C9 demand; J1 | Access; representative pilot; permissions/cost |
| G02 shared observations; C4 state; J7 | Identity/UNS; notebook context; verified learning |
| G03 identity/documents; C1 physical machine, C2 engineering knowledge; J3–J4 | Photo; manual acquisition; identity/UNS |
| G04 answers/safety; C3 evidence recommendations; J5–J6 | Cited answers; continuity; safety/applicability |
| G05 packet/living work; C5 useful work; J8 | Useful work packet; notebook persistence |
| G06 verified reuse; C6 learning; J9–J10 | Verified learning; notebook context |
| G07 actual phone; C7 beside-machine usability; J2 | Deployed technician workflow; access; persistence |
| G08 durable recovery; J11 | Notebook persistence; permissions/recovery/cost |
| G09 permissioned CMMS; C8 actions | Optional CMMS; standalone workflow always retained |
| G10 permissions/cost | Every tenant/asset/source read or mutation; explicit permissions row |
| G11 frozen candidate | Full deployed journey and representative pilot |
| G12 representative value | Representative pilot, independent human acceptance |
| P1 own-manual answers; P2 junior/night-shift capability; P3 recovery time; P4 branching guidance | Cited answers, safety, work packet, continuity and representative comparative tasks |
| P5 photo→manual→ask; P6 standalone; P7 next-shift reuse; P8 lost cellular service | Photo/manual workflow; CMMS-off journey; verified learning; recovery and separate offline qualification |

Preserve the existing proposed evaluation bars: at least 30 distinct supported cases,
90% supporting answered citation checks, 80% useful grounded supported tasks, 4/5
representative technicians complete without rescue and 3/5 show measured benefit.
These remain proposals from #5086; they neither lower stricter existing criteria
nor authorize a paid run. Zero wrong-asset/tenant writes, private-thread leaks,
duplicate transitions, unsupported critical facts/instructions, lost prerequisites
or false safety clearance; no unresolved blocker/HIGH on the offered path.
Second-job use by 2/5 within 14 days and the proposed 30-day pilot are separate
follow-up measures, not evidence of current Level 3 acceptance or revenue.

## Prioritized recovery backlog for #5232

This is the proposed next-action order for the coordinator to reconcile in the
existing queue. It assigns no new worker and authorizes no runtime action.
Current claims, human prerequisites and review-budget stops take precedence.

| Order | Recover/reuse before development | Existing owner/dependency | Exit evidence and next handoff |
|---|---|---|---|
| 0 — Reconcile authority and fresh reports | Existing four lane comments, #5232 claims, Mission Control/Project #4 and the private ledger. Recover the current Desktop/CLI session/contact rather than trusting names or old peer IDs. | Claude Desktop coordinator registration and Codex Desktop independent audit; current lane owners retain claims. Mike resolves supported scope and unresolved authority. | Exact plan ACKs, current claim/head/status/next action for every reachable active owner; stale/unreachable explicitly recorded. Link W0–W5 definition and full acceptance sources; do not wait to do independent read-only inventory. |
| 1 — Qualify existing safety, evidence and identity repairs | Existing #6015/#6025/#5671 plus included #5764; #6030/#6028 and #6090; reuse current-main #5746/#6056/#6084/#6088/#6089/#6091. Reconcile #6104 identity confirmation against the same model/source contract. | Existing Bravo repair owner and Claude identity worker; no takeover. #5671 human/review prerequisites and budgets remain. | Exact candidate/source and critical negatives; independent review/CI disposition; integration order with shared route/host writers. No merge/deploy in this mission. |
| 2 — Close continuity and durability seams | Existing `buildRetrievalQuery`, saved-turn history, component subject and #5669; reuse #6081/#6082 accounting repair. Reproduce #6106 before selecting code or a paid rewrite. | Existing #5669/route owners; coordinator claims only an unowned #6106 diagnostic slice after overlap reread. | Reopened-thread X80 receipt plus history/query trace; reload/retry/cancel/concurrency/asset-switch negatives, original context and one persisted exchange. Hand independent auditor the exact repaired composition. |
| 3 — Reuse find/onboard/manual capabilities | Merged #5602/#5614/#5625/#5746; recovery #5544/#5545; retain proposed FIND #5628 and ontology stack. | Current equipment/shared-UI/ontology owners; serial writing lease. Requires supported scope and current model/manual contract. | Actual find→select→photo/identity→manual ready→first cited answer. If #5628 adopted, all FIND-01–10 and Mike's exact acceptance. No recreated navigator/ingest service. |
| 4 — Join the existing living record and verified reuse | Observation state, packet/job sheet, #5874, #5089, #5212/#5033 and existing outcome contracts. | State/outcome/packet owners after schema/ledger authority reconciliation G02; G05/G06/G08. Optional CMMS owner only if offered. | Raw/corrected/confirmed provenance, saved packet/PDF, restart, scoped later recall and technician B; strict unresolved/permission negatives. |
| 5 — Freeze and independently accept the complete candidate | Existing #5794 real-route/tablet harness, stranger walk, mobile harness, ledger and release receipts. Recover historical failures as regression inputs; do not transfer their results to new builds. | Existing integration/device owners; Claude Desktop coordinates, independent Codex audit and human assessors. G01–G10 applicable gates precede G11/G12. | Full manifest and every J1–J11 receipt; required review/CI, actual staging/device results and representative human evidence. Named gaps and rollback before any separately authorized release. |
| 6 — Continue only from observed failures or offered dependencies | Existing capability registry/backlog, customer corrections and remaining L1–L14 cases; live/offline/distribution only under selected scope. | Coordinator reranks #5232; current owner or acknowledged reassignment. | One authorized next slice, reusable source and a demonstrated remaining gap. No speculative platform or feature program. |

## Adoption by existing agents

This PR is a reviewable proposal, not evidence that agents have consumed it. Do not
interrupt sessions, send new task prompts or claim ACKs on their behalf. The user or
registered coordinator can give each session the PR and exact revision through its
existing contact. Current workers finish their safe boundary under existing authority.

1. Read `git show <full-plan-commit>:DELIVERY.md`, this crosswalk and the inventory.
   Before merge, acknowledge that exact revision as **PROPOSED**; after merge read
   the resulting main revision and acknowledge **MERGED**. Do not execute historical
   commands or old status next-actions without current authorization.
2. Read the original requirements relevant to your slice, current #5232 claims and
   the private pilot ledger if authorized. Existing plan #5628 remains proposed;
   retain its owner and requirements during reconciliation rather than copying it.
3. The designated lane owner updates the same existing report using DELIVERY's
   expanded template. Specialists add/link their own registration and send evidence
   through that owner. Never overwrite another live lane report. Put the plan read,
   intended outcome, reuse, observed progress, blockers and one next action in it.
4. Claude Desktop records its real coordinator session/contact and backup, reconciles
   all owner ACKs, then chooses the next already-authorized dependency in #5232.
   Codex Desktop registers a separate auditor and verifies the plan/acceptance mapping;
   it cannot independently approve its own authored plan or repairs.
5. Each CLI owner checks its current head, worktree/paths, authority and overlap,
   keeps the claim and reports the next safe action. New work requires a free claim;
   missing reports do not release another worker. Use the existing peer/GitHub channel;
   if unavailable retain an UNPUBLISHED local report and name the blocked route.
6. Re-read at material changes/handoff, keep the same comment current while executing,
   and close out under the existing protocol. A source commit does not hot-reload a
   running agent. Adoption is complete only with attributable ACKs or explicit
   unavailable/pending entries for every inventoried session; draft delivery does not
   claim adoption complete.

| Existing audience | Read next / required response | Present adoption evidence |
|---|---|---|
| Claude Desktop coordinator | Confirm actual session/contact and backup; reconcile queue and release-owner boundaries with the four current lanes. | Role requested by user; no session ACK observed. |
| Codex Desktop auditor | Separate author/reviewer identity, inspect full requirements/current evidence and report unproven rows. | This specialist authored the draft; separate independent audit pending. |
| BRAVO Claude identity worker (`vw7va12u`, reported #6104) | Preserve identity/migration claim and exact review ledger; report current PR head, outcome and integration dependencies. | Live broker report observed; this plan not dispatched. |
| BRAVO Claude redraft worker (`2mquvvlx`, reported #6081/#6082) | Preserve route/cascade ownership; report current accounting candidate and dependency/stop conditions. | Live broker report observed; this plan not dispatched. |
| BRAVO Codex repair lane (#6015/#6025/#5671/#5669 closeout) | Reconcile current four candidates, human/review prerequisites and existing handoffs before resuming any implementation. | GitHub closeout observed; local app tasks notLoaded, not proof of stopped work elsewhere. |
| CHARLIE Codex integration / CHARLIE Claude UI, runtime and acceptance owners | Refresh the stale combined/lane reports against merged #5625/#5746 and actual runtime; preserve current device/shared-UI claims. | Existing reports/host session records observed; fresh plan ACK pending. |
| CHARLIE native Claude `5b3ff234-…` (`safety-switch-jumper-fix`) | Bind the actual current mission and claim before assuming this name means an active safety assignment; report through the owning lane. | Process live; mission binding and exact-plan ACK pending. |
| CHARLIE native Claude `59596322-…` (`ship-v3-461-5-prod`) | Report current mission/authority and release evidence separately; the session name grants no deploy authority. | Process live/metadata idle; exact-plan ACK pending. |
| Other visible Claude sessions and ALPHA/unseen remote workers | Identify current mission, live route and applicable claim; report through existing lane, or explicitly record unrelated/no assignment. | Session metadata is not mission acceptance. ALPHA SSH timed out; census remains incomplete. |

## Unresolved decisions and limits

- Register the actual Claude Desktop coordinator, independent auditor, backup and
  reachable contacts. Role naming does not select/stop/reassign an existing process.
- Mike confirms supported offer, equipment/revision/tasks, optional CMMS/offline
  inclusion and representative participants. Preserve existing deadlines/history;
  this PR does not verify external commitments or propose replacement dates.
- Reconcile the additive DELIVERY changes with open #5628 and root pointers with
  #4960/#5568 at merge time. Their owners, proposed contracts and approval boundaries
  remain intact. #5629's Mission Control extension is unmerged; it is not a dependency
  for this documentation plan and must not be installed under this mission.
- Locate the authoritative W0–W5 definition; keep its acceptance unresolved until
  linked. Refresh private ledger evidence against the next frozen candidate.
- Independent exact-head/body R3 review and required CI remain pre-merge gates.
  No paid review, autonomous round or exhausted-ledger extension is granted here.
  CI, a manual content check or this author's self-check cannot supply independence.
- ALPHA and unobserved Desktop/remote sessions need current registration/ACKs.
  No local application tests, paid inference, device workflow, reassignment, merge or
  deployment were performed as part of this documentation mission.
