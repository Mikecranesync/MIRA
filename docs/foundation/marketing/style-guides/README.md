# FactoryLM learning pilot, style guides and first editorial review

Version 0.3, 2026-10-25 (America/New_York). Draft refinement of [PR #4762](https://github.com/Mikecranesync/MIRA/pull/4762), starting from `df14ab5857c6e42d2277a2d72751d9c89ffa176f`.

**Start-gate direction:** develop these posts into a repeatable way to learn from real technician questions, test MIRA, improve FactoryLM and create useful content. The style guide is a working tool for that experiment. The [pilot plan](BLOG-PLAN.md) now defines one initial cycle, reuses the existing Answer Radar system and distinguishes implemented components from proposed integration.

**Editorial finding:** retain the navy/amber tech-sheet design and exact OEM citations. Revise the three attached posts before publication. Their main weakness is the transition from a documented condition to an apparent fix without enough scope, prerequisites or evidence of repair. These are content findings and potential evaluation inputs, not demonstrated MIRA defects.

This PR contains six documentation files only. This review updates the guides; it does not revise the source blog posts, replace the attached PDFs, approve publication, alter runtime code or establish current product performance.

## Guide map and authority

| File | Purpose |
|---|---|
| [STYLE-GUIDE.md](STYLE-GUIDE.md) | Main editorial standard: voice, evidence, technical scope, article structure, visuals, claims and release checklist. |
| [SEO-GEO-GUIDE.md](SEO-GEO-GUIDE.md) | Search metadata, current search-feature guidance, claim consistency and live-site follow-up. |
| [BLOG-PLAN.md](BLOG-PLAN.md) | Early learning pilot: existing Answer Radar integration, three development cases, first implementation slice, measures and retained topic backlog. |
| [STYLE-GUIDE-part4-proposed.md](STYLE-GUIDE-part4-proposed.md) | Pending weekly-batch mechanism; does not override existing publication authority. |
| [forum-reply-template.md](forum-reply-template.md) | Useful, sourced draft replies; no posting authorization. |
| README.md | This review, evidence references and concrete corrections. |

Hard rules preserved: no prices/dollar amounts, including audit examples; no competitor promotion; exact applicable OEM references; evidence-backed product claims; no invented CMMS dependence; safety work stays catalog and review only; publication follows Mike's existing authority. Technical OEM names remain necessary to identify the equipment and sources.

The main guide resolves the collected draft's conflicting FAQ/image quotas, byline rules, article order and capability assumptions. A style guide is not a second product capability registry.

## What we want to learn first

One question should produce a traceable source record, a test of the actual product, a classified outcome and a useful explanation. If it exposes a real product gap, link a bounded repair and comparable retest. If MIRA already handles it correctly, preserve that result and correct the article. Either outcome is useful.

| Initial case | Learning opportunity | What remains unmeasured |
|---|---|---|
| PowerFlex 525 F004/F005 | Source-grounded diagnosis, uncertainty, fault history and reset/restart distinctions. | Actual MIRA answer, retrieval/citations, interface experience and technician usefulness. |
| Micro820 flashing red | Fault class versus cause, conditional recovery, preserving the intended application. | Whether the product preserves these qualifications and asks for needed context. |
| S7-1200 factory reset | Version scope, deliberate erasure and honest handling of conflicting sources. | Whether MIRA clarifies, scopes or declines appropriately without inventing certainty. |

The existing [Answer Radar records](https://github.com/Mikecranesync/MIRA/blob/f1e53e0d30a317b1863d401df34609c90cea0d8b/answer_radar/schema.py), [Hub batch](https://github.com/Mikecranesync/MIRA/blob/f1e53e0d30a317b1863d401df34609c90cea0d8b/answer_radar/batch.py) and [historical staging rebenchmark](https://github.com/Mikecranesync/MIRA/blob/f1e53e0d30a317b1863d401df34609c90cea0d8b/answer_radar/runs/staging-2026-09-29-ae03a3877/FINDINGS.md) provide a starting implementation. The first extension is a small import of reviewed blog cases and a link between article, references, run, issue and retest. Present staging health and these three case results were not tested in this review.

Begin with one complete PowerFlex cycle, then test whether the workflow transfers to the other two cases. Keep the reviewed questions in the development split. Evaluate source coverage, product behavior, useful content and actual inquiries separately. An article can remain useful while an honestly recorded product limitation is open.

## Review scope and method

Reviewed the full text, rendered pages and PDF link annotations of all three supplied four-page previews. Checked the relevant official OEM publications below, including adjacent context where it changed the interpretation. This was an AI-assisted source/editorial review, not a hardware test, field repair verification, qualified human sign-off or live-site acceptance test.

The future dates in the attachment names are queue labels. All three PDFs identify October 25 as their modification/review date; none establishes that the article was published on its filename date.

| Area | Assessment |
|---|---|
| Subject selection | Useful real technician questions; PowerFlex is the strongest first revision for the drives focus. |
| Visual identity | Clear hierarchy, source labels and recognizable navy/amber design. |
| Core references | Major code/LED/menu facts largely match the cited editions. The PowerFlex clearing interpretation is wrong; Siemens has an unresolved applicability/source conflict. |
| Diagnostic usefulness | Needs a clearer progression from observation to evidence, interpretation and next decision. |
| Safety and consequences | Not publication-ready: prerequisites and warnings follow actionable resets/checks. |
| Reading efficiency | Tables reappear as smaller diagrams and repeated FAQs. Extra pages add less value than scope/verification would. |
| Export quality | Every PDF contains four `file:///` navigation/product links; these do not lead a recipient to the intended website. |
| Product claims | Default closing copy includes unproven timing/pilot statements and conflicts with the separately drafted claim registry. |

## 1. Micro820: revise before publication

Source attachment: `2026-10-27-micro820-flashing-red-fault-clear.pdf`.

**Keep:** exact controller/card/file names, LED distinctions, source-page links, and the practical constraint of not having CCW available.

**Correct before release:**

- **Attempt versus guarantee (PDF pp.1-2, title/summary/lead/Figure 2):** the OEM describes an attempted fault clear. The draft repeatedly promises “clear it” and labels the action a fix. Preserve the qualification everywhere, including metadata and FAQ. A cleared indication is not proof that the cause was repaired. (M1, p.120)
- **Prerequisites before power-up (pp.2-3):** bring relevant machine-state, saved-evidence and card/restore context before the card operation. The OEM describes automatic restore and possible wrong-project loading. Do not tell a reader to overwrite an existing configuration or use an unknown card without checking its contents and behavior. (M1, pp.117-118)
- **Remove the production-program shortcut (p.3, Gotchas):** an attributed forum suggestion to download a one-rung program is still a program replacement. Keep it out of the routine field recovery sequence.
- **Improve the fallback and completion check (p.3):** use the fault details and applicable corrective-action reference when the condition persists. “SD LED is not off” includes busy states and does not prove completion. Do not make firmware updating a generic fallback or imply one LED proves the application is ready. (M1, pp.149,155-156)
- **Fix diagnostic labels (p.1):** a recoverable-fault classification is not a root cause. “Often after a failed download” is unsupported by a single forum case. Use “reported after a failed download in this thread.”

**Lead direction:** define the flashing-red indication, state that it does not identify the cause, recommend preserving available diagnostic evidence, and introduce the conditional recovery option with its prerequisites. A full revised procedure still needs a review of the finished copy.

## 2. S7-1200: revise and resolve applicability before publication

Source attachment: `2026-10-28-s7-1200-reset-to-factory-settings.pdf`.

**Keep:** the accurate AQ-manual menu path, clear explanation that internal memory/data are erased, and the useful consequences table.

**Correct before release:**

- **Erasure before instructions (PDF p.1):** make intentional erasure the purpose. Confirm the correct CPU, controlled machine state, needed diagnostic evidence and recovery plan or deliberate discard decision before the reset controls. CPU STOP is not a statement that the machine is isolated.
- **Resolve the card/password source conflict (pp.1-3):** the statement that card contents are erased only with the Format option matches the cited AQ manual, pp.1057-1058. It is not a misquote. A separate official STEP 7 V20 topic, scoped to S7-1200 firmware V4.5 onward with a card, describes additional deletion and reload behavior associated with password and card options. Do not publish an unconditional card-preservation promise until the actual firmware/TIA scope and applicable behavior are resolved. (S1 and S2 below)
- **Make lost-password consequences explicit (p.3):** the cited recovery route deletes the protected program/internal load memory, with a warning continuing onto p.120. Describe it as destructive recovery, not password retrieval. (S1, pp.119-120)
- **Use task-specific summary fields:** purpose, consequences, prerequisites and source. A used CPU is not itself a diagnosed fault, and a retained program is not established as every reader's reset-failure cause.
- **Rename the completion block:** “Verify the reset result” is accurate. “Check before you call it fixed” implies a machine repair the article does not demonstrate.

**Lead direction:** state intentional erasure and the version boundary before the menu path. If scope cannot be established, publish only a corrected reference to consequences and the OEM sources, without the disputed operational promise.

## 3. PowerFlex 525: revise this one first

Source attachment: `2026-10-30-powerflex-525-f004-f005-undervoltage-overvoltage.pdf`.

**Keep:** the F004/F005 explanation, edition/page citations, and the choice to start with recorded drive diagnostics. The major definitions and F651-F660 references match the cited O edition.

**Correct before release:**

- **Remove the “Only Type 2” distinction (PDF p.2):** Rockwell's general manual-clearing instructions require correcting the cause before clearing. The draft incorrectly narrows that requirement. (P1, p.160)
- **Describe restart consequences accurately (pp.2-4):** automatic reset may also restart the drive, depending on configuration. The OEM also documents automatic clearing without restart for these faults; do not replace the draft's omission with a universal claim that every automatic clear restarts. (P1, pp.134,159-160)
- **Pair the actual history entries (pp.2-3):** verify the stored codes and their indices before associating F651/F652 with the pair. Repetitive faults can be recorded once, so history is not a complete occurrence log. The filtered b005 display range is not an acceptable operating range or universal trip threshold. (P1, pp.78-79,145)
- **Keep hypotheses out of authoritative graphics (p.2, Figure 1):** the brake theory is not a diagnosed cause. Neither the shared fault sequence nor the forum's photographed U/T1 termination proves the reader has that defect.
- **Make the repair checklist conditional (p.3):** require correction of a defect actually found, with recorded evidence and relevant verification. Do not require fixing the forum poster's alleged defect on every reader's machine.
- **Move the hazard boundary forward (p.3 safety panel):** supply/terminal work follows the applicable full OEM/site procedure and qualified review. The current abbreviated electrical checks should not look like a complete safe-isolation procedure. (P1, p.13)

**Suggested replacement for the defective reset paragraph:**

> F004 and F005 are Type 1 faults. Depending on configuration, the drive can clear the fault and restart automatically. Rockwell also documents a clear-without-restart configuration for these faults. Before manually clearing a fault, identify and address its cause and follow the machine's approved restart procedure. Reset eligibility does not prove the problem is repaired.

Source: (P1, pp.134,159-160). This is proposed editorial wording, not permission to enable automatic restart.

## Common corrections across all three posts

1. Put material consequences and required conditions before action-bearing summaries, procedures and FAQ answers.
2. Replace universal “Likely cause / Fix” cards with the task-specific fields in STYLE-GUIDE section 5.
3. Remove duplicate table graphics unless they add a decision, location or relationship. Preserve readable technical labels at final print and phone sizes.
4. Fix the twelve total `file:///` links in the PDF exports. Use absolute HTTPS only for destinations that will be available when distributed. Recheck the actual final PDF annotations.
5. Keep preview status, SEO fields and raw tracking URLs out of public exports. Their presence is acceptable in a clearly labelled internal review copy, as these previews indicate.
6. Remove the unsupported processing-time promise and factual active-pilot claim. The original default cited-answer wording also conflicts with the draft #4570 registry; reconcile current claim evidence or use the contact-only invitation.
7. Make the final block prove what its heading claims. Data collection, operation completion and repaired-machine verification are separate outcomes.

## Next handoff

Use [BLOG-PLAN section 6](BLOG-PLAN.md#6-first-implementation-slice-and-exit-criteria) for the first engineering slice: connect the reviewed PowerFlex question to Answer Radar, preserve a valid baseline and classify the outcome. Reuse existing issue/PR/release work for a demonstrated gap. The pilot is successful when the evidence supports a useful disposition, including a correct existing behavior; it does not need to manufacture a bug.

In parallel, Content Studio should revise the PowerFlex article, including its figures, summary and FAQ. Search Steward should check the exact corrected source and exported artifact. Carry Micro820 into the next iteration. Resolve or omit the disputed Siemens claim before releasing the affected procedure. Foreman packages reviewed content under Mike's existing publication authority. A MIRA pass is not a prerequisite for a useful OEM reference article; a product success claim needs its own evidence.

No additional stylistic preference is needed to begin. Measure what the cycle teaches about sources, product behavior, technician comprehension and effort, then revise the process. Accurate author/reviewer attribution and the applicable release decision remain required before publication; use existing roles and label AI-assisted desk review accurately.

## Evidence references

Official source files were retrieved and relevant pages inspected during this review. Rolling OEM URLs can change; recheck the edition before using them for a later release. Printed/PDF page numbers align for the reviewed locations.

- **M1:** [Micro820 Programmable Controllers User Manual](https://literature.rockwellautomation.com/idc/groups/literature/documents/um/2080-um005_-en-e.pdf), 2080-UM005H-EN-E, September 2025. Reviewed pp.13,117-118,120-121,149,155-156.
- **S1:** [S7-1200 Programmable controller System Manual](https://cache.industry.siemens.com/dl/files/302/109977302/att_1307432/v2/s71200_system_manual_en-US.pdf), V4.7, December 2024, A5E02486680-AQ. Reviewed pp.119-120,1057-1058.
- **S2:** [STEP 7 V20: restoring factory settings with a memory card](https://docs.tia.siemens.cloud/r/en-us/v20/device-and-network-diagnostics/hardware-diagnostics/changing-the-properties-of-a-module-or-the-programming-device/pc/resetting-an-s7-cpu-to-the-factory-settings-s7-1200-s7-1500/restoring-the-factory-settings-of-an-s7-1200-cpu-as-of-firmware-version-v4.5-with-a-memory-card-or-an-s7-1500-cpu-as-of-firmware-version-v2.9-s7-1200-s7-1500). Additional source with overlapping scope and materially different password/card notes; conflict remains unresolved for the proposed article.
- **P1:** [PowerFlex 520-Series Adjustable Frequency AC Drive User Manual](https://literature.rockwellautomation.com/idc/groups/literature/documents/um/520-um001_-en-e.pdf), 520-UM001O-EN-E, September 2025. Reviewed pp.13,78-79,134,145,159-161.
- **Product-claim conflict:** [#4570 registry at reviewed head](https://github.com/Mikecranesync/MIRA/blob/0315f7ea62adc0c235a5394f6d7d0336560adad5/mira-web/src/capabilities/marketing-claims/capabilities.json). This is branch evidence, not proof of current deployment.
- **Search changes:** primary references are listed in [SEO-GEO-GUIDE](SEO-GEO-GUIDE.md#primary-search-references).

### Reviewed attachment fingerprints

The PDF previews themselves are not added to the repository by this change.

| Attachment | SHA-256 |
|---|---|
| `2026-10-27-micro820-flashing-red-fault-clear.pdf` | `e37d9e9238b28bb5e5e3f0a56021c1fbde0885aefab50de426ba79b858018c88` |
| `2026-10-28-s7-1200-reset-to-factory-settings.pdf` | `1c59f1ff4fc975a164272f2f71b21457a841b58e09bc90c09a65a7546ed94bde` |
| `2026-10-30-powerflex-525-f004-f005-undervoltage-overvoltage.pdf` | `2332ce7fd510f20f477ddd8b6f8c21f8dd93b3fd45c2487a4a2bf1b8c6804323` |
