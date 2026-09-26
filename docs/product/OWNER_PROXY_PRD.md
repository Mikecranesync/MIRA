# MIRA Autonomous Refinement & Owner Proxy System

Status: **Proposed**

Owner: Mike / FactoryLM

Product: MIRA / FactoryLM

Origin: lessons and methodology established through [PR #3999](https://github.com/Mikecranesync/MIRA/pull/3999).

This is the governing product requirements document (PRD) for the Owner Proxy
development lane. It records Mike's complete proposal, including the first mission
and governing principle. The principles and mission contract linked below are its
operating documents. A proposed specification is not a claim of operational readiness.

Primary objective: enable AI agents to continuously refine MIRA as Mike's
product-quality proxy, without architectural drift, benchmark gaming or false success.

## 1. Problem

A technically successful interaction can still fail the technician: an uploaded photo
can be misread; a correct reading can become an incorrect manufacturer or label in the
answer; a plausible diagnosis can depend on invented evidence. Confusing workflows,
false safety refusals and broken phone/web continuity are separate failures. Automated
tests do not establish real product quality. Mike should not have to discover,
translate and supervise every such repair personally.

## 2. Product vision

Observe → Capture → Classify → Trace → Repair → Freeze → Replay → Challenge → Accept.

Mike defines product principles, boundaries, benchmarks and major direction. AI takes
on increasing observation, investigation, bounded refinement, verification and
documentation. The proxy must locate the first divergence, coordinate the smallest
appropriate repair and demonstrate improvement in the original experience.

## 3. Goals

The system SHALL identify meaningful correctness and polish problems from a technician's
perspective; encode Mike's judgment durably; separate software checks from generated-answer
quality; find the first failing layer before implementation; reuse existing architecture;
produce bounded agent work; replay the original failure; test opposite controls; retain
failed runs; record exact source/build/model identity; escalate major decisions; and
reduce Mike's manual product-QA burden.

## 4. Non-goals

The system SHALL NOT redesign MIRA autonomously, replace architecture for convenience,
introduce major workflows on its own, optimize only for scores, put benchmark answers
in production, infer generative correctness from unit tests, accept fabricated evidence
because a diagnosis sounds plausible, close serious safety issues from related tests,
deploy production without authorization, or fabricate actions, measurements or results.

## 5. Governing product principles

[OWNER_OPERATING_PRINCIPLES.md](OWNER_OPERATING_PRINCIPLES.md) is the canonical product
judgment contract: distinguish evidence kinds; respect industrial evidence limits;
require an honest evidence chain; provide useful targeted help; localize uncertainty;
preserve relevant context; protect safety and legitimate troubleshooting; make failures
visible and recoverable. It governs the authorized work in this lane alongside existing
architecture, privacy, ownership and release rules.

## 6. Quality model

Grade each interaction independently at all seven layers:

| Layer | Question |
| --- | --- |
| A — Acquisition | Did the intended photo, document, user statement and equipment context arrive? |
| B — Interpretation | Were text, identity, associations, orientation, units and diagrams understood correctly? |
| C — Context/persistence | Did relevant earlier evidence, project association and conversation survive turns and devices? |
| D — Retrieval | Were appropriate references retrieved without unrelated material? |
| E — Reasoning/synthesis | Did the final answer preserve evidence without inventing labels, manufacturers, measurements, states, wiring or diagnoses? |
| F — Safety | Were inappropriate actions prevented while legitimate help remained available? |
| G — Presentation/UX | Was the experience understandable, responsive, inspectable and recoverable? |

## 7. First-failure rule

Find the earliest demonstrated divergence in the actual data path. Target that layer
unless evidence establishes another root cause. If interpretation says CURRENT SENSOR
but the answer says FLAME SENSOR, investigate synthesis; do not edit vision merely
because it is easier. Unknown intermediate evidence is an attribution gap, not proof.

## 8. Benchmark system

Use [benchmarks/product/](../../benchmarks/product/README.md) for realistic workflow
contracts. Start with BENCH-FIREPLACE-001 from #3999. Expand from demonstrated failures
across panels, drawings, multiple photos, VFDs, PLC I/O, motors, nameplates, mechanical,
hydraulic and pneumatic equipment, manuals, ambiguity, poor images, incomplete context,
safe/unsafe requests, long conversations, interrupted uploads and device continuity.

## 9. Benchmark contract

Each benchmark SHALL define original evidence and literal prompts, visible facts,
acceptable and unsupported interpretations, known unknowns, useful follow-up, safety
boundaries, UX expectations and opposite controls. Do not make a hidden final answer
the primary scoring target. Keep private originals separate from public scoring
contracts and controlled software fixtures.

## 10. Anti-benchmark-gaming requirement

Production SHALL NOT contain benchmark-specific diagnoses or labels, hidden outcomes,
prompts keyed to case identities, or fixture detection that forces acceptance. Repair
general behavior. A case used for tuning is development/regression evidence, not an
unseen quality estimate.

## 11. Refinement mission

One mission addresses one demonstrated failure using the full loop in section 2.
The [mission contract](REFINEMENT_MISSION_CONTRACT.md) defines its required inputs,
outputs, permissions, roles and stopping conditions. Preserve failed attempts.

## 12. Phase 0 — reconnaissance

Refresh main and record its exact SHA. Inspect relevant PRs, work claims, issues,
components, tests, collisions and reuse opportunities. Produce REUSE / CONNECT /
FINISH / REPAIR before implementation. Do not begin by inventing replacement architecture.

## 13. Phase 1 — demonstrate the problem

Reproduce the failure or obtain strong evidence. Capture exact prompt, supplied evidence,
environment, source SHA, app/build/backend/model identity, observed output, expected
behavior and relevant screenshots/logs/transcripts. Unreproduced suspicions remain
investigations and SHALL NOT be called demonstrated defects.

## 14. Phase 2 — determine the first failing layer

Classify A through G with evidence. Trace the actual boundary where behavior first
became unacceptable; distinguish a demonstrated mechanism from a root-cause hypothesis.

## 15. Phase 3 — define the bounded slice

Before changing code, record the problem, cause hypothesis, existing responsible
mechanism, smallest repair, files/components, opposite control and required acceptance
evidence. Preserve active ownership and explicitly exclude unrelated work.

## 16. Phase 4 — implementation

Reuse existing architecture, avoid unrelated refactors, preserve ownership, add
regression coverage, avoid benchmark hints and maintain necessary observability.
Large multi-module work SHOULD use non-overlapping assignments within existing agent
and independent-review constraints; this PRD does not expand the execution machinery.

## 17. Phase 5 — deterministic verification

Run targeted regression and opposite controls, relevant suites, type/static checks and
applicable integration tests. Record exact commands/results. Distinguish new from
pre-existing failures; neither may be hidden.

## 18. Phase 6 — freeze

Record one exact committed candidate, build hash, app version, backend SHA, environment
and model/provider configuration. Verify the running artifact matches. Live-edit runs
are investigation, not acceptance. A relevant change requires a new frozen candidate.

## 19. Phase 7 — replay

Repeat the original failing interaction. Capture input evidence → interpretation →
assembled context → retrieval → final answer separately where available. Missing capture
must remain explicit so a plausible final answer cannot conceal the first failure.

## 20. Phase 8 — challenge

Test changed photo order, ambiguous labels, nearby different equipment, safe/unsafe
neighboring requests, current/historical photos, text continuation, restart, interrupted
upload and device transition as declared by the mission. A repair that damages adjacent
valid behavior SHALL NOT pass. Fix run counts and acceptance rules before execution.

## 21. Mission outcomes

Every attempt ends in exactly one state: PASS when frozen replay and all required
controls satisfy the contract; FAIL when unacceptable behavior is demonstrated; UNKNOWN
when required evidence cannot be obtained. Preserve the first remaining failure and
all missing evidence. UNKNOWN never becomes PASS. A known failure with missing checks
remains FAIL overall, with those checks individually UNKNOWN. No outcome grants release
permission or clears unrelated safety issues.

## 22. Product polish loop

Evaluate polish separately from correctness: navigation, delays, loading feedback,
empty screens, buried evidence, verbosity, answer hierarchy, generic follow-ups,
phone/web consistency, error recovery, extra steps, lost work and source inspection.
Ask what Mike would first notice as wrong, then demonstrate the problem before repair.

## 23. Autonomy boundaries

Permitted bounded work includes bug repairs, copy and UX polish, loading/progress,
recovery, accessibility, regression tests, observability, evidence instrumentation,
small correctness fixes and benchmarks from demonstrated failures.

Mike's approval is required for replacement architecture, major workflows, significant
schema changes, new infrastructure or model vendors, major cost increases, removal of
major capabilities, substantial philosophy or safety-policy changes, production
migrations/deployments and irreversible customer-data operations. Escalate uncertain
scope instead of broadening it. Existing merge and independent-review gates still apply.

## 24. PR evidence contract

Every refinement PR SHALL explain observed/expected behavior, first failing layer,
demonstrated root cause, repair, reuse, opposite controls, exact deterministic results,
real-model replay, surface-specific device evidence, exact identities and uncertainty.
Test counts are not evidence that a generated answer is correct.

## 25. Owner Proxy output

Give Mike a short plain-language report: current state; what changed; what remains
wrong; evidence and its limits; owner decision needed; next bounded mission. Publish
sanitized reports on GitHub with detailed evidence linked appropriately. Mike should
not need implementation knowledge to understand progress or make the decision.

## 26. Continuous refinement mode

After the benchmark infrastructure is established, support this operating instruction:

> Run the MIRA refinement loop. Use the governing owner principles and current
> repository truth. Execute representative product workflows, identify the first
> demonstrated unacceptable behavior, trace it to the first failing layer, and propose
> or execute the smallest permitted repair. Do not expand scope. Do not declare success
> without frozen-source replay evidence.

This is the intended post-feature-development mode. Configure ownership, limits and
cadence on existing execution tooling after readiness; do not create a large new
agent subsystem first or activate an unspecified recurring job.

## 27. Success metrics

Keep correctness (faithfulness, unsupported claims, association/context errors),
usefulness (useful follow-ups, generic lists, unnecessary refusals), safety (unsafe
advice and safe-request false positives), UX (upload/retry/persistence/source-opening/
continuity/latency) and engineering (escaped regressions, benchmark regressions,
duplicated architecture, missions without owner intervention) separate. Report
attempts, denominators, unknowns and scoring provenance. No single aggregate quality
score replaces these dimensions.

## 28. Initial implementation plan

1. Governance: principles, mission contract and autonomy boundaries; no runtime change.
2. Benchmark foundation: convert #3999 to BENCH-FIREPLACE-001; separate private evidence,
   deterministic fixtures and scoring contracts.
3. Evaluation harness: connect/instrument existing paths to record evidence,
   interpretation, context, retrieval and answer; no parallel production reasoning path.
4. Owner Proxy: connect existing agent tools to reconnaissance, execution, classification,
   bounded repair, delegation, verification and PR reporting.
5. Expansion: grow toward about ten valuable workflows from actual failures.
6. Continuous refinement: periodic and post-feature missions, each stopping at one
   demonstrated unacceptable behavior instead of generating speculative backlogs.

## 29. Initial acceptance criteria

The system is operational only after demonstrating all sixteen abilities: current
repository reconnaissance; BENCH-FIREPLACE-001 execution; exact identity capture;
separation of deterministic and generative evidence; first-layer attribution; bounded
repair contract; architecture reuse; collision avoidance; authorized implementation
or delegation; regression and opposite controls; candidate freeze; original replay;
PASS/FAIL/UNKNOWN outcome; concise owner report; reviewable PR package; and stopping
before unrelated expansion. Documentation alone does not satisfy these criteria.

## 30. First mission — finish #3999's evidence

[PR #3999](https://github.com/Mikecranesync/MIRA/pull/3999) remains the initial proving
ground. **Do not create new architecture first.** Complete its outstanding evidence:

1. Repair remaining interpretation-to-answer attribution errors.
2. Address or explicitly localize uncertain small-print readings.
3. Freeze one exact candidate.
4. Run the complete five-photo benchmark.
5. Run changed-order controls.
6. Verify on the physical Pixel.
7. Verify conversation continuity through phone → web → phone.
8. Preserve #3984 and other safety blockers until their own clearing contracts are
   demonstrated.

Continue authorized investigation on the emulator until Mike reconnects the Pixel.
Emulator evidence cannot substitute for steps 6 or 7's physical-phone requirement;
record unavailable physical proof as UNKNOWN without stopping independent emulator work.

Once #3999 reaches a defensible outcome, extract its successful methodology into the
permanent Owner Proxy system. Do not present the general system as operational first.
The [first-mission record](../missions/OWNER-PROXY-FIREPLACE-001.md) scopes this work.

## 31. Governing principle

The Owner Proxy reduces Mike's need to personally discover and translate every
product-quality problem. It does not replace his authority. Mike defines what MIRA
should become. The proxy repeatedly asks:

> What is the first demonstrated thing that does not meet that standard?

Then it proves the problem, repairs the correct layer, proves the result and stops
before expanding scope.
