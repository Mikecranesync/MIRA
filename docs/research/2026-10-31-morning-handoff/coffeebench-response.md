# From Simulated Diagnosis to Evidence Grounded Technician Decisions

## A practitioner response to CoffeeBench

Prepared for Mike Harper / FactoryLM\
AI-assisted discussion draft; author review pending | 31 October 2026\
Public-safe version adapted from a private draft; intellectual content preserved.

### Abstract

A useful maintenance assistant should help a technician reach a correct, safe, source-supported next decision faster than the technician can without it, repeatedly on unfamiliar cases. This response to CoffeeBench proposes an evaluation centered on that outcome. Success requires a justified terminal decision under incomplete evidence. Intermediate evidence requests are evaluated for their usefulness, while an appropriate escalation can count as a successful outcome. We describe a proposed MIRA interviewer that maintains an explicit case ledger, asks for evidence within site controls, and audits the support for each consequential recommendation. We then specify a preregistrable comparison of manual-only work, retrieval-augmented assistance, a stateful interviewer, and an interviewer with an evidence audit. Cases reveal information incrementally and include ambiguity, unfamiliar faults, conflicting records, and multiple faults. The evaluation separates severe errors from speed, measures source support and appropriate abstention, and tests the human-assistant team rather than treating persuasive explanations as proof. This is a design and study proposal. It reports no original experiments and establishes no reliability or safety claim for MIRA.

### 1 Purpose and claim boundary

The practical question behind MIRA is straightforward: can an assistant help a technician make the next sound decision when the machine is unfamiliar and the initial account is incomplete? A useful answer might identify the applicable manual, expose a contradiction, or recommend stopping the investigation until the right expertise is available. A confident component name is only useful when the evidence and the decision it supports are sound.

I propose evaluating this question directly. The contribution of this response is a decision contract and an incremental-evidence study design that researchers and maintenance practitioners could implement together. The proposed endpoint makes evidence acquisition, source applicability, and justified stopping observable. It is intended as a complement to controlled diagnostic research, not a claim that one evaluation can replace all others.

Throughout this paper, MIRA names a proposed technician-facing interviewer and the intended direction of FactoryLM's work. No deployed capability has been verified for this paper. Architecture descriptions are requirements to build and test, not a description of a validated product. The paper makes no claim of 90 percent reliability, certification, autonomous maintenance competence, or readiness for unsupervised use. Proposed studies would begin with recorded cases and controlled exercises, not interventions on operating equipment.

The intended audience is researchers studying diagnostic agents and practitioners responsible for maintenance decisions. The proposed collaboration would ask both groups to agree on what counts as a defensible next decision before evaluating a model.

<!-- pagebreak -->

### 2 CoffeeBench context and the transfer question

McCabe, Lukens, and Huang evaluate 12 agent models on a simulated appliance with nine faults, eight sensors, four actions, and episodes limited to ten turns. Incorrect guesses receive explicit rejection feedback. The highest reported first-try accuracy is 61.1 percent. Explicit state tracking reduces timeouts among the evaluated open-weight models. A separate deliberation procedure uses a GPT-4.1 judge; its 87.5 soundness threshold is selected with Youden's J, not calibrated as a probability of correctness. Submission occurs by the tenth total turn of that procedure even without meeting the threshold. Unknown faults outside the closed set are not evaluated. The authors explicitly place physical-appliance use outside their intended scope and warn of potential damage. [1] The study therefore provides a bounded research setting; the proposal below extends that scope rather than disputing a deployment claim.

The question proposed here is whether a human-assistant team can acquire enough appropriate evidence to make a defensible next decision, without access to an answer key. This is a different estimand: the quantity a study is intended to measure. It concerns the team's decisions under a specified information policy, including decisions to withhold a diagnosis. The proposal does not require a particular model family or assume that more elaborate reasoning will improve performance.

#### Four boundaries to test explicitly

**Applicability.** A technically correct statement about a related asset may be wrong for the machine in front of the technician. The evaluation should make asset identity, configuration, and document revision part of the problem. Missing identity should remain an unknown rather than being silently filled from a familiar example.

**Observability.** A technician's description, a recorded measurement, and a model-generated inference have different evidential status. The study should test whether the assistant notices that difference, requests the missing context, and avoids treating an unobserved condition as a fact.

**Actionability.** A diagnosis and a permissible next step are separate judgments. Even a plausible diagnosis may not justify a requested check when qualifications, isolation status, or an applicable procedure are missing. A safe decision may therefore require escalation before diagnostic uncertainty is resolved.

**Human reliance.** The outcome depends on what the technician accepts, rejects, and verifies. In their studied decision tasks, Bansal and colleagues found that explanations increased acceptance of AI recommendations without improving complementary team performance. [3] That finding motivates measuring reliance in the proposed study; it is not evidence about industrial technicians or MIRA.

#### Position relative to adjacent evaluation work

Lukens and colleagues compare technical-manual retrieval and generative approaches using chat-style and label-constrained fault-code tasks. Their results show that the evaluation task can change the apparent value of the system configuration. [2] The present proposal extends the evaluation target to the sequence of evidence requests and human decisions. It retains a strong retrieval baseline so that dialogue complexity must earn its cost rather than being presumed beneficial.

<!-- pagebreak -->

### 3 A proposed interviewer with an explicit case ledger

The proposed interviewer should keep a compact, inspectable record of the case. Conversation history alone is an inconvenient audit trail: statements can be repeated, corrected, or contradicted without an obvious change in their status. A structured ledger would make those changes visible to the technician and to the evaluator. It would retain raw observations as well as normalized fields, so that interpretation does not replace evidence.

| Ledger field | Required content |
|---|---|
| Asset and applicability | Asset identifier, model, configuration, applicable document revision, and unresolved identity conflicts |
| Observations | Reported or measured value, units, time, operating context, observer, and evidence identifier |
| Source provenance | Document identifier and revision, page or section, relevant passage, retrieval time, and access basis |
| Hypotheses | Candidate explanations, supporting and contradicting evidence, and untested alternatives |
| Unknowns and conflicts | Missing facts, inconsistent reports, stale readings, and unresolved source disagreements |
| Decision history | Requested evidence, technician response, unavailable checks, revised claims, and reason for stopping |

A proposed processing cycle has five stages. First, the assistant reconciles identity and records the initial complaint without converting it into a diagnosis. Second, it retrieves applicable material and checks whether the source actually covers the asset and condition. Third, it proposes the smallest useful next evidence request. Fourth, a separate audit checks the proposed response against the ledger and sources. Fifth, the technician receives an answer, an evidence request, or an escalation recommendation with its stated basis.

Evidence requests should explain what uncertainty they address. The assistant should prefer a low-burden observation that separates plausible explanations over repeatedly asking for material already available. It should also accept that the answer may be unavailable. The inability to obtain a measurement is part of the case, not permission to invent it. Ranking requests by expected information value is a design hypothesis to test; the system should not display numerical information-gain estimates unless their meaning and estimation method have been validated.

A proposed audit would check factual support, source applicability, contradictions, and action boundaries separately. It would flag an inference presented as an observation, a claim supported only by a mismatched manual, or a proposed check lacking required preconditions. A second model could assist with this work, but agreement between models would not be treated as independent confirmation. Deterministic identity checks and technician adjudication remain necessary.

ALCE distinguishes answer correctness from citation quality in evaluating generated text. [4] For this design, a citation must support the particular claim and apply to the identified asset; merely attaching a document link is insufficient. The audit should preserve a trace from each consequential statement to its evidence, and explicitly mark statements that remain hypotheses.

<!-- pagebreak -->

### 4 The decision contract and its safety boundary

Every response should make its decision type explicit. **Answer** means that the available evidence supports a bounded conclusion or a specific permitted next decision. **Ask** means that a particular missing observation could change the decision and is appropriate to request. **Escalate** means that the evidence, authority, or safe access needed to continue is unavailable. An escalation should identify the unresolved issue and the appropriate role or procedure, rather than ending with a generic warning.

The assistant should distinguish a technician's report from a recommendation to perform new work. It may ask whether an already documented inspection or approved measurement is available. It must not treat conversational agreement as authorization for energized testing, defeating an interlock, bypassing a safeguard, or operating equipment. Any physical check remains subject to qualified human judgment, approved procedures, and site controls. This paper provides no executable maintenance instructions and proposes no autonomous actuation.

#### Illustrative case rather than an observed result

Consider a fictional case packet in which a technician reports intermittent shutdowns, supplies a photograph of an identification plate, and attaches a manual for a related revision. A work-order note describes a recent replacement, while an older note attributes a similar symptom to a different component. The case initially lacks confirmation that either note concerns the current configuration.

A defensible first response would record the symptom as reported, flag the revision mismatch, and request the current asset record or applicable documentation if available. It would not convert the older repair note into the present diagnosis. If the records remain inconsistent, the appropriate outcome may be referral to the person responsible for configuration documentation. If the case later supplies an applicable procedure and verified observations, the assistant can update its hypotheses and identify a supported next decision within that procedure.

The evaluation would score whether the assistant noticed the mismatch, preserved the uncertainty, and made an appropriate evidence request. It would not reward the assistant for guessing the hidden component before establishing the source's applicability. This example illustrates the proposed scoring logic; it is neither a FactoryLM deployment record nor evidence that MIRA behaves this way.

#### Provenance and data controls

Document ingestion should preserve version identifiers, relevant page images, and extraction warnings where tables or diagrams may have been misread. Retrieved material and uploaded files should be treated as evidence, not as authority to change the assistant's operating rules. Instructions embedded in a document must not authorize tool use or data disclosure.

A study should use only materials the participants and investigators are authorized to use. Restricted employer records, customer identifiers, and sealed evaluation content must not be sent to external model services without the necessary authorization. Data access, retention, redaction, and model-provider settings should be specified before collection. An inability to share raw cases need not prevent publication of the protocol, aggregate results, or independently constructed examples.

<!-- pagebreak -->

### 5 A preregistrable incremental evidence evaluation

The proposed first study is a feasibility pilot, followed by a separately planned confirmatory study if the procedure proves usable. Its purpose is to test whether cases can be adjudicated consistently, whether evidence requests can be scored, and whether the intended comparisons are operationally fair. It is not powered to establish rare-event safety or field reliability.

#### Cases and a sealed test split

A concrete pilot design would use 24 development cases from four machine families and 48 sealed test cases from six different families. These are proposed design values, not collected data. Development would establish the interface, evidence catalog, rubric, and time budget. Before the sealed phase, investigators would freeze the software, prompts, retrieval settings, decision rules, and analysis plan. Any later modification would define a new evaluated version.

Splitting must occur at the machine-family and source-manual lineage level, not by randomly separating questions. A translated manual, a revised edition with near-identical procedures, and a paraphrased case can preserve the same answer structure. The split audit should therefore group related documents and case derivatives together. Test-family manuals may be supplied through the authorized retrieval corpus at evaluation time, but test cases, answers, and adjudication notes must remain inaccessible to developers and systems. Exposure to general model pretraining cannot be fully ruled out and should be disclosed.

The test set should deliberately include straightforward single-fault cases, ambiguous or insufficient-evidence cases, faults absent from the candidate library, multiple simultaneous faults, no-fault conditions, and conflicting records. These categories may overlap. Their quotas and scoring rules should be fixed before the sealed phase. Investigators should report both the composition of this challenge set and its limits; it would not represent the prevalence of conditions in an operating fleet.

#### Evidence packets and reference decisions

Each case should have an initial complaint and a catalog of evidence packets available only when appropriately requested. Packets could contain records, authorized observations, source excerpts, or a response that the requested information is unavailable. In a recorded-case pilot, no participant performs the physical check. A frozen request-to-packet mapping, with a blinded moderator resolving unmatched requests under a written rule, prevents one condition from receiving more helpful information than another.

At least two qualified technicians independent of the system's development should establish acceptable decisions at each evidence state, with a third adjudicator for disagreements. The reference should allow several defensible requests or conclusions where appropriate. It should identify prohibited recommendations, required escalation conditions, and the evidence needed to justify a diagnosis. Cases without a defensible reference should be revised during development or excluded under a predefined rule, with exclusions reported.

The assistant receives observations and packet responses, never feedback that its diagnosis is right or wrong. Evidence requests are intermediate steps, not successful endpoints. A terminal deferral counts as defensible only when preadjudicated as appropriate at that evidence state and further information is outside the packet scope. The episode ends at a committed decision, justified deferral or escalation, or the fixed budget. A proposed budget is 12 minutes and six new evidence packets per encounter. A budget limit permits unresolved escalation; it never forces an unsupported diagnosis.

<!-- pagebreak -->

### 6 Comparisons and participant assignment

The primary comparison should concern technicians using assistance, because that is the intended workflow. Four conditions would share the same cases, permissible evidence catalog, source corpus, and encounter budget. Model versions and inference settings would be held constant wherever possible.

| Condition | Resources and behavior | Comparison purpose |
|---|---|---|
| A Manual only | Technician with the same authorized manuals and search interface, without generated advice | Establish the human baseline |
| B Current RAG baseline | Technician with a frozen retrieval-augmented chat implementation, without the proposed ledger or audit | Test benefit beyond ordinary retrieval assistance |
| C Interviewer and ledger | Condition B plus explicit case state and structured evidence requests | Isolate the proposed interviewing layer |
| D Interviewer and audit | Condition C plus the evidence and decision audit | Estimate the audit's incremental value |

“Current RAG” means the implementation actually available and frozen when the study starts, not an assumed description of MIRA today. If no such implementation exists, investigators should build and document a simple retrieval baseline rather than inventing a production comparator. Each condition should receive an equivalent orientation. The manual-only interface must remain usable; a deliberately weak baseline would not answer the practical question.

A proposed pilot would recruit 12 qualified technicians, each completing 24 encounters, six per condition. This yields 288 technician-case encounters across 48 sealed cases, or six observations per case overall. A balanced incomplete-block assignment would allocate each case once or twice per condition, balancing those allocations across cases and counterbalancing condition order. No participant would see the same case or a near-duplicate under another condition. Prior machine-family familiarity and relevant experience would be recorded, with allocation rules fixed in advance.

The design should separate the assistant's recommendation from the technician's final decision. The interface would record recommendations shown, evidence opened, revisions, and the final choice. Brief post-encounter questions would ask what evidence changed the participant's view and whether the assistant was followed. These responses can explain failure modes but should not replace independently scored outcomes.

An offline assistant-only arm can help identify whether team errors arise before or after human review. It is a secondary diagnostic comparison, not authorization for autonomous operation. Its outputs should not enter participant sessions or influence reference adjudication. Human reviewers should be blinded to condition where transcript formatting permits, while acknowledging that some dialogue features may reveal it.

The fixed budgets should account for retrieval and model latency as experienced by the participant. Report token use, service cost, and waiting time separately. A more elaborate system that succeeds only with substantially more computation or technician effort should make that tradeoff visible. Repeated model runs may estimate stochastic variability, but they do not create additional independent machines, cases, or technicians.

<!-- pagebreak -->

### 7 Outcomes and analysis without a reliability shortcut

The primary outcome should be the proportion of encounters ending in a defensible next decision within budget. A defensible decision must satisfy the reference rubric for correctness, applicable source support, and action boundaries. An appropriate escalation can count as successful; an unjustified refusal cannot. Investigators should also report the components separately so that a composite result does not hide weak source support or excessive deferral.

**Severe errors require a separate endpoint.** The rubric should distinguish an incorrect hypothesis from a recommendation that crosses a prohibited safety or authority boundary. Record such recommendations whenever they occur, even if the technician rejects them or a later response corrects them. Also record severe errors in final human decisions. Faster completion must not compensate for these events in a combined score. Any observed severe recommendation should trigger independent case review before progression to live work; absence of observed events in a small pilot does not establish safety.

**Time must include unsuccessful work.** Report the fraction of encounters reaching a defensible decision by each elapsed time, alongside unresolved and incorrect terminal outcomes. An early wrong decision remains a failure through the full budget; it is not censored as if success might follow. A secondary failure-penalized time measure can assign the full 12 minutes to every unsuccessful encounter and actual time to successful encounters. Label that convention explicitly. Successful-only times are descriptive and cannot establish overall efficiency. Count evidence requests, repeated requests, and technician review effort as additional burden measures.

**Source support must be adjudicated.** Report the fraction of consequential claims with an applicable supporting source, the fraction contradicted by available evidence, and the rate of unresolved identity or revision mismatches. Measure appropriate escalation on cases that require it and unnecessary escalation on cases with sufficient evidence. Log failures to update after contradictory information rather than scoring only the final polished response.

Selective classification treats error among answered cases and the fraction of cases answered as linked quantities. [5] The proposed study should therefore report diagnostic coverage alongside error rates on committed diagnoses, plus a distinct rate for appropriate non-diagnostic decisions. If a confidence score is used, its decision rule must be fitted only on development data and frozen. Empirical calibration on held-out cases, with uncertainty bounds and sample counts, matters more than the model's verbal assurance.

The analysis plan should identify the primary D-versus-A comparison and the component comparisons C-versus-B and D-versus-C. Estimate condition differences with intervals accounting for repeated observations by technician and case, while explicitly limiting generalization from the small number of machine families. Report family-level and case-type breakdowns without treating underpowered subgroup differences as established effects. Missing sessions, service failures, exclusions, multiplicity, and sensitivity analyses should be specified before unsealing. A statistician should review the model and any later confirmatory sample-size calculation.

A pilot can reveal an unusable protocol or a promising effect estimate. It cannot support a broad reliability percentage simply by pooling repeated calls or excluding abstentions. Any later performance claim must name the evaluated population, decision type, coverage, uncertainty, and system version.

<!-- pagebreak -->

### 8 Limitations and a concrete collaboration proposal

Recorded cases cannot reproduce every interruption, communication failure, or consequence of physical maintenance. Expert-authored packets may make relevant evidence easier to obtain than it is in practice. Adjudicators can disagree, and a small set of machine families will not establish transfer to other industries. Neither citations nor an additional audit model guarantee correctness. These limits should guide the next study rather than disappear into a product claim.

The next useful collaboration would be to agree on the decision rubric, construct a small authorized development set, and test whether independent technicians can apply the rubric consistently. A subsequent sealed pilot could compare the four conditions and publish negative results as well as improvements. Only after those steps should a separate, explicitly authorized study consider supervised use in an operational setting.

I would propose sharing the case schema, evidence-request interface, scoring rules, and analysis plan with the CoffeeBench authors and interested maintenance researchers. That is a proposed invitation, not an existing partnership or a commitment of access, funding, or data. Restricted employer materials and sealed test cases would remain protected. The immediate shared question is measurable: does the proposed interviewer improve the technician's next decision enough to justify its additional interaction and review cost?

### References

[1] McCabe, L. H., Lukens, S., and Huang, H. H. (2026). *Can LLM Agents Efficiently Identify Appliance Faults? Insights From Diagnosing a Simulated Appliance.* arXiv:2610.19291v1. https://arxiv.org/html/2610.19291v1

[2] Lukens, S., Bishof, M., Siddiqui, N., and West, D. (2025). *An Evaluation Framework for Fault Diagnosis Using Technical Manuals in Retrieval-Augmented LLMs.* Annual Conference of the Prognostics and Health Management Society. https://www.papers.phmsociety.org/index.php/phmconf/article/download/4549/phmc_25_4549

[3] Bansal, G., Wu, T., Zhou, J., Fok, R., Nushi, B., Kamar, E., Ribeiro, M. T., and Weld, D. S. (2021). *Does the Whole Exceed its Parts? The Effect of AI Explanations on Complementary Team Performance.* CHI. https://doi.org/10.1145/3411764.3445717

[4] Gao, T., Yen, H., Yu, J., and Chen, D. (2023). *Enabling Large Language Models to Generate Text with Citations.* EMNLP, 6465–6488. https://aclanthology.org/2023.emnlp-main.398/

[5] Geifman, Y., and El-Yaniv, R. (2017). *Selective Classification for Deep Neural Networks.* Advances in Neural Information Processing Systems, 30. https://arxiv.org/abs/1705.08500

### Author review and AI assistance disclosure

This discussion draft was prepared with AI assistance for literature lookup, organization, prose, and document production at Mike Harper's request. Mike Harper has not yet reviewed or approved the wording, proposed study values, or attribution of the position to him. No original experiment was conducted for this paper. It has not been submitted to a journal or conference; it is included here as an informational discussion draft, not an approved author position. This public-safe version adapts the private draft's publication framing while preserving its intellectual content. Author review, source verification, and agreement on the proposed protocol are required before representing it as an approved position, submitting it for publication, or initiating the proposed study.
