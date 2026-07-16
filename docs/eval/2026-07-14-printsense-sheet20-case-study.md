# PrintSense Sheet-20 Case Study and Model Economics Report

> **Provenance / editorial note (committed 2026-07-14):** operator-authorized decision record,
> uploaded by Mike with the instruction "implement this." The §7 rubric decision (catalog code
> `ITS.LWL-K-01.2` is `type_text`, not a device tag) is implemented in `printsense/grader.py` +
> `printsense/benchmarks/scu2_sheet20/rubric.json` (same PR as this doc). **Sheet-identity
> caveat:** §1–§2 of this report describe a *three-module* "Opto-Koppler, Bit 1–3" page
> (`-20/A10…A12`, cables W5463/65/67 + W5491/93/95); the repo's benchmark image + verified
> ground truth (`printsense/benchmarks/scu2_sheet20_opto.md`) is the *two-module*
> "Opto-Koppler, belegt" page (`-21/A13`, `-21/A14`, wires -W5497/-W5469) of the same drawing
> [drawing]. They are different pages of the same book — the §10 regression case for the Bit 1–3
> page needs its own image + verified truth before it can be added to the benchmark set (tracked
> in `printsense/PATH_TO_A.md`). The economics table (§6) is the same data as
> `docs/eval/2026-07-14-printsense-cost-benchmark.md`, measured on the *belegt* benchmark image.

**Date:** 2026-07-14  
**Scope:** Wiring-diagram interpretation quality, technician usefulness, model cost/latency, rubric calibration, and recommended production changes  
**Reference case:** Drawing [drawing], Sensor Control Unit 2, sheet 20, “Opto-Koppler, Bit 1–3”

---

## Executive summary

This report combines two findings that should be treated as one product decision:

1. **The sheet-20 response was technically useful but initially too component-first and insufficiently system-aware.**
2. **Opus 4.8 at high or medium effort delivered the best measured cost-quality balance on the corrected production prompt path.**

The original PrintSense response correctly recognized three powered electrical-to-fiber interface modules, plastic optical fiber, digital inputs and outputs, and the presence of Position Bits 1–3. However, it missed the most technician-relevant circuit overview:

> Sensor Control Unit 2 appears to receive three optical position bits from SCU3, convert them into local electrical signals, and transmit its own three electrical position bits optically onward to SCU1.

That topology should have appeared first. The response instead began with a device inventory and treated the modules too generically.

The benchmark then showed that the improved prompt and grading path can produce strong A-band results, but the current production default is unnecessarily expensive:

| Configuration | Cost per print | Wall time | Grade |
|---|---:|---:|---:|
| Opus 4.8, xhigh effort | $0.421 | 149 s | 93.0 / A |
| Opus 4.8, high effort | $0.232 | 73 s | 96.0 / A |
| Opus 4.8, medium effort | $0.234 | 70 s | 96.0 / A |
| Sonnet 5, xhigh effort | $0.232 | 188 s | 86.9 / B |
| Haiku 4.5 | $0.035 | 43 s | 72.3 / C, fail |

The immediate conclusion is:

- **Do not change the production default based on one five-configuration run.**
- **Treat Opus 4.8 high effort as the leading candidate for the new default.**
- **Run a minimum five-run variance study before switching production.**
- **Adopt the Batches API for evaluation and corpus runs immediately.**
- **Add prompt caching for burst workloads.**
- **Do not use Sonnet 5 as the primary print reader under the tested conditions.**
- **Do not use Haiku 4.5 for final technician-facing interpretation.**

The constant device F1 score of 0.8 across every model strongly suggests the remaining strict-A blocker is not visual perception. It is likely the rubric convention around whether `ITS.LWL-K-01.2` is graded as a device tag, a catalog/type attribute, or both.

---

## 1. Reference circuit: what the sheet actually shows

### Document identity

- Drawing: [drawing]
- System: [project]
- Assembly: Sensor Control Unit 2
- Sheet: 20
- Sheet title: Opto-Koppler, Bit 1–3
- Position channels: Bit 1, Bit 2, and Bit 3
- Interface modules: -20/A10, -20/A11, and -20/A12
- Module supply: 24 VDC and ground
- Optical medium: POF
- Optical port notation: LWL IN and LWL OUT

### Circuit overview

This sheet shows three identical bidirectional electrical-to-fiber interface channels.

Each module contains two independent signal paths:

- A local electrical position bit enters `DIG IN`, is converted into light, and leaves through `LWL OUT`.
- A separate incoming optical signal enters `LWL IN`, is converted back to an electrical state, and leaves through `DIG OUT`.

The visible off-sheet references indicate a directional relationship among three Sensor Control Units:

- SCU3 sends optical Position Bits 1–3 into SCU2.
- SCU2 converts those received optical bits into local electrical outputs.
- SCU2 also converts its own local electrical Position Bits 1–3 into optical signals.
- Those outgoing optical signals continue toward SCU1.

The likely purpose is to distribute or cross-check a three-bit machine-position state among multiple controllers while maintaining electrical isolation and immunity to industrial electrical noise.

The exact redundancy, voting, permissive, or safety strategy is not proven by this sheet alone.

---

## 2. Correct channel mapping

| Position bit | Module | Local electrical input | Optical output toward SCU1 | Optical input from SCU3 | Local electrical output |
|---|---|---|---|---|---|
| Bit 1 | -20/A10 | 1X4.7 | W5463, SCU1-LWL1 | W5491, SCU2-LWL1, referenced from SCU3 | DA5.7 |
| Bit 2 | -20/A11 | 1X4.8 | W5465, SCU1-LWL2 | W5493, SCU2-LWL2, referenced from SCU3 | DA5.4 |
| Bit 3 | -20/A12 | 1X4.9 | W5467, SCU1-LWL3 | W5495, SCU2-LWL3, referenced from SCU3 | DA5.8 |

The DA5 and 1X4 references should be described as visible cross-referenced destinations unless the referenced sheets prove that they are specific PLC input or output cards.

---

## 3. Evaluation of the original PrintSense response

### Overall grade

**70/100 — Useful Draft, not yet field-ready**

The response was directionally correct and safe, but it underperformed in system-level interpretation and technician-first organization.

### What it did well

It correctly recognized:

- Three repeated optical interface channels
- Electrical digital inputs and outputs
- Plastic optical fiber
- 24 VDC power
- Off-sheet signal references
- The need to verify field conditions
- The need to avoid inventing an unreadable module model

Its safety language was also appropriate and conservative.

### Where it lost accuracy and usefulness

#### A. OCR normalization failure

The response repeatedly read `Position Bit` as `Position Blt`.

The title block and repeated channel labels provide enough evidence to normalize this correctly.

#### B. Missed topology

The response did not identify the likely SCU3 → SCU2 → SCU1 flow.

That is the single most useful circuit-level conclusion for a technician.

#### C. Merged independent paths conceptually

The wording could imply that `DIG IN` passes directly through to `DIG OUT`.

The drawing instead shows two independent conversions:

- `DIG IN` to `LWL OUT`
- `LWL IN` to `DIG OUT`

#### D. Overgeneralized the endpoint

The response described the fibers as going to “remote sensor units.”

The visible labels support Sensor Control Unit destinations, not direct field-sensor termination.

#### E. Excessive uncertainty around traceable wiring

The response said the W54xx fiber-to-module mapping could not be traced.

The cable relationships are visible even though some type text is blurred.

#### F. Technician-unfriendly ordering

It started with a long component description and signal list before answering:

- What does the whole circuit do?
- Where does the information come from?
- Where does it go?
- Why should the technician care?
- What machine symptom would a failure create?

---

## 4. Technician-first response design

The preferred response structure should be:

### 1. Circuit overview

Explain the whole sheet in two to four sentences.

### 2. Why it exists

Explain the likely machine purpose and clearly mark inference.

### 3. Direction of signal flow

State source, conversion, and destination.

### 4. How one repeated channel works

Explain one module, then state that the other two channels repeat the same pattern.

### 5. Fault meaning

Explain likely machine symptoms before listing terminals.

### 6. Troubleshooting sequence

Follow the actual signal path.

### 7. Exact mapping

Provide the cable, terminal, and cross-reference details.

### 8. Unknowns and safety

Place unresolved details and safety notes at the end unless the image contains an immediate hazard.

This ordering is better aligned with how an industrial technician approaches a print: understand the machine function first, then decide where to test.

---

## 5. Gold-standard technician explanation

### Overview

This sheet is the Position Bit 1–3 fiber-optic handoff for Sensor Control Unit 2. Three identical powered interface modules pass a three-bit position state through what appears to be a directional link among three Sensor Control Units. SCU2 receives optical copies of the three bits from SCU3 and converts them into local electrical signals, while SCU2’s own local electrical bits are converted to POF signals and sent onward to SCU1.

The likely purpose is to let multiple control units exchange or compare position information without sharing an electrical connection between cabinets. Fiber provides electrical isolation and strong immunity to electrical noise. The exact redundancy or voting strategy must be confirmed on the control-logic and system-overview sheets.

### How one channel works

Each module has two independent paths.

A local electrical position bit enters `DIG IN`. The module converts that electrical state into light and sends it through `LWL OUT` toward SCU1.

Separately, a light signal from SCU3 enters `LWL IN`. The module converts that optical state back into a local electrical signal at `DIG OUT`.

A10 handles Position Bit 1, A11 handles Position Bit 2, and A12 handles Position Bit 3.

### Why a technician should care

The three bits may form a coded machine-position value. Losing one channel may not remove all position information; it may create a wrong or invalid position code.

Possible symptoms include:

- Controller disagreement
- Invalid position
- Blocked motion or launch permissive
- Intermittent position changes
- A position code that changes when a fiber is moved
- Faults caused by dirty, loose, swapped, damaged, or sharply bent POF

---

## 6. Benchmark results

The benchmark was completed on the shipped prompt path against the upright sheet-20 image. It was collected from the existing background run rather than re-run, avoiding duplicate spend.

| Configuration | Cost per print | Wall time | Grade | Result |
|---|---:|---:|---:|---|
| Opus 4.8, xhigh effort | $0.421 | 149 s | 93.0 / A | Pass |
| Opus 4.8, high effort | $0.232 | 73 s | 96.0 / A | Pass |
| Opus 4.8, medium effort | $0.234 | 70 s | 96.0 / A | Pass |
| Sonnet 5, xhigh effort | $0.232 | 188 s | 86.9 / B | Pass |
| Haiku 4.5 | $0.035 | 43 s | 72.3 / C | Fail |

### Interpretation

#### Opus high is the leading production candidate

Compared with the current Opus xhigh default, Opus high produced:

- A higher measured grade
- Roughly 45% lower cost
- Roughly half the latency

The cost reduction is structural because it uses approximately half the thinking tokens.

However, the 96-versus-93 difference is still within the known cross-reference scoring noise. A production-default change should wait for a repeated-run variance study.

#### Opus medium performed similarly

Opus medium also scored 96/A with nearly identical cost and latency to high.

This makes both medium and high worth testing across a larger and more varied corpus. High is the more conservative candidate unless the variance study shows medium is equally stable.

#### Sonnet 5 is dominated for the primary read

Under this test, Sonnet 5 had:

- Similar dollar cost to Opus high
- About 2.6 times the latency
- A lower letter grade

It does not present a compelling primary-reader advantage under the tested conditions.

#### Haiku is unsuitable as the final interpreter

Haiku was much cheaper and faster, but it failed the benchmark.

It may still be useful for bounded support tasks such as:

- File triage
- Image-orientation checks
- Metadata extraction
- Simple OCR cleanup
- Output formatting
- Non-authoritative preclassification

It should not be trusted as the final technician-facing circuit interpreter without an escalation gate.

---

## 7. Rubric calibration issue

The device F1 score remained 0.8 across all tested configurations, including models with very different quality levels.

That consistency is strong evidence of a rubric or representation issue rather than a perception failure.

The likely issue is how the string `ITS.LWL-K-01.2` is classified:

- Device tag
- Catalog or model code
- Type attribute
- Or a value that should count in more than one rubric field

### Recommended rubric decision

Do not force catalog/type text into the same field as the schematic device designation.

Use separate normalized fields:

- `device_tag`: the schematic identifier, such as `-20/A10`
- `device_type_text`: the visible type or family text
- `catalog_code`: an exact manufacturer or catalog identifier when confirmed
- `raw_visible_label`: source-preserved text
- `confidence`
- `evidence_region`

The grader should only penalize the device-tag category for missing an actual schematic tag.

If the gold truth expects `ITS.LWL-K-01.2` as a device tag, that convention should be explicitly defended against normal industrial drawing semantics before it remains a strict-A blocker.

---

## 8. Recommended architecture changes

### A. Deterministic port-aware graph

Preserve the device ports and directions as first-class graph elements:

- DIG IN
- DIG OUT
- LWL IN
- LWL OUT
- 24 VDC
- GND

Do not collapse a module into a generic “opto-coupler” node without port-level edges.

### B. Off-sheet cross-reference graph

Parse and retain:

- Sheet references
- Cable numbers
- Terminal references
- SCU identifiers
- Destination labels
- Source labels
- Signal direction

The response generator should be able to form deterministic statements such as:

- Received from SCU3
- Converted at A10
- Output locally at DA5.7
- Sent onward to SCU1 through W5463

### C. OCR reconciliation

Use repeated context before exposing uncertain OCR:

- Compare repeated channel labels
- Compare against the title block
- Use electrical vocabulary
- Preserve raw OCR separately
- Promote corrected text only when multiple clues agree

### D. Observation versus inference

Maintain explicit internal categories:

- Visible fact
- Strong inference
- Unknown

The final answer should not present a likely control philosophy as directly printed truth.

### E. Technician response planner

Generate overview-first output by default:

1. Whole-circuit function
2. Likely operational purpose
3. Directional flow
4. Repeated device behavior
5. Fault consequence
6. Troubleshooting
7. Detailed mapping
8. Unknowns and safety

### F. Evidence-sensitive uncertainty

A blurred model number should reduce confidence in the model number only.

It should not reduce confidence in wiring connectivity that is clearly traceable.

---

## 9. Cost and deployment recommendations

### Adopt immediately

#### Batches API for evaluation and corpus runs

The reported 50% cost reduction does not change answer quality because it changes execution economics, not inference behavior.

Use it for:

- Regression suites
- Corpus grading
- Prompt comparisons
- Model variance studies
- Offline benchmark campaigns

#### Prompt caching for repeated system context

The static system block is approximately 6,260 tokens and exceeds the reported Opus caching threshold.

Use prompt caching for burst workloads and repeated corpus runs. The expected saving is approximately 12% per call in the measured setup.

### Validate before changing production

Run at least five independent trials per configuration across a representative corpus.

Minimum comparison set:

- Opus 4.8 xhigh
- Opus 4.8 high
- Opus 4.8 medium

Measure:

- Overall score
- Topology accuracy
- Port-direction accuracy
- Cross-reference F1
- Device F1
- Hallucination rate
- Safety hard failures
- Cost
- Wall time
- Output variance

### Recommended decision rule

Change the production default from xhigh to high only if:

- High remains in the A band across the repeated study
- No hard-failure rate increases
- Topology and signal-direction scores remain stable
- Cross-reference quality does not regress materially
- The lower cost and latency persist

---

## 10. Regression acceptance criteria

A corrected response for this case must:

- Identify the drawing as sheet 20.
- Read `Position Bit`, not `Position Blt`.
- Explain the entire circuit before listing signals.
- State that each module contains two independent paths.
- Trace `DIG IN` to `LWL OUT`.
- Trace `LWL IN` to `DIG OUT`.
- Identify the apparent SCU3 → SCU2 → SCU1 relationship.
- Associate the three modules with the correct cable groups.
- Avoid claiming direct termination at field sensors.
- Describe three-bit position exchange or comparison as a likely inference.
- Distinguish schematic device tag from type or catalog text.
- Put detailed terminal mapping after the circuit overview.
- Explain the likely machine impact of losing one bit.
- Keep uncertainty tied to genuinely missing or unreadable evidence.

---

## 11. Suggested scoring rubric

| Category | Points |
|---|---:|
| Correct circuit overview and topology | 25 |
| Port-aware signal direction | 20 |
| Cable, terminal, and cross-reference tracing | 15 |
| Functional interpretation with calibrated confidence | 15 |
| Technician-first ordering and clarity | 15 |
| Honest uncertainty and safety | 10 |
| **Total** | **100** |

A field-ready response should score at least 90 and must not fail either topology or signal-direction accuracy.

---

## 12. Recommended next actions

### Product decisions

1. Keep Opus 4.8 xhigh as production default until the variance study is complete.
2. Treat Opus 4.8 high as the leading replacement candidate.
3. Include Opus medium in the same variance study.
4. Do not promote Sonnet 5 as the primary reader based on this benchmark.
5. Restrict Haiku to bounded support roles with escalation.
6. Resolve the `ITS.LWL-K-01.2` rubric convention before using device F1 as a strict-A blocker.

### Engineering

1. Merge the queued PrintSense changes in the required order: #2698, #2699, #2700, then #2701 after explicit gate approval.
2. Merge #2704 independently when desired.
3. After the ordered merges, derive the clean F1, F2, F5, `--enhance`, and `--verify` changes from the iterate branch.
4. Ensure the budget PR also updates the two resize guard tests introduced by #2698.
5. Add this sheet as a permanent regression case.
6. Add topology, port direction, and overview-first ordering to deterministic grading.
7. Add a repeated-run model variance benchmark before changing the production default.

### Operations

1. Complete the secret rotation identified in the existing Phase 2 plan.
2. Review the DigitalOcean billing line items, orphan snapshots, reserved IPs, and the purpose of `srv1078052`.
3. Ping both bots from a phone to close the VPS recovery validation.

---

## Final recommendation

The strongest combined conclusion is not simply “use a cheaper model” or “improve the prompt.”

The product should make two coordinated changes:

1. **Improve the interpretation architecture so the system deterministically understands ports, direction, cross-references, and circuit topology before generating prose.**
2. **Use Opus 4.8 high as the leading cost-optimized production candidate, subject to repeated-run validation.**

That combination preserves technician-grade quality while reducing unnecessary inference cost and latency.

The product goal should be:

> Give the technician the purpose and behavior of the whole circuit first, then expose the exact wires, terminals, and evidence underneath it.
