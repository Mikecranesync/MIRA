# MIRA two-lane answers — research and implementation assessment

Date: 2026-09-13. Status: research and proposed implementation refinements; runtime changes are not delivered by this document.

## Recommendation

Keep one conversation interface with two understandable answer bases: **General guidance** and **From your equipment evidence**. General engineering explanations should remain useful without a machine or manual. Exact equipment claims need relevant supporting evidence. The second lane includes documents, photos, recorded history, and live observations, with their existing provenance distinctions preserved.

This is a refinement of Mike's direction in [issue #3787](https://github.com/Mikecranesync/MIRA/issues/3787), not a return to blanket abstention. A source gap should narrow the unsupported claim while preserving useful general explanation. A label is a provenance statement; it does not make an invented procedure acceptable.

## Evidence ledger

Source inspection was performed at `b5bcc102c3b46eb3cafa2afb44a74a74716a6e44`, also the main tip returned by GitHub when publication began. PR #3789 was open at `38fd56e1c301111d964902b3be45c58c711da335`. This research did not execute application tests or reproduce the deployed benchmark.

| Finding | Evidence | Status and implication |
| --- | --- | --- |
| General and grounded paths already exist | [Notebook chat route](https://github.com/Mikecranesync/MIRA/blob/b5bcc102c3b46eb3cafa2afb44a74a74716a6e44/mira-hub/src/app/api/equipment-notebooks/%5Bid%5D/chat/route.ts): `body.mode === "general"`, `GENERAL_SYSTEM_PROMPT`, `BASE_SYSTEM_PROMPT` | Confirmed by static inspection. Extend this seam; do not build another inference pipeline. |
| The general evidence badge already exists | Same route, evidence frame near lines 1381–1385 and persistence near 1464–1466 | It emits `general_reasoning` and saves the served answer's basis. Audit actual consumer visibility and timing before claiming the badge is missing. |
| The suggested new name is incompatible with the mobile heuristic | [Mobile adapter](https://github.com/Mikecranesync/MIRA/blob/b5bcc102c3b46eb3cafa2afb44a74a74716a6e44/mira-mobile/src/unified/to-interaction.ts): `basisKind`, `BASIS_KINDS` | The regex containing `knowledge` maps to `oem_documentation`; passing `general_knowledge` would select that mapping. Static, deterministic consequence; no runtime test was run here. |
| Evidence values are already persisted | [Migration 084](https://github.com/Mikecranesync/MIRA/blob/b5bcc102c3b46eb3cafa2afb44a74a74716a6e44/mira-hub/db/migrations/084_notebook_turn_basis_and_source_origin.sql) | The original check constraint includes `general_reasoning`, not `general_knowledge`. Reuse the existing value. A new value would require checking all later migrations, types, and consumers; the live schema was not queried. |
| Raw candidate text streams before final evidence handling | Notebook route: `controller.enqueue` near 1189; answer assembly near 1328; evidence near 1397 | A full-answer check inserted only after generation cannot prevent earlier disclosure to the client. Add a validation boundary before releasing answer content. |
| Photo extraction and answer grounding are disconnected in the reported test | [Issue #3788](https://github.com/Mikecranesync/MIRA/issues/3788) | Reported reproduction, not rerun here. Reuse the stored observation and ownership checks; inspect pending photo work first. |
| A cited answer can still violate safety rules | [Issue #3790](https://github.com/Mikecranesync/MIRA/issues/3790) | The report records four unsafe responses driven by a poisoned source. Grounding alone is not a safety guarantee. |
| The baseline PR is documentation and fixtures | [PR #3789](https://github.com/Mikecranesync/MIRA/pull/3789) | Its numbers are recorded benchmark results, not evidence this two-lane fix exists. Its PR summary and expanded issue findings reflect different stages of the run; do not combine their counts into one new score. |

## Product behavior

| Request / evidence state | Expected answer |
| --- | --- |
| General concept, no project or manual | Fluent explanation, general-guidance label, no invented source or needless upload demand. |
| Named equipment and an unverified fault code | State that the meaning cannot be verified from available evidence; offer useful general checks/questions without assigning that code a guessed meaning; offer the appropriate upload action. |
| Relevant manual passage supports the requested detail | Give the supported detail with a citation that opens the actual passage. Model, revision, and applicability matter. |
| A manual exists but does not answer the question | Identify the coverage gap. General explanation can be separated and labeled when allowed; an explicit manual-only request stays manual-only. |
| Photo contains a readable rating | Answer from the stored, authorized observation; identify the photo as the source and preserve uncertainty in extraction. Do not label it OEM documentation merely because it is evidence. |
| Sources conflict | Surface the conflict and applicability/revision evidence; do not silently pick one value or issue a repair setting without a supported resolution. |
| One answer combines a sourced definition with diagnostic hypotheses | Separate “From your sources” and “Possible causes” content, or use existing part-level provenance. One citation must not imply every surrounding claim is verified. |
| Safety issue or malicious instructions in evidence | Apply the common safety boundary independent of the answer lane and source branding. |

Lane choice should be based on admissible support, not just whether a project has files. This proposal does not authorize widening retrieval across tenants, projects, or rejected sources. Photo and sensor records must remain grounded in their own source types and timestamps.

## Correct the specificity gate before implementing it

The issue's example hedge says that codes in a family usually mean a particular thing. That can preserve the very hallucination being fixed. Prefer an honest inability to verify the code, then general reasoning that does not assign an invented meaning to it. Absence from available sources proves only a coverage gap; it does not prove a model or code does not exist.

The presence of a fault-shaped token alone is not an unsupported claim. An answer may quote the user's code while explaining that it is unverified. Likewise a number may be a user-provided observation, a unit conversion, or a general illustration. Conversely, a dangerous instruction can lack both a code and a number. Follow-up questions can refer to “that drive” without repeating its model.

Use the request, authorized conversation context, resolved equipment identity, available source passages, and proposed answer together. Deterministic checks can enforce exact invariants such as allowed basis values and citation IDs. They cannot establish that arbitrary prose is true or fully safe. For unsupported content, reject the affected claim or use a controlled fallback; do not blindly prepend a hedge or split sentences on punctuation, which can corrupt decimals and instructions.

General mode must not produce fabricated citations or claim that an unseen document says something. It may say what kind of source would help, such as the manufacturer's fault troubleshooting manual, without asserting possession, existence of a particular edition, or a page number.

## Place safety and validation before display

The first implementation should buffer candidate answer text, validate it, and then emit the accepted content through the existing SSE grammar. Progress/status can remain visible during generation. Check both evidence and general answers; missing a hazard during input classification must not leave raw output unreviewed.

Preserve cancellation of the provider request, cascade behavior, timeout/error reporting, and honest partial-turn lifecycle. Do not save or replay rejected candidate text as an accepted answer. A client Stop before validation must not flush the unchecked buffer. Copy/export should carry the accepted answer's basis and citations.

This introduces a measurable delay before answer text appears even if it adds no model call. Record time to first accepted content, total completion time, and cost separately. Only optimize selective or incremental release after tests establish its boundaries. Do not claim unchanged latency or comprehensive protection from a small regex set.

Treat document text as untrusted source material. Keep source instructions separate from application instructions; preserve tenant scoping; apply output validation. These controls follow the defense-in-depth approach described by [OWASP's prompt-injection guidance](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html). No single delimiter, prompt sentence, classifier, or keyword list is a complete defense.

## Existing work to inspect before writing

These were open PRs when the publication check ran. Their presence is a reuse lead, not a recommendation to merge them unchanged. Read each relevant current diff, owner, review, and compatibility with main.

| Work | Why relevant |
| --- | --- |
| [#3557](https://github.com/Mikecranesync/MIRA/pull/3557), [#3563](https://github.com/Mikecranesync/MIRA/pull/3563) | Photo-source disclosure, explicit photo pointers, question-directed extraction, citable context. The newer observed gap should be compared to these paths before creating a third solution. |
| [#3690](https://github.com/Mikecranesync/MIRA/pull/3690) | Evidence chrome versus failed/stopped/completed lifecycle. |
| [#3696](https://github.com/Mikecranesync/MIRA/pull/3696) | Copy payload preserving basis and sources. |
| [#3789](https://github.com/Mikecranesync/MIRA/pull/3789) | Existing adversarial fixtures and baseline report. |
| [#3785](https://github.com/Mikecranesync/MIRA/issues/3785), [#3786](https://github.com/Mikecranesync/MIRA/issues/3786), [#3790](https://github.com/Mikecranesync/MIRA/issues/3790) | Prompt leakage, scope steering, and source-driven safety failures. |

The route imports existing `matchSafetyStop`, `canonicalProviders`, `appendManualContext`, `retrieveNodeChunks`, `recordTurn`, and typed notebook frames. Prefer extending those seams. This report did not establish that Python engine regexes are used in the deployed TypeScript route; prove the actual call path before reusing their names as evidence of coverage.

## Development estimate and release evidence

| Work | Focused developer-days, estimated |
| --- | ---: |
| Evidence mapping and display repair | 0.5–1 |
| Specificity handling and helpful fallback | 1–2 |
| Shared pre-display validation, safety, and stream lifecycle | 2–3 |
| Photo/manual transition in the existing conversation | 1–2 |
| Regression, adversarial, latency, and platform evidence | 1–2 |

Approximately 6–10 focused developer-days for the two-lane work, assuming reuse and working environments. This excludes unresolved access, review queues, unforeseen architecture repairs, and Projects completion. Labels and deterministic checks require no additional inference call; semantic review, if needed, has to be budgeted and measured. The estimate is not a deadline or proof of feasibility for every safeguard.

Acceptance must protect usefulness and honesty together: concept questions answered, exact unsupported claims withheld, useful next steps retained, citations actually supporting claims, no cross-project leakage, poison probes rejected, and no unchecked text released during streaming or Stop. Run the recorded regressions plus independently phrased variants; never describe a finite passing set as proof that all defects were discovered.

Read the [combined implementation guide](CLAUDE_IMPLEMENTATION_GUIDE.md) for sequence, ownership boundaries, and end-to-end completion criteria.
