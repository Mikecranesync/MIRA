# Independent technical-publication judge

Version 0.1, 2026-10-25. **Status: proposed review contract for Phase 3; no validated judge CLI or automated gate is shipped by this document.** These instructions can guide a separate manual or agent review now. The planned workflow must still implement and test manifest binding, complete render inventories and report validation before claiming an automated pass. Apply the [editorial guide](../style-guides/STYLE-GUIDE.md) and [learning pilot](../style-guides/BLOG-PLAN.md).

The judge evaluates an exact editorial artifact against its sources and the approved visual reference. It does not certify equipment safety, authorize equipment work, establish MIRA performance, or approve publication. A model's visual comparison is a recorded judgment against explicit criteria, not proof of objectively identical quality.

## 1. Independence and evidence binding

Require separate **technical** and **visual** reports from distinct reviewing invocations, each separate from every author. One independent reviewer may perform both roles during an explicitly labelled preliminary review, but that is not two independent opinions and does not satisfy the proposed automated gate. Give reviewers the final candidate, required source material, the reference and this rubric; do not give them an author's self-awarded grade as evidence. Reviewers inspect and report, but must not edit the candidate or silently repair the source ledger. A new agent alone does not guarantee correctness: consequential or contested findings still follow the existing review policy.

The packet must identify:

- The run, article/case revision, author and separate judge invocation.
- The exact final PDF and its SHA-256; the source HTML/Markdown and its hash when available.
- Every numbered page render, its hash, and the rendering tool/version, resolution and page count. Render the PDF being judged, not a different preview.
- The approved reference PDF and its SHA-256; all reference pages rendered for comparison.
- Each OEM/source file's SHA-256, publication identifier, edition/date, applicability, URL and printed-to-PDF page mapping.
- The claim/source ledger, including captions, tables, metadata and unresolved claims. Editorial inferences must be labelled separately from OEM statements.
- Figure assets and hashes, provenance, captions and whether they are editorial illustrations, factual diagrams, screenshots or photos.
- Artifact-check results for links, text extraction, page count and required output files. A tool result is supporting evidence, not a substitute for inspecting the artifact.
- Separate MIRA run/trace evidence only when the article makes a product-result claim. Its absence is acceptable for an OEM reference article with no such claim.

Recompute or independently verify hashes before review. Check that the full-page render inventory matches the PDF page count and order. Regenerate renders from the candidate when provenance is uncertain. A checksum proves identity, not correctness or permission to reuse material.

Bind each report to the SHA-256 of the exact build manifest, source ledger, approved reference PDF and render manifest. The render manifest must bind its ordered full-page PNGs and rendering settings to the candidate PDF hash. Record the rubric revision in the evidence. Any subsequent change to PDF bytes invalidates its artifact verdict. Reuse still-valid source review, but recheck changed text, figures, layout and dependent links against the new PDF. Do not transfer a verdict to an uninspected export.

## 2. The approved quality reference

The user-approved reference is **FactoryLM-PowerFlex-525-F004-F005-Sample.pdf**, SHA-256:

`c84aca76304482965124fb5943197c05a56bb5cd192e6a952f13288a23534c07`

It has two US Letter pages. Both pages were independently rendered and inspected when this rubric was drafted. Its useful design characteristics are:

- A strong navy/amber editorial hero, clear subject and explicit notice that the generated drive illustration is generic rather than model-accurate.
- A short direct lead, a consequence/scope notice before the diagnostic table, and readable selectable body/table text.
- A second page that uses three numbered evidence sections, one useful history table, a concise handoff, sources and a modest contact invitation.
- Consistent spacing and alignment, restrained color, readable source notes and unobstructed page footers. No visible clipping or overlapping content was observed in the inspected renders.
- Thirteen link annotations: twelve official HTTPS manual links and one contact email link; no local-file website links.

Treat approval as a visual and editorial direction, not an exemption from source review. Do not inherit a mistake because it appears in a reference. The candidate need not have exactly two pages, copy the composition pixel for pixel, or include a hero when that would weaken the topic. Explain material design departures. Preserve the reference's readability, hierarchy and practical usefulness.

The reference's main title is part of its raster hero. Future output should also preserve the subject in machine-readable document metadata or accessible text; operational meaning must not depend on image-only text. A larger image, another page or a higher decorative score does not compensate for less readable instructions or missing qualifications.

## 3. Source and semantic review comes first

Read the candidate's complete extracted text, then inspect the PDF itself to capture image text, table relationships and page order. Read every cited OEM passage supporting a consequential claim, including adjacent warnings and continuation pages. Inspect the actual source file, not only a search result, author's excerpt or working URL.

For each consequential statement, decide whether it is supported, correctly scoped, unresolved or contradicted. Check exact model/code/parameter strings, units, conditions, sequence, consequences and certainty. A technically valid sentence can still mislead through its location, heading, omitted prerequisite or combination with another statement.

Use these PowerFlex reference assertions when judging this topic; adapt the assertions from applicable sources for other equipment:

| Check | Expected meaning | Reviewed OEM location |
|---|---|---|
| Fault meaning | F004 is DC-bus undervoltage and F005 is DC-bus overvoltage. Their reported order does not establish one cause. | 520-UM001O-EN-E, p.161; causal limitation is editorial reasoning. |
| History pairing | The newest recorded code and bus record share index 1; index 2 refers to the previous recorded entry. Confirm the codes rather than assuming the pair. | pp.79,145. |
| Record limits | Repeated faults are recorded once; stored bus values derive from filtered b005. Do not turn a display range into a trip threshold. | pp.78-79,145. |
| Clearing versus repair | Manual clearing follows cause correction. Type 1 does not remove that requirement. Automatic clearing/restart behavior is conditional, including documented clearing without restart. | pp.134,159-160. |
| Consequential work | The full OEM notice and qualified-person boundary apply; an unlit display does not establish isolation. Keep reference content distinct from permission to restart. | p.13; restart authorization is a site decision. |

Reference source: [official PowerFlex 520-Series manual](https://literature.rockwellautomation.com/idc/groups/literature/documents/um/520-um001_-en-e.pdf), 520-UM001O-EN-E, September 2025, reviewed SHA-256 `b9445a63c78865037d22238ddedbb785b4309c9798da9da35029d628658636a6`. Recheck identity and scope if the rolling URL serves different bytes.

Judge substance, not exact wording. A concise reference need not cover every possible parameter. An appropriate request for missing scope, an honest limitation or omission of an unsupported procedure can pass. Do not reward confident completeness over justified uncertainty.

## 4. Required role checks

Use these exact check IDs in the report. Each required check is **PASS**, **FAIL** or **UNKNOWN** with specific evidence. UNKNOWN is not PASS. Do not add irrelevant technical requirements to make an editorial reference prove a product capability.

| Role | Required ID | What a PASS establishes |
|---|---|---|
| technical | `source_identity` | The reviewed source files/editions, page mappings and ledger match their declared identities. |
| technical | `claim_support` | Consequential facts, tables, captions and summaries are supported by the applicable source or explicitly labelled reasoning. |
| technical | `equipment_scope` | Model, material version and conditional applicability are accurate; absent critical scope is requested or the claim is omitted. |
| technical | `consequences` | Consequences/prerequisites precede material instructions; clearing, repair and restart remain distinct; hazardous-work scope follows the editorial rules. |
| technical | `uncertainty` | Observations, hypotheses and outcomes remain distinct; unresolved source claims are scoped/omitted rather than asserted. |
| technical | `product_claims` | Product statements have their own relevant evidence, or no product-result claim is made. An untested product is not automatically a failing article. |
| technical | `attribution` | Sources, authorship, review dates, illustrations and reported field outcomes are honestly attributed; no unsupported credentials or promotion. |
| visual | `page_inventory` | Every candidate and reference page was inspected; ordered renders match the manifest and exact PDFs. |
| visual | `readability` | Essential body/table/figure/source text is readable at its delivered size with adequate contrast and no missing text. |
| visual | `layout` | No material clipping, overlap, split qualification, orphaned section or disruptive pagination; spacing and hierarchy are coherent. |
| visual | `reference_quality` | The applicable comparison criteria below meet the approved direction or improve it with stated reasons; no material regression is hidden by an aggregate score. |
| visual | `figure_honesty` | Figures preserve technical meaning and scope; generated/generic art is labelled and is not presented as hardware or test evidence. |
| visual | `navigation` | Required citations and website destinations match their labels; no local-file web links; valid PDF internal and contact links remain usable. |
| visual | `accessibility` | Subject is machine-readable; operational body/table/source text is selectable; essential meaning is not color-only or image-only; supplied figure descriptions remain available in the intended output. This is a basic artifact check, not PDF/UA or WCAG certification. |

## 5. Noncompensable blockers

Any item below prevents a PASS for the affected artifact. Do not average it away with a visual or prose score.

| ID / role check | Blocker | Required disposition |
|---|---|---|
| H1 / `source_identity`, `page_inventory` | Candidate, source, figure or render identity does not match the packet; required evidence is unavailable or some pages were not inspected. | BLOCKED pending the exact evidence; do not infer a pass. |
| H2 / `claim_support`, `equipment_scope`, `uncertainty` | A material technical claim is false, unsupported, missing its applicable scope or contradicted by unresolved authoritative evidence. | REVISE the claim, or BLOCKED on a genuine source/scope dispute. |
| H3 / `consequences` | A state-changing instruction precedes its material prerequisites, confuses clearing with repair/restart, or presents an incomplete hazardous-work sequence as sufficient. | REVISE; retain the full applicable source and task-specific boundary. A generic footer disclaimer is insufficient. |
| H4 / `claim_support`, `figure_honesty` | A figure, caption, summary, FAQ or metadata strengthens or contradicts the supported claim; generated imagery purports to show exact hardware, measurements or test evidence it does not establish. | REVISE every affected surface. |
| H5 / `product_claims`, `attribution` | The artifact invents a field outcome, author/reviewer credential, customer result or product capability; a claimed MIRA result lacks the relevant run evidence. | Remove or substantiate the claim. Editorial quality cannot establish product behavior. |
| H6 / `readability`, `layout`, `accessibility` | Required text, labels, warnings or sources are clipped, overlapped, missing, unreadable at the intended reading size, or detached from the action they qualify. | REVISE and inspect a newly rendered PDF. |
| H7 / `navigation` | A necessary citation points to the wrong document/page; website links resolve to local-file paths; important content or source notes disappear from the delivered export. | REVISE. Legitimate PDF bookmarks/GoTo links and contact mailto links remain allowed. |
| H8 / `attribution` | Unapproved price/promotion, unrelated private information or internal workflow/debug metadata appears in a public deliverable. | REVISE the affected output. A clearly labelled internal review copy may contain review-only metadata. |

Distinguish a demonstrably wrong source link from an unreachable site: temporary access failure is a recorded verification limitation, not proof that the document is false. The judge must say what it could and could not inspect. A known source conflict holds the affected assertion, not all independent drafting or product research.

## 6. Visual and usefulness comparison

Inspect **every candidate and reference page**, first at normal reading size and then enlarged where a table, caption or dense region needs closer examination. A contact sheet alone is insufficient. Check the actual output after its last edit. For an HTML deliverable, additionally inspect the rendered page at the requested desktop/phone widths; a PDF review does not prove responsive behavior.

For each criterion record **meets reference / improves reference / below reference / not applicable / not inspected**, with a candidate page or region and a specific reason:

| Criterion | What to compare |
|---|---|
| Hierarchy and identity | Immediate subject recognition; readable headings; coherent navy/amber treatment; topic-appropriate hero or alternative; no misleading OEM identity. |
| Legibility | Body, code/parameter labels, table cells, captions and source notes at final size; adequate contrast; no essential image-only instruction. |
| Composition | Consistent margins/alignment/spacing, balanced pages, intentional whitespace, no crowded footer, orphaned heading, split warning or unnecessary trailing page. |
| Information design | Tables/figures clarify a comparison or decision, avoid duplicating nearby content, and keep qualifications visible. |
| Technician usefulness | The reader can identify what is known, the next useful evidence, what remains uncertain and where the source is. A polished but vague page fails this criterion. |
| Provenance and honesty | Clear sources and scope; honest image labels; appropriate review/test attribution and a restrained contact invitation. |

Do not invent a numeric quality score or treat font preference as a technical failure. A material below-reference result fails `reference_quality` and requires a specific revision; small optional preferences can be recorded without starting another loop. “Looks professional” is not sufficient evidence. An uninspected required criterion cannot be silently marked satisfied.

## 7. Report contract, verdict and bounded revisions

Return one JSON report per role using `factorylm.document-review.v1`, plus a short readable explanation. Field contract:

```text
schema_version: "factorylm.document-review.v1"
role: "technical" | "visual"
reviewer_id: distinct identity for the reviewing invocation/person
author_ids: identities of all candidate authors
independence: "separate_agent" | "separate_model" | "human"
bindings:
  build_manifest_sha256: SHA-256 of the final build manifest
  source_ledger_sha256: SHA-256 of the reviewed source ledger
  reference_pdf_sha256: SHA-256 of the approved reference PDF
  render_manifest_sha256: SHA-256 of the ordered final-page render manifest
decision: "PASS" | "REVISE" | "BLOCKED"
checks: [{id, status: "PASS" | "FAIL" | "UNKNOWN", evidence}]
findings: [{id, severity: "blocker" | "high" | "medium" | "low",
            check_id, location, evidence, required_change,
            status: "open" | "resolved", disposition?}]
```

Include every required check for the stated role. `reviewer_id` must not appear in `author_ids`. Evidence must identify inspected pages, source passages or output regions; state limitations instead of fabricating tool results. Use stable finding IDs. Every medium finding needs a nonempty `disposition` explaining its correction or why a residual issue does not violate a required check. An accepted medium cannot excuse a failed check; low preferences are nonblocking.

- **PASS:** every required role check is PASS, no blocker/high finding remains open, and every medium finding has its recorded disposition. State residual limits. Both role reports are needed for the artifact gate. This is an editorial artifact verdict only.
- **REVISE:** an identified defect can be corrected using the available evidence. Give the exact page/location, claim or region, supporting evidence and smallest sufficient correction.
- **BLOCKED:** missing identity/evidence, a material source conflict, unavailable inspection or a consequential disagreement prevents the affected judgment. Name the evidence or responsible review needed; continue independent work.

Keep technical findings separate from design judgments and product-test findings. In `product_claims` evidence, state not tested, supported by a named run, or unresolved as applicable; never convert the PDF verdict into a MIRA evaluation pass. The mechanical gate checks report completeness, consistency and bindings. It cannot establish whether the source interpretation or visual judgment is true, and it does not prove reviewer independence beyond declared provenance.

Default to at most **two author correction rounds after the initial judgment**, within the run's existing budget. Rejudge changed material and its layout consequences; reuse unchanged verified evidence. Stop earlier when a source conflict cannot be resolved by rewriting, the same material failure recurs, or author/judge disagreement requires the existing responsible reviewer. Record the best current draft and remaining finding instead of regenerating until a model agrees. This bound does not authorize further spending, publication or deployment.

## 8. Callable judge instruction

Use this instruction with the complete run manifest; keep the author and judge invocations separate:

```text
Act as the independent FactoryLM publication judge for the assigned technical
or visual role. Read the run manifest and JUDGE.md. Verify its hash bindings and
the relevant candidate/reference/source/figure/render identities. Complete every
required check for your role. The technical judge reads the complete candidate
and applicable source passages, including figures. The visual judge inspects
every candidate and reference page. Do not edit the artifact, trust author grades,
substitute missing evidence, or treat the reference as technical truth.

Evaluate semantic support, scope, uncertainty and consequential qualifications
first; then evaluate every visual/usefulness criterion against the approved
reference. A hard blocker cannot be compensated by design quality. Keep an OEM
reference article separate from any MIRA product-result claim and verify the
latter only from its own identified run evidence.

Return one factorylm.document-review.v1 report and a concise explanation: PASS,
REVISE or BLOCKED; exact manifest/source/reference/render bindings; all required
role checks; findings with page/claim/region and evidence; smallest necessary
corrections and medium dispositions; unresolved limits. Technical product_claims
evidence states the separate product-test status. Both independent role reports
are required by the artifact gate; one report cannot stand in for the other.
If evidence is missing or sources materially conflict, identify the affected
judgment and next evidence. Do not block unrelated work. Do not claim equipment
safety certification, publication approval or a hardware/product test you did
not observe. Respect the run's bounded revision budget.
```
