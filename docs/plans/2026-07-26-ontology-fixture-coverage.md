# Ontology follow-up plan — fixture coverage, mappings, drift check, CI

**Created:** 2026-07-26
**Governs:** the ADR-0032 §8 follow-ups left open by PR #2936 (ontology foundation)
**Status:** Phase 0 complete (foundation + harness proven). **Phase 1 complete** (evidence module,
10/10 shapes, coverage 1/42 → 11/42). Phases 2–6 open.

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

## Phase 3 — `electrical` (7) + `drives` remaining (5)

Print → physical trust gates, plus finishing the drive-scope module.

**electrical:** `PrintObservationSeparationShape` (R8 — an observation is not a physical asset),
`PromotedSymbolNeedsHumanShape` (R8c — promotion requires a human), `PrintObservationEvidenceShape`
(R8b), `ConductorEndpointsShape` (R6), `ConnectionPointShape` (R6b),
`VerifiedConductorNoUnresolvedShape` (R6c), `TerminalOwnershipShape` (R7).

**drives:** `FaultCodeScopeTargetShape` (R4b), `FaultAppliedToWrongFamilyShape` (R4c — a fixture
already exists in scratch from the tracer bullet; promote it), `DriveFamilyIdentityShape`,
`ParameterCardCitationShape`, `RemedySafetyShape` (**note:** `sh:Warning` severity, not Violation —
confirm the harness treats a Warning-only fixture as non-conforming, or mark the fixture's
expectation accordingly; this is the one shape in the set with a known-different failure mode).

## Phase 4 — `core` (5) + `maintenance` (3)

Thinnest and most mechanical; good closing batch.

**core:** `AssetClassInstanceShape`, `AssetClassHasNoUnsPathShape`, `InstanceOfDirectionShape`,
`SelfParentShape` (R11a), `ContainmentCycleShape` (R11b — needs a 3-node cycle fixture).

**maintenance:** `FaultNotFaultCodeShape`, `ResolutionEvidenceShape`, `TechnicianObservationActorShape`.

## Phase 5 — `ontology/mappings/` + README

The QUDT / PROV-O / ISO-14224 crosswalks currently referenced only by `mira:maps_to` comments and
by `mira-maintenance`'s header. **Mappings, never imports** — the external vocabularies are not
redistributed (license hygiene, PRD §4). `mapping_files()` in the validator already globs
`ontology/mappings/*.ttl` into the ontology graph, so this phase needs no tool change.

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
PR   n+3     Phase 3 — electrical(7) + drives(5)
   ↓
PR   n+4     Phase 4 — core(5) + maintenance(3)   → 42/42
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
| `RemedySafetyShape` is `sh:Warning` | Called out in Phase 3 — confirm expected behavior before writing its pair |
