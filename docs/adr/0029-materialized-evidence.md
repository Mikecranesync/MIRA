# ADR-0029 — Materialized Evidence & Recall-First Architecture

**Status:** Accepted (doctrine) 2026-07-20. Implementation on the PR ladder in
`docs/architecture/materialized-evidence.md`. Extends ADR-0028 (Vision Zero-Token Architecture) from
vision to *all* expensive industrial data.

**Context.** MIRA processes datasets whose cost is measured in hours/days/model-expense (thousand-page
print packages, hundreds of photos, hours of video, PLC projects, years of historian). Recomputation
is not cheap, verification may need another expensive pass, and the data does not fit a context
window. Agent systems that assume "just run it again / ask the model again" fail here. The seed
pattern already exists (`printsense/cas.py`: content-addressed, producer-version-keyed derivation
cache). These decisions make it a platform layer without a big-bang rewrite and without duplicating
FactoryLM's canonical systems.

The six decisions (PRD Appendix A):

## A1 — Materialized Evidence is a first-class platform layer
It sits between raw source and Capability Packs. Consequences: expensive stage results are addressable
outside a chat session; evidence may exist before it is trusted; evidence is immutable **by version**;
corrections create new versions or review overlays; promoted packs identify exact evidence versions;
raw source remains authoritative; packs are not a substitute for preserving source-stage evidence.
**Rejected:** storing only the final model answer or final pack.

## A2 — Recall resolution precedes expensive execution
Every registered expensive stage calls a common recall-resolution service before processing.
Consequences: each stage declares its compatibility inputs; reuse decisions use consistent reason
codes; force-recompute requires authorization + an audit record; direct model calls that bypass recall
are prohibited for registered expensive stages; CI should detect known expensive entrypoints that skip
the recall contract where practical.

## A3 — Immutable evidence versions, mutable status overlays
Evidence payloads are immutable; review/trust/approval/stale/deprecation states are controlled status
records, not mutations of historical evidence. Consequences: old conclusions stay auditable; pack
builds stay reproducible; a human correction never erases the original machine proposal; the system
can explain what changed, when, and why.

## A4 — Dependency-aware invalidation
Invalidation follows explicit lineage edges, not broad cache clearing. Consequences: a source change
marks only dependent evidence stale; downstream pack versions are identified; unaffected evidence
stays usable; pack attachments stay active only while their required evidence remains valid under
policy; rebuilding creates a new version, never overwrites history. (Appendix F matrix → executable
tests.)

## A5 — Temporal executes; FactoryLM stores business state
Temporal owns durable orchestration state for migrated workflows; FactoryLM owns assets, permissions,
evidence manifests, approvals, attachments, and customer-visible status. Consequences: Temporal
histories carry ids + hashes, **not** industrial source payloads; `WorkflowRun` (mig 044) or its
canonical successor links to Temporal workflow/run ids; customer status pages read FactoryLM's ledger;
recovery procedures name which system is authoritative for each kind of state.

## A6 — Vendor-neutral evidence interface
DataChain may be evaluated/used **behind** a MIRA-owned evidence interface, but public domain contracts
cannot depend on DataChain-specific types. Consequences: adoption is reversible; a MIRA-native backend
and a DataChain backend are comparable (PR L bake-off); Capability Packs and MIRA runtime use the same
evidence API; no vendor becomes the approval authority or asset source of truth.

## Domain boundaries (PRD Appendix B, summarized)
Raw Source Store (immutable/revisioned objects, hashes, retention) · Evidence Catalog (manifests,
version lookup, lineage, stale state, summaries — **not** asset identity, auth policy, approval truth,
chat memory, or Temporal history) · Evidence Payload Store (typed records; Neon for bounded structured
+ object storage for large columnar/JSONL, or a DataChain backend, chosen by later ADR) · Approval
Systems (**reuse** `ai_suggestions`/`relationship_proposals`/KG approval — no new queue) · Capability
Pack System · Temporal · MIRA Runtime.

## Consequences for engineers
See `.claude/rules/materialized-evidence.md` (the 15 rules). The non-negotiables: recall before
recompute; chat is never the only store; preserve intermediate stages; content-addressed identity with
lineage; keep inference versions in lineage; invalidate only dependents; models never self-promote to
trusted; large data out of Temporal history; one shared evidence contract, no second registry/queue.

## Cross-references
- `NORTH_STAR.md` § "Materialized Evidence and Recall-First Architecture"
- `docs/architecture/materialized-evidence.md` (5 layers + contracts + PR ladder)
- `docs/architecture/materialized-evidence-inventory.md` (existing systems — the seed is `printsense/cas.py`)
- `docs/adr/0028-vision-zero-token-architecture.md` (the vision-scoped predecessor this generalizes)
- `docs/adr/0025-drive-intelligence-packs-and-drive-commander.md`, `0026-machine-pack-and-provenance-unification.md` (Capability Packs)
- ADR-0017 (approval status-transition mapping — the approval systems this reuses)
