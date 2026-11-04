> **Current refresh:** see [November 4, 2026 — current capability and customer-readiness worksheet](#november-4-2026--current-capability-and-customer-readiness-worksheet). The original November 1 baseline below is preserved; the implementation plan's proposed Level 3 criteria are unchanged.

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

