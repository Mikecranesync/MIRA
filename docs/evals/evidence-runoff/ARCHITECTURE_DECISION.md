# Architecture decision — evidence verification (Phase 2)

Status: **Proposed** (2026-10-20). Evidence: `RUNOFF_RESULTS.md`. Successor track for #4496 (#4488 closed).

## Decision

1. **Adopt the typed claim → source verifier (`mira-hub/src/capabilities/claim-verifier.ts`) as a shadow-mode
   signal, not a gate.** Basis: it is the only candidate that catches wrong-page citations without flagging
   most correct answers (6/8 genuine held-out page swaps at 7–10 % false flags), it handles the bit/PLC-address
   lookalikes it was built on (TQ-06, dev), it costs 0.06 ms with no model, and it never refuses prose or
   yes/no answers (the #4488 failure). It does **not** catch held-out lookalike values (1/9), so it must not
   be described as a hallucination stop.
2. **Keep claim-sentence NLI as the follow-up experiment, not the shipped validator.** NLI on the sentence that
   states the claim does separate lookalikes V1 cannot bind (TQ-06 bit 12 = 0.98/0.43 vs bit 11 = 0.013; tq-31
   boot-up COB-ID), but flags 23–25 % of correct answers, and costs 0.08–0.37 s on an M4 GPU (staging x86 CPU
   will be several times slower). The `mira-reranker` sidecar is the natural host if it is ever adopted
   (same cross-encoder shape, already deployed on staging). Eligible models are Apache-2.0 MNLI/SNLI only.
3. **Reject the Guardrails framework.** Its provenance validators are an LLM call (paid) or a cosine threshold
   (measured: 3/19 caught) behind an orchestration layer the PRD bans.
4. **Docling: do not adopt yet; the licence question is now narrowed** (`DOCLING_LICENCE.md`, investigation
   approved by Mike 2026-10-20). Code is MIT; the layout model (Heron) is Apache-2.0. Docling 2.140.0 pins
   TableFormer to `docling-models@v2.3.0` (`table_structure_model.py:108`), whose card says
   **CDLA-Permissive-2.0 only**. The identical weight bytes (same LFS sha256, verified) are on that repo's
   `main` under **CDLA-Permissive-2.0 + Apache-2.0** since a Dec 2025 "dual licensing" change with no stated
   rationale. Options: re-source the same bytes from the dual-licensed commit (no quality loss; whether the
   Apache grant on `main` covers them is a policy/legal call for Mike), use the Apache-only `TableFormerV2`
   (preview), or disable table structure. Why it still matters: It is the only candidate that fixes the table failures
   seen (Micro810 columns, Micro820 unit header, pin tables). But TableFormer's weight licence is unresolved, it
   costs 1–25 s and about 2 GB per page, and it does not fix the PLC-5 font cipher. If Mike clears the licence,
   the next experiment is Docling table cells as an *ingest-time* structured layer for table pages only. That
   would also remove the verifier's largest false-flag class.

## Integration boundary

- Inputs: question, final answer text, and for each cited `[n]` the model-visible text of that cited page's
  chunks (the route already builds this mapping for `withSupportingQuotes`).
- Output: one verdict plus per-claim `(key, status, page)` on the trace (`mira.claim_verifier.*`) and the turn
  evidence packet. It never changes the streamed answer, the citations, or `answer_status`.
- Order: safety gate → answer gate → (shadow) claim verifier. It can never replace or hide a safety stop.
- Flag: `NOTEBOOK_CLAIM_VERIFIER=shadow` (default off). Kill switch = unset.
- Expect shadow false-flag rates **above** the runoff's 7.4 %: production evidence is the 1200-character
  model-visible prefix of each chunk, not the full page.

## Promotion path (each step needs Mike)

1. Shadow on staging; collect verdicts on real turns for at least 2 weeks.
2. Build a **fresh** held-out set (the current one has been seen) and fix the known classes: wrapped lines
   (V1b), table unit headers (structured table text), phrase subjects ("phase loss", "at 500 kBd"),
   `tH1o`-shaped codes, hex in "80 hex" form.
3. Persist cited pages per turn (today only counts are stored) so shadow verdicts can be audited.
4. Gate only when the false-flag rate on correct typed answers is ≤ 2 % on the fresh set **and** an independent
   label audit has been done. The refusal must reuse #4496's reviewed text and redraft directive.

## Risks

- False flags (7–10 % in the runoff, all extraction artifacts; higher expected in production): harmless in
  shadow, unacceptable as a gate.
- Coverage: only about 30 % of answers carry a typed claim; prose correctness stays unjudged.
- Recall: lookalike values on pages whose question has no mnemonic pass (8 of 9 held-out swaps).

## Effort

- Shadow adapter + tests (unguarded `capabilities/`): done in the draft PoC.
- Route wiring (approved by Mike 2026-10-20): done in #4550 — `answer_gate.evaluate` carries
  `mira.claim_verifier.{verdict,reason,claim_count,claims}` when `NOTEBOOK_CLAIM_VERIFIER=shadow`; only for
  answers served from the documents; the answer, citations and status are already final when it runs. Not
  yet on the turn evidence packet (that is a packet-schema change). Turning it on in staging also needs the
  flag forwarded in `docker-compose.staging-vps.yml` (a guarded file) — not done.
- Fresh held-out set and failure fixes: 2–3 days.
- Docling ingest experiment, if the licence is cleared: 3–5 days.
