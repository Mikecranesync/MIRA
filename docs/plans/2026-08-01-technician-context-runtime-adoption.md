# TechnicianContext runtime adoption — retrieval family (converges on #3032)

**Status:** slice landed here is **audit-only**; the prompt-render unification is scoped
but **not** implemented (grounding constraint below). ADR-0033 is **proposed, awaiting
sign-off**; everything is behind `MIRA_CONTEXT_CONTRACT`, default off.

## Context — what already landed (#3032)

PR #3032 ("WS1 — the context contract becomes a live consumer on the serving path") wired
the **prior-decision** evidence family end-to-end:

- `mira-bots/shared/prior_decisions.py` — first reader of `decision_traces`.
- `mira-bots/shared/technician_context.py` — `contract_enabled()`, `build_turn_context()`,
  `prompt_block()` (renders **only** the `PRIOR_DECISION` projection), `manifest_of()`.
- `engine.py::_build_prior_decisions_context` — the sixth enrichment block in
  `_call_with_correction`; the manifest rides the result to the decision trace.
- Migration `071` — `decision_traces.context_manifest` (+ `_sha256`).
- Flag **`MIRA_CONTEXT_CONTRACT`**, default off, read per call.

#3032 explicitly deferred one thing: *"unifying retrieval's prompt rendering onto the
contract is the next slice"* — because manual chunks already reach the prompt via the RAG
worker's `[Source: label]` reference block, and re-rendering them through the contract would
label one fact under two trust levels.

This plan is that next slice — done **safely**.

## Two hard constraints (discovered by reading the landed code)

1. **Chunks don't exist at #3032's build seam.** `build_turn_context` runs at the engine level
   **before** `rag.process()`; retrieved chunks only appear afterward. They are, however,
   available back at the engine right after the call as `parsed["_last_chunks"]` (lifted from
   `state["_rag_last_chunks"]`). So the retrieval family is merged into the turn context
   **post-RAG, in the engine** — *not* by stashing a second manifest in the worker (which was the
   P1: nothing lifted it onto `parsed`, so it never reached the trace).
2. **`to_prompt_block` would break citations.** The contract renders evidence as
   `Evidence [M1] (manual_chunk, …)`. The RAG reference block uses `--- [i] [Source: label] ---`,
   and both `citation_compliance` and the system prompt instruct the model to copy those
   `[Source: label]` tags. Swapping the reference block to the contract's format would drop the
   tags and regress grounding. So this slice is **audit-only**: it does not touch the prompt.

## What this slice implements

The retrieval family is merged into the **same** turn context the engine already builds, and
re-manifested **after** the RAG call — so a single manifest carrying both families reaches the
trace. (An earlier draft stashed a second manifest in the RAG worker; it never got lifted onto
`parsed`, so it silently never reached the trace — the P1 this version fixes.)

- `technician_context.augment_with_retrieval(ctx, chunks)` — takes the prior-decision context
  `build_turn_context` produced pre-RAG and merges `evidence_from_recall_chunks(chunks)` into
  it (`dataclasses.replace`), re-validates, returns `(combined | None, violations)`. Fail-open
  (`None` → keep the prior-only manifest).
- `engine._build_prior_decisions_context` — now stashes the validated `ctx` on
  `state["_turn_ctx"]` (before the empty-block early return), so a turn with chunks but no
  priors still carries a context to augment.
- `engine._call_with_correction` — lifts `_turn_ctx` once before the retry loop; in the loop,
  after `parsed["_last_chunks"]` is set, re-manifests the combined context and sets
  `parsed["_context_manifest"]` (the carrier the trace writer reads). Set every attempt so the
  final chunks win; fail-open to the prior-only manifest.

**Prompt bytes are unchanged.** The merge happens *after* `rag.process`, so nothing chunk-derived
enters the prompt via the contract; `prompt_block` still renders the prior-decision projection
only, and the chunks reach the model through the RAG worker's `[Source: label]` reference block.
No second flag, no second assembly path, no grounding risk.

## Also in this PR (discoverability — #3032 didn't do these)

- `materialized_evidence/__init__.py` exports the contract (`from materialized_evidence import
  TechnicianContext` now works; was submodule-only).
- `materialized_evidence/README.md` — plain-language explainer, matched to the landed reality.
- `.claude/rules/materialized-evidence.md` — names the contract, the one flag, the two
  `build_*_context` seams, and the no-double-render rule.

## The remaining next slice (not here)

Unify retrieval's **prompt** rendering onto the contract. This needs a **citation-preserving
projection** — a renderer that emits the typed evidence in the `[Source: label]` form the
compliance layer and system prompt expect (either a new `to_prompt_block` mode, or a worker-side
renderer that reads the typed `EvidenceItem`s but keeps the legacy tag format). Only then can
the reference block be *derived from* the contract instead of running in parallel. Until that
lands, the reference block stays authoritative for the prompt and the contract is authoritative
for the audit. Fuller unification (a single per-turn context carrying prior-decision **and**
manual-chunk evidence under one manifest) requires moving `build_turn_context` after the RAG
call, or merging the two manifests on the trace — a deliberate follow-up, not folded in silently.

## Tests

`mira-bots/tests/test_technician_context_retrieval.py`:
- `build_retrieval_context` returns a valid context (no violations) for well-formed chunks +
  tenant; kinds are `manual_chunk`; fail-closed (`None`) on empty tenant.
- `rag_worker._build_prompt_with_chunks`: with `MIRA_CONTEXT_CONTRACT` off → no manifest stashed
  and prompt unchanged; on → `state["_retrieval_context_manifest"]` present **and the prompt
  is byte-identical to the off run** (audit-only proof).
- package export importable.
Regressions: `test_unit2_citations`, `test_reranking`, `test_technician_context`,
`test_context_contract`, GS11 grounding.
