# MIRA / FactoryLM Go-Forward Plan

> **Provenance (committed 2026-07-14):** operator-authored go-forward plan, uploaded by Mike after
> the sheet-20 case study + n=5 variance study. Companion decision records:
> `docs/eval/2026-07-14-printsense-sheet20-case-study.md` (rubric decision, PR #2705) and
> `docs/eval/2026-07-14-printsense-cost-benchmark.md` (this PR). Execution state lives in
> `C:/wt-printsense/.planning/STATE.md` + PRs #2698–#2706. **Release-order note:** this plan sets
> the commercial sequence PrintSense → Drive Commander → Panel Decoder → PLC Logic Lens →
> Technician Pro; it supersedes the wayfinder map's Drive-Commander-first *release* order
> (#2577) — the Drive Commander work itself remains valid as product #2.

## Purpose

This document converts the current PrintSense benchmark result into the next execution plan and connects that work to the product strategy.

The immediate objective is **not** to build the entire MIRA industrial-maintenance platform at once.

The objective is to release a small number of focused technician tools that create an immediate “wow, this actually works” moment, earn individual subscriptions, and naturally lead users toward the larger MIRA and FactoryLM product.

---

# 1. Product Strategy

## The near-term product thesis

Industrial maintenance technicians are frequently hired with limited formal training. Many cannot confidently read electrical prints, diagnose drives, interpret PLC logic, or identify panel components. They depend heavily on senior technicians, and much of that knowledge disappears when experienced people retire or leave.

MIRA should eventually become the complete phone-based maintenance assistant, but that is the long-term platform.

The near-term strategy is to release narrow products that each solve one painful problem extremely well:

1. **PrintSense** — understand an electrical print.
2. **Drive Commander** — diagnose a drive fault.
3. **Panel Decoder** — identify and explain panel components.
4. **PLC Logic Lens** — translate PLC logic into plain English.

These tools should later combine into **MIRA Technician Pro**, with FactoryLM providing the team and enterprise layer.

## The product rule

Every early product must have:

- One obvious input.
- One impressive result.
- Almost no setup.
- A useful answer in under a minute.
- Evidence or citations showing why the answer is trustworthy.
- Clear safety and uncertainty boundaries.
- A natural reason to save the result into a machine record.

Do not lead with “AI for maintenance.”

Lead with the exact outcome:

- Understand any electrical print.
- Diagnose a drive fault.
- Identify what is inside a control panel.
- Explain why a PLC output is not turning on.

---

# 2. What the Current PrintSense Result Means

The latest variance study is encouraging, but it does **not** mean the entire PrintSense program is finished.

It means the following infrastructure is now healthy enough to support a disciplined production decision:

- The corrected grading rubric is implemented.
- The strict-A device gate now evaluates schematic tags correctly.
- The variance harness works against the live API.
- Batch execution, cost previews, cache handling, and dry-run support are implemented.
- The first live `n=5` comparison exposed meaningful differences between reasoning configurations.
- The open queue has been repaired into a clean merge ladder.

## Current study result

| Configuration | Mean score | Cross-reference F1 | Approx. cost/run |
|---|---:|---:|---:|
| `xhigh` | 95.54 ± 2.09 | 0.703 | $0.344 |
| `high` | 98.26 ± 1.15 | 0.885 | $0.234 |
| `medium` | 98.84 ± 1.29 | 0.923 | $0.208 |

On this case, `medium` produced the best mean score, best cross-reference F1, and lowest cost. `xhigh` produced the weakest cross-reference result, highest variance, and highest cost.

However, the current hard-failure comparison is contaminated by the known `duplicate_identifier` false positive involving the two fiber cables `-W5469` and `-W5497`. PR `#2701` is intended to fix that exact issue.

Therefore:

> Do not make the final production reasoning-level decision from the current run alone.

The current result makes `medium` the leading candidate, not yet the permanent winner.

---

# 3. Immediate Execution Plan

## Step 1 — Merge the repaired queue in order

Use normal branch protection and the established approval constraints.

Merge order:

1. `#2698`
2. `#2699`
3. `#2700`
4. `#2701` — only after the explicit gate approval already required
5. `#2705`
6. `#2706`

PR `#2704` is documentation-only and can merge at any safe point.

Do not bypass required checks. Do not merge around a failed required gate. Preserve the clean version ladder.

## Step 2 — Re-run the same variance study after `#2701`

Run the same command and same case after the duplicate-identifier fix lands.

The purpose of this run is causal confirmation:

- Verify that the fiber-cable false positives disappear.
- Verify that no new hard failures appear.
- Confirm whether `medium` still outperforms `high` and `xhigh`.
- Preserve raw outputs, grading records, costs, and configuration metadata.

Expected spend is approximately the same as the first run.

## Step 3 — Make a provisional PrintSense configuration decision

Use this order of importance:

1. Confident misreads and hard failures.
2. Cross-reference accuracy.
3. Overall quality score.
4. Variance and repeatability.
5. Cost and latency.

Recommended decision logic:

- Eliminate any configuration that introduces a confident misread or real hard failure.
- Prefer `medium` if it remains equal or better than `high` on accuracy and reliability while retaining its cost advantage.
- Prefer `high` if broader evidence shows that `medium` loses important accuracy or robustness.
- Stop using `xhigh` as the default if it continues to be more expensive while producing worse cross-reference accuracy or greater variance.
- Do not choose a configuration merely because it produces longer or more confident-sounding answers.

## Step 4 — Validate the provisional winner on a small, diverse corpus

The first `n=5` study is repeated sampling of one case. It measures variance, but not broad generalization.

Before changing the global production default, run the surviving configurations on a compact stratified set containing examples such as:

- Simple motor starter.
- Multi-page cross-reference case.
- European/IEC schematic.
- Dense industrial control sheet.
- Ambiguous or partially legible image.
- Print containing repeated identifiers across legitimate cable sections.
- Case where the correct answer must explicitly say something cannot be confirmed.

The goal is not a huge benchmark campaign. The goal is enough diversity to avoid choosing a global default from one favorable drawing.

## Step 5 — Complete the operational cleanup

After the configuration decision:

- Rotate the exposed or temporary secrets identified in the current handoff.
- Complete the DigitalOcean panel items.
- Test both user-facing bots from a phone.
- Confirm the actual production model/configuration reported by telemetry.
- Verify that user-visible citations, uploads, follow-up questions, and error handling work outside the benchmark harness.

## Step 6 — Build the pending Bit 1–3 regression case when the source image exists

The §10 case should remain staged until the correct Bit 1–3 page photo is supplied.

Do not invent the truth set from the wrong drawing.

When the correct image arrives:

- Preserve the source image.
- Create the human-confirmed truth set.
- Add it as a permanent regression case.
- Run it through the same grader and variance machinery.
- Document why it covers a distinct failure mode.

This missing image should not block the other execution steps.

---

# 4. Definition of “Done” for the Current PrintSense Phase

The current phase is complete when:

- The repaired PR queue is merged in order.
- The duplicate-identifier false positive is verified as fixed.
- The variance study is rerun.
- A provisional reasoning configuration is selected from evidence.
- That selection survives a small diverse corpus.
- Required regression gates are green.
- Phone-level production smoke tests pass.
- The benchmark, decision record, and raw evidence are durable.
- The system clearly reports uncertainty and does not fabricate devices, identifiers, or cross-references.

This completes the **quality and configuration decision phase**.

It does not complete every future PrintSense capability.

---

# 5. First Product: PrintSense

## User input

- Photo of an electrical print.
- Screenshot or cropped snippet.
- PDF page.
- Eventually, a full print package.

## Magic moment

PrintSense identifies the important devices and signals, traces the relevant circuit, and explains the drawing in plain English.

Example:

> This motor can start only when the stop circuit, overload contact, guard switch, and PLC permissive are all satisfied.

## Initial paid value

- More scans.
- Full-page and multi-page analysis.
- Cross-reference following.
- Follow-up questions.
- Saved drawings and machines.
- Exportable technician reports.
- Higher-priority or higher-quality processing.

## What should not block launch

Do not require complete plant integration, a CMMS connection, live PLC data, or a finished enterprise knowledge graph before releasing the useful standalone product.

---

# 6. Second Product: Drive Commander

## User input

- Drive manufacturer and model.
- Fault code.
- Keypad or display photo.
- Parameter question.
- Eventually, a saved drive configuration or live telemetry.

## Magic moment

Drive Commander returns:

- Exact fault meaning.
- Likely causes in useful order.
- Parameters to inspect.
- Keypad navigation.
- Cited manual evidence.
- Clear safety and qualification boundaries.

## Initial paid value

- Unlimited or expanded lookups.
- More drive families.
- Saved drive records.
- Parameter comparison.
- Replacement and commissioning checklists.
- Machine-specific notes and history.
- Technician-ready reports.

## Strategic advantage

Drive fault pages can also serve as search-driven acquisition pages. Technicians already search exact fault codes, model numbers, and parameters.

---

# 7. Third Product: Panel Decoder

## User input

A photo of:

- Electrical cabinet.
- Starter.
- Terminal strip.
- PLC rack.
- Sensor.
- Relay.
- Power supply.
- Other control component.

## Magic moment

Panel Decoder labels visible components and explains their probable function.

It should answer:

- What is this component?
- What does it normally do?
- What print symbol or tag should I look for?
- Where is the part number?
- What commonly prevents it from operating?
- What information must be verified before relying on the identification?

## Initial scope boundary

Do not initially promise perfect automatic wire tracing from arbitrary cabinet photographs.

Start with:

- Component recognition.
- Part-number extraction.
- Functional explanation.
- Probable panel role.
- Correlation to an uploaded print when available.

---

# 8. Fourth Product: PLC Logic Lens

## User input

- Ladder-logic screenshot.
- PDF or image export.
- PLC project export where legally and technically supported.
- Eventually, read-only live tags.

## Magic moment

PLC Logic Lens explains the rung and identifies the condition blocking an output.

Example:

> The conveyor output is off because `Guard_Closed` is false. The start request, overload, and upstream permissive are currently satisfied.

## Initial scope boundary

The first version does not need live PLC integration.

Begin with deterministic parsing and explanation of uploaded logic. Add live read-only status later.

Never allow inexperienced users to edit or force PLC logic from the phone as part of the initial product.

---

# 9. The Subscription Ladder

## Free utility layer

- Limited PrintSense scans.
- Limited Drive Commander lookups.
- Public fault-code and parameter pages.
- Basic Panel Decoder identification.
- Demonstration-level PLC Logic Lens usage.

The free layer must provide a real answer, not merely a teaser.

## Technician Pro

Target around the currently discussed individual pricing, subject to market validation:

- All focused tools.
- Higher limits.
- Saved machines.
- Personal maintenance history.
- Better reports and exports.
- Cross-tool context.
- More manufacturers and file support.

## Team

- Shared machine records.
- Shared prints, drive records, and repair notes.
- Supervisor review.
- Team permissions.
- Shared procedures.
- Common parts and known-fix library.

## Enterprise

- PLC, SCADA, historian, CMMS, inventory, and identity integrations.
- Live machine context.
- Approved knowledge and governance.
- Qualification and permission controls.
- Plant-wide maintenance memory.
- Private deployment and enterprise support.
- Analytics across machines, failures, and technician workflows.

---

# 10. How the Small Products Become MIRA

Each standalone tool should create a structured record that can later attach to a machine:

- PrintSense contributes drawings, devices, connections, and interpreted circuits.
- Drive Commander contributes drive identity, parameters, faults, and troubleshooting evidence.
- Panel Decoder contributes components, nameplates, cabinet locations, and part numbers.
- PLC Logic Lens contributes tags, rungs, permissives, interlocks, and outputs.

After a useful result, ask:

> Save this to a machine?

That action begins a Machine Pack without forcing the user to understand FactoryLM, UNS architecture, knowledge graphs, or enterprise integrations.

The long-term path becomes:

> Scan the machine → understand the print → diagnose the drive → explain the logic → save the repair → share the knowledge.

The standalone products are acquisition wedges. The shared Machine Pack is the bridge into MIRA. FactoryLM becomes the enterprise operating layer.

---

# 11. Architecture Principles

## Deterministic first, LLM fallback

For every product:

1. Deterministic software handles known formats, identifiers, schemas, rules, and verified packs.
2. The LLM handles ambiguity, explanation, and unresolved cases as an explicit fallback.
3. The answer states what came from deterministic evidence and what remains inferred.
4. Successful fallback resolutions are captured as evidence.
5. Repeated successful resolutions should improve parsers, schemas, packs, tests, and deterministic logic.

Do not allow useful corrections to remain permanent opaque model behavior.

## Source evidence over fluency

A confident explanation is not enough.

The system must preserve:

- Source image or document.
- Extracted identifiers.
- Citations or coordinates.
- Confidence.
- Unconfirmed items.
- Grader result.
- User or technician corrections.
- Model and configuration used.

## Shared core, separate product experiences

The products should share:

- Authentication.
- Billing and usage.
- Evidence storage.
- File ingestion.
- Machine identity.
- Packs and schemas.
- Grading.
- Feedback capture.
- Safety policies.
- Telemetry.

But each product should have its own simple landing page and workflow. Do not expose the complexity of the shared platform to a first-time technician.

---

# 12. What Claude Should Do After the Current Benchmark Phase

Once the queue, rerun, and configuration decision are complete, Claude should produce a short implementation plan for the first commercial release.

The plan should answer:

1. What is the smallest trustworthy PrintSense release?
2. What existing code already supports it?
3. What work is required for billing, limits, saved results, and phone UX?
4. What must be shared with Drive Commander?
5. Which features are explicitly deferred?
6. What objective release gates prove that technicians can use it successfully?
7. How will technician corrections feed the deterministic improvement loop?
8. What telemetry will measure activation, useful answers, repeat usage, and conversion?

Use read-only discovery agents where helpful, but avoid another broad architecture restart. Inventory and reuse the existing system.

Then implement through small PRs with:

- Written scope.
- Tests.
- Evidence-backed release gates.
- No production deployment or merge without the established approval.
- No unnecessary redesign of working components.

---

# 13. Explicit Non-Goals for the Next Release

Do not delay the first products while trying to finish:

- A complete CMMS replacement.
- Full plant-wide UNS deployment.
- Autonomous PLC modification.
- Universal cabinet wire tracing.
- Every drive manufacturer.
- Every PLC platform.
- Complete enterprise permissions.
- Fully automated root-cause analysis.
- The entire senior-technician digital twin.

Those remain part of the larger vision.

The immediate job is to produce small, trustworthy tools that technicians will pay for because they solve a real problem immediately.

---

# Final Directive

Finish the current PrintSense evidence cycle first:

1. Merge the repaired queue in order.
2. Rerun after `#2701`.
3. Compare `medium` and `high` on truth, cross-references, variance, cost, and a small diverse corpus.
4. Select the production configuration from evidence.
5. Complete operational smoke tests and cleanup.
6. Preserve the missing Bit 1–3 case until the correct source image is available.

Then move into the commercial product sequence:

> **PrintSense → Drive Commander → Panel Decoder → PLC Logic Lens → MIRA Technician Pro → FactoryLM Team and Enterprise**

Do not build the entire future before releasing the first useful tool.

The goal is to give a technician one unmistakable win, earn trust, save the result to a machine, and make the next tool an obvious upgrade.
