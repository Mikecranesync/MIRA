# FactoryLM technical blog style guide

Version 0.2, 2026-10-25 (America/New_York). Draft refinement of PR #4762.
This is the editorial standard for this guide set. It does not approve a post, change a product capability, or authorize equipment work. [README](README.md) records the three-post review; [SEO-GEO-GUIDE](SEO-GEO-GUIDE.md) owns search rules; [BLOG-PLAN](BLOG-PLAN.md) owns delivery planning.

## 1. What a FactoryLM post must do

Help a maintenance technician understand one specific condition, collect the next useful evidence, and recognize when the question exceeds the available information. Write for a capable technician reading on a phone near a machine, with a printable reference available afterward.

A reader should leave knowing:

- What the indication or function means for the stated equipment.
- What is established, what remains a possibility, and which observation would separate the possibilities.
- What needs to be preserved or controlled before changing anything.
- Where the exact OEM instructions are, and when to involve the responsible qualified person.

A manual explanation is useful even when there is no confirmed repair. Do not manufacture an outcome to finish the story.

## 2. Voice: a careful maintenance technician explaining the next check

Use plain, direct English, short paragraphs, concrete nouns and the equipment's actual labels. Explain the point first, then the parameter, terminal, menu or file that supports it. Use contractions naturally. Address the reader as “you.” Use “we tested” or “I found” only for work the attributed person actually performed and recorded.

The tone is practical, calm and candid. Avoid vendor language, fake urgency, an invented night-shift story, or reassurance such as “the good news” when a fault has not been diagnosed. Experience shows through the quality of the checks and caveats, not through slang.

| Avoid | Prefer | Reason |
|---|---|---|
| “Clear it with these two lines.” | “The OEM documents a command that attempts to clear the fault.” | Preserve the source's certainty. |
| “The likely cause is a recoverable fault.” | “Flashing red identifies the fault class; it does not identify the cause.” | Classification is not diagnosis. |
| “Just reset it.” | Name the exact operation and its consequences before any instruction. | Reset is ambiguous. |
| “The brake theory fits here.” | “Regeneration is one OEM-listed possibility; the brake theory is unconfirmed.” | A plausible explanation is not a finding. |
| “Check before you call it fixed.” | “Evidence to record” or “Verify the operation,” unless repair was demonstrated. | Match the conclusion to the evidence. |
| “Ready in a few minutes.” | Omit the time promise unless current, relevant production evidence supports it. | Product performance is a factual claim. |

House preferences:

- Keep exact strings exact: `F004`, `F651 [Fault 1 BusVolts]`, `ConfigMeFirst.txt`, and software menu labels. Explain upload/download direction when it could be confused.
- Prefer full stops, commas and colons to em dashes. Do not alter an exact source quotation to satisfy punctuation style; paraphrase instead.
- Avoid filler such as “in today's fast-paced world,” “delve,” “leverage,” “seamless,” “game-changer,” and generic concluding pep talks.
- Preserve useful qualifiers: “attempts,” “if configured,” “in this edition,” and “reported by the forum poster.” Removing them is a factual change.
- An opinion is optional. Label a recommendation and give its reason. Do not require an opinion, anecdote, statistic, FAQ or image to fill a template.
- No prices, dollar amounts, discounts or competitor promotion in organic copy or this guide set, including audit examples. OEM names needed to identify equipment, software and sources remain necessary technical context, not an endorsement or a supported-brand claim.

## 3. Separate six kinds of statement

| Kind | What establishes it | How to write it |
|---|---|---|
| Observation | An actual reported LED, code, reading, log or screenshot | “The poster reported F004 followed by F005.” |
| OEM fact | An applicable official manual, bulletin or software help topic | Identify model, edition, section and printed page. |
| Field report | A named person's account with a traceable source | Attribute it; preserve whether a result was reported. |
| Hypothesis | A possible explanation consistent with some evidence | Say what evidence would support or weaken it. |
| Editorial recommendation | A reasoned next check | Label it as the recommended sequence, not an OEM quotation. |
| Product claim | Current evidence for the exact MIRA capability and surface | Use the approved claim and its scope; see section 9. |

A forum link establishes where a statement came from. It does not validate the advice. Keep forum theories out of OEM-derived tables, diagrams and “confirmed cause” boxes. Do not convert one incident into “often,” “usually” or “the common cause.”

## 4. Technical scope, safety and consequential changes

### Name the operation

Fault acknowledgment, fault clearing, power cycling, project download, memory restoration, firmware update, factory reset and machine restart are different operations. A display acknowledgment may leave the fault active. A fault clear may leave its cause unresolved. A factory reset may erase the application and data. A restart can move equipment. State the exact operation and applicable behavior.

### Put consequences before controls

Place the relevant warning, scope and prerequisites before the first actionable instruction. This includes the lead, summary card, caption, FAQ, search description and social excerpt. A safety box at the end cannot qualify an earlier reset recipe.

For a state-changing procedure, establish the correct equipment and version, site authorization and controlled machine state, relevant saved diagnostics, and the needed backup/restoration plan. For deliberate erasure, allow an explicit decision to discard existing contents instead of implying every used CPU has a recoverable project. Do not present CPU STOP, a dark display, or a cleared fault as proof of isolation or readiness to restart.

Routine OEM procedures may be explained when their applicability, necessary conditions and consequences are established. Safety work remains **catalog and review only**: identify the operation, hazard, required expertise and complete applicable source. Do not author a site-specific lockout sequence, energized electrical test, safety-function/interlock bypass, protection-setting change, or restart/return-to-service authorization. Do not shorten an electrical safety procedure into an apparently complete checklist.

Two permitted attribution forms:

- **OEM notice:** a short exact quotation with a page, or an explicitly labelled paraphrase linked to the complete notice. A paraphrase must never be labelled verbatim.
- **Publisher's note:** task-specific editorial context, clearly separate from OEM wording. Explain the relevant consequence and route the reader to the site's approved procedure and qualified personnel.

A quotation or publisher's note is not an approval to perform hazardous work. Do not claim that MIRA supplies a proven safety barrier merely because the article contains one.

### Stop and escalate when the missing information changes the decision

Hold the affected procedure or claim if equipment identity, critical prerequisite, firmware/software applicability, backup consequence, safety condition or source conflict remains unresolved. Continue independent reference work that does not depend on it. Do not choose the most convenient of two conflicting OEM passages.

Record fault evidence before changing state when practicable. Repeated resets, firmware updates, one-rung program downloads and replacement parts are not generic next steps for an undiagnosed problem.

## 5. Article structure

Use one primary reader question. The preferred order is:

1. **Title:** model and actual question; no promised fix unless established.
2. **Short answer:** usually two or three sentences defining the condition and the next useful evidence, with source and material scope. Keep destructive controls out of a context-free answer snippet.
3. **Before proceeding:** consequences and required conditions when applicable. Put it before any summary that contains action.
4. **At a glance and scope:** choose the fields below; include model, relevant firmware/software, manual edition and review date.
5. **Reported context:** a short attributed paraphrase of the real question. A quote is optional and should earn its space.
6. **Interpretation and checks:** one readable reference table, then the least invasive useful evidence sequence. Separate stored-diagnostic reading from exposed electrical work.
7. **What the results mean:** distinguish alternatives and limitations; say what remains unknown.
8. **Evidence or verification:** describe what can actually be concluded, plus escalation conditions.
9. **Sources, useful related reading and one modest contact invitation.** Add FAQs only for unanswered reader questions.

### Choose summary columns for the task

| Article type | At-a-glance fields |
|---|---|
| Fault/symptom | Observed symptom / What the manual establishes / First evidence to collect / Source |
| Reset or reconfiguration | Intended task / What changes or is lost / Before proceeding / Source |
| Parameter or feature reference | Function / Applies to / Conditions or limitations / Source |
| Verified repair case | Observed fault / Confirmed cause / Corrective action / Verification evidence |

Do not force every article into “Likely cause / Fix.” A failed factory reset and a deliberate reset of a used CPU are different reader questions.

### Make checks explain a decision

For each useful diagnostic check, give the observation to record, the expected or relevant result if documented, what it can establish, and what to do if it does not resolve the question. Do not invent a threshold or a branch absent from the source.

Example: pair a drive's fault-history code with the diagnostic record at the same history index. “Fault 1” means the newest stored record, not permanently the first code mentioned in the article. A filtered stored value is not a high-speed trace, and a parameter's display range is not its safe operating range.

### Use honest completion headings

- **Evidence to record:** values, order, operating context and unknowns.
- **Verify the operation:** the intended configuration/memory change occurred; this does not establish a repaired machine.
- **Verified repair:** documented cause, authorized correction, and observed outcome under relevant operating conditions. Record the test conditions; do not invent a universal observation period.
- **When to escalate:** unresolved fault, recurring symptom, unavailable diagnostics, conflicting sources or work beyond the reader's authorization.

## 6. Sources and fact-check records

First mention: full manual title, publication number including revision, date and applicable equipment. Later citations can be shorter if unambiguous. Cite the printed page in prose and use the actual PDF page for `#page=N`; check the mapping rather than assuming it.

For every consequential claim record:

- Article location and exact claim.
- OEM URL, document identifier/revision, section/table, printed page and PDF page.
- Model and firmware/software scope when material.
- Supporting passage, required qualifications, and any conflicting source.
- Reviewer, review date, and result: verified, scoped, unresolved or removed.

Open the cited page and surrounding warning/continuation pages. A search snippet, successful URL response or matching title does not verify the claim. If an official rolling PDF URL changes edition, update the citation and recheck the claim; preserve a checksum in the review evidence when feasible.

Use “Manual references checked against [edition] on [date]” for a desk review. Reserve “tested on hardware” for a recorded test that identifies the device, versions, setup and result. Keep author, technical reviewer and publisher roles distinct. Never invent credentials or attribute an AI-assisted review to Mike.

Drafts may leave a byline unresolved. Before publication, use the actual approved author or an accurate organization byline; use the real reviewer only after review occurred. Structured data must match the visible attribution.

## 7. Visual system and readable exports

Keep the navy/amber FactoryLM tech-sheet identity. The supplied PDFs have a clear header, strong hierarchy and useful source labels. Improve their information density and reading order instead of adding decoration.

| Element | House direction |
|---|---|
| Page | US Letter for download; approximately 0.5 in top, 0.55 in sides, 0.6 in bottom margins. Let content determine length. |
| Type | Archivo headings, Fira Sans body, Fira Code identifiers when available; sensible system fallbacks. Target 10.5-11 pt print body and readable source notes. Web body should be comfortable at phone width. |
| Color | Navy `#17324d`, secondary navy `#24486b`, ink `#1d2733`, muted `#5b6876`, rules `#d6dde5`, zebra `#f4f6f9`, amber `#e8a200`, pale amber `#fff6dc`. Use navy for links on white; verify contrast. |
| Header | FactoryLM tech sheet, model, subject and publication identifier. No OEM trade dress or implied OEM endorsement. |
| Summary | Four task-appropriate fields on desktop/print; stacked labelled fields on mobile. Safety/consequences precede an action-bearing summary. |
| Tables | Real selectable text, descriptive headers, restrained zebra shading and source immediately below. Reflow or provide a deliberate mobile treatment. |
| Figures | Use only when they explain a decision, state, location or relationship better than text. No mandatory count. Do not repeat an existing table as a smaller image. |
| Notices | Task-specific label, icon and text; never depend on color alone. Keep the notice with the relevant action across page breaks. |
| Footer | Short title/slug, document revision, review date and page number. Avoid long footers that collide with pagination. |

Do not force every post to four pages or every figure into a fixed short height. A title, table, repeated image and duplicate FAQ explaining the same fact are not four separate benefits. Keep a heading with its first paragraph, a figure with its caption, and a step with its qualification. Avoid a trailing page containing only a CTA or internal metadata.

Use genuine equipment photos or software screenshots when they add evidence, with appropriate publication rights and removal of unrelated sensitive details. Label drawings and recreated dialogs “Diagram: FactoryLM” or “schematic, not a screenshot.” A diagram is not proof that software was run. Do not use generated product imagery to represent a real terminal layout, instrument reading or test result.

Use original explanations and only the source material necessary to support them. Attribution, a small crop or a redraw does not by itself establish reuse permission. Do not copy full OEM pages, decorative branding or long forum exchanges. Prefer a linked paraphrase; keep quotations brief and accurate.

Give each useful figure meaningful alt text and a caption naming its purpose, source and page. Critical qualifications must remain in readable text. Use native HTML/SVG for precise diagrams where practical; raster text must remain legible at the delivered size. Keep print and web content in sync.

### Check the delivered artifact

Inspect the actual web output at narrow phone widths (including 360 and 412 CSS px), desktop and text zoom. Inspect every PDF page at normal reading size. Verify no clipped tables, unreadable figure labels, split warnings, missing glyphs or accidental blank/trailing pages.

For exported PDFs, resolve website navigation links to absolute `https://factorylm.com/...` URLs. Reject `file:///` web destinations; legitimate in-document bookmarks and PDF `GoTo` links are allowed. Test the PDF link annotations, not just the source Markdown. A related post must be live when the link is delivered; inclusion in the same PR does not make a future-dated post available today.

Keep SEO fields, workflow status, UTM debugging and preview notes in internal review output. Omit them from public HTML and customer PDFs. Label an internal preview plainly.

## 8. Titles, summaries and FAQs

Search rules live in [SEO-GEO-GUIDE](SEO-GEO-GUIDE.md). These are editorial examples, not approved replacements for the posts:

| Post | Better title direction | Better lead direction |
|---|---|---|
| Micro820 | “Micro820 flashing red: meaning and fault-clear options” | Flashing red identifies a recoverable fault. It does not identify the cause. Rockwell's microSD option attempts a fault clear; establish machine state and card restore behavior before using it. |
| S7-1200 | “S7-1200 factory reset: what it erases and what to check” | A factory reset deliberately erases controller information. Confirm intentional erasure, equipment/version scope and a recovery-or-discard decision before discussing controls. Resolve the memory-card/password source conflict. |
| PowerFlex 525 | “PowerFlex 525 F004 and F005: what to record first” | Explain undervoltage and overvoltage, then pair stored fault codes with bus-voltage records. The sequence alone does not identify one cause. |

Preserve the full citation and applicable caveats when turning these directions into finished copy. Avoid imperative reset instructions in metadata. FAQ answers must stand safely on their own; omit questions that merely repeat an earlier heading. Zero to three genuinely useful FAQs is a good starting point, not a quota.

## 9. MIRA claims and contact language

An accurate OEM article does not prove MIRA can perform that task. Keep editorial reference material separate from product demonstrations.

The original guide's external `capabilities.md` and can-say snapshots conflict with the draft registry in [PR #4570](https://github.com/Mikecranesync/MIRA/pull/4570). At the reviewed head `0315f7ea62adc0c235a5394f6d7d0336560adad5`, `mira-web/src/capabilities/marketing-claims/capabilities.json` keeps generalized cited-answer claims partial. That is a dated branch observation, not a finding about the current deployed product. Do not create another independent approved-claims list here.

Before using any capability claim, locate its current owner-approved record and production evidence for the exact wording, date, model/content and user surface. A merge, a staging test, an emulator result and a physical-phone production test are different evidence. If sources disagree, omit the disputed claim while it is reconciled.

Remove unsupported processing times, broad “never guesses” promises, automatic fault diagnosis/reset claims, adoption counts, pilot-customer claims, and “works with any manual.” Do not invent CMMS dependence or claim integrations, device support or safety performance from roadmap intent. No prices or competitor promotion in visible copy, metadata, schema, examples or audit notes.

Default contact invitation requiring no performance promise:

> Questions about using FactoryLM with your manuals? Talk to Mike.

Use the established `mailto:mike@factorylm.com` destination. “Talk to Mike about a pilot” is an invitation; “we run pilots with several plants” is a separate factual claim that needs evidence. Preserve the current product boundary for fault-reset and restart guidance. Do not remove a limitation because a reference article discusses the operation.

## 10. Review and publication

Use the existing review roles; the list below describes responsibilities, not a requirement to staff new roles or add an approval layer. Record an AI-assisted desk review as such.

1. Content Studio drafts the post and its claim/source record using this guide.
2. A technical reviewer checks the applicable OEM pages and all consequential qualifications. Search Steward checks wording, claims, sources, search metadata and delivered output. AI assistance is labelled accurately; it does not impersonate a qualified human review.
3. Resolve blockers and give Mike the exact reviewed revision, remaining limitations and recommendation. Preserve his existing approval/merge policy; do not add a second confirmation when an applicable approval already exists.
4. Foreman packages and publishes only under that authority. A date, `status: approved`, a passing check or this guide alone does not authorize publication. The proposed weekly mechanism remains described in [STYLE-GUIDE-part4-proposed](STYLE-GUIDE-part4-proposed.md).
5. Recheck changed claims, procedures, captions and linked dependencies after edits. Reuse still-valid evidence for unaffected material. Record the final revision and actual publication verification separately.

### Release checklist

- [ ] One clear reader question; model and material version scope stated.
- [ ] Definitions, observations, hypotheses, recommendations and outcomes remain distinct.
- [ ] Consequences and required conditions precede actionable instructions everywhere they appear.
- [ ] Every consequential claim matches its applicable OEM source; conflicts are resolved or the claim is removed.
- [ ] No forum hypothesis is presented as an established cause, OEM instruction or completed repair.
- [ ] Verification wording matches the evidence; no inferred hardware test or safe restart.
- [ ] Product language has current, scoped approval/evidence; no price or competitor promotion.
- [ ] Readable web/PDF output, usable absolute PDF links, useful visuals and no public preview metadata.
- [ ] Honest byline/reviewer/date; exact reviewed revision and applicable publication authority recorded.

Revisit after the first published batch using technician feedback, corrections and measured search behavior. Change the guide when evidence improves it; do not turn a stylistic preference into a technical fact.
