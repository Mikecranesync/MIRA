# Maintenance Compiler research: primary-source addendum (2026-10-18)

**Companion to:** `2026-10-18-atomic-machines-decision-package.md` (PR #4495). **Mode:** read-only research. No code, repo, PR or infrastructure was touched.
**Method:** four research streams (Atomic Machines primary sources, standards prior art, product landscape, baseline metrics). Each stream was followed by an independent agent that re-fetched every cited URL and tried to refute the claim. The orchestrating session then reviewed the result by hand against the raw agent output (workflow run `wf_a612079e-a60`).
**Labels:** **FACT** means read in a fetched source and confirmed by the second agent. **INFERENCE** means it follows from facts but no source states it. **UNVERIFIED** means the source could not be fetched or did not contain the claim.
**Limits:** many vendor pages were marketing, aggregators (explainx.ai, glitchwire, runtimewire) or behind 403/404/CAPTCHA. No paywalled standard text (ISA-88, S1000D, IEEE 1232, IEC 60812) was read; the standards findings come from public summaries and vendor explainers.

---

## 1. What changes in the decision package

| Package § | Change | Basis |
|---|---|---|
| §1 table, "No per-product tooling" | **Confirmed as already stated.** The package already marked this "contradicted in part" by the NYT detail. A second outlet repeats it: "engineers still move parts between its 13 machines and help assemble the final device" (Interesting Engineering, citing Cade Metz/NYT). | FACT |
| §1 table, PrimeSwitch specs | **Confirmed, with Wevolver's caveat kept.** 150 A, 200 µΩ, 9.5 × 3 mm. The 50 µs opening time depends on fault-current rise rate. | FACT (company claim, via Wevolver) |
| §1 table, funding | **Refined.** $250M; the investor list also includes Tru Arrow Partners and Construct Capital (dealroom.co/news/160613). | FACT |
| §1 table, patents | **Partly confirmed.** US 12,469,659 ("Microelectromechanical systems power relay") and US 12,272,912 ("Electrical contacts using an array of micromachined flexures") are confirmed as assigned to Atomic Machines, Inc. in the USPTO Official Gazette. **US 12,451,309 and WO/2024/220292 could not be confirmed.** No patent was found on a compiler, planner, process library or metrology loop. | FACT / UNVERIFIED |
| §1, "Amazon's tenth engineer" | **Unverified.** Only a 2018 YourStory profile ("engineer #10") says so, and the checking agent could not confirm it. Non-load-bearing. | UNVERIFIED |
| §1, demo / independent test data | **Still not found.** No public fab demonstration and no third-party PrimeSwitch measurement. | FACT (absence, as of 2026-10-18) |
| §4.3, AssetOpsBench "~65%" | **Downgrade to UNVERIFIED.** The arXiv 2506.03828 abstract does not contain the 65% figure, and the review page was rate-limited. The package cites it as external evidence, so its §4.3 sentence should say "reported" until the full paper is read. | UNVERIFIED |
| §4.2, diagnosis share of MTTR | **Widen the range.** Published splits run from about 30% to 80% of MTTR for diagnosis, depending on source and method. See §4. | FACT (range) / INFERENCE (bound) |
| §5.1, outcome enum | **No standard defines this exact enum, and no vendor documents one.** The closest precedents are listed in §2. A `PASS_WARNING` style outcome has real precedent: the HL7 FHIR TestReport `action.result` is `pass, fail, warning, error, skip`. | FACT (FHIR) / INFERENCE (mapping) |

---

## 2. Action-contract prior art

| Source | What it actually defines | Fit with MIRA's proposed contract | Label |
|---|---|---|---|
| ISA-88 / IEC 61512 (via SepaSOFT, PLC Academy) | Phase state machine (Idle, Running, Complete, Held, Paused, Stopped, Aborted) and commands. Recipe (procedure) separated from equipment control. | Complete is close to PASS and Held close to BLOCKED. Aborted is **not** FAIL: it means stopped abnormally, not a diagnostic result. The useful borrowing is the recipe/equipment split (template is data, executor is separate). | FACT (summary sources) / INFERENCE (mapping) |
| ISA-106 (ISA InTech) | Extends procedural automation to continuous processes (startup, shutdown, abnormal situations). | Supports "procedures as data". The three-model detail could not be confirmed. | FACT (existence) / UNVERIFIED (detail) |
| ISO 14224 (fabrico.io, Oxmaint) | Failure mode / cause / mechanism taxonomy; equipment hierarchy. | **Borrow directly.** A FAIL outcome should carry `failure_mode` (and cause where known) so results can be trended across assets. | FACT |
| HL7 FHIR TestReport | `action.result` ∈ pass, fail, warning, error, skip. No "inconclusive". | Precedent for a passed-with-flags outcome and for `skip` (close to BLOCKED). It does **not** support INCONCLUSIVE, which stays MIRA's own term. | FACT |
| IETF RATS (draft-sokolov-rats-aep-composition; draft-ietf-rats-evidence-trans) | Remote attestation of computing platforms. Attester / Verifier / Relying Party roles; trustworthiness tiers None, Affirming, Warning, Contraindicated. | **Analogy only, not a domain standard.** The role split (who measured, who judged, who acts) lines up with MIRA's `verification` class (`machine`, `self_reported`, `attested`). Don't adopt its tier vocabulary. | FACT (draft content) / INFERENCE (relevance) |
| IEEE 1636 SIMICA | Interoperable schemas for test results and maintenance information. | Worth reading if MIRA ever exports step records. Not needed for the pilot. | FACT (existence) |
| S1000D | Procedural and fault-isolation data modules exist. | The specific fault classification names claimed by the research agent were **not** found in an accessible source. | FACT (modules) / UNVERIFIED (classes) |
| ATA MSG-3 | Consequence-of-failure decision logic for task selection. | Task-outcome detail not in the accessible source. | UNVERIFIED (detail) |
| IEEE 1232 AI-ESTATE, IEC 60812, IEC 61025 | Diagnostic-model exchange; FMEA; fault tree analysis. | Cited sources were 404 (IEEE 1232, IEC 60812) or did not cite the standard (IEC 61025). Read the standard text before claiming alignment. | UNVERIFIED |
| UNSAFE as an outcome | Not found as a step outcome in any source checked. Safety appears instead as FMEA severity gates and ISA-88 abort semantics. | MIRA's UNSAFE is new. It should end the plan and hand off to the existing safety path, not loop. | INFERENCE |

**What the evidence supports for decision 4 (input only, not a decision):** keep the five outcomes. Optionally add a passed-with-flags outcome on the FHIR `warning` precedent. Require `failure_mode` on FAIL (ISO 14224) and `reason` on BLOCKED/UNSAFE. Keep `verification` as a separate field and don't fold it into the outcome. The IETF RATS role split is the clearest argument for that separation.

---

## 3. Product landscape

| Vendor | What the checked source shows | Evidence quality |
|---|---|---|
| Augmentir, Tulip | Connected-worker guided procedures, checklists, AI assistance. | Vendor pages, confirmed |
| Siemens Industrial Copilot | Generative AI for maintenance guidance. | Vendor claim, confirmed as stated |
| ALLDATA | Structured OEM repair procedures (automotive). | Vendor page, confirmed |
| Parsable, Poka, Microsoft D365 Guides, PTC Vuforia, MaintainX, UpKeep, Fiix | Pages exist, but the specific feature claims the research agent made (conditional logic, data capture, predictive features) **did not match** the fetched text. | Quote mismatch, so treat as UNVERIFIED |
| Aquant, Dozuki, Cognite, Infor | Could not be fetched (loading page, 403, 404, redirect). | UNVERIFIED |
| Veryon (aviation) | "50% faster troubleshooting", "+5% FTF". | Vendor press release, not peer-reviewed |

**Finding (INFERENCE, from absence):** none of the vendor pages checked documents a step library with typed per-step outcomes, a verification class, and outcomes fed back into later plans. This is absence of documentation in marketing pages, not proof the feature doesn't exist. It is weak support for the package's differentiation claim, not a validation of it.
**Dropped:** case-study metrics the research agent attributed to Oxmaint (EAF mini-mill 40%, cement plant 43%, 97% vs 54% safety acknowledgment) do not appear in the cited pages.

---

## 4. Baseline metrics for §4.2–4.3

| Metric | Value | Source | Quality |
|---|---|---|---|
| First-time-fix, industrial machinery | ~71%; best-in-class reported 88%+ | Aquant 2025 benchmark | Vendor benchmark, confirmed as stated |
| Diagnosis share of MTTR | ~36% diagnosis, ~14% response, ~10% verification in one split; up to ~80% "finding the fault" in another | AdvancedTech; ReliablePlant | Practitioner articles; **sources disagree** |
| Diagnosis time per event | 15 min to 4 h | VistaProjects; PLCS.ai | Practitioner articles |
| Fewer executed tests from better diagnostic trees | ~34% fewer test items | Pan et al., ensemble-learning diagnostic trees (Frontiers in Mechanical Engineering) | Peer-reviewed; lab setting |
| No-fault-found rate | 20–50% avionics; ~15% across workshops | NFF literature | Partly fetched (one ResearchGate source 403). **No industrial-machinery figure found.** |
| AR guidance task-time reduction; digitized-process minutes saved | 28–40%; 56–74 min/event | Various | NCBI source behind CAPTCHA, so UNVERIFIED |
| Controlled field study, technicians with vs. without an LLM copilot, on FTF/MTTR | **None found** | Google Scholar / arXiv search | FACT of absence (search-bounded) |

**Speedup bound (INFERENCE, arithmetic):** if only the diagnosis share *d* of an episode gets faster, the whole-episode speedup is at most 1/(1−d).

| *d* | 30% | 40% | 60% | 80% |
|---|---|---|---|---|
| Max speedup | 1.43× | 1.67× | 2.5× | 5× |

The package's 1.3–2.5× corresponds to *d* of about 23–60%. Even at the most generous published share (80%), an episode-level 30× is out of reach. The conclusion holds across every source. Only the upper end of the range moves.

---

## 5. Which evidence bears on which open decision (§10)

This section only maps evidence to decisions. It makes no decisions; those are Mike's.

1. **Retire 30×.** The speedup bound (§4) holds across all published diagnosis shares. No controlled copilot field study exists. Treat the AssetOpsBench 65% as unverified.
2. **P1 baseline-first.** The external baselines are wide and mostly practitioner or vendor sources (FTF ~71%, diagnosis 15 min–4 h), which strengthens the case for measuring MIRA's own baseline.
3. **P2 PoC.** No external evidence for or against. Prior art (§2) gives the contract fields standard names.
4. **Action list and outcome enum.** See the input under §2: FHIR `warning` precedent, ISO 14224 `failure_mode`, verification kept separate. UNSAFE has no precedent and needs its own handling rule.
5. **Single surface.** No bearing.
6. **ASI-001 reuse.** No bearing (internal).
7. **Housekeeping.** No bearing (internal).

---

## 6. Not confirmed / remaining gaps

- US 12,451,309 and WO/2024/220292: assignee not confirmed. The package should mark them "reported".
- AssetOpsBench per-model scores: read the full paper (not the abstract) before citing 65%.
- Paywalled standards text (ISA-88, S1000D fault classes, IEEE 1232, IEC 60812/61025, MSG-3 task outcomes) was not read.
- Atomic Machines' learning loop ("training data continuously") remains a company statement with no published evidence.
- No industrial-machinery NFF rate was found.
- Vendor feature claims for Parsable, Poka, Microsoft, PTC, MaintainX, UpKeep and Fiix did not match the fetched pages. Recheck before using them competitively.

## 7. Sources (fetched 2026-10-18)

- Atomic Machines: dealroom.co/news/160613 · wevolver.com (PrimeSwitch PS-150 article) · interestingengineering.com (NYT-cited profile) · runtimewire.com · thenextweb.com · USPTO Official Gazette entries for US 12,469,659 (patentsgazette.uspto.gov/week45/OG/html/1540-2/US12469659-20251111.html) and US 12,272,912.
- Standards: sepasoft.com and plcacademy.com (ISA-88) · isa.org InTech (ISA-106) · fabrico.io and oxmaint.com (ISO 14224) · hl7.org FHIR TestReport (STU3) · ietf.org/archive/id/draft-sokolov-rats-aep-composition-02 and draft-ietf-rats-evidence-trans-02 · ieee.org (IEEE 1636) · Adobe FrameMaker S1000D documentation.
- Benchmarks: Aquant 2025 · advancedtech.com · reliableplant.com · vistaprojects.com · plcs.ai · Pan et al. (Frontiers in Mechanical Engineering) · arxiv.org/abs/2506.03828 (abstract only) · veryon.com.
- Full per-claim URLs, quotes and verification status are in the workflow journal (`wf_a612079e-a60/journal.jsonl`, BRAVO session 3b6c1342).
