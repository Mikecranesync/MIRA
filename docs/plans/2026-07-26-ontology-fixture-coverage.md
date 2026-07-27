# Ontology follow-up plan — fixture coverage, mappings, drift check, CI

**Created:** 2026-07-26
**Governs:** the ADR-0032 §8 follow-ups left open by PR #2936 (ontology foundation)
**Status:** Phase 0 complete (foundation + harness proven). **Phase 1 complete** (evidence module,
10/10 shapes, coverage 1/42 → 11/42). **Phase 2 complete** (controls module, 11/11 shapes,
coverage 11/42 → 22/42, plus one fail-closed correction to `WritableSignalShape`).
**Phase 3 planned in detail below, not implemented** (electrical + maintenance → 32/42).
Phases 4–7 open.

---

## Where this starts

PR #2936 landed the foundation: 6 Turtle modules, 6 SHACL shape files (42 shapes),
`tools/validate_ontology.py`, ADR-0032, and **one seed fixture pair**. Syntax + hygiene phases are
real and green; the fixture phase is 1/42 covered.

Two things the seed already bought us, which set the difficulty for everything below:

1. **The harness works end-to-end for both constraint styles.** Property-shape violations
   (`sh:property [ … ]`) and SPARQL-constraint violations (`sh:sparql [ … ]`) both attribute
   correctly to the named shape a fixture declares. Verified with a real fixture of each kind.
2. **The attribution bug is already fixed.** `sh:sourceShape` names the *blank* inner shape, not
   the named node shape — so `# EXPECT-VIOLATION:` was unsatisfiable until `_named_ancestors`
   walked up the shapes graph. Had this been found in Phase 3 instead of Phase 0, every fixture
   written before it would have been silently mis-verified.
   **Measured blast radius (Phase 1 correction):** **17 of 42** shapes — those declaring
   `sh:property` and no `sh:sparql`. The 19 `sh:sparql` shapes were never affected (pyshacl
   attributes SPARQL constraints to the named shape directly); 6 more use node-level constraints
   and likewise attribute directly. An earlier "~36 of 42" figure in this document and in
   ADR-0032 was an estimate and was wrong.

The remaining work is therefore **volume, not risk**. Read the current uncovered list from the
tool, never from this document:

```bash
python tools/validate_ontology.py     # [SKIP] shapes:fixture-coverage → N/42 + names
```

---

## The recurring per-fixture recipe

Each shape gets a **pair**, and the pair is the unit of work:

- `ontology/fixtures/valid/<module>_<case>.ttl` — a minimal graph that **conforms**. Proves the
  rule doesn't fire on legitimate data (a rule that rejects everything is not a rule).
- `ontology/fixtures/invalid/<module>_<case>.ttl` — a minimal graph that violates **exactly** the
  named shape, declared in a `# EXPECT-VIOLATION: mirash:<ShapeName>` header.

Copy `fixtures/{valid,invalid}/drives_*_fault.ttl` — they are the annotated templates.

**The bar for an invalid fixture:** it must fail for the *declared* reason. The validator already
enforces this (a fixture that violates some *other* shape fails, and reports what did fire), so
the discipline is mechanical rather than a review judgement call. Keep fixtures minimal — every
extra triple is another shape that might fire and turn the fixture into a false pass elsewhere.

**Batch size:** one PR per module (below). Fixtures within a module share vocabulary, so they are
cheaper together than scattered; and a module-sized PR is reviewable in one sitting.

---

## Phase 1 — `evidence` (10 shapes) · **do this first**

The keystone module and the highest-safety rules: this is the "an AI approves its own work" class.
Every one of these encodes a prohibition that is currently doctrine-only.

| Shape | Kind | Rule |
|---|---|---|
| `ApprovedAssertionEvidenceShape` | prop | R9 verified assertion needs evidence + approver + timestamp |
| `CitationCompletenessShape` | prop | R9b citation names a source document |
| `AssertionShape` | prop | confidence within [0,1], structural completeness |
| `InferenceCannotSelfApproveShape` | SPARQL | R10a an inferred assertion needs a *distinct* approval event |
| `ApproverIsNotProposerShape` | SPARQL | R10b approver ≠ proposer |
| `MachineVerifiedIsNotApprovedShape` | SPARQL | R10c `machine_verified` never maps to `verified` |
| `ProvenanceTierIsNotApprovalShape` | SPARQL | R10d source strength ≠ who signed off |
| `SupersededNotCurrentShape` | SPARQL | R14a superseded ≠ current |
| `InvalidatedNotCurrentShape` | SPARQL | R14b invalidated ≠ current |
| `SupersededStateShape` | SPARQL | R14c superseded leaves the verified set |

7 of 10 are SPARQL constraints over `mira:Assertion`, so they share one fixture skeleton (an
Assertion with `subject`/`predicate`/`object` + `proposed_by`/`approved_by`/`approval_state`).
Build that skeleton once and vary one property per case.

**Why first:** these are the rules whose violation is least visible in production. A wrong fault
scope eventually surfaces as a bad answer; a self-approved inference silently becomes "verified"
and is then trusted forever.

## Phase 2 — `controls` (11 shapes)

Live-data honesty and the read-only OT boundary.

| Shape | Kind | Rule |
|---|---|---|
| `CommandNotFeedbackShape` | SPARQL | R3 a command bit never supports "the motor **is** running" |
| `StaleCommsNumericClaimShape` | SPARQL | R12b no numeric claim over dead comms |
| `LiveDiagnosisEligibilityShape` | SPARQL | R12a live diagnosis needs fresh, healthy data |
| `ClockProvenanceShape` | SPARQL | R12c event time vs ingest time |
| `BooleanNotQuantityShape` | SPARQL | R2 a boolean is not a quantity |
| `QuantityKindNeedsNonBoolShape` | SPARQL | R2b quantity kind implies a numeric signal |
| `MeasurementCompletenessShape` | prop | R1 value + unit + quality + timestamp |
| `RegisterInterpretationShape` | prop | R5 register needs datatype + scaling + unit |
| `ScalingRuleShape` | prop | scaling rule structural completeness |
| `ReadOnlyPolicyShape` | prop | R13 read-only policy |
| `WritableSignalShape` | prop | R13b command signals are read-only to MIRA |

`ReadOnlyPolicyShape` / `WritableSignalShape` are the graph-level counterpart to
`.claude/rules/fieldbus-readonly.md`. Cross-check their fixtures against
`mira-bots/tests/test_drive_packs_readonly.py` so the two layers can't drift apart.

### Phase 2 outcome (shipped)

11 fixture pairs (11 valid / 12 invalid — `WritableSignalShape` gets two invalid cases: an
explicit write path and the fail-closed missing-capability case). Coverage **11/42 → 22/42**.
Semantics are pinned by `tests/test_ontology_controls_phase2.py`, which asserts the constraints
directly rather than checking that files exist.

**One shape was corrected, not merely covered.** `WritableSignalShape` carried only
`sh:not [ sh:in (false) ]`. SHACL evaluates that per *value*, so a `CommandSignal` declaring no
`mira:read_only` at all had zero values and passed vacuously — an undeclared command point read
as safe. That is backwards for a capability flag. Phase 2 adds `sh:minCount 1` so missing
capability metadata fails closed, matching the default-deny posture of the fieldbus rule.
Verified by rebuilding the pre-fix shapes graph: the same input fires nothing before, and
`WritableSignalShape` after.

**Deliberate asymmetry between R13 and R13b.** `ReadOnlyPolicyShape` still tolerates an absent
`presents_action_as_permitted`, and that is correct: silence about an *assertion* means the claim
does not assert permission (safe). Silence about a *capability* means writability is unknown
(not safe). Both directions are pinned by tests so the asymmetry cannot drift unnoticed.

**Structural finding — R12b is not independently reachable.** For `StaleCommsNumericClaimShape`
to fire alone, an observation would need a quality that is not `good`, yet present (else R1
fires), yet outside `{bad, stale, uncertain}` (else R12a fires). `mira:QualityState` is closed at
exactly those four values, so no such value exists: R12b is strictly subsumed by R1 ∪ R12a. It is
kept as defence-in-depth — the three rules key on different things, so relaxing either neighbour
still leaves numeric claims guarded — and it becomes independently reachable if QualityState ever
gains a fifth value. Its fixture therefore co-fires with R1 by construction.

### What Phase 2 does NOT enforce (honest limits)

The controls module covers **live-data honesty** well and the **read-only boundary only at the
level of claims and signals**. Several stricter OT guarantees are *not representable* in the
current ontology, because the vocabulary for them does not exist:

| Guarantee | Status | Missing vocabulary |
|---|---|---|
| A recommendation cannot be represented as a command that was sent | **not enforceable** | no `Recommendation` / `Command` distinction |
| A proposed command cannot be represented as executed | **not enforceable** | no `Execution` / execution-evidence class |
| Execution claims must carry evidence from a control-capable path | **not enforceable** | no `Integration` class carrying a capability |
| A read-only connection cannot be the execution path for a write | **not enforceable** | same — connections are not modelled |
| Authorization must be explicit and separate from AI reasoning | **not enforceable** | no `Authorization` class; `approved_by` covers *assertion* approval, not *action* authorization |

`mira:ControlActionClaim` + `presents_action_as_permitted` is the only control-side vocabulary
that exists today, and it models what MIRA *says*, not what any integration *can do*. Closing
these gaps needs new classes (`Integration` with a capability flag, `Command`, `Execution`,
`Authorization`) and is a **Phase 7** candidate — deliberately not invented here, since inventing
ungrounded terms would violate the `mira:grounded_in` rule that every term abstract a real
repository artifact. **Do not describe MIRA as ontologically prevented from issuing OT writes on
the strength of Phase 2.** What is enforced: no *signal* is marked writable, and no *claim*
presents an action as permitted. The prohibition on actually issuing writes remains enforced by
code and rules (`.claude/rules/fieldbus-readonly.md`,
`mira-bots/tests/test_drive_packs_readonly.py`), not by the graph.

## Phase 3 — `electrical` (7) + `maintenance` (3) → **32/42**  *(PLANNED, not implemented)*

**Re-prioritised from the original "electrical + drives" grouping.** The instruction for this phase
is safety-first ordering, and `electrical` + `maintenance` is the pairing that front-loads the two
human-in-the-loop boundaries: *a symbol seen on a drawing is not a device in a panel*, and *a
software agent's summary is not a technician's observation*. `drives` moves to Phase 4 — its
highest-risk rule (R4 fault-code scope) is **already covered** since Phase 0, so what remains there
is lower-severity pack hygiene.

All 10 use vocabulary that already exists and is `grounded_in` real artifacts. **None** touch the
Phase 7 gap (`Integration` / `Command` / `Execution` / `Authorization` / execution-evidence).

### Shapes, guarantees, and proposed fixture pairs

| # | Shape | Guarantee | Invalid fixture | Valid fixture |
|---|---|---|---|---|
| 1 | `PrintObservationSeparationShape` | R8 — a mark seen on a sheet is not a physical thing | node typed **both** `PrintObservation` and `AssetInstance` | the two kept distinct, linked by `observed_as` |
| 2 | `PrintObservationEvidenceShape` | R8b — every reading cites its region + carries a TrustState | observation with no `supported_by`, no `trust` | observation citing an `ImageRegion`, `trust=proposed` |
| 3 | `PromotedSymbolNeedsHumanShape` | R8c — only a human turns a symbol into a component | `AssetInstance observed_as` an obs with `trust=machine_verified` | same, `trust=human_verified` |
| 4 | `ConductorEndpointsShape` | R6 — two resolved ends, **or** honest `endpoint_unresolved` | conductor with one endpoint and no unresolved flag | (a) two labelled endpoints; (b) one end + `endpoint_unresolved=true` |
| 5 | `ConnectionPointShape` | R6b — an endpoint is (device, terminal), not just a device | `ConnectionPoint` with no `terminal_label` | `terminal_label "X1:3"` |
| 6 | `VerifiedConductorNoUnresolvedShape` | R6c — a human cannot approve a run whose end was never read | `endpoint_unresolved=true` **and** `approval_state=verified` | unresolved but only `proposed` |
| 7 | `TerminalOwnershipShape` | R7 — a verified terminal is locatable in the panel | verified `Terminal` with no `belongs_to_device` | verified terminal owned by a device |
| 8 | `FaultNotFaultCodeShape` | a `Fault` (observed condition) ≠ a `FaultCode` (printed identifier) | node typed **both** | the observed fault linked to, not merged with, its code |
| 9 | `ResolutionEvidenceShape` | a `Resolution` is plant ground truth only if traceable to its job | orphan `Resolution`, no `WorkOrder closed_by` | resolution closed by a work order |
| 10 | `TechnicianObservationActorShape` | a SoftwareAgent summary is not a technician observation | `TechnicianObservation` with `proposed_by` a `SoftwareAgent` | `proposed_by` a `Technician` |

**Expected coverage: 22/42 → 32/42** (10 shapes, ~10 valid + ~11 invalid fixtures — R6 warrants two
valid cases for its two legitimate forms).

### Isolation risks (predicted — verify during implementation, do not assume)

- **R8 vs R8b/R8c.** A `PrintObservation` also typed `AssetInstance` will additionally trip R8b
  unless the observation carries `supported_by` + `trust`. Give it both so R8 isolates.
- **R8c fail-open on absent `trust`.** R8c's SPARQL is `?obs mira:trust ?t . FILTER(?t != human_verified)`
  — if the observation has **no** `trust`, the pattern does not match and R8c stays silent. The
  missing-trust case is caught only by R8b's `minCount 1`, and only when the object is typed
  `PrintObservation`. **Likely correction:** add a fail-closed clause to R8c (`FILTER NOT EXISTS
  { ?obs mira:trust mira:trust_human_verified }` instead of the inequality), which catches both
  "wrong trust" and "no trust". Decide with a fixture, exactly as `WritableSignalShape` was decided
  in Phase 2 — this is the same bug class.
- **R6 vs R6b.** A conductor fixture carrying `ConnectionPoint`s trips R6b unless each endpoint has
  a `terminal_label`. Label them.
- **R6c vs R6.** No conflict: `endpoint_unresolved=true` satisfies R6's escape hatch, so R6c
  isolates cleanly.
- **`FaultNotFaultCodeShape` vs `FaultCodeScopeShape` (Phase 0, drives).** A node typed `FaultCode`
  is targeted by R4, which demands `scoped_to` + `supported_by` + `fault_mnemonic`. Supply all three
  so the maintenance rule isolates.
- **`TechnicianObservation`** — confirm its superclasses before writing the fixture; if it is a
  subclass of `Observation`, `MeasurementCompletenessShape` may co-target it.

### New harness ground covered by Phase 3

`ConductorEndpointsShape` is node-level `sh:or` over RDF list cells — the **first real fixture** to
exercise the list-cell branch of `_named_ancestors`, which until now has only synthetic unit-test
coverage (`tests/test_ontology_attribution.py::test_or_list_cell_blank_node_resolves_to_owner`).
Confirm attribution resolves to `ConductorEndpointsShape` and not to an anonymous inner shape.

`sh:targetObjectsOf` remains unexercised by any fixture after Phase 3 — both its shapes
(`InstanceOfDirectionShape`, `FaultCodeScopeTargetShape`) fall in Phase 4.

### Acceptance criteria (exact)

1. `python tools/validate_ontology.py` → exit 0, **`32/42` shapes pinned**, 20→10 uncovered.
2. Every new invalid fixture fires its **declared named** shape; the isolation audit shows no
   *undocumented* co-firing.
3. New `tests/test_ontology_electrical_maintenance_phase3.py` asserts the constraints
   semantically (not file existence), including the R8c missing-`trust` decision and the R6
   two-legitimate-forms case.
4. Phase 1 + Phase 2 fixtures and tests unchanged and still green (`39 passed` becomes N passed,
   with zero prior tests removed or weakened).
5. CI step `Ontology validation (ADR-0032)` executes (non-skipped, `conclusion=success`) and its log
   shows the validator result, the `32/42` coverage line, and the test count.
6. `git diff --check`, `ruff`, `pyright`, `actionlint` clean; `/VERSION` bumped with a CHANGELOG entry.

### Honest exclusions

- **Nothing from Phase 7** — no `Integration` / `Command` / `Execution` / `Authorization` vocabulary
  is invented to reach a higher number.
- **`SelfParentShape` (core, Phase 4) is already known-subsumed.** Verified empirically: a
  self-parent matches `mira:has_parent+`, so `ContainmentCycleShape` fires alongside it and R11a can
  **never** fire in isolation — the same relationship R12b has to R1 ∪ R12a. Its fixture will
  co-fire by construction and must say so. (`ContainmentCycleShape` *is* isolatable via a 2-node
  cycle, which does not trip R11a.)
- **`RemedySafetyShape` (drives, Phase 4) severity question is now settled** — verified that a
  `sh:Warning`-only violation still yields `conforms=False` in pyshacl, so it needs no special
  handling in the harness. Recorded here so Phase 4 does not re-investigate.
- **No shape is corrected merely to make a fixture pass.** The one candidate correction (R8c
  fail-closed) is justified on its own safety merits — absent metadata must not read as safe — and
  is the identical bug class already fixed in `WritableSignalShape`.

## Phase 4 — `drives` remaining (5) + `core` (5) → **42/42**

Closes coverage. Lower severity than Phase 3, and carries the two already-diagnosed oddities.

**drives:** `FaultCodeScopeTargetShape` (R4b, `sh:targetObjectsOf` — first fixture for that
targeting mode), `FaultAppliedToWrongFamilyShape` (R4c — a working fixture was already written and
verified during the Phase 0 tracer-bullet probe; re-create it), `DriveFamilyIdentityShape`,
`ParameterCardCitationShape`, `RemedySafetyShape` (`sh:Warning`; behaviour confirmed above).

**core:** `AssetClassInstanceShape`, `AssetClassHasNoUnsPathShape`, `InstanceOfDirectionShape`
(`sh:targetObjectsOf`), `ContainmentCycleShape` (isolatable via a 2-node cycle), `SelfParentShape`
(**known-subsumed**, will co-fire with `ContainmentCycleShape` by construction).

## Phase 5 — `ontology/mappings/` + README

The QUDT / PROV-O / ISO-14224 crosswalks currently referenced only by `mira:maps_to` comments and
by `mira-maintenance`'s header. **Mappings, never imports** — the external vocabularies are not
redistributed (license hygiene, PRD §4). `mapping_files()` in the validator already globs
`ontology/mappings/*.ttl` into the ontology graph, so this phase needs no tool change.

## Phase 7 (new, from Phase 2) — OT action vocabulary

Surfaced by Phase 2: the ontology cannot express recommendation ≠ command ≠ executed, nor that a
read-only integration is never an execution path, because the terms don't exist. Needed:
`Integration` (with an explicit capability flag), `Command`, `Execution` (+ execution evidence),
`Authorization` (distinct from `approved_by`, which approves *assertions*, not *actions*).

Each new term must carry `mira:grounded_in` pointing at a real repository artifact — if no such
artifact exists yet, the term is premature and the gap stays documented rather than papered over
with invented vocabulary. See "What Phase 2 does NOT enforce" above.

## Phase 6 — `tools/ontology_drift_check.py` + CI wiring

The drift check asserts every `term_status "canonical"` term **still exists** as the production
identifier it claims to be (a `relationship_type` string, a `CHECK` value, an i3X registry entry).
This is what stops the ontology from quietly becoming a second, diverging source of truth — the
main long-term failure mode of an ontology layer.

Wire `validate_ontology.py` into CI **after Phase 1**, not before: it is already safe to run (exit
0 today), but it earns its place as a gate once it's actually pinning the evidence rules.

---

## Sequencing and PR shape

```
PR #2936  ✅ Phase 0 — foundation + harness proven + 1/42
   ↓
PR   n+1     Phase 1 — evidence      (10) → CI wiring becomes worthwhile
   ↓
PR   n+2     Phase 2 — controls      (11)
   ↓
PR   n+3     Phase 3 — electrical(7) + maintenance(3)  -> 32/42
   ↓
PR   n+4     Phase 4 — drives(5) + core(5)             -> 42/42
   ↓
PR   n+5     Phase 5 — mappings/
   ↓
PR   n+6     Phase 6 — drift check
```

Phases 1–4 are independent of each other (different modules, different fixtures) and could run in
parallel if desired; the ordering above is by **safety value**, so a stall after any phase still
leaves the most dangerous rules pinned.

### ⚠️ Repo gotcha: a stacked PR gets ZERO CI

Every workflow in `.github/workflows/` is gated on `pull_request: branches: [main]`, and `ci.yml`
has no `workflow_dispatch`. **A PR whose base is a feature branch therefore triggers no workflow
runs at all** — `gh run list --branch <branch>` returns empty.

The trap is that such a PR still reports `mergeStateStatus: CLEAN`. That is not "CI passed"; it is
"no required check was ever evaluated." Do not read it as a green light. (Observed on PR #2939,
Phase 1.)

Options, in order of preference:

1. **Merge the parent first, then let GitHub auto-retarget the stacked PR to `main`** — CI fires
   on retarget and the PR is validated normally. This is the intended flow.
2. **Open each phase PR against `main` sequentially**, after the previous phase merges. No stack,
   no gap, at the cost of serialization.
3. **Verify locally and say so explicitly in the PR body**, including a clean-room run of the exact
   CI step (`python -m venv` → `pip install -r ontology/requirements.txt` → validator + pytest), so
   a reviewer is never misled by the CLEAN badge.

Whichever is chosen, a phase PR must never be described as "CI green" until a workflow run actually
exists for its head SHA.

## Definition of done for the fixture work

- `shapes:fixture-coverage` reports **42/42**, no uncovered names.
- Every invalid fixture names its shape and fails for that reason (validator-enforced).
- Every valid fixture conforms to **all** shapes, not just its own module's.
- `python tools/validate_ontology.py` exits 0 with zero SKIPs.
- The validator runs in CI, so a red run means a real regression.

## Risks and how they're handled

| Risk | Handling |
|---|---|
| A fixture passes for the wrong reason | Validator requires the *declared* shape to fire and reports what did — already enforced, already tested both directions |
| Partial coverage reads as full coverage | `shapes:fixture-coverage` always prints `N/42` + the uncovered names |
| Fixtures drift from the code the shapes abstract | Phase 6 drift check; `mira:grounded_in` on every term is the anchor |
| An over-broad fixture trips unrelated shapes | Keep fixtures minimal; the valid-fixture phase catches over-broad *valid* ones immediately |
| `RemedySafetyShape` is `sh:Warning` | **RESOLVED (Phase 2 close-out):** verified that a Warning-only violation still yields `conforms=False` in pyshacl, so it needs no special harness handling. Shape moves to Phase 4. |
| A shape can never fire in isolation (subsumption) | Detect during the isolation audit, document in the fixture, keep the shape as defence-in-depth. Two known: R12b ⊂ R1 ∪ R12a; `SelfParentShape` ⊂ `ContainmentCycleShape`. |
