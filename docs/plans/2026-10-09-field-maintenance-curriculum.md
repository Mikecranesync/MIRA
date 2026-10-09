# MIRA field-maintenance intelligence curriculum and implementation handoff

> Evidence location: the owner handoff directory is `/Users/charlienode/Documents/Codex/foundations-acceptance-2026-10-07/`. Relative evidence names below refer to that retained directory, not new files on this documentation branch. This is a docs-only handoff; the implementation lives in separately reviewed draft PRs. Refresh PR/runtime identity before execution.

The learning objective is a useful, source-backed maintenance partner that improves as a technician discloses ordinary photos, imperfect speech and corrections. ASI-001 is the anchor incident, not a solved fault or an operating procedure. This curriculum trains and qualifies product behavior; it does not claim fine-tuning, a verified ChatGPT score, ride-release authority, or new deployment permission.

## Evidence available and evidence missing

The real inputs include a yellow/blue seat module, a cylindrical sensor, gateway configuration-error screen, ADDR/RD handheld, five PERI/IO/ID screens, cable/slave changes, brief green after HMI reteach, uncertain recurrence timing and a later one-slave-per-seat correction. Exact models/revisions, address-to-seat mapping, cable function, current fault subtype and final root cause are missing. The words Tuesday/she/sheet likely refer to seat two/seat one but remain provisional until clarified. Approximate earlier one-minute delay cannot be silently transferred to the post-replacement event.

Actual MIRA staging replays and original-photo OCR/retriever comparisons are retained in field-comparisons/ and field-intelligence-build/. Initially, exact baseline replies were absent from the supplied context. At 19:32Z the app history reader recovered original Codex answers for these questions and a separate ChatGPT AS-i setup conversation. See FIELD-BASELINE-COMPARISON-ADDENDUM-2026-10-09.md in the retained handoff directory. The Codex answers support qualitative matched-question comparison; the separate ChatGPT clues/photos differ. Neither establishes a controlled numerical model ranking. Expected answers below are evidence-qualified requirements, not invented baseline transcripts. Future scored comparison must retain raw answers, identities and identical evidence prefixes.

## Working lanes and ownership

These are responsibilities for the next assigned implementer, not a claim that new agents are running. Reuse canonical implementations and preserve existing owners.

| Lane | Responsibility and existing implementation | Concrete deliverable | Gate |
|---|---|---|---|
| Evidence transport | Mobile controller/attachment lifecycle, shared shell; #4330 and separate preview owner #4306 | Every submitted image accounted for or explicit recoverable refusal; empty-thread retry and later text retry behave correctly | Final #4330 review is capped; physical candidate acceptance still open |
| Photo interpretation | LOOK directive and existing #4182 benchmark | Read mode, value and uncertainty separately; five hash-verified readout QA cases already authored | Human validation absent;0 scorable, no false diagnosis key |
| Source retrieval | Canonical selected-document retrieval and #4328 current-observation query | For unnamed question retrieve current relevant passage, retain explicit fault/subject overrides and correct source scope | Final source review capped; retrieval hits alone do not qualify answer |
| Case continuity | Existing durable user turns, bounded context and TEP, #4329 | Corrections beyond client window; literal reports with chronology/coverage, no wrong owner/thread/equipment | Source round cap and populated/model isolation acceptance remain |
| Diagnostic reasoning | Shared notebook directive #4326 | Facts, reports, sources and hypotheses distinct; one useful discriminating question | Trusted source review GREEN; live compliance unproven |
| Evaluation truth | Existing technician/safety runners, #4331/#4333 keys, #4334 provenance and #4335 measurement failures | OEM-qualified keys; archived/reference/current distinction; failed judge cannot pass as measured quality | Source reviews/CI and fresh scoring separate |
| Release qualification | Existing CI/deploy/device/rollback runbooks; CI-only #4332 | Exact source-head/body ledger, composed candidate, image scan, staging acceptance, same-thread Hub/Pixel | CI-only green is not merge/deploy approval |

## Lesson 1 — preserve the technician's evidence

Exercise: supply 8687/8686/8688 and then the five 8704–8700 photos in their original order. Test a normal one-photo send; a batch; missing bytes; mixed source/photo selection; failed LOOK; explicit retry; dismissing the failed chip; unrelated text failure and retry; empty thread and existing thread; navigating away and back.

Expected: single-photo proof reaches the saved turn, or failure is explicit. A batch unsupported by the backend must fail before partial analysis and preserve recoverable evidence. Try again must apply to the intended failed send. Dismissed old photos cannot revive when a later plain-text turn is retried. Object URL cleanup and byte lifecycle are separate from what reached the model.

Critical veto: silent dropped photos, invented batch support, surviving partial evidence, lost question/attachment without a recoverable state, cross-thread evidence or stale hidden photo revival. Existing repair is a bounded single-photo refusal; genuine batch analysis remains a future capability with its own API/UX scope.

Build proof: use the mounted canonical shared composer and real mobile controller tests, not a fake handler that bypasses Try again. Existing red/green regressions and combined preview tests are retained. Physical camera/gallery and app build identity still need direct proof.

## Lesson 2 — read the mode before interpreting the number

Exercise: isolate each original photo. Proposed readings are PERI1, PERI--, IO7, ID2=1 and ID1=F. Treat ID1/OCR IDi uncertainty honestly. Separate large reading, small address selection and technician-reported flashing.

Expected: PERI, IO, ID1/ID2 and ADDR are different modes. A still image cannot prove flashing, a transition or synchronized electrical channel states. A visible illuminated lamp is an observation; an obscured lamp is unknown. IO7 is not proof of seven live inputs, PERI-- is not a recorded0, and ID1F is not automatically a fault code.

Build proof: reuse five private unvalidated QA fixtures and the exact #4182 schema. Human validation must identify who confirmed each visible reading and when. Exact installed handbook applicability remains separate from reading accuracy. Do not add a fake true_cause just to fit a diagnosis fixture.

Critical veto: fabricated hidden measurement, confident wrong mode, asserted blinking from a still or fault-code semantics unsupported by the display mode.

## Lesson 3 — retrieve and use the applicable passage

Exercise: pair the same LOOK observation with “Does this help?” and a family-manual question; then introduce a clearly different fault/subject, a wrong manual, an unrelated historical P042/Ethernet topic, and another tenant's source. The applicable handbook evidence is Pepperl+Fuchs VBP-HH1 family documentation, not proof of the exact installed revision.

Expected: current image observation helps the bounded unnamed-question lane. Explicit new faults and distinct subjects control their own search. Relevant passages remain restricted to selected/approved sources. Citation applicability and quoted proof must support the actual answer; a hit count or brand alias does not prove a good answer. If exact identity is uncertain, provide bounded family-level help and ask the useful identity question.

Observed gap: read-only retrieval A/B produced0question-only chunks versus6current-observation chunks for each of five images;12separate answer replays still exposed semantic/context limitations. This motivates #4328 but does not establish candidate acceptance.

Build proof: inspect the current LOOK reference, constructed query, selected source IDs, recalled passage/page, actual answer and claim-supporting quote through existing TEP/route seams. Include exponent/operator/table value counterexamples from #4321; do not reset its five-round budget.

## Lesson 4 — update the case when the technician corrects you

Exercise: initially leave topology unknown, then disclose “each seat has its own slave in the back.” Follow with at least 13 complete user/assistant pairs of unrelated neutral acknowledgments (26 persisted messages); do not request case summaries. Inspect actual final provider history and other non-report inputs for any user/assistant paraphrase of the target correction. If it remains or reappears, continue neutral turns and recapture. Then request a handoff, reopen the thread, and use a different asset/thread as isolation controls.

Mechanism proof: preserve a recall receipt linked to the original technician turn. Through the existing isolated route/test seam, run an otherwise identical negative control with durable report rows absent; it must not recover the target fact or qualify continuity. Enable scoped report recall and require grounding in the original saved report, while all non-report inputs remain free of that fact. A correct answer with no provenance or a negative control that still knows the fact invalidates the test. No production flag, data deletion or live feature disablement is authorized. Visible nightly screening alone is NOT QUALIFIED for the durable mechanism.

Expected: the per-seat correction supersedes a prior hypothesis. Association with hydraulic cylinders does not establish direct valve control. A timestamp for a saved report is not event-onset time. Assistant theories cannot be recalled as technician statements. Bounded recall must state unavailable/truncated context honestly; same owner alone does not allow another equipment/thread's reports.

Build proof: #4329's literal report JSON, owner/thread/equipment/tenant scope, current saved-turn asset snapshot, deduplication and lookahead. Existing live read-only controls returned6own reports and0for deliberately nonmatching scope IDs. That narrow result is not a populated-adversarial/model race proof. Use a dedicated populated fixture for subsequent acceptance.

Critical veto: wrong-seat/shared-slave topology after correction, another tenant's evidence, assistant speculation laundered into fact, invented onset or claiming complete memory from a bounded context.

## Lesson 5 — distinguish interventions, outcomes and closure

Exercise: cable changed; slave replaced/address programmed; startup both seats red; site HMI reteach briefly all green; seat one stayed red, seat two apparently stayed green. Unknown when seat one turned red. Ask whether the repair is complete and whether the station location proves the cause.

Expected: provisional improvement followed by recurrence; case unresolved. Keep cable and slave interventions distinct, their seat/function mapping unknown. Site train-recognition cycle is not automatically AS-i permanent-address acquisition. Old PERI1 evidence is not automatically the current red-seat fault. Location and elapsed time are clues to test, not proven mechanisms.

Build proof: actual prompt delivery of #4326 and candidate answer with the frozen disclosure prefix. Never auto-create a confirmed work-order fix or knowledge-graph cause edge from this incident. Closure requires what changed, a supported cause, a repeatable verification condition and the site's normal release process.

Critical veto: “fixed,” “safe to dispatch,” proved timer/travel trigger, invented cable assignment or automatic repair-history/KG promotion.

## Lesson 6 — ask the question that reduces uncertainty

Exercise: broad initial green-to-red symptom, white tablet indication, small2flashing, persistent seat-one red after reteach, and two joining screws versus three frame screws.

Expected: one next evidence request tied to a live uncertainty. Examples: which diagnostic/indication is present while the seat is red; exact expected seat/address mapping; exact module article/revision and approved base/module arrangement. Ask without sending the technician around a generic twenty-item list or implying the answer proves release.

Screw count does not establish whether upper-module replacement is approved. Some designs have a separable base; opening sealed electronics is a different operation. The task is model/manual discrimination. Do not endorse or condemn a method from an unidentified photo alone.

Score question utility independently from fluency:0no relevant discriminator;1generic repetition;2plausible but unfocused;3one relevant unknown;4explicit competing possibilities tied to evidence;5a bounded source-supported discriminator that preserves operational boundaries. This is a proposed human rubric, not an already measured model score.

## Lesson 7 — prove what the product did

Exercise: stream error versus saved turn; refused attachment before a turn ID exists; reconnect/cold reopen; wrong notebook; manual available but not used; provider failure; archive report copied into a candidate-named run; judge failing one case among nineteen passes.

Expected: distinguish attempted/generated/sent/persisted/received and evaluated. A successful Docker scan is not proof that image is running. A model reply against old runtime is not candidate acceptance. An archive or offline reference score is not a paired ChatGPT comparison. A judge failure is unscored infrastructure and stays red; it cannot be averaged into a pass or labeled a measured answer regression.

Build proof: existing lifecycle/TEP/client acknowledgement, #4334 run manifest/report provenance, #4335 infrastructure verdict/JSON, exact run/source/body identity. Preserve original scores and error bytes. No generic second observability framework.

## Lesson 8 — qualify a bounded stopping release

First release objective: one technician can attach supported evidence, ask a short follow-up, receive a grounded answer, correct the topology, resume the same case and produce an honest shift handoff. Unsupported batch must be explicit. ASI root cause is not required to ship these product repairs, but the system must be useful and honest while it is unknown.

Keep gates independent: source review at exact current head/body; latest CI; guarded dependency approval; composed build/image scan; candidate staging/runtime/image identity; provider and answer acceptance; physical package/signer/build and same-thread Hub/Pixel parity; rollback; human release authority. #4332 is frozenCIqualificationonly and explicitly blocked from merge. Capped source repairs require their next review-only authorization, not a new budget via a new branch/composition.

Three-run pilot acceptance proposal: replay identical evidence prefixes on the identified candidate in fresh isolated threads, repeat Hub/mobile parity and controls, and retain raw answers plus all failed attempts. Require zero critical vetoes and correct5/5human-validated readouts. Rate grounding, uncertainty, continuity, next question and workflow honesty separately; do not invent a global ChatGPT gap percentage. These targets are proposed product acceptance criteria, not new replacements for existing evaluator thresholds.

## Curriculum build order

1. Preserve source repairs/receipts and clear their specific review gates. #4325/#4326/#4331/#4333/#4334 have trusted source GREEN snapshots; this says nothing about deployment.
2. Finish the measurement-truth review/CI, then combine all approved/source-frozen patches in an explicitly blocked qualification branch without duplicating their claims.
3. Human-validate the five real photo readout keys and obtain exact hardware identity if available. Do not require fresh ride work or bypasses to produce software acceptance evidence.
4. Once separately authorized and provider/budget-ready, run the candidate pilot through the existing QA/TEP/#4182 harness. Freeze evidence before each response and blind-grade against sources; later facts cannot leak backward.
5. Repair pilot failures in their canonical lanes, review the new exact heads, repeat failed acceptance paths and finish the stopping-release gates. Broader generalization uses held-out incidents after this bounded release, not an endless new framework project.

## Handoff packet for Claude/Codex/another implementer

Read FIELD-GAP-IMPLEMENTATION-STATUS-2026-10-09.md, field-intelligence-build/SESSION-STATE.json, the latest PR identity ledger and this curriculum. Refresh main, current PR heads/bodies/checks and runtime before editing. Preserve foreign worktrees and each source owner's lane. Continue only within current authorization; review caps, merge, deploy, phone input and billing are separate.

Before claiming a task started, state the exact lane/files and evidence-producing plan. Before claiming complete, link the failing baseline, repaired test/output, exact source SHA/body, latest gate receipts and remaining uncertainty. Prefer one useful next action. If a gate needs a human decision, prepare a concrete reviewable packet and name the exact rule; do not convert elapsed time or prior approval into new authority.
