# Architecture decision — evidence verification (Phase 2)

Status: **Proposed** (2026-10-20). Evidence: `RUNOFF_RESULTS.md`. Successor track for #4496 (#4488 closed).

## Decision

1. **Adopt the typed claim → source verifier (`mira-hub/src/capabilities/claim-verifier.ts`) as a
   shadow-mode signal**, not a gate. It runs after the answer is final and after the safety gate, judges only
   typed claims (bits, PLC addresses, parameter/fault codes, pins, hex IDs, closed-unit quantities), binds each
   value to the question's own identifiers on the cited page, and records `supported | unsupported | no_opinion`
   with per-claim reasons on the retrieval/answer trace. No user-visible change.
2. **Reject NLI (`cross-encoder/nli-deberta-v3-*`, `nli-MiniLM2`) and embedding provenance as validators** for
   manual answers. They cannot separate the right table value from its lookalike (TQ-06: correct and wrong both
   score entailment 0.00) and, at any useful threshold, flag a majority of correct answers.
3. **Reject the Guardrails framework.** Its provenance validators are an LLM call (paid) or a cosine threshold
   (measured as V2: 3/19 caught), behind an orchestration layer the PRD bans.
4. **Docling: do not adopt yet; escalate the licence.** It is the only candidate that fixes the table failures
   seen (Micro810 columns, Micro820 unit header, pin tables) — but TableFormer's weight licence is unresolved,
   it costs 1–25 s and ~2 GB per page, and it does not fix the PLC-5 font cipher. If Mike clears the licence,
   the next experiment is Docling table cells as an *ingest-time* structured layer for table pages only.

## Integration boundary

- Inputs: question, final answer text, and for each cited `[n]` the text of the chunks of that cited page the
  model saw (the route already builds this mapping for `withSupportingQuotes`).
- Output: one verdict + per-claim `(key, status, page)`, as trace attributes `mira.claim_verifier.*` and a field
  on the turn evidence packet. Never changes the streamed answer, the citations, or `answer_status`.
- Order: safety gate → answer gate → (shadow) claim verifier. It can never replace or hide a safety stop.
- Flag: `NOTEBOOK_CLAIM_VERIFIER=shadow` (default off). Kill switch = unset.

## Promotion path (each step needs Mike)

1. Shadow on staging; collect verdicts on real turns for ≥2 weeks.
2. Fix the known failure classes on a **fresh** held-out set: wrapped lines (V1b), table unit headers
   (needs structured table text — Docling or a header-propagation pass), phrase subjects ("phase loss",
   "at 500 kBd"), `tH1o`-shaped codes.
3. Gate only when the measured false-flag rate on correct typed answers is ≤ 2 % and the refusal reuses #4496's
   reviewed text and redraft directive.

## Risks

- False flags (7–10 % today, all table/extraction artifacts): harmless in shadow, unacceptable as a gate.
- Coverage: only ~30 % of answers carry a typed claim; prose correctness stays unjudged.
- Recall gap: lookalike quantities on pages whose question has no mnemonic pass (6/19).

## Effort

Shadow wiring + tests + trace fields: ~1 day (guarded chat route → lifecycle rationale + full-tier Codex
review). Fresh held-out set + V1 failure fixes: 2–3 days. Docling ingest experiment (if licence cleared): 3–5 days.
