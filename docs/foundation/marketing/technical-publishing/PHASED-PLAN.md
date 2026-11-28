# Phased implementation and agent handoff

Prepared 2026-10-25 (America/New_York). Continue [PR #4762](https://github.com/Mikecranesync/MIRA/pull/4762) under its existing branch and review authority. This plan supersedes the earlier intention to implement the complete publishing system in one session.

## Outcome

A future agent should be able to take a real technician question, identify its applicable sources, produce an HTML article and printable document at least as useful and readable as the approved PowerFlex sample, obtain independent technical and visual judgments, and preserve the evidence that connects the document to product and marketing learning.

The process must retain negative results and uncertainty. It must not transform a polished article into a claimed MIRA capability, turn every content correction into a product defect, or generate until a judge happens to agree.

## Phase ledger

| Phase | Deliverable | Completion evidence | State at this handoff |
|---|---|---|---|
| **1. Preserve and document** | Approved-reference identity/assets, editable example, source ledger, callable skill, judge rubric and marketing study on the existing PR. | Remote file/commit verification; clear implementation status; no broken claims of completed tools. | This documentation handoff. Binary transfer status is recorded in the example README. |
| **2. Reusable document build** | Small local JSON-to-PDF/HTML renderer, pinned dependencies, documented CLI and build manifest. | Real sample build; all-page visual inspection; native text/links; repeated-build comparison; meaningful failure tests. | Not complete. Partial local exploration is not a shipped implementation. |
| **3. Independent judges and gate** | Separate technical/visual review invocations, render packet and integrity checker. | Real independently authored reports on exact artifacts; stale/missing/tampered evidence rejected; unresolved findings retained. | Rubric and contracts documented. Executable gate and actual candidate reports not complete. |
| **4. One product-learning cycle** | Reviewed-case input for existing Answer Radar; identified source/run/answer evidence; classified outcome and warranted repair/retest link. | One actual PowerFlex cycle, followed by a transfer check on Micro820 or S7-1200. | Proposed; no MIRA run for these cases in this work. |
| **5. Marketing pilot** | Authorized open article/PDF distribution, task-based feedback and a four-week readout. | Actual audience counts, reading-task observations, qualified inquiries and verified improvements, with attribution limits. | Research and draft experiment complete; execution not started. |

Phases 2 and 3 may share one bounded development slice if a working renderer already exists. Finish and record that slice before connecting live evaluation or distribution. Marketing research can continue while engineering is pending; public claims must follow actual evidence.

## Phase 2 — build contract

### Reuse and dependency decision

The approved sample was created with OpenAI image generation and a one-off ReportLab PDF script. The original image-generation tool did not expose a versioned model identifier. Preserve the actual asset and label provenance honestly; do not invent a specific latest-model name.

The one-off script used workspace-specific paths and is not a reusable repository tool. Repository `AGENTS.md` permits new MIT or Apache-2.0 dependencies only. ReportLab's licensing does not satisfy that rule. Exploration of jsPDF 4.2.1 found a transitive `fast-png`/`pako` license conflict; an exact `fast-png` 8.0.0 override was installed with optional dependencies and lifecycle scripts disabled, and the approved 1536 × 1024 PNG decoded through jsPDF. This is a preliminary compatibility check only. No PDF renderer, final dependency audit, image-format test suite or deterministic build was completed. The candidate also requires Node 22.12 or newer for CommonJS loading of that ESM dependency. Do not copy the exploratory lockfile or claim dependency compliance. Resolve a supported, compatible toolchain and test its actual transitive licenses before committing implementation. An existing approved host renderer is another option if its reproducibility limits are explicit.

Keep the first tool small: use the example input, one design system and a documented set of blocks. Do not build a CMS, scheduler, model router or parallel product stack.

### Proposed interface

These commands are a **target interface**, not commands shipped by Phase 1:

```text
node tools/technical-publishing/render.cjs --input article.json --out-dir dist
node tools/technical-publishing/render.cjs --input article.json --validate-only
```

Use `examples/powerflex-525/article.json` as the editable input contract:

- `schemaVersion: 1`, title, slug, revision, explicit date and accurate author label.
- One optional hero with local path, alt text and visible caption.
- Reference identities, labels and absolute URLs.
- Explicitly ordered pages with section, paragraph, table and notice blocks.
- Native rich text spans with bold/italic/code/link properties; never interpret raw HTML from the input.

Require native subject/body/table/source text, readable typography, coherent margins and HTTPS citations. Allow legitimate contact links. Reject unsafe links, unsupported glyphs, malformed input, overwritten input files and content overflow. Never silently reduce the font size to squeeze in content. Reflow, simplify, resize decorative art or add an intentional page.

Emit PDF, self-contained HTML and a manifest with input/asset hashes, output hashes/byte sizes, page geometry, renderer/dependency identity and links. Do not put secrets, absolute workstation paths or debug traces into public artifacts. A fixed input date belongs in the document; volatile build timestamps should not defeat a claimed deterministic build.

### Acceptance

Build the real PowerFlex example, render and inspect every PDF page, inspect HTML at desktop and phone widths, extract the actual PDF text and annotations, and compare consecutive builds. Explain any intentional visual departure from the approved reference. Record whether reproducibility means identical bytes or equivalent content/layout; do not conflate them.

Test concrete failure risks: overflow, malformed or unsafe links, asset/path errors, unsupported characters, source overwrite and output identity. Keep checks local and narrow. Stop when the stated risks are resolved; do not turn this into an unrelated test framework.

## Phase 3 — judging contract

Implement [JUDGE.md](JUDGE.md) after a real candidate exists. Use different author, technical-judge and visual-judge invocations. Preserve their declared identities and actual model/tool versions when available. Do not fabricate a version when the runtime does not expose one.

The technical judge must inspect the candidate and actual applicable OEM pages, including warnings and continuation context. The visual judge must inspect all candidate/reference pages and the delivered HTML. Give both the source ledger, asset provenance, manifests and explicit rubric; do not supply the author's self-grade as proof.

Bind reports to the exact build manifest, source ledger, approved PDF and render inventory. Require seven checks per role, no open high/blocker findings, and recorded dispositions for medium findings. A hard technical or readability defect cannot be averaged away. Return PASS, REVISE or BLOCKED with evidence. Cap the normal loop at two correction rounds and escalate a persistent material disagreement through the existing responsible reviewer.

The integrity checker must reject stale artifact hashes, missing pages/checks/reports, self-review, conflicting author identities, unresolved required failures and edited outputs. It cannot prove technical truth or genuine independence merely by reading JSON. Report editorial acceptance separately from publication authority and any hardware/product result.

## Phase 4 — product improvement

Follow [BLOG-PLAN.md](../style-guides/BLOG-PLAN.md), which already identifies Answer Radar records, batch runner, source-reference grading and relevant limits. Extend the existing reviewed-case input instead of inventing another evaluator.

Retain question identity, applicable manual/edition/hash, supplied-source condition, product build/environment, complete answer/citations, grading references and exact report. Use the same reference notes for grader packet creation and scoring. Keep these known examples in the development split; a later fresh set measures transfer.

Classify the observed result before proposing work: article error, missing source, source conflict, invalid test, retrieval/answer issue, interface issue or supported behavior. A confirmed defect needs a bounded change and comparable retest. An already-correct response is useful evidence. Mark unrun and blocked cases honestly.

## Phase 5 — marketing and learning

Use [MARKETING-EXPERIMENT.md](MARKETING-EXPERIMENT.md). Start with one open article and downloadable PDF, a small reading task with relevant people, and an appropriate owned channel. Treat search as a measured discovery baseline. Follow current community rules; the studied PLCTalk policy prohibits commercial promotion.

Measure technician usefulness, actual reach, voluntary inquiries and verified product/content improvements separately. The chosen five-reader planning goal is an exploratory learning sample, not a benchmark. The four-week clock begins at authorized launch. No public post, message, ad campaign or schedule is created by this plan.

## Next-agent assignment

```text
Read docs/foundation/marketing/technical-publishing/README.md and PHASED-PLAN.md,
then use .agents/skills/marketing/technical-publishing/SKILL.md.

Continue the first unfinished phase on PR4762. Start by refreshing the branch
and inspecting its actual files; this handoff is not evidence that a tool exists.
For Phase2, resolve the renderer/dependency choice, build the real PowerFlex
input and preserve the approved PDF/art unchanged. Meet the stated acceptance
criteria and record exact commands and artifacts. Keep later phases pending.

Use existing MIRA components. Make routine reversible implementation decisions
autonomously within the user's scope. Escalate only a material source conflict,
unavailable authorization or an unresolved requirement that prevents a valid
result. Do not merge, deploy, send messages or launch marketing without the
applicable authority. Return the commit, changed paths, actual evidence,
remaining findings and the next bounded phase.
```

## Handoff discipline

Keep one status ledger in this folder. Update it after each completed phase and link the evidence. Do not leave another agent to infer completion from a filename, a proposed CLI, a mock review report or a generated image. If a session ends, preserve the current text and explicitly name the next action before attempting more work.
