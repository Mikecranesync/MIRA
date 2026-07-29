# ADR-0032: Ontology Foundation (OWL/SHACL layer over the existing schema)

**Status:** Accepted (foundation phase; fixture coverage and CI wiring are follow-up phases, see §8)
**Date:** 2026-07-26
**Driver:** Make MIRA's cross-cutting domain concepts (assertion, evidence, approval, UNS scope,
fault-code scope, print-observation trust) explicit and machine-checkable, instead of living only
as scattered doc comments, CHECK constraints, and convention.
**Relates to:** ADR-0013 (UNS schema canonicalization), ADR-0017 (proposal state machine), ADR-0025
(drive intelligence packs), ADR-0026 (machine pack/provenance unification), ADR-0028
(vision-zero-token architecture), ADR-0029 (materialized evidence), `.claude/rules/uns-compliance.md`,
`.claude/rules/knowledge-entries-tenant-scoping.md`

## Context

MIRA has real, load-bearing domain rules that today are enforced only by scattered code and
convention: a fault code is meaningless without its drive-family scope; an inferred assertion
cannot self-approve; a PrintSense observation cannot become a verified physical asset without a
human step in between; a live diagnosis claim needs fresh, healthy telemetry, not a stale command
bit. Each rule already exists somewhere — a docstring, a `CHECK` constraint, a code comment — but
nothing lets a reviewer or a CI job ask "does this new relationship actually violate the
fault-code-scope rule?" in one place, across modules, deterministically.

An ontology answers that, but only if it doesn't become a second source of truth that drifts from
the schema. The two failure modes to avoid: (1) inventing vocabulary that doesn't correspond to
anything real (the classic ontology-engineering trap), and (2) building something so abstract
(full OWL reasoning, RDF-star, a quad store) that it needs infrastructure MIRA doesn't have and
never will in its current architecture.

## Decision

Six Turtle modules under `ontology/`, six paired SHACL shape files under `ontology/shapes/`, and a
deterministic offline validator (`tools/validate_ontology.py`) that runs with zero paid calls and
zero network after `pip install`.

### Module boundaries

| Module | Owns | Imports |
|---|---|---|
| `mira-core` | Physical hierarchy, asset class vs. instance, documents, the ontology's own annotation properties (`grounded_in`, `term_status`, `maps_to`) | — |
| `mira-controls` | Control program structure (Controller/Program/Routine), signals, observations, quality/freshness | core |
| `mira-evidence` | The reified `Assertion`, evidence/citation, agents, proposal/approval/supersession lifecycle | core |
| `mira-drives` | Drive families, fault codes, registers, remedies (Drive Commander domain) | core, controls, evidence |
| `mira-electrical` | PrintSense prints, symbols, terminals, conductors | core, evidence |
| `mira-maintenance` | Faults, failure modes, procedures, work orders, parts (deliberately the thinnest module — MIRA is not a CMMS) | core, evidence |

An earlier draft split control-program structure and live signal observation into separate
`mira-controls` / `mira-live` modules. They were merged: an `Observation` is not conceptually
separable from the `Signal` it observes, and `mira-live` would have shipped with no independent
shapes or fixtures of its own — a placeholder module is worse than a slightly larger one.

**Finding F3 (signal-class vocabulary):** MIRA has no signal-class vocabulary anywhere in code
today. The command/status/fault-code/measurement distinctions in `mira-controls` are currently
*implicit* — scattered across drive-pack `cmd_word`/`status_bits`/`fault_codes`, Sparkplug
`SparkplugTopic.is_command`, and the PLC parser's flat `urn:mira:type:signal`. Every subclass in
that vocabulary is `term_status "proposed"`: this module is where the vocabulary is defined for
the first time, not where an existing one is mirrored. Promotion to `"canonical"` happens
per-term, in a future PR, if and when code actually starts keying on the distinction.

### §6 — Statement-level evidence strategy: reification, not RDF-star or named graphs

Every claim MIRA holds or renders needs its own approval state, confidence, and provenance —
i.e., a triple isn't just true or false, it's *held* to some degree by some agent. Three ways to
express that were considered:

1. **RDF-star** (quoted triples as subjects). Rejected: SHACL has no standard way to target a
   quoted triple, so none of the rules below (`InferenceCannotSelfApproveShape`,
   `ApprovedAssertionEvidenceShape`, …) would be enforceable by a SHACL engine.
2. **Named graphs** (one graph per assertion, graph URI carries metadata). Rejected: requires a
   quad store, which MIRA does not run, and the safety rules (`.claude/rules/fieldbus-readonly.md`
   et al.) forbid adding infrastructure whose failure mode is silent metadata loss.
3. **Reification** (`mira:Assertion` as a first-class subject–predicate–object entity, chosen).
   This already exists in the schema: `kg_triples_log` has literal `subject`/`predicate`/`object`
   columns, and `kg_relationships` rows already carry `approval_state` + `confidence` +
   properties. `mira:Assertion` is the ontology's *view* of that row — no migration, no new store.

`mira:subject` / `mira:object` are therefore the structural endpoints of the reification pattern
(mirroring `rdf:subject`/`rdf:object`), not domain relationships a technician-facing query walks
in reverse — see the inverse-completeness bar in §5.

### §7 — Trust ↔ approval crosswalk

PrintSense and the kg/Hub proposal pipeline each evolved their own confidence vocabulary:
`kg_*.approval_state` (`proposed`/`verified`/`rejected`/`needs_review`[/`deprecated`, relationships
only]) and PrintSense `TrustState` (`proposed`/`machine_verified`/`human_verified`/`unresolved`).
Critically, PrintSense splits `verified` into machine- vs. human-verified; `kg_*.approval_state`
does not — it has one flat `verified`. Collapsing those two would let a deterministic
self-consistency check masquerade as human approval, which the safety/approval rules forbid
(`ApproverIsNotProposerShape`, `MachineVerifiedIsNotApprovedShape`).

Both vocabularies are modeled as-is (`mira:ApprovalState`, `mira:TrustState`, both
`rdfs:subClassOf mira:ControlledVocabulary`), and the mapping between them is made explicit and
**lossy by record** via `mira:maps_to_approval_state`:

```
trust_proposed         → approval_proposed
trust_machine_verified → approval_proposed   (NOT approval_verified — the whole point)
trust_human_verified   → approval_verified   (the only trust state that maps to verified)
trust_unresolved       → approval_needs_review
```

### The grounding rule

Every `mira:` term the ontology *declares* (has an `rdf:type` in one of the six modules) must
carry `mira:grounded_in` — the concrete repository artifact (file, table, column, `CHECK` list,
dataclass, enum) it abstracts. A term with no `grounded_in` is a validator failure
(`ontology:every-term-is-grounded`). **Exemption:** `owl:AnnotationProperty` declarations
(`mira:grounded_in`, `mira:term_status`, `mira:maps_to` themselves) are the ontology's own
metadata vocabulary, not claims about the factory — there is no repository artifact for them to
abstract, and requiring `mira:grounded_in mira:grounded_in` would be circular.

`mira:term_status` is either `"canonical"` (already a production identifier — a
`relationship_type` string, a `CHECK` value, an i3X registry entry; a future drift check asserts
it still exists in code) or `"proposed"` (new in the ontology, not yet a production identifier,
exempt from the drift check, a candidate for a future PR). No third value.

### The inverse-completeness rule — and its bar

Every `owl:ObjectProperty` must either declare `owl:inverseOf` (with the reverse property
declaring it back — `ontology:inverse-symmetry`) or document, in `rdfs:comment`, why no inverse is
modeled. The bar for "no inverse" is **a named production query or answer-path traversal that
would need it, not a hypothetical.** Concretely:

- **Reification endpoints** (`mira:subject`, `mira:object`) — no inverse; filtering by
  `kg_relationships.source_id`/`target_id` is a query, not a graph edge.
- **Reporting/audit aggregates** (`mira:supported_by`, `mira:cite_doc`, `mira:proposed_by`,
  `mira:approved_by`, `mira:requires_safety`) — "how many things cite this doc" / "what has agent
  X proposed" are coverage reports or activity feeds, not something the diagnostic answer path
  walks backward.
- **Single-direction resolution** (`mira:describes_family`, `mira:member_of_family`,
  `mira:has_scaling`, `mira:expected_band`, `mira:scoped_to`, `mira:observed_signal`) — the reverse
  direction is answered by a file/DB lookup (`packs/<family>/pack.json`, a resolver keyed on
  `match_keywords`, a time-series query over `tag_events`) that the ontology doesn't need to
  duplicate as a graph walk.
- **Deliberately one-directional trust gates** (`mira:observed_as`) — the direction is the point:
  you may only walk observation → physical *after* a human approval exists (`observed_as` on
  `AssetInstance`), and modeling the reverse would let code bypass that gate by construction.
- **Genuine symmetric/paired relationships** get a real `owl:inverseOf` pair instead of a
  documented exemption: `supersedes`/`superseded_by`, `invalidates`/`invalidated_by`,
  `protects`/`protected_by`, `appears_on`/`shows`. `mira:cross_references` is its own inverse
  (symmetric sheet-to-sheet continuation).

Attribute-style properties whose `rdfs:range` is a `mira:ControlledVocabulary` subclass (`quality`,
`value_type`, `approval_state`, `trust`, …) are exempt from this rule entirely — they point at a
closed enumeration mirroring a production `CHECK` constraint, not at another entity, so "the
inverse of `quality=good`" isn't a meaningful traversal.

### §8 — Fixtures and CI are a follow-up phase, not this PR

`tools/validate_ontology.py` has four phases: syntax, hygiene (grounding/term-status/inverse
rules, above), valid fixtures (every fixture under `ontology/fixtures/valid/` must conform to
every shape), and invalid fixtures (every fixture under `ontology/fixtures/invalid/` must violate
the *specific* shape(s) named in its `# EXPECT-VIOLATION:` header — proving the rule is actually
enforced, not merely written).

This PR ships **one seed fixture pair** (`fixtures/valid/drives_scoped_fault.ttl` +
`fixtures/invalid/drives_unscoped_fault.ttl`, covering `FaultCodeScopeShape`) and leaves the
other 41 shapes uncovered. The seed is not decoration — it exercises the harness end-to-end, and
writing it immediately surfaced a foundational defect that would otherwise have been discovered
41 fixtures too late:

> **`sh:sourceShape` names the blank property shape, not the named node shape.** For the common
> `mirash:X sh:property [ sh:path … ; sh:minCount 1 ]` idiom, a violation is reported against the
> **anonymous** inner shape. The first `violated_shapes()` extracted local names from the URI, so
> a blank node yielded nothing and `# EXPECT-VIOLATION: mirash:X` could never be satisfied. Fixed
> by walking UP the shapes graph from the blank node to its owning named shape
> (`_named_ancestors`, through `sh:property` / `sh:node` / `sh:not` / the RDF list cells of
> `sh:or`/`sh:and`/`sh:xone`). Verified both ways: the correct expectation passes, and a fixture
> naming the *wrong* shape still fails and reports what did fire.
>
> **Blast radius, measured rather than estimated (corrected in Phase 1).** An earlier draft of
> this ADR said "~36 of the 42 shapes." That was an estimate and it was **wrong**. The real figure
> is **17 of 42** — the shapes that declare `sh:property` and no `sh:sparql`, whose constraints
> therefore live entirely in blank nodes. The **19** `sh:sparql` shapes were never affected:
> pyshacl attributes a SPARQL constraint to the *named* shape itself. The remaining 6 use
> node-level constraints (`sh:or`, `sh:class`) and likewise attribute directly. Confirmed
> empirically by re-running every invalid fixture under the pre-fix logic: exactly the
> property-shape fixtures fail, and every SPARQL-constraint fixture passes unchanged.

Building the remaining 41 is a phase of its own — fixture authoring plus pyshacl debugging per
shape — tracked as a follow-up rather than squeezed into the foundation PR.

Two guards keep that gap honest rather than silent:

- A **missing** `fixtures/valid/` or `fixtures/invalid/` directory is a deliberate `SKIP` (exit 0),
  not a failure, so the validator is safe to wire into CI before the phase completes. An
  **empty-but-present** directory still fails — once the phase begins, empty is a regression, not
  an absence.
- `shapes:fixture-coverage` always reports `N/42 shapes have an invalid fixture pinning them` and
  lists the uncovered ones by name. It never fails the run, because the dangerous failure mode is
  the *silent* one: two fixtures make every phase green and read as "the shapes are covered" when
  40 rules have never been exercised. Naming the number keeps the gap visible.

Same status for `ontology/mappings/` (referenced by `mira:maps_to` on `mira-core` and by the
ISO-14224 alignment note in `mira-maintenance`): the directory and its `README.md` don't exist
yet. `mira:maps_to` is a mapping, never an import — the external vocabulary (QUDT, PROV-O,
ISO 14224) is never redistributed — but writing the crosswalk file itself is deferred to the same
follow-up work as fixtures.

## Consequences

- New domain rules get expressed as a SHACL shape + `grounded_in` citations, not as a paragraph in
  a `CLAUDE.md` rule file that nothing checks. Existing doc-only rules migrate opportunistically,
  not as a rewrite.
- `tools/validate_ontology.py` is safe to wire into CI today (`syntax` + `hygiene` phases are real
  and green; `valid`/`invalid` phases SKIP cleanly).
- No OWL reasoner runs anywhere in MIRA. `owl:inverseOf` is a machine-readable declaration
  consumed by tooling (this validator, and a future `tools/ontology_drift_check.py`), not an
  invitation to add inference.

## Follow-ups (tracked, not in this PR)

1. Fixture coverage for the remaining 41 shapes (1 of 42 seeded here), each invalid fixture naming
   its expected shape(s). Run `tools/validate_ontology.py` for the current uncovered list.
2. `ontology/mappings/` + `README.md` — the QUDT/PROV-O/ISO-14224 crosswalks currently only
   referenced by `mira:maps_to` comments.
3. `tools/ontology_drift_check.py` — asserts every `term_status "canonical"` term still exists as
   the production identifier it claims to be.
4. Wire `tools/validate_ontology.py` into CI once (1) exists, so a red run means a real regression.
