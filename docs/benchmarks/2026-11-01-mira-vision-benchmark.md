> **Current assessment:** see [November 5, 2026 — readiness reevaluation](#november-5-2026--readiness-reevaluation). The November 1 and November 4 snapshots are historical; the implementation plan's proposed Level 3 criteria are unchanged.

**FactoryLM/MIRA: benchmark against the 2126 vision**

Assessment snapshot: November 1, 2026, approximately 9:28–9:35 a.m. EST. This is an evidence audit using existing code, artifacts and test results; no new paid evaluation was run.

**Overall judgment: strong architectural alignment, connected prototypes, incomplete operational proof.** FactoryLM/MIRA has important foundations for an industrial engineering assistant: confirmed machine identity, citable observations, manual retrieval, machine history, deterministic workflows and recorded fixes. The next major milestone is a verified maintenance learning cycle on one real asset. A demonstrated chain from observation through work and outcome to useful later recall was not established in the reviewed evidence.

The 2126 vision is the benchmark: a technician can ask what changed, inspect the evidence, prepare the right work, verify its result and leave reliable knowledge for the next person. This assessment does not require futuristic displays or robots to prove that core value.

Mike's architecture clarification after this assessment: **MIRA feeds technician inputs into FactoryLM's UNS, and FactoryLM builds machine state from those inputs.** Technician observations are therefore first-class operational evidence. The central path to benchmark is technician observation → MIRA identity/meaning confirmation → typed UNS event → asset-state projection → an appropriately informed later response. A live PLC feed is not a prerequisite for that cycle. Sensor, historian and future robotic inputs can become additional producers. This clarification changes the evaluation emphasis; it is not a new independent verification that every link already works end to end.

**What was assessed.** MIRA main at [5691a00c](https://github.com/Mikecranesync/MIRA/tree/5691a00cbcc91f0dfd008d68ceacccc38eb41489); FactoryLM main at [3037d10f](https://github.com/Mikecranesync/factorylm/tree/3037d10f4725902bae1b274c055b8e3918b5f7cb); Work Packet PR #5062 at 4561ab7a; the existing November 1 staging walk and real-Pixel report.

At 9:28 a.m. EST, direct health reads returned production 3.431.8 / 01f4f512f and staging 3.436.0 / fe39c459f. These are different from current source. The Pixel report also identifies a packaged native UI built from an older branch, against the newer staging backend. Code, backend deployment and installed client must therefore be assessed separately.

Maturity levels below are judgments about the reviewed evidence: **0** intended; **1** working component/prototype; **2** connected with limited practical proof; **3** passes defined representative acceptance; **4** repeatable customer use with demonstrated value. **U** means the evidence was not established. Level 4 applies to a bounded capability, not to completion of the entire future vision.

| Capability from the vision | Current level | Evidence and limit | Proof needed next |
|---|---:|---|---|
| Know the physical machine | 2 | Human-confirmed identity becomes citable evidence; source applicability and idempotent confirmation exist. A new QR/DataMatrix path is merged behind a flag. Robust field performance across similar models and replacements is unproven. | Correct asset, variant and revision throughout a complete job; reject conflicting identifiers and unsupported applicability. |
| Maintain trustworthy engineering knowledge | 2 | Indexed manuals, page sources, versioned evidence contracts and content-addressed artifacts exist. Extraction can still lose safety conditions. | Preserve instruction scope, prerequisites, exceptions and provenance across page breaks, figures, tables and revised manuals. |
| Explain and recommend from evidence | 2 | A complete staging path exists. The inspected walk scored 29/49 for the first citation opening the expected page, with unresolved safety omissions. | Pass existing retrieval, numeric-support, applicability and safety gates on the exact offered surface and candidate. |
| Build and use machine state from technician inputs | 2 infrastructure; complete-cycle proof U | Tenant-scoped run/window/diff APIs, confirmed observations and machine-history context exist. The intended state path is MIRA → FactoryLM UNS → asset state. The reviewed evidence did not establish that complete path for a technician-originated update and its later reuse. PLC connectivity is a separate source concern. | A confirmed technician input creates the correct asset-scoped event, changes only the justified state fields and informs the next turn; source, time, attestation, uncertainty and conflicts remain explicit. |
| Prepare and guide useful work | 2, limited development proof | Work Packet builds editable, sourced drafts and PDFs on a local branch; guided procedures support units, measurements and explicit outcomes. Work Packet remains draft with a HIGH review finding. | Qualified parser, final-head review, physical-phone workflow and a technician-accepted packet for an explicitly supported job. |
| Remember verified outcomes and improve the next job | 1 for the complete learning cycle | Fix records persist symptom, fault code and a technician-entered fix; machine history is queryable. The reviewed fix-record shape does not itself establish a measured before/after outcome, and next-job improvement was not proven. | Record how success was verified, retain uncertainty and identity, and demonstrate appropriate reuse by another technician later. |
| Stay usable beside the machine | 2 | Real Pixel sign-in, navigation and some citation/PDF checks passed. Keyboard obstruction, Back behavior and overflow failed; the newest Work Packet PDF lacks equivalent physical-phone proof. | Complete the offered workflow on an actual phone without losing work or access to controls and evidence. |
| Coordinate actions under permission | 1 for broader execution | Typed workflow outcomes, approval boundaries and idempotent CMMS dispatch infrastructure exist. CMMS dispatch is disabled and has an upstream endpoint dependency; OT control remains outside the current diagnostic scope. Shared budget enforcement also has gaps. | Explicit authorization, durable shared reservations, idempotency, readback and failure/rollback proof for each additional action. |
| Demonstrate customer demand | U | A five-organization, free 30-day pilot is defined. Reviewed artifacts did not establish the five-technician repeat-job acceptance result. | Observe task completion, factual corrections, time saved and unprompted second-job use. |

The strongest foundation is the connection between human correction and durable evidence. The [nameplate confirmation route](https://github.com/Mikecranesync/MIRA/blob/5691a00cbcc91f0dfd008d68ceacccc38eb41489/mira-hub/src/app/api/equipment-notebooks/%5Bid%5D/nameplate/confirm/route.ts) materializes a corrected identity as a citable source. The [machine-memory helper](https://github.com/Mikecranesync/MIRA/blob/5691a00cbcc91f0dfd008d68ceacccc38eb41489/mira-hub/src/lib/machine-memory.ts) reads persisted runs, state windows and anomalies. [Fix records](https://github.com/Mikecranesync/MIRA/blob/5691a00cbcc91f0dfd008d68ceacccc38eb41489/mira-hub/src/capabilities/fix-records.ts) bind a technician's report to the answer's equipment and deduplicate retries. Those are useful pieces of a factory memory.

The architecture is also pointed in the right direction. [Materialized Evidence](https://github.com/Mikecranesync/MIRA/blob/5691a00cbcc91f0dfd008d68ceacccc38eb41489/docs/architecture/materialized-evidence.md) defines version, provenance, approval, uncertainty and reuse. Current engine code has a TechnicianContext serving seam; the older July note claiming zero production call sites must not be repeated as today's state. However, [runtime adoption documentation](https://github.com/Mikecranesync/MIRA/blob/5691a00cbcc91f0dfd008d68ceacccc38eb41489/docs/plans/2026-08-01-technician-context-runtime-adoption.md) distinguishes audit integration from fully unified prompt rendering. The batch-ingest evidence receipt is optional and explicitly does not implement recall-based extraction skipping. This is partial integration, not proof of universal reuse.

**The most consequential gaps are information fidelity and closure of the learning cycle.**

1. A matching number or citation does not establish a complete engineering instruction. On the exact reviewed Work Packet head, [review round 8](https://github.com/Mikecranesync/MIRA/pull/5062#issuecomment-6559050210) reproduced safety continuations being discarded as captions while the remaining fragments stayed Verified. The relevant benchmark is preservation of all applicable conditions, or an explicit Unknown, across held-out document layouts.
2. Saving what somebody says fixed a problem is the beginning of memory. A trusted learning cycle also records observations before and after, the verification method, who attested it, applicable asset/revision and unresolved causes. A reported fix must not automatically become a universal causal rule.
3. The technician-to-machine-state cycle needs explicit acceptance evidence. A technician's confirmed inspection, repair or measurement can supply state without a PLC feed. Test the event and derived state, then test that a later response uses it correctly. [FactoryLM #233](https://github.com/Mikecranesync/factorylm/pull/233) provides a separate diagnosis-service proof; its receipt states the PLC was unreachable and answers came from the KB, which limits that sensor-connected demonstration without invalidating technician-originated state. The [capability registry](https://github.com/Mikecranesync/MIRA/blob/5691a00cbcc91f0dfd008d68ceacccc38eb41489/docs/architecture/convergence/CAPABILITY_CLOSURE.yaml) records several relevant paths as staging-only or disabled, including the CV-101 observer and CMMS outbox. Its older environment observations are registry claims, not new live flag observations from this audit.
4. A coherent customer journey remains weaker than the collection of implemented components. The real-Pixel report (CHARLIE local file `.planning/charlie2-support-2026-10-31/RELEASE-REPORT-2026-11-01.md`, not in this repository) documents useful working behavior and blocking phone defects. No reviewed evidence established repeat use and customer benefit across the complete job.

**Existing benchmark evidence must retain its definitions.**

The November 1 walk, run 2026-11-01T10-41-17-690Z on fe39c459f, finished with 29 CORRECT, 13 WRONG_PAGE, 0 UNCITED, 4 ABSTAINED, 3 SAFETY_STOP, 0 BROKEN and 1 NOT_ASSESSED. The omitted case, smc50-q5, was refused by the old 3.84 USD process cap. Five of 14 assessed safety-relevant cases had NO_NOTICE; the fifteenth safety case was not assessed. Two of five specially watched answers omitted required manual safety conditions. A successful harness exit and cleanup did not establish acceptance. CORRECT means the first citation opened within one page of the benchmark target; answer wording was not generally graded.

These findings were independently read from BRAVO's supplied task artifacts, not just a peer summary. The final scored.json SHA-256 is b50f4406af95156530a86dfc01e8fdf6f0fee370152dede70517162ff5fa53c2. Its original directory is /private/tmp/claude-501/-Users-bravonode/9e2a4da4-c808-4c9e-9950-63135e91c13d/scratchpad/walk-5059 on BRAVO.

Separately, the local listwise retrieval experiment achieved 27/37 right pages versus 17/37 for its baseline, but its 95% Wilson lower bound was 57%, below its declared 70% threshold. The sealed safety slices were not run. That is promising research, not an accepted product result. Frozen result: CHARLIE local file `.planning/2026-10-29-t1-fix/measure-1031/sealed/exam/RESULTS-sealed-b1.md`, not in this repository.

**The next benchmark should be one complete maintenance learning cycle.** These are proposed acceptance tests, not results claimed by this audit:

- Choose one explicitly supported pump and real job. Reuse the existing CAT 3520 development example; use a real 5CP6120 field job only after that exact model and manual scope qualify.
- Have MIRA resolve and confirm a technician observation, publish its typed evidence into the correct UNS asset scope, and demonstrate the resulting machine-state change. Confirm that another asset is unchanged and that an ambiguous or contradictory statement cannot silently overwrite established state.
- Confirm identity and revision; prepare the sourced packet; preserve every applicable safety condition and critical value; complete the phone and PDF journey. Wrong-model or unsupported critical facts must never remain Verified.
- Capture technician-confirmed observations and how the job outcome was verified. A claimed improvement and a measured improvement remain different evidence types.
- Preserve the raw report, normalized event, source time, recording time, units where relevant, attestation and state-derivation rule. A reported repair does not automatically establish that the machine is safe to operate.
- Have another technician reopen the same asset later, recover what happened and its evidence, and use the experience appropriately for a new job. Exercise a revised manual and a conflicting observation; stale or contradictory evidence must not silently become trusted guidance.
- Use the five scoped free 30-day pilots to measure completion without rescue, factual corrections, time saved and repeat use. Proposed initial bars: 4/5 complete independently, at least 3/5 show measurable benefit, no critical unsupported/applicability errors, and at least 2/5 return for a second supported job within 14 days.
- Keep existing release gates. Preserve read-only industrial boundaries and separately agreed paid continuation. Any fresh paid evaluation needs its own valid authority and enforceable all-lane cost bound.

After that technician-originated state loop works, add one real read-only telemetry source using the same evidence discipline and prove freshness/quality through a fault window. Then qualify specific permissioned external actions. Spatial displays and robotics can use the same identity, evidence, memory and authorization foundations later.

Prioritize completed jobs with verified outcomes, zero critical unsupported instructions, useful later recall, evidence reuse, cost per completed job and voluntary repeat use. These measures track progress toward the 2126 vision more directly than PR count, model count or test count alone.

---

## November 4, 2026 — current capability and customer-readiness worksheet

**Evidence refresh: November 4, 2026, from 15:09 UTC.** This section supplements the preserved November 1 assessment above. It is a read-only source/receipt audit, not a new product test, paid evaluation, release decision or human acceptance. Levels retain the original definitions: **0 intended; 1 working component/prototype; 2 connected with limited practical proof; 3 passes defined representative acceptance; 4 repeatable customer use with demonstrated value; U evidence not established.**

**Current judgment: foundations have progressed; complete first-customer Level 3 remains unproved.** V1 Work Packet and Mission 001 have merged. Local state/handover and V2 packet evidence is stronger. None of that establishes one accepted offered build, all mandatory journey gates, representative technician benefit or repeat customer use. No capability is promoted to Level 3 by this update.

### Evidence identity: source, deployment and local candidate are different

| ID | Environment / revision | Exact source and scope |
|---|---|---|
| E1 | Source main `acd230af009f37f14e72fb9f643a45a28ca9f859` at refresh | [Source commit][E1]. Source presence is not runtime adoption or acceptance. The two pre-existing documents in this PR remain based on their own dated November 1 snapshot. |
| E2 | Last recorded Hub production: `8a226231b9d2bf4e27ffe0e3fd6411aeabdbfb82`, v3.438.4; receipt 2026-11-02 15:51:59Z | [Production deploy run][E2], job `125378904693`: runtime SHA and built/running Hub image `sha256:aa68dc5ffd9797d874bbeefb2c30943fdcb275353efe49f7adf499513cce540b`. The run's controller SHA is different from its approved target; do not use controller identity as deployed identity. This publication did not poll live health. |
| E3 | Last recorded staging Hub: `f52e7f59eaff776574c3ff279b391cce41549cee`, v3.441.2; built 12:41:52Z, receipt 12:46:09Z on November 4 | [Staging deploy run][E3], job `126579330070`: Hub built/running image `sha256:6f7bcf89beb7fe864ba45a2c0eec95f450d7a439c64c6b029e3e6c0698ecce9e`. A later build at the same SHA is a different image generation; earlier tests are not transferred automatically. |
| E4 | Retrieval replay at PR #5181 head `3c07a573c768123753f9036cdc367a373b57ad24`; earlier staging generations including f52e7f59e | [Merged PR / replay][E4], [staging findings][E4a] and [correcting addendum][E4b]. Replay improved supporting-passage reach from 214/275 to 239/275 focused cases; that is not measured answer quality. Earlier staging flag-on tests failed timeout, p95 and wrong-model gates. They are not a test of E3's later image. |
| E5 | Mission 001 merged head `cab91fbbc3037e772e7afae83234c3f7d17107a0` | [PR #5091][E5], [current capability registry][E5a], [proposed migration 113][E5b], [staging compose][E5c], [production compose][E5d]. Registry records observation state as deployed-disabled/unset; 113 remains proposed and the flag is not forwarded by the inspected compose files. Those are source/config records, not a fresh live environment-variable read. Shared adoption is not demonstrated. |
| E6 | Retired local Pixel test surface, candidate `fe8c282865992ea2c7c93c841139c01c8e59bb5a`; report at `7b2518fe4412f3429065d5e26efb131c70b15e00` | [November 2 findings and November 3 cleanup][E6]. Local disposable DB/server, actual Pixel, synthetic reports and revision-specific provider/stub tests. Privacy/restart/recall proof is limited; original symptom was omitted and the full supporting PDF page did not open. No representative technician acceptance. Preview/DB were removed: the historical entry point is not live. |
| E7 | Work Packet V1 merged head `7cd06ab9ff49b46d8395e8fcec9967542c4cd1f7` | [PR #5062][E7] and [exact-head round-18 GREEN receipt][E7a]. The previous HIGH was fixed. The November 1 open-PR/HIGH description above is historical, not current. GREEN does not establish full manual coverage or the complete phone/customer journey. |
| E8 | Work Packet V2, draft #5173 at `482d698913cc1102024e0758256187af6e7d507c` | [Current PR][E8], [latest disposition][E8a], [device-local draft/record storage][E8b]. Owner reports 12,281 local tests; the prior head's HIGH is reported fixed here, but this head lacks independent review and its Pixel test is blocked by no attached device. Earlier body text describing older Pixel proof is not acceptance of this head. [#5175][E8c], [#5176][E8d], [#5177][E8e] remain open. |
| E9 | Main E1 fix-record contract; draft mobile retry head `d0e5aae3b059a8760591c5808274512e726079f4` | [Fix-record fields / deferred chat consumer][E9], [open later-reuse gap #5089][E9a], [draft #5033][E9b]. Current records store a symptom/fix report, not verified before/after outcomes. The report-to-guidance learning loop and disconnected reload exactly-once behavior are not accepted. |
| E10 | Atlas production restoration, approved candidate f52e7f59e; controller main acd230af | [Apply run 41835307246][E10] completed successfully; [attachment issue #5180][E10a] is open. Atlas service restoration is separate from Hub integration. The E1 registry still documents unsupported negotiated CMMS dispatch. Service health is not integration or customer-use proof. |
| E11 | Main E1 signup; draft consent #4930 at `93993316dc085c9cb83ddd123f53e25d2aface3e` | [Signup source][E11] still says 7-day trial; [versioned consent PR][E11a] remains draft. Proposed free 30-day pilot terms and local tenant/access tests are not an accepted offered-runtime journey. |
| E12 | Customer evidence not established in the inspected set | [Pilot job receipt][E12] explicitly remains a template without customer results. No participant identities, deal names or confidential records are published. Missing acceptance/payment proof does not establish absence of demand. |
| E13 | Eight-pain acceptance overlay at `809a6877e73dd42385c87b36af27c1663cec8111` | [PR #5094 customer-value acceptance][E13], linked to the [October 31 Demand Map][E13a]. Work tags and priority scores are planning judgments, not maturity ratings or proved demand. |

The earlier staging finding must retain its limits: timeout fallback **50%** versus its **20%** maximum; p95 **4003 ms** versus **3500 ms**; wrong-model page gate **1/2**, not met; production **NO-GO for that rerank candidate**. The addendum narrows the causal claim to likely, corrects unique turn mapping to **40/42**, and labels unsupported-value counts as the Hub's heuristic, not independent answer judgments. Passing short-query acceptance turns did not exercise reranking. The later E3 deployment needs generation-matched qualification before this failure can be considered cleared; it is not declared to have freshly failed those tests either.

### Current nine capability rows

Each row below separates implemented pieces from missing or failed acceptance. Owners identify the existing workstream to consult, not a new assignment or permission to change runtime. Where the registry has no promotion owner, Mike/integration coordination must confirm one.

| ID | Capability | Current defensible level |
|---|---|---|
| C1 | Know the physical machine | **2** |
| C2 | Maintain trustworthy engineering knowledge | **2** |
| C3 | Explain and recommend from evidence | **2** |
| C4 | Build and use machine state from technician inputs | **2 infrastructure / limited local integration; offered complete cycle U** |
| C5 | Prepare and guide useful work | **2**, stronger local packet proof |
| C6 | Remember verified outcomes and improve the next job | **1 for complete learning cycle** |
| C7 | Stay usable beside the machine | **2** |
| C8 | Coordinate actions under permission | **1 for broader execution** |
| C9 | Demonstrate customer demand | **U** |

#### C1 — Know the physical machine

- **Evidence / environment / revision:** E1 confirmed identity/applicability sources and E6 local candidate; current identity failures must be scoped to their actual reproduction. [#5134's reproduction note][E14] did **not** reproduce the alleged sibling-manual wrong answer; the observed gap was a refusal that failed to name the model mismatch.
- **Missing proof:** correct asset, component, variant, revision and conflicting-identity handling throughout the offered build's complete physical-phone journey. Skipped real-Postgres adoption tests do not establish adoption.
- **Smallest next action / owner:** existing identity/retrieval owner qualifies one offered asset/manual/revision with positive, mismatch and cross-asset controls, on the exact release pair; implement only the narrowed refusal clarification if still required. Mike confirms physical scope.

#### C2 — Maintain trustworthy engineering knowledge

- **Evidence / environment / revision:** E7 replaces the stale V1 HIGH claim with merged exact-head GREEN. E8 is newer local V2 work, not shared rollout; applicability, title-negation and struck hazard-control defects remain open. PDF-ingest NUL repair #5038 is still draft (see draft-head register).
- **Missing proof:** held-out manual coverage and complete applicable prerequisites, quantities, restrictions, figures and warnings on the offered runtime/export; original-PDF ingestion and actual DB adoption where required.
- **Smallest next action / owner:** existing Work Packet/evidence owner freezes one manual/job, resolves or excludes the relevant open defects, and proves completeness against source plus a mutation that removes a required condition. No broad family-coverage claim from one fixture.

#### C3 — Explain and recommend from evidence

- **Evidence / environment / revision:** E4 replay provides better passage reach, not better generated instructions. Earlier staging generation failed declared rerank gates; E3 is a later image at the same SHA without transferred acceptance. The draft core-fix register below is not merged capability.
- **Missing proof:** generation-matched supported answers, source opening, applicability, numeric fidelity, complete safety conditions and useful abstention; representative usefulness and latency on one offered candidate.
- **Smallest next action / owner:** existing retrieval/safety owner resolves the failed configuration/resource question within authorized scope, then produces generation-matched acceptance and complete answer assessments. Any new paid run needs its own valid authority; this document dispatches none.

#### C4 — Build and use machine state from technician inputs

- **Evidence / environment / revision:** E5 merged confirmed observation→event/state→recall infrastructure, plus E6 limited local two-session, restart and privacy evidence. Registry/compose/migration records still do not establish shared staging/production adoption. Local test input and a self-report are not physical measurements.
- **Missing proof:** approved shared schema/grants/flag adoption, exact offered build, original symptom and attempted work preserved, full source opening, conflicting/late/duplicate events, private-thread controls and representative technician completion.
- **Smallest next action / owner:** Mission 001 maintainer and integration coordinator prepare one fully identified successor test surface and the authorized shared-adoption plan. Mike names the currently missing promotion owner and decides any migration/flag enablement separately. Repair the source-view/symptom gaps before claiming a complete handover.

#### C5 — Prepare and guide useful work

- **Evidence / environment / revision:** E7 V1 merged; E8 V2 local head 482d69891 has stronger procedure/coverage/field-record proof. Drafts and work records persist in device localStorage; this is not shared verified-outcome memory.
- **Missing proof:** independent review of the latest head, disposition of #5175/#5176/#5177 in the offered scope, actual Pixel save/reopen/PDF/camera cases as promised, source-to-export agreement and technician-accepted job.
- **Smallest next action / owner:** existing #5173 Work Packet owner finishes the named review/defect/device gate on the frozen candidate; coordinate the shared host with the integration owner. Preserve unknowns and qualified users' authority.

#### C6 — Remember verified outcomes and improve the next job

- **Evidence / environment / revision:** E9 current persisted symptom/fix reports and server idempotency; #5089 remains open. E6 observation recall is useful but does not add verified before/after outcome fields or prove the repair-learning cycle.
- **Missing proof:** verification evidence and method, unsuccessful/unverified outcomes, appropriately scoped subsequent answer use, technician B's actual benefit, and disconnected reload exactly-once proof on the accepted client.
- **Smallest next action / owner:** existing fix-record/history owner links verification to the current record/consumer and resolves the promise in #5089; #5033 mobile owner proves reload retry. Show B recovering one verified or explicitly unverified outcome without A's private thread.

#### C7 — Stay usable beside the machine

- **Evidence / environment / revision:** E2 production includes the recorded phone hardening target; E6 actual local Pixel proof improves confidence in selected interactions, with source-page/symptom limitations and no current preview. E8's newest candidate lacks its own physical-device acceptance.
- **Missing proof:** a single identified web/backend/APK/active-bundle pair passes keyboard, Back, long source, upload/camera return, interruption, cold restart and phone→web→phone continuity throughout the promised journey.
- **Smallest next action / owner:** existing shared-UI/mobile/device owner records that exact pair and runs the physical journey with all failed/unassessed cases retained. A desktop viewport or an older APK is not a substitute.

#### C8 — Coordinate actions under permission

- **Evidence / environment / revision:** E10 restores an Atlas service, while E1's CMMS outbox still negotiates unsupported behavior and #5180 attachments remain open. Hub setup and standalone use are separate. E9 leaves disconnected record-fix recovery unaccepted.
- **Missing proof:** complete standalone journey with CMMS off, plus, for each separately offered external action, authorization, supported backend endpoint, durable reservations, exactly-once delivery/readback and failure/rollback. Service health does not prove those actions.
- **Smallest next action / owner:** current integration owner first proves the supported standalone journey with connectors disabled. Existing CMMS-dispatch/Atlas owners then qualify one explicitly supported action only if separately authorized. OT controls remain outside this diagnostic offer.

#### C9 — Demonstrate customer demand

- **Evidence / environment / revision:** E12 is a blank receipt framework, not customer acceptance; E13 public-pain research identifies hypotheses. No newly inspected representative technician receipts, measured-benefit results or paid-continuation proof establish this row.
- **Missing proof:** task relevance, completion without rescue, factual corrections, comparable-task benefit, voluntary repeat use and separately agreed payment evidence where claimed. Interest, pipeline entry, free access, use and payment are different observations.
- **Smallest next action / owner:** Mike/pilot owner obtains the existing proposed five-technician evidence for the defined scope and records every failure/assistance as well as successes. Do not infer “no demand” or “no paying customers” from missing proof here.

### Eight customer pains cross-mapped to capability and journey

Pain names/numbers and work tags below retain the [October 31 source][E13a]; the November 1 [acceptance overlay][E13] supplies the expected relief. These tags are not current levels. Journey IDs refer to the eleven original plan rows below.

| Pain | Original tag | Capability / journey | November 4 evidence and missing acceptance | Smallest next action / existing owner |
|---|---|---|---|---|
| P1. Cited answers from OUR manuals at the machine | FINISH | C1–C3, C7; J3–J6 | E1–E4, E7–E8: sources and retrieval exist; complete applicable useful answer and source opening remain unaccepted on one offered generation. | Qualify one correct manual/question/source path; identity, retrieval and safety owners. |
| P2. Junior / night shift as capable as the retiring senior | FINISH | C2–C7, C9; J3–J10 | E6/E8/E12: simulated/local proof is not less-experienced technician completion or measured benefit. No qualification-replacement claim. | Supported task without senior/operator rescue plus comparable baseline; pilot/mentor owner. |
| P3. Cut recovery time when unplanned downtime hits | REUSE | C3, C5, C7, C9; J5–J9 | E4 measures reach/latency, not recovery or prevented downtime. No observed MTTR improvement established. | Measure all-in question-to-accepted-next-step time; record actual restoration separately if observed; pilot + retrieval owner. |
| P4. Branching troubleshooting that isn't a useless error-code echo | FINISH | C2, C3, C5; J5, J6, J8 | E1/E7/E8 do not establish an accepted branching job on the offered candidate. A sourced fallback and an interactive branch have separate proof. | Qualify one OEM branch with changing input/results, complete conditions and honest fallback; guided-work owner. |
| P5. Photo the nameplate → right manual → ask | FINISH | C1–C3, C7; J3–J5 | E1/E6: scope/camera/readiness/citation must be proved together; assisted recognition is not accepted by typed-identity proof. | Prove manual-selection route, then camera-assisted path only if offered; identity/source + device owners. |
| P6. AI that works without ripping out (or depending on) the CMMS | REUSE | C3, C5–C8; J1–J11 | E10 restoration does not establish standalone usability; Hub configuration/dispatch/attachments are distinct. | Complete one promised journey with CMMS connectors off; integration owner. |
| P7. Record the fix once; next shift gets the guided workflow | CONNECT | C4, C6, C7; J7, J9–J11 | E5/E6/E9: observation recall is ahead of complete verified-fix reuse; shared adoption, omissions, source opening and reload retry remain gaps. | Close A's confirmed event→restart→B's evidence-backed handover, then qualify outcome learning; state/history owners. |
| P8. Answers when the help file needs internet (or the cell drops) | BUILD | C6, C7; J2, J4, J11 | E9: disconnected recorded-fix exactly-once is not accepted. Full offline manuals/Q&A remain separately unverified. | Prove no lost draft, duplicate event or false saved state after reconnect; mobile/recovery owner. Do not promise offline reasoning from queue recovery. |

### Eleven original journey steps: acceptance disposition

The existing [plan](../superpowers/plans/2026-11-01-first-customer-level-3.md#the-customer-promise-and-acceptance-matrix) remains the authority for these mandatory steps. “Unverified” means the required evidence is absent here; it does not by itself mean implementation is absent. No row is marked an accepted offered-build pass.

| ID / original first feature | Cross-map | Environment/revision and current evidence | Missing proof → smallest next action / existing owner |
|---|---|---|---|
| J1. Offer, request access, approval, crew invite | C9; P6 | E11: main E1 signup copy and draft 4930; local access tests are not runtime proof. | Reconcile 7-day copy, approved 30-day offer, versioned consent, seats/concurrency and access states on the offered build; intake/consent owner with Mike for wording. |
| J2. Sign in, HOME, Project and thread | C7; P6/P8 | E2 production receipt; E6 retired local Pixel candidate. | Exact physical-client/backend same-thread and cold-restart acceptance without rescue; shared-UI/mobile owner. |
| J3. Identify machine/component | C1; P1/P5 | E1 source, E6 local proof and E14 narrowed reproduction. | Correct scope/model/variant/revision, mismatch notice and wrong-asset/tenant controls end to end; identity owner. |
| J4. Add manual or photo evidence | C1/C2/C7; P1/P5/P8 | E1 sources and draft 5038 ingestion repair. | Searchable/openable known passage; upload/LOOK failure, readiness and camera return without false success; ingestion/source + device owners. |
| J5. Ask a question and open its source | C3/C7; P1/P2/P3/P4/P5 | E4 earlier rerank tests, E6 full-page failure; E3 later image not covered by them. | Matched-generation useful answer plus supporting full source, critical facts and applicability; retrieval/source owner. |
| J6. See safety information | C2/C3; P1/P2/P3/P4 | E4 limited page/heuristic evidence; E7 fixed historical HIGH; draft safety repairs below. | Actual complete OEM conditions and positive/negation/educational/poisoned-source controls, live and reloaded; safety owner. |
| J7. Report an observation and see machine state | C4; P2/P7 | E5 merged, proposed 113/unset registry; E6 limited local candidate. | Authorized shared adoption and trace raw→confirmed→event/state→next turn, retaining original symptom/conflicts; Mission 001 + integration owner. |
| J8. Prepare/edit/save a Work Packet | C5; P1/P2/P3/P4/P6 | E7 merged V1, E8 draft V2 head 482d69891 and device-local storage. | Latest-head review, scoped defects, physical Pixel edit/save/reopen/export and source agreement; Work Packet owner. |
| J9. Record work and verify result | C6; P2/P3/P6/P7 | E9 main symptom/fix shape; later-reuse issue open. | Inspectable before/after or attestation, unsuccessful/unverified outcomes, no inferred resolution; fix-record/outcome owner. |
| J10. Return later / hand over to another technician | C4/C6/C7; P2/P6/P7 | E6 two-session privacy/restart proof is local/simulated; E9 complete learning not established. | B recovers all approved facts and unresolved issues, sees revisions/conflicts and later answer, without private-thread leakage; state/history + pilot owner. |
| J11. Retry, recover, sign out, reach pilot end | C6–C9; P6/P7/P8 | E9 draft 5033, E11 consent/access work, E10 unsupported external path. | Exact client retains idempotency across reload; cancel/timeout/retry, expiry/sign-out, cost bounds and prohibited-write controls; mobile + access/integration owners. |

### Unmerged core-fix register at this refresh

All below were **open, draft, unmerged** when read. Their existence or local tests do not change E1/E2/E3 behavior by themselves. This is a status record, not a request to merge or dispatch their owners.

| PR | Head checked | Relevant gap / existing lane |
|---|---|---|
| [#5139](https://github.com/Mikecranesync/MIRA/pull/5139) | `f5149205e4aea9c3587b7642b75074e892b4090e` | Catalog-number retrieval; retrieval owner. |
| [#5142](https://github.com/Mikecranesync/MIRA/pull/5142) | `3f09bd8f01cfed4edeaae796b7376d2af5f39e22` | Erase/back-up notice and fault-reset framing; safety owner. |
| [#5143](https://github.com/Mikecranesync/MIRA/pull/5143) | `51602b5ffd9a847acff859a049fde134dbcaf80d` | Dotted parameter search/glyph scope; retrieval/ingestion owner. |
| [#5145](https://github.com/Mikecranesync/MIRA/pull/5145) | `946ca41d353e7875156943ca3f9e490a6a149511` | Factory-reset vs fault-reset warning; safety owner; stacked on 5142. |
| [#5153](https://github.com/Mikecranesync/MIRA/pull/5153) | `39aa0f4f6041d4447ae0f934da020a934923497d` | Citation passage relevance; citation owner. |
| [#5156](https://github.com/Mikecranesync/MIRA/pull/5156) | `2376507fd8bdfd6265e379c8c07667c2768c1c6a` | Short follow-up subject carry; retrieval owner. |
| [#5161](https://github.com/Mikecranesync/MIRA/pull/5161) | `a124132bf082028e989edfa15d6a66720080b3b7` | Ellipsis/acronym/rating follow-ups; stacked on 5156. |
| [#5038](https://github.com/Mikecranesync/MIRA/pull/5038) | `061a335a6d101e83e06459299a4ae8ad019d9520` | NUL glyph ingestion; original manual not reproduced locally, synthetic regression plus staging error evidence. |

### Narrow next proof and unchanged Level 3 bars

**Smallest next integration proof:** one explicitly supported asset, confirmed variant/manual/revision and a source-qualified task; correct full source opening → one reviewed factual observation → exactly one durable state event → normal restart → technician B recovers the original symptom, attempted work, evidence, disagreement and unresolved outcome without A's private conversation. The E6 preview is retired, so the existing integration/state owner must prepare a successor and identify its exact server/build/client/schema/flags. Mike confirms physical scope and representative participants. This is a scoped handover proof, not the complete Level 3 package; J1–J11 still require their own acceptance, including the packet/outcome gates.

Resolve the observed source-page and omitted-symptom failures first, using existing owners and interfaces. Preparing a shared-adoption plan is not permission to apply migration 113, change flags, perform hazardous work, deploy or spend. An observation or reported repair never grants return-to-service authority.

The original plan's numerical bars remain **PROPOSED**, not achieved here or newly approved:

- Frozen representative set of at least **30 distinct in-scope cases**, including independently owned unseen cases.
- At least **90%** supporting citation checks among answered cases and **80%** useful grounded in-scope results, with every critical assertion checked individually.
- At least **4/5 representative technicians** complete without operator rescue; at least **3/5** demonstrate measured benefit against comparable manual-only work. Include waiting, correction, retry, assistance and unsuccessful/unassessed cases.
- **Zero critical** safety, identity, tenant/privacy or state-integrity failures; no lost safety prerequisite, unsupported critical instruction, duplicate transition or false safety clearance; no unresolved blocker/HIGH on the offered path. Applicable stricter gates remain.
- One exact candidate/generation and actual required reviews, CI, physical-phone and cross-surface evidence. Simulator personas and automated tests do not count as representative technicians.
- Level 4 remains separately proposed: **2/5** voluntarily return for a second supported job within **14 days**, retaining benefit without critical failure.

No scores are averaged across broken steps. No source-page reach, passing deployment, unit-test count, merged PR, healthy Atlas service or successful software turn is converted into verified maintenance success, MTTR reduction, safe operation or customer demand.

### Publication and verification boundary

This addition uses source files, PRs, issues and receipts already recorded in this same GitHub repository; it includes no CRM facts, customer identities, employer records or credentials. Only this benchmark receives a dated addition. The November 1 baseline and the Level 3 implementation plan/criteria are retained; no runtime flags, code, schemas or release decisions change. Source/receipt reads, Markdown/crosswalk/link checks and a documentation diff review support this update. No product suite, paid reviewer, model call, workflow dispatch, deployment, merge or customer outreach is performed to prepare it. Documentation CI may run when this draft PR is updated, and its success is documentation-check evidence only.

[E1]: https://github.com/Mikecranesync/MIRA/commit/acd230af009f37f14e72fb9f643a45a28ca9f859
[E2]: https://github.com/Mikecranesync/MIRA/actions/runs/41474739256
[E3]: https://github.com/Mikecranesync/MIRA/actions/runs/41831418158
[E4]: https://github.com/Mikecranesync/MIRA/pull/5181
[E4a]: https://github.com/Mikecranesync/MIRA/pull/5181#issuecomment-6630376552
[E4b]: https://github.com/Mikecranesync/MIRA/pull/5181#issuecomment-6630580419
[E5]: https://github.com/Mikecranesync/MIRA/pull/5091
[E5a]: https://github.com/Mikecranesync/MIRA/blob/acd230af009f37f14e72fb9f643a45a28ca9f859/docs/architecture/convergence/CAPABILITY_CLOSURE.yaml
[E5b]: https://github.com/Mikecranesync/MIRA/blob/acd230af009f37f14e72fb9f643a45a28ca9f859/mira-hub/db/proposed/113_asset_observations.sql
[E5c]: https://github.com/Mikecranesync/MIRA/blob/acd230af009f37f14e72fb9f643a45a28ca9f859/docker-compose.staging-vps.yml
[E5d]: https://github.com/Mikecranesync/MIRA/blob/acd230af009f37f14e72fb9f643a45a28ca9f859/docker-compose.saas.yml
[E6]: https://github.com/Mikecranesync/MIRA/blob/7b2518fe4412f3429065d5e26efb131c70b15e00/docs/evals/2026-11-02-codex-cli-level3-findings.md
[E7]: https://github.com/Mikecranesync/MIRA/pull/5062
[E7a]: https://github.com/Mikecranesync/MIRA/pull/5062#issuecomment-6571220132
[E8]: https://github.com/Mikecranesync/MIRA/pull/5173
[E8a]: https://github.com/Mikecranesync/MIRA/pull/5173#issuecomment-6621940634
[E8b]: https://github.com/Mikecranesync/MIRA/blob/482d698913cc1102024e0758256187af6e7d507c/mira-hub/src/factorylm-ui/WorkPacketPanel.tsx
[E8c]: https://github.com/Mikecranesync/MIRA/issues/5175
[E8d]: https://github.com/Mikecranesync/MIRA/issues/5176
[E8e]: https://github.com/Mikecranesync/MIRA/issues/5177
[E9]: https://github.com/Mikecranesync/MIRA/blob/acd230af009f37f14e72fb9f643a45a28ca9f859/mira-hub/src/capabilities/fix-records.ts
[E9a]: https://github.com/Mikecranesync/MIRA/issues/5089
[E9b]: https://github.com/Mikecranesync/MIRA/pull/5033
[E10]: https://github.com/Mikecranesync/MIRA/actions/runs/41835307246
[E10a]: https://github.com/Mikecranesync/MIRA/issues/5180
[E11]: https://github.com/Mikecranesync/MIRA/blob/acd230af009f37f14e72fb9f643a45a28ca9f859/mira-hub/src/app/signup/page.tsx
[E11a]: https://github.com/Mikecranesync/MIRA/pull/4930
[E12]: https://github.com/Mikecranesync/MIRA/blob/809a6877e73dd42385c87b36af27c1663cec8111/docs/product/first-customer-package/PILOT-JOB-RECEIPT.md
[E13]: https://github.com/Mikecranesync/MIRA/blob/809a6877e73dd42385c87b36af27c1663cec8111/docs/product/first-customer-package/CUSTOMER-VALUE-ACCEPTANCE.md
[E13a]: https://github.com/Mikecranesync/MIRA/blob/1f40a8a82f632ce017fba2f32fb5d47923634279/docs/market/hair-on-fire-demand-map.md
[E14]: https://github.com/Mikecranesync/MIRA/issues/5134#issuecomment-6592219503


## November 5, 2026 — readiness reevaluation

**Current judgment: connected maintenance work has advanced; a complete Level 3 customer journey remains unverified.** Work Packet V2, its applicability follow-ups, and the Living Work Sheet are now merged. A fictional staging job has completed the CMMS chain: confirmed request → one order → finish note → completion → independent read-back. C8 therefore advances from **1 to 2 for this bounded CMMS path**. C1–C5 and C7 stay at 2, C6 stays at 1 for complete verified-outcome learning, and C9 stays U. No capability is promoted to Level 3 by this review.

This replaces the November 4 section as the current assessment; both earlier snapshots remain historical. The original maturity definitions, eight pain categories, eleven mandatory journey steps and proposed acceptance thresholds are unchanged. Missing acceptance does not imply missing implementation. Technical staging acceptance, representative human acceptance and production readiness are separate findings.

### Evidence scope and runtime identity

Evidence cutoff: November 5, 2026, 23:15 UTC. The review inspected public repository source, PR/review records, issue updates and existing Actions logs; it did not run a product evaluation or use private customer/CRM data. Core source was inspected at 01a27e9fc11160a81050f3d47965390b9bf4af55; the final main recheck is [3020e45be78b54fb422b362144e58d00e123d8bc][N5-main]. That one-commit advance merges attachment clarity #5228, with no change to the inspected core/schema/workflow files. The worksheet branch before this update is 33ed90ba6df0267b1ee05a76995b32173ad3d171.

| Surface | Exact inspected evidence | What it establishes / limit |
|---|---|---|
| Source main | 3020e45be (core audit at 01a27e9fc); Work Packet V2 merged as 258a4f318; Living Work Sheet as 82b06cbea; applicability follow-ups as 5c41389a9 | Implementation exists on main. A merge alone is not deployed or accepted behavior. [N5-main][N5-v2][N5-sheet][N5-applicability] |
| Last recorded production Hub deployment | [Run 41966843847][N5-prod], job 127046706796; approved/runtime SHA 489088d4cc0f8d16c02036df891752120a0250da; v3.443.1; deployed 2026-11-05 04:23:21Z; built/running Hub image sha256:20f396afb514464601eeaf2bd84f925184d8906a2974c63a2bffaacb4dbf1fbd | Production has advanced since the November 4 chart. This is a deployment receipt, not a fresh live-health read or complete product acceptance. Later main migrations/configuration do not transfer to this deployment. |
| Last recorded staging Hub deployment | [Run 41979537225][N5-stg], job 127086263753; approved/runtime SHA 5b903995dd90b3febe2fc77bee59c7324f6036d7; v3.444.4; built 06:19:17Z, deployed 06:23:17Z; built/running Hub image sha256:576a6849de02af26761404a444b6e26e3fac2d4165ae01f77db542d407b84920 | Includes the newer work and quota-error handling. Physical-client/APK/OTA and representative human acceptance are not supplied by this receipt. |
| Later staging worker deployment | [Run 42010063169][N5-worker], job 127186567719; fd98befc73d8e98fd91f17affb07c02f6d46de2f; v3.444.5; deployed 10:24:39Z; mira-cmms-sync image sha256:4752de14fa3fe2d8496f2be94762d9a57499944caf68fff11cb6809edf43de0f | Worker only: no Hub runtime is recorded in this receipt. Do not call fd98befc the tested Hub revision. Background sync was turned off for the bounded staging recovery. [N5-recovery] |
| Independent staging destination check | [Run 42126595397][N5-readback], job 127592265594, 23:03:52Z; controller main 01a27e9fc; order 1602 COMPLETE, identity true, one create marker, source-job reference true, complete two-page duplicate scan, one finish marker, PASS | Directly inspected log supports one completed fictional staging lifecycle. Earlier separate verify/complete/verify runs and Hub delivery evidence are linked in the [acceptance receipt][N5-atlas-acceptance]. This is not production, phone or human acceptance. |
| Schema and flags | [#5217][N5-migration] promotes 114 and staging-only default-off passthrough. Main still keeps [113 proposed][N5-113]; [registry][N5-registry] records observation state disabled/unset. [#5226][N5-drift] and [#5227][N5-prod-drift] report shared ledger drift; [run 42125228760][N5-dryrun], job 127587587167, is explicitly staging **dry-run**, with apply/post-apply verification skipped. | A green dry-run does not repair drift. [#5218][N5-compat] tracks 113 narrowing 114's outbox types; a newly claimed repair is not merged proof. Establish actual schema and ledger separately, preserve applied 114, then use the authorized migration path. |

Image generation, service, schema, flags, client and source matter together. Historical same-SHA rerank failures are retained below as historical evidence; this review neither transfers them to these new images nor treats new deployment receipts as clearing them.

### Current capability chart

Owners below identify existing workstreams, not new assignments. Where no individual is established, that remains an ownership gap for Mike to resolve. All next actions are proposed validation/repair work; this documentation update performs none of the runtime actions.

| ID / capability | November 4 → November 5 | New evidence and practical limit | Missing proof → smallest next action / existing owner |
|---|---|---|---|
| C1. Know the physical machine | 2 → **2** | Catalog-number retrieval repair #5139 is now merged at head 9d51d12b48194fd9dd1b8237c18abb38e271fadf. V2 applicability handling is stronger. These do not prove the full camera/model/variant/revision path. [N5-catalog][N5-applicability] | One exact candidate must keep confirmed identity through source, packet, state and handover, and reject conflicts; identity/source workstream. |
| C2. Maintain trustworthy engineering knowledge | 2 → **2** | V2 and follow-ups close #5175–#5177 and #5200–#5202, including struck hazard controls, negation and unknown-model coverage. #5208 has exact-head GREEN at d003cbc29ccced641277f9a24e6313e140cb989b. Corpus ingestion and safety scope still need qualification; #5038 remains draft. [N5-v2][N5-applicability][N5-ingest] | Qualify one supported manual/revision, preserving instructions, prerequisites, tables and exclusions on screen and paper; ingestion + Work Packet/safety workstreams. |
| C3. Explain/recommend from evidence | 2 → **2** | #5139 is merged; [#5142](https://github.com/Mikecranesync/MIRA/pull/5142), [#5143](https://github.com/Mikecranesync/MIRA/pull/5143), [#5145](https://github.com/Mikecranesync/MIRA/pull/5145), [#5153](https://github.com/Mikecranesync/MIRA/pull/5153), [#5156](https://github.com/Mikecranesync/MIRA/pull/5156) and [#5161](https://github.com/Mikecranesync/MIRA/pull/5161) remain draft/unmerged at the heads recorded November 4. #5038 has moved to 881671ae73042a7cc8e95476060fa92fb7b09d50, still draft. No inspected new matched-image 30-case representative acceptance replaces the earlier limited results. [N5-catalog][N5-ingest] | Run current candidate through useful-answer/full-source/applicability/safety gates, including the known failures; retrieval/source/safety workstreams. Passing narrow CI rubrics does not substitute for this. |
| C4. Build/use machine state from technician inputs | 2 → **2 infrastructure; offered cycle U** | Living Sheet durable job events/context are new shared infrastructure. Mission 001's asset-observation projection is still separately disabled in the registry, with proposed 113 and compatibility issue #5218. A job event or CMMS completion is not proof of the observation → UNS/state → later answer path. [N5-sheet][N5-registry][N5-compat] | Finish the compatible 113 repair and establish actual schema, then authorized staging adoption and A→restart→B/state/answer trace; Mission 001/integration workstream, Mike for named owner/adoption authority. |
| C5. Prepare/guide useful work | 2 → **2, stronger merged/staging foundation** | V2 final head 135e09f645fa8dc3ab214c15a8abd917472e69f2 was independently reviewed: zero BLOCKER/HIGH, three MEDIUM, subsequently fixed by #5208. Living Sheet adds steps, readings/units, parts, photos, notes and handover. Its PR reports 110 real-Postgres integration tests; final independent review has zero HIGH and two MEDIUM follow-ups. Direct Work Packet→Living Sheet procedure import remains follow-up. [N5-v2-review][N5-applicability][N5-sheet][N5-sheet-review] | Physical phone edit/save/reopen/source/PDF proof at the current revision, followed by a qualified technician completing the supported task; Work Packet + Living Sheet/device workstreams. Earlier 46/46 Pixel proof belongs to older V2 source, not this offered candidate. |
| C6. Remember verified outcomes/improve next job | 1 → **1 complete learning cycle** | Shared sheet records, attributed corrections and handover now exist; staging finish-note read-back is verified. This is stronger recording infrastructure. Main fix-record shape and open #5089 still do not establish automatic later answer reuse of a verified outcome. Finishing an Atlas order does not establish machine restoration. [N5-sheet][N5-readback][N5-fix][N5-reuse] | Record measured before/after or explicit qualified attestation, unsuccessful/uncertain outcomes, and demonstrate appropriate reuse by technician B on a later job; history/state + pilot workstreams. |
| C7. Stay usable beside the machine | 2 → **2** | #4936 home Attach closed with bounded staging browser evidence. November 5 closeout records no physical Pixel for that repair phase. Since that closeout, [#5228][N5-attach] attachment clarity has merged as 3020e45be from head 85a35ddd226be5dfc442df1bcc10c88bf3ebd4ef; its current-head review records PASS. This is source progress, not newer deployed/physical acceptance. New sheet PR explicitly has no Pixel/real-technician run. [N5-closeout][N5-sheet] | Full offered journey on an actual phone, including source page, keyboard/Back, photos, offline recovery and no lost work; shared-UI/device + pilot workstreams. |
| C8. Coordinate actions under permission | 1 → **2 for confirmed CMMS request/finish** | Source confirmation, idempotent outbox and destination read-back now connect to real staging Atlas. Independent check sees exactly one order/finish marker and persisted completion. Production stats recovered per #5205, while this write lifecycle is staging-only. Broader action types remain unverified individually. [N5-atlas-acceptance][N5-readback][N5-cmms-repair] | Current phone/two-technician acceptance, permission/tenant/retry/failure controls, and resolution of #5209 scan ceiling, #5210 permanent-failure recovery, #5216 process collision and #5223 sync/capacity policy; CMMS/Living Sheet workstream, Mike for policy. No OT write/return-to-service authority follows. |
| C9. Demonstrate customer demand | U → **U** | Reviewed new evidence remains fictional/local/automated; #5223 still calls out human acceptance. No completed representative pilot receipt or repeat-job/benefit result was established in this review. This is an evidence gap, not a finding of no demand. [N5-atlas-acceptance][E12] | Observe representative completion, corrections, all-in benefit and voluntary later use; pilot owner, Mike for participants/scope. |

### Eight customer pains: current crosswalk

Original work tags remain planning tags, not maturity scores. These rows update relief evidence without changing the [original acceptance overlay][E13].

| Pain / original tag | Capability / journey | November 5 disposition → next proof / existing owner |
|---|---|---|
| P1. Cited answers from OUR manuals at the machine / FINISH | C1–C3/C7; J3–J6 | Stronger merged catalog/applicability work; complete applicable answer plus full source on the offered phone remains unaccepted → qualify one manual/task and exact generation; identity/retrieval/source owners. [N5-catalog][N5-applicability] |
| P2. Junior/night shift as capable as retiring senior / FINISH | C2–C7/C9; J3–J10 | Packet/sheet support has advanced; no novice-versus-baseline result → observed supported task with mentor rescue recorded, preserving qualifications and authority; pilot/mentor owner. [N5-sheet][N5-atlas-acceptance] |
| P3. Cut recovery time during unplanned downtime / REUSE | C3/C5/C7/C9; J5–J9 | Completed staging software chain is not measured repair time/MTTR → measure all waiting, retries and corrections against comparable manual-only work; pilot owner. |
| P4. Useful branching troubleshooting / FINISH | C2/C3/C5; J5/J6/J8 | Phased procedures and open questions improve work preparation; an accepted changing-input OEM branch is still missing → demonstrate branch conditions and safe fallback on the current build; guided-work/safety owner. [N5-v2][N5-applicability] |
| P5. Nameplate photo → right manual → ask / FINISH | C1–C3/C7; J3–J5 | Retrieval repair does not certify camera-to-answer behavior; unavailable mobile actions now have merged clarity repairs, without new deployed/physical proof → test the complete offered capture route; identity/device owner. [N5-catalog][N5-closeout] |
| P6. Works without ripping out or depending on CMMS / REUSE | C3/C5–C8; J1–J11 | Optional CMMS path is now technically stronger. Standalone value must still work with that connector off → run the supported journey with CMMS off, with honest unavailable-action copy; integration/pilot owner. [N5-sheet] |
| P7. Record fix once; next shift gets guided workflow / CONNECT | C4/C6/C7; J7/J9–J11 | Shared sheets/finish notes advance capture, not verified-fix learning or second-technician acceptance → A records evidence/result, B recovers it after restart and receives appropriate guidance; history/state/pilot owner. [N5-sheet][N5-reuse] |
| P8. Answers when cell service drops / BUILD | C6/C7; J2/J4/J11 | Offline sheet queue exists, but open #5212 can lose a rejected queued note after navigation; #5033 reload-safe fix remains draft. Full offline manuals/Q&A are still separately unverified → persist/recover rejected writes, prove reconnect/reload exactly once; mobile/recovery owner. [N5-offline][E9b] |

### Eleven mandatory journey steps: current disposition

No row below is certified as a complete representative offered-build pass. Local/staging partial proof is credited where present; mandatory J7/J9/J10 cannot be replaced by a successful CMMS order.

| Journey | Capability / pain | Current evidence, remaining proof → next action / existing owner |
|---|---|---|
| J1. Offer/access/approval/crew invite | C9; P6 | Main still says 7-day trial; planned 30-day pilot/versioned consent remains unreconciled and #4930 draft → align approved offer, consent, seats and access on the candidate; intake owner + Mike. [N5-signup][E11a] |
| J2. Sign in/HOME/Project/thread | C7; P6/P8 | #4936 staging browser proof is bounded; project continuity policy and physical same-thread/cold-restart proof remain → verify web/native continuity without rescue; shared-UI/device owner. [N5-closeout] |
| J3. Identify machine/component | C1; P1/P5 | #5139 merged and V2 applicability strengthened → prove exact machine/variant/manual through the whole job, including mismatch/tenant controls; identity owner. [N5-catalog][N5-applicability] |
| J4. Add manual/photo evidence | C1/C2/C7; P1/P5/P8 | Sheet photo/event infrastructure exists; #5038 ingest repair still draft, camera acceptance absent → known passage searchable/openable, capture/cancel/failure/retry honest; ingestion/device owners. [N5-sheet][N5-ingest] |
| J5. Ask/open source | C3/C7; P1–P5 | New images deployed; no inspected matching representative source-opening result → answer plus full correct supporting source at exact generation; retrieval/source owner. |
| J6. Safety information | C2/C3; P1–P4 | [Struck JHA controls repaired within V2][N5-jha]; safety-answer drafts still unmerged → verify complete OEM conditions, exclusions and safety controls live/reloaded/on paper; safety owner. [N5-v2] |
| J7. Observation→machine state | C4; P2/P7 | 113 proposed/flag disabled, #5218 compatibility repair newly claimed → repair, authorize adoption, then confirm→durable event/state→later answer with original symptom/conflicts; state/integration owner. [N5-registry][N5-compat] |
| J8. Prepare/edit/save Work Packet | C5; P1–P4/P6 | V2/follow-ups and Living Sheet merged; procedure import still follow-up → current phone edit/reopen/PDF/source and supported-task acceptance; packet/sheet/device owners. [N5-v2][N5-applicability][N5-sheet] |
| J9. Record work/verify result | C6; P2/P3/P6/P7 | Staging finish note and CMMS completion read back; actual verified maintenance outcome not established → before/after or qualified attestation, including failed/unverified work; outcome/pilot owner. [N5-readback][N5-fix] |
| J10. Later return/technician B | C4/C6/C7; P2/P6/P7 | Shared handover structures exist; no inspected real two-technician result → restart, B recovers facts/edits/open questions without private-thread leakage and uses the result appropriately; history/state/pilot owner. [N5-atlas-acceptance] |
| J11. Retry/recover/sign out/pilot end | C6–C9; P6/P7/P8 | Quota retry uses same delivery; one real recovery read back. Offline rejection loss, 500-order scan ceiling, permanent-failure recovery and consent/expiry proof remain → targeted failure/reload/sign-out tests and current phone acceptance; mobile/CMMS/access owners. [N5-quota][N5-offline][N5-scan][N5-permanent] |

### What blocks the next readiness increase

1. **Protect captured work and establish shared state.** Existing Living Sheet/state owners address #5212 and the 113/114 compatibility/adoption gap. Preserve rejected payloads across navigation/reload; prove one observation changes only justified asset state and informs later recall. The new staging dry-run is planning evidence, not an applied migration.
2. **Freeze one supported end-to-end candidate.** Existing integration/device owners identify Hub image, schema/ledger, flags, client/APK/OTA, manual/model/revision and task. Reproduce source-opening, packet/PDF, permissions, restart and A→B handover on the real phone. Keep CMMS optional; if included, retain independent destination read-back and isolate sync/capacity policy. #5216 and #5223 remain scoped operational limitations, not solved by the one successful staging job.
3. **Run representative acceptance and measure benefit.** Pilot owner/Mike select representative technicians and qualified scope. Retain the original **proposed**, not newly approved, bars: at least 30 distinct cases, 90% supporting citations, 80% useful grounded answers, 4/5 technicians without rescue, 3/5 with measured benefit, zero critical safety/identity/tenant/privacy/state-integrity failures, and no unresolved BLOCKER/HIGH on the offered path. Do not average away a failed mandatory journey step. Level 4's repeat use remains a separate proposed gate.

No measured productivity, reduced downtime, novice equivalence, planner replacement, customer demand, safe machine restoration or complete offline reasoning is inferred from merges, test counts or an Atlas order. Qualified people retain work and return-to-service authority.

### Documentation verification boundary

This addition uses evidence already present in this public repository. The November 1 baseline, November 4 snapshot and original Level 3 plan/criteria are retained. Only the benchmark and this PR's description are updated; the unrelated local North Star branch is not involved. Current automatic-review/evaluation/deploy workflow scopes were inspected before publication: documentation paths exclude automatic model review/DeepEval, staging cloud evaluation is scope-gated off, and deployment requires a separate manual dispatch. Documentation CI may run; it is not product acceptance. No product code, flag, database, issue state, release or review request is changed by this assessment.

[N5-main]: https://github.com/Mikecranesync/MIRA/commit/3020e45be78b54fb422b362144e58d00e123d8bc
[N5-prod]: https://github.com/Mikecranesync/MIRA/actions/runs/41966843847
[N5-stg]: https://github.com/Mikecranesync/MIRA/actions/runs/41979537225
[N5-worker]: https://github.com/Mikecranesync/MIRA/actions/runs/42010063169
[N5-readback]: https://github.com/Mikecranesync/MIRA/actions/runs/42126595397
[N5-atlas-acceptance]: https://github.com/Mikecranesync/MIRA/issues/5223#issuecomment-6659904675
[N5-recovery]: https://github.com/Mikecranesync/MIRA/issues/5223#issuecomment-6655663001
[N5-v2]: https://github.com/Mikecranesync/MIRA/pull/5173
[N5-v2-review]: https://github.com/Mikecranesync/MIRA/pull/5173#issuecomment-6647431344
[N5-applicability]: https://github.com/Mikecranesync/MIRA/pull/5208#issuecomment-6648596693
[N5-sheet]: https://github.com/Mikecranesync/MIRA/pull/5207
[N5-sheet-review]: https://github.com/Mikecranesync/MIRA/pull/5207#issuecomment-6648838573
[N5-migration]: https://github.com/Mikecranesync/MIRA/pull/5217
[N5-113]: https://github.com/Mikecranesync/MIRA/blob/01a27e9fc11160a81050f3d47965390b9bf4af55/mira-hub/db/proposed/113_asset_observations.sql
[N5-registry]: https://github.com/Mikecranesync/MIRA/blob/01a27e9fc11160a81050f3d47965390b9bf4af55/docs/architecture/convergence/CAPABILITY_CLOSURE.yaml
[N5-compat]: https://github.com/Mikecranesync/MIRA/issues/5218#issuecomment-6671867555
[N5-drift]: https://github.com/Mikecranesync/MIRA/issues/5226
[N5-dryrun]: https://github.com/Mikecranesync/MIRA/actions/runs/42125228760
[N5-catalog]: https://github.com/Mikecranesync/MIRA/pull/5139
[N5-ingest]: https://github.com/Mikecranesync/MIRA/pull/5038
[N5-fix]: https://github.com/Mikecranesync/MIRA/blob/01a27e9fc11160a81050f3d47965390b9bf4af55/mira-hub/src/capabilities/fix-records.ts
[N5-reuse]: https://github.com/Mikecranesync/MIRA/issues/5089
[N5-closeout]: https://github.com/Mikecranesync/MIRA/blob/9f78377800910732153a4d0509480b0df9cc1ed6/docs/evals/2026-11-05-codex-cli-closeout.md
[N5-cmms-repair]: https://github.com/Mikecranesync/MIRA/issues/5205#issuecomment-6649637516
[N5-offline]: https://github.com/Mikecranesync/MIRA/issues/5212
[N5-scan]: https://github.com/Mikecranesync/MIRA/issues/5209
[N5-permanent]: https://github.com/Mikecranesync/MIRA/issues/5210
[N5-quota]: https://github.com/Mikecranesync/MIRA/pull/5222
[N5-signup]: https://github.com/Mikecranesync/MIRA/blob/01a27e9fc11160a81050f3d47965390b9bf4af55/mira-hub/src/app/signup/page.tsx
[N5-prod-drift]: https://github.com/Mikecranesync/MIRA/issues/5227
[N5-jha]: https://github.com/Mikecranesync/MIRA/blob/01a27e9fc11160a81050f3d47965390b9bf4af55/mira-hub/src/factorylm-ui/WorkPacketV2Sections.tsx
[N5-attach]: https://github.com/Mikecranesync/MIRA/pull/5228
[N5-attach-review]: https://github.com/Mikecranesync/MIRA/pull/5228#issuecomment-6671825575

