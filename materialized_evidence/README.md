# `materialized_evidence` — the TechnicianContext contract

> **Status: PROPOSED doctrine.** The governing decision (`docs/adr/0033-one-technician-brain.md`)
> is **awaiting sign-off**. The contract is wired into the serving path behind a
> **default-off** flag (`MIRA_CONTEXT_CONTRACT`); "on" is not "authorized" — see
> `CLAUDE.md` § "Unification Program".

## TechnicianContext in one sentence

A **single, typed "case file"** that every MIRA answer is built from — one standard
shape all the specialist tools (manual search, drive-pack lookup, print reader, live
tags, work orders, prior decisions) drop their findings into, so the policy answers
from *one organized brief* instead of a pile of loose strings.

Think of it as a **doctor's chart before rounds**: labs, imaging, vitals, prior notes —
each from a different machine, all clipped into one folder in a fixed order, each page
stamped with where it came from and how much to trust it. The doctor (the LLM) reads the
chart and explains; the doctor never re-runs the MRI.

## Why it exists

ADR-0033: **one policy, many evidence producers.** The producers stay specialized and
dumb; they emit *typed evidence with provenance and confidence* into **one contract**,
so there's no ad-hoc per-producer format, and there IS a typed distinction between *"the
manual literally says this"* vs *"the model guessed this"* vs *"a live sensor reads this,
but it's 10 minutes stale."* That contract is `TechnicianContext`.

## The pieces (`context_contract.py`)

**`TechnicianContext`** — the whole case file for one answer: `task_mode` (which *job* —
metadata, **not** a different chatbot), `tenant_id`, `asset` (`AssetIdentity`), `question`,
`evidence` (list of `EvidenceItem`), `live` (`LiveStateOverlay` + freshness),
`contradictions`, `unknowns`, and the read-only fence (`allowed_actions` /
`authorization_state`).

**`EvidenceItem`** — one fact from one producer: `kind` (`manual_chunk`, `prior_decision`,
`drive_pack_fact`, `print_observation`, `live_tag`, `work_order`, `kg_path`, …),
`citation_id`, `trust` (`candidate` = model guessed vs `verified` = human confirmed),
`page`/`section`/`bbox` (kept **only when the source actually has it** — never invented),
`document_lineage_key`.

## The three rules that make it trustworthy — do not weaken these

1. **Read-only, fail-closed.** `validate_context()` rejects the whole context on any
   write-shaped `allowed_action` or non-`read_only` `authorization_state`. MIRA can
   *explain / cite / suggest / request a measurement* — it cannot *act*.
2. **Deterministic, byte-stable rendering.** `to_prompt_block()` renders in a fixed order
   so identical case file → identical text (and `manifest_of()` hashes it for the audit row).
3. **Pure adapters in, no `EvidenceManifest` field additions.** The `evidence_from_*(dict)
   → list[EvidenceItem]` functions are the **only** door in — pure, no I/O. The
   `EvidenceManifest` hash is a recall cache key; a new field would silently invalidate
   every stored result.

## Where it's wired (the landed reality)

Per-turn assembly lives in **`mira-bots/shared/technician_context.py`**, gated by
**`MIRA_CONTEXT_CONTRACT`** (default off, read per call):

- `contract_enabled()` — the flag check.
- `build_turn_context(...)` — assembles + validates the **prior-decision** family at the
  **engine** seam (`engine.py::_build_prior_decisions_context`, joined with the KG / live /
  interlock / work-order enrichment blocks in `_call_with_correction`), before the RAG call.
- `augment_with_retrieval(ctx, chunks)` — **after** the RAG call (where the retrieved chunks
  exist), merges the **manual-chunk** family into that *same* turn context and re-validates,
  so **one** manifest — not two derivations — reaches the trace. `engine.py` re-manifests the
  combined context and sets `parsed["_context_manifest"]` (the carrier the trace writer reads).
  This is **audit** enrichment: the chunks still reach the *prompt* only through the worker's
  `[Source: label]` reference block, and `prompt_block` still renders the prior-decision
  projection only — so no chunk is labelled under two trust levels, and prompt bytes are
  unchanged.
- `prompt_block(ctx)` / `manifest_of(ctx)` — render the projection / hash the context; the
  manifest rides the per-turn result out to `decision_traces.context_manifest` (migration 071).

## How to build on it (for Codex / any contributor)

- **New evidence source →** add one `evidence_from_<source>(dict) → list[EvidenceItem]`
  adapter in `context_contract.py`, then fold it into the **one** turn context in
  `technician_context.py` (`build_turn_context` before the RAG call, or
  `augment_with_retrieval`-style merge after it) — **one flag, one context, one manifest.**
  Don't add a second flag, a second assembly site, or a second prompt format.
- **Anything a model produced → `trust="candidate"`.** Promotion to `verified` goes through
  the canonical approval systems (ADR-0017), never automatically.
- **Never put an action verb in `allowed_actions`.** Actions live outside this contract.
- **Keep provenance honest** — `page`/`bbox`/`hash` only when the source explicitly has them.

## Open next slice

Unifying retrieval's **prompt** rendering onto the contract (so the reference block is
*derived from* the typed evidence) requires a **citation-preserving** projection — one that
still emits the `[Source: label]` tags `citation_compliance` and the system prompt depend
on. Until that exists, `build_retrieval_context` is audit-only. See
`docs/plans/2026-08-01-technician-context-runtime-adoption.md`.

**One line:** *TechnicianContext turns "a pile of retrieved strings" into "one organized,
read-only, provenance-stamped brief the AI reasons from" — and the adapters are the only way
in, so every fact arrives typed, cited, and honest about how much to trust it.*
