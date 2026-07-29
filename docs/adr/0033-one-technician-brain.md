# ADR-0033: One Technician Brain, Many Evidence Producers

- **Status:** Proposed (awaiting Mike's review — this ADR ships in the unification PR)
- **Date:** 2026-07-29
- **Inputs:** Mike's 2026-07-28 unification mission prompt; Phase-1 inventory
  (`docs/zta/technician-unified/inventory.md`); Training Plan v2
  (`docs/zta/2026-07-28-technician-training-plan-v2.md`); ADR-0029 (materialized
  evidence), ADR-0030 (CLF), ADR-0032 (ontology); v1 hold-out eval scorecards.

## Decision

MIRA has exactly **one conversational technician policy**: one base model
(`Qwen/Qwen3.5-9B` today) carrying **at most one** general technician behavior adapter.
Drive Commander, PrintSense, graph reasoning, live-state diagnosis, and work-order
assistance are **task modes of that one policy, not personalities** — represented as
`task_mode` metadata on a common context contract, never as separate conversational
models, separate system-prompt identities, or stacked adapters.

Everything specialized stays specialized **below the conversation**: OCR/visual
extraction, print decoding, drive-pack resolution, PLC/tag parsing, anomaly and
condition classifiers, graph traversal, retrieval/reranking, and safety/authorization
gates remain deterministic or narrow systems that emit **typed evidence with provenance
and confidence into the common context contract** (ADR-0029 `EvidenceManifest`,
extended per Phase 3). They never answer the technician independently.

## The behavior the one policy learns (and is evaluated on)

Ground every claim in supplied evidence; separate observed fact / retrieved fact /
inference / unknown; cite exact evidence; ask for the next highest-value measurement,
crop, tag, page, or document; never invent fault codes, parameters, tags, wiring, or
machine state; recognize stale or unhealthy live data (`FreshnessSummary`); reconcile
conflicting sources without silently choosing one; preserve technician corrections;
remain read-only absent an independently authorized execution path; explain in
technician language; hold one consistent identity and safety policy across products.

This is the empirically supported target: the v0→v1 arc proved small LoRA SFT transfers
*behavior* (Track-1 grounding 18-0-7, Track-2 no-overreach 23-1-1 on held-out equipment)
while knowledge stays in retrieval — HF's own agents guidance fine-tunes only for
behavior robustness and keeps knowledge in tools
(`docs/research/2026-07-28-hf-training-best-practices-vs-technician-program.md`).

## Rules

1. **One adapter.** No per-product conversational LoRAs. A specialist adapter may be
   *proposed* only after repeated, lineage-clean evaluation shows negative transfer that
   survives all five cheaper fixes, in order: better context assembly; better task
   metadata; dataset rebalancing; prompt/policy cleanup; more diverse general behavior
   records. Any future specialist is explicitly routed, independently evaluated, returns
   the same evidence-grounded response contract, and is never stacked or blended with
   another adapter in one answer path.
2. **Product modes, not personas.** Domain prompts may add narrow instructions but
   inherit one canonical technician policy. Contradictory duplicated system prompts are
   defects to eliminate as they are touched (the inventory lists the known forks; the
   drive-pack reply formatter fork is the first).
3. **Evidence producers emit, they do not speak.** A system that cannot express its
   output as typed evidence + confidence + provenance in the contract does not
   participate in answers.
4. **The dataset is majority general.** The compiled training corpus is ≥50%
   general/cross-domain technician behavior; no product family exceeds 25%; no
   manufacturer exceeds 10%; no template family dominates through paraphrases
   (enforced by the mixture compiler + audit, Phase 4). This is the structural guard
   against "the Drive Commander model."
5. **Knowledge lives outside weights.** Manuals, fault codes, parameters, wiring,
   graph facts, and live state stay in retrieval/tools/context. Training records
   carry evidence *in the prompt* (or teach refusal when it is absent) — never
   memorized facts. The A/B fact partition and held-out lineages remain law.
6. **Governance is unchanged and non-negotiable:** corpus-source.v1 fail-closed
   rights; human review sittings bound to frozen manifests; lineage splits with
   leakage guards; signed single-use spend authorizations; sealed blinded evals;
   append-only receipts.

## Consequences

- Phase 3 extends `materialized_evidence/schema.py` (the only versioned+validated
  candidate, 6/8 target dimensions) with `task_mode`, `allowed_actions`, and an
  explicit `unknowns` block; `MachineContextPacket` folds in as the live-state overlay;
  `agent_registry` supplies the allowed-actions vocabulary with write-verb rejection.
  `state["uns_context"]`, `ignition_chat.asset_context`, and the other untyped
  producers adapt IN via adapters; they are not extended.
- `decision_traces` (already tag+manual+kg evidence in one row, write-only today)
  becomes a *consumer* of the contract, giving the audit row and the prompt context a
  single shape.
- The known duplicate paths are scheduled for retirement in the inventory (review
  console v1, flywheel export bypassing the paid gate, v1.1 builder) — surgically, not
  in this PR where they are load-bearing.
- The dual `kg_entities` schema families are OUT of scope here (highest-risk change in
  the repo); the ADR records the bridge as the next structural target.

## Rejected alternatives

- **Per-product specialist models** — rejected: no evidence of negative transfer yet;
  the v1/v2 eval program measures per-slice regressions precisely so this claim can be
  tested; multiplying conversational authorities multiplies safety surfaces and
  contradicts the context-layer wedge (`NORTH_STAR.md`).
- **A new runtime context schema** — rejected: forks hashing/validation; the inventory
  proved an extendable versioned contract already exists (ADR-0029).
- **Memorizing domain facts in weights** — rejected: contradicts the retrieval
  architecture, the rights posture toward OEM material, and the observed failure mode
  (v0's evidence-free confident answers).
