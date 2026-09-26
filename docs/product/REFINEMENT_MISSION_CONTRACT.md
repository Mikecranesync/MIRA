# Owner Proxy refinement mission contract

Status: **Proposed; no scheduler or runtime activated**

Governing product judgment: [owner operating principles](OWNER_OPERATING_PRINCIPLES.md)

## Purpose and roles

Mike sets product principles, boundaries, benchmark expectations, and major direction.
The Owner Proxy observes real use, identifies demonstrated failures, coordinates a
small repair, and demands proof that the original experience improved.

Reuse the [Foreman management contract](../missions/AUTONOMOUS-FOREMAN-V1.md), its
existing mission records, and existing execution tools. Do not create another agent
manager, database, production reasoning path, or background service for this contract.
Keep the manager, implementer, exact-version reviewer, and acceptance verifier roles
distinct as the existing Foreman contract requires. The manager cannot mark its own
work independently verified. Preserve Foreman's current one-implementer limit;
large work may be divided into non-overlapping assignments executed within that limit.

## Permission boundary

An authorized mission may repair bounded bugs, wording, accessibility, loading feedback,
error recovery, tests, evidence instrumentation, and small correctness defects. It may
add benchmark cases based on demonstrated failures. This is not permission to run an
unbounded loop or ignore existing ownership and review rules.

Mike's explicit approval is required for replacement architecture, major workflows,
significant schema changes, new infrastructure providers or AI/model vendors, major
cost increases, removal of major capabilities, substantial product-philosophy or
safety-policy changes, production migrations/deployments, and irreversible customer
data operations. Existing merge, HELD-PR, credentials, fleet, and release gates remain.
When scope is uncertain, document the concrete decision rather than expand it.

Each mission records its existing execution host, owner, allowed files, permitted
environment/account, time/call/cost limits, stop conditions, and reporting destination.
Missing limits do not mean unlimited permission. Use the existing scheduler only after
mission readiness, ownership, cadence, and execution limits are explicitly established.
Do not create a second recurring job where one already owns the work.

## Mission record: required input

Store the record under the existing `docs/missions/` convention, with private artifacts
referenced by protected identifiers rather than copied into public GitHub text.

- Mission ID, one demonstrated problem, benchmark/version and origin issue/PR.
- Literal prompt and input-evidence references; rights/privacy classification.
- Main SHA, candidate source/build/backend/model identities and dirty/clean state.
- Owner, worktree/branch, relevant open work and collision assessment.
- Seven-layer assessment; first divergence and evidence, or explicitly unknown.
- Root-cause hypothesis versus demonstrated mechanism.
- Existing responsible component, smallest change, allowed files and out-of-scope list.
- Original replay, opposite controls, required surfaces, attempt count and acceptance rule.
- Runtime/cost limits, approval requirements, and exact stop/handoff conditions.

## Quality layers — grade independently

| Layer | Question | Evidence to examine |
| --- | --- | --- |
| A: Acquisition | Did the intended evidence arrive? | Attachment, bytes/hash, prompt, document/asset association |
| B: Interpretation | Was it read correctly? | Raw OCR/vision description, label-to-object mapping, units/orientation |
| C: Context and persistence | Was the right evidence kept and supplied later? | Stored turns/photos, scoped context, restart and cross-device history |
| D: Retrieval | Were the right references found without introducing unrelated material? | Query, filters, returned documents/chunks and actual context |
| E: Reasoning and synthesis | Did the answer stay faithful to the evidence? | Claims versus observations, source excerpts and technician statements |
| F: Safety | Were unsafe actions blocked and valid help preserved? | Unsafe and nearby-safe controls, actual served answer |
| G: Presentation and usability | Could the technician understand and recover the interaction? | Screen behavior, progress, latency, original viewing, retry/navigation |

Assess all seven; record PASS / FAIL / UNKNOWN with supporting evidence for each.
Declare required applicability before testing; do not mark an untested layer PASS.
Follow the actual data path when locating the first divergence; the letters are
categories, not a promise that execution occurs alphabetically. Independent UX and
safety failures may need separate bounded missions. Unknown upstream evidence means
the root cause remains a hypothesis, not a demonstrated attribution.

If the interpretation says CURRENT SENSOR but the answer says FLAME SENSOR, investigate
E first; do not change B merely because a vision prompt is easier to edit.

## The mission loop

Observe → Capture → Classify → Trace → Repair → Freeze → Replay → Challenge → Accept

1. **Reconnaissance.** Fetch main; record its exact SHA; inspect recent commits,
   relevant open PRs/issues, active work claims, local modifications and ownership.
   Inventory existing components/tests. Produce REUSE / CONNECT / FINISH / REPAIR.
   Names and historical handoffs are not proof of current state. Resolve collisions
   before editing; preserve active worktrees and private evidence.
2. **Demonstrate.** Reproduce or collect strong existing evidence of one failure.
   Record prompt, supplied evidence, output, expected behavior, environment, source,
   app/build/backend/model identities, and suitable screenshots/logs. Suspicions are
   investigation items; absent evidence is not a product failure by itself.
3. **Classify and trace.** Compare evidence → interpretation → assembled context →
   retrieval → final answer using existing diagnostics. Record the first demonstrated
   mismatch and why another layer is not the source. Keep hypothesis separate from fact.
4. **Bound the repair.** State problem, cause, existing owner mechanism, smallest change,
   files, out-of-scope work, opposite controls and measurable acceptance requirements.
5. **Implement.** Reuse existing architecture; avoid unrelated refactoring; preserve
   ownership. Add regression coverage and required observability. No benchmark hints.
6. **Check deterministic behavior.** Run the failing regression, opposite controls,
   affected suites, type/static checks and applicable integration tests. Report exact
   counts/commands and new versus pre-existing failures. Never hide baseline failures.
7. **Freeze.** Use a clean, committed candidate. Record full source SHA, app version and
   build hash, backend SHA, environment, actual requested/returned model/provider,
   relevant configuration fingerprint with secrets excluded, and benchmark/scorer version.
   Verify what the running system actually serves. Any relevant change invalidates the
   freeze and requires a new candidate/run identity. Live editing is diagnostic only.
8. **Replay.** Execute the original literal interaction on frozen source. Capture
   intermediate readings separately from final answers. Keep run IDs, timestamps,
   failed attempts and environment failures. Do not replace earlier results.
9. **Challenge.** Run the predeclared controls: different evidence order, similar
   equipment, ambiguous labels, safe/unsafe neighboring requests, current and historical
   photos, text continuation, restart, interrupted upload and required device transitions.
   Do not select only the successful repeats. Independent review/verification follows
   the existing exact-SHA role rules, not the implementer's self-assessment.
10. **Decide and report.** End this attempt with exactly one outcome below, preserve its
    evidence, and nominate one next bounded mission. Do not silently broaden the mission.

## Outcome, not release permission

- **PASS:** the original failure is absent under the predeclared acceptance contract,
  on the exact frozen candidate, and all required controls/evidence are satisfied.
- **FAIL:** the candidate demonstrably violates the contract. Preserve the first
  remaining failure; a new repair attempt gets a new record.
- **UNKNOWN:** required evidence could not be obtained, for example an unavailable
  Pixel, provider, input, or valid environment. State exactly what is missing.

If a demonstrated failure and missing evidence coexist, the overall attempt is FAIL
and the missing portions stay UNKNOWN in the layer/surface record. No demonstrated
failure but incomplete required proof is UNKNOWN. PASS never follows from an exit
code, a skipped test, a plausible diagnosis, an average score, or a later lucky answer.
Keep these product outcomes separate from Foreman's GO/NO-GO recommendation and human
merge/deploy approval; there is no automatic PASS-to-GO conversion.

## Review package and owner report

A refinement PR must state: observed behavior; expected behavior; first failing layer;
demonstrated root cause; repair; reused architecture; opposite controls; exact test
results; real-model replay; emulator/Pixel/browser evidence separately; exact identities;
and remaining uncertainty. Explain developer detail in a linked appendix.

Mike receives a short plain-language report with these six fields:

1. Current state — what the product demonstrably does now.
2. What changed — the behavior that improved.
3. What remains wrong — observed failures, not speculation.
4. Evidence — what was tested, on which version and surface; what was not tested.
5. Decision needed — one concrete owner decision, or “none for this slice.”
6. Next bounded mission — the next small investigation or repair and its stopping point.

## Rollout and operational acceptance

1. Review/adopt the principles and this contract; no runtime change is required.
2. Register BENCH-FIREPLACE-001 with private evidence, scoring contract and controls.
3. Connect existing diagnostics and benchmark records; demonstrate one complete capture.
4. Use the existing agent manager/executor to complete one bounded PR #3999 mission.
5. Add demonstrated cases toward roughly ten valuable workflows, not dozens of invented ones.
6. Only then enable an explicitly configured periodic/post-feature execution mode.

Operational means demonstrated current-state reconnaissance, collision avoidance,
BENCH-FIREPLACE-001 execution, exact identities, first-layer attribution, a bounded
repair contract, reuse, authorized implementation/delegation, deterministic checks,
frozen replay, challenge, PASS/FAIL/UNKNOWN outcome, owner report, reviewable GitHub
package, and stopping at the boundary. A collection of these documents is not that proof.

The user's First Mission section arrived truncated at “Repair remaining interpretation-t…”.
Do not reconstruct its missing requirements or treat this proposal as a new mission dispatch.
The current known PR #3999 failures are described in the linked reconnaissance report.
