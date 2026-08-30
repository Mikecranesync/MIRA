# General Intelligence Preservation (the parity law)

Source: MIRA General Intelligence Parity build plan (2026-08-30) §35; current-state map
`docs/architecture/general-intelligence-parity-current-state.md`; benchmark
`evals/general-intelligence/`.

## General Intelligence Preservation Rule

> MIRA is a general multimodal assistant first and a FactoryLM-aware assistant second.
> FactoryLM context, retrieval, machine evidence, modes, and tools may add knowledge,
> provenance, constraints, and actions, but must not unnecessarily reduce the capabilities
> of the configured frontier model. No general user question may be rejected solely
> because private FactoryLM evidence is absent unless answering the requested claim would
> require pretending to possess asset-specific evidence. Every material orchestration
> change must be evaluated against the raw configured frontier-model baseline.

## Evidence Truth Rule

> General knowledge may be answered from model reasoning and public evidence. Private
> document claims require private document evidence. Asset-specific historical/live claims
> require machine evidence. The absence of one evidence class must not suppress unrelated
> answerable portions of the user's request.

## Benchmark Rule

> A feature is not considered an intelligence improvement merely because its tests pass.
> For behavior that affects answer generation, compare MIRA against the raw configured
> frontier model on representative benchmark cases and investigate meaningful regressions
> before merge.

## What this does NOT relax

- Workstream C machine-memory invariants (`PR #3486`): replay CTA gated on admissible
  coverage; unavailable ≠ empty; no false "Live"; canonical condition titles; route-level
  refusal for an *explicitly requested* empty/unavailable machine-history claim; preflight;
  observer; tenant isolation; read-only equipment. An explicit machine-history claim may
  still get a precise "unavailable/empty" result — but the general parts of the same
  question are answered.
- Provider policy: Groq → Cerebras → Together cascade; OpenAI models permitted **behind the
  seam** (owner decision 2026-08-26); **Anthropic excluded** from diagnosis; paid inference
  is validation, never a dev/debug tool (`zero-token-architecture.md`).
- Security: tool authorization, tenant isolation, read/write distinction, and mutation
  confirmation live in code, never in the prompt.
- One conversation store, one evidence model, one canonical seam — new evidence kinds
  (web, machine history) extend `evidence[]`; they never create a second store or route.

## When this applies

- Any change to a chat/answer route, gate, mode, provider seam, citation contract, or
  image pipeline; any PR that adds or tightens a refusal.

## What a reviewer must catch

- ❌ A turn refused wholesale because private evidence is absent when the model could have
  answered the general portion.
- ❌ A new answer path/stack instead of a tool beneath the one conversation engine.
- ❌ Web/public evidence rendered as private evidence (or vice versa); cosmetic citations.
- ❌ An answer-generation change merged without a `evals/general-intelligence` before/after.
- ❌ Authorization delegated to prompt text.
