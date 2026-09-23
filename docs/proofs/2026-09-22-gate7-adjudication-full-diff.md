# Gate 7 adjudication — PR #3959

**Verdict:** BLOCK · **Effort:** xhigh · **Adjudicator:** groq (openai/gpt-oss-120b)
**Prior findings:** 4 · **Rulings:** 4 (sustained: 3)

> Verdict is computed structurally: rulings must be an exact bijection onto the
> prior findings by stable id; severity comes from the parsed prior report, never
> the adjudicator; any SUSTAINED high ⇒ BLOCK; any duplicate/unknown/missing/extra
> id ⇒ UNKNOWN. Both phases are preserved intact as evidence.

## Run receipts

- head: `500d8fcf65b91714c98bc5f27c020bd923c97508`
- scope (--paths): full PR diff
- excluded by scope (0): none
- diff chars sent/total: 340,000/374,732 (cap 340,000)
- reviewed-diff sha256 (sent bytes): `58a2f0a8a359925110027522afc12d832a1ae1ac98ad8e89eab4c8b5f4652d06`
- full scoped-diff sha256 (pre-cap): `133413ed25e9d65cf482d90fe5277fb4e11b7f3f43f682b5b3afc568a2193ad8`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Prior findings (structural ids)

- F1 [high] Stale allow‑list entries break the drift‑guard test
- F2 [high] Database schema incompatibility for new turn‑mode values
- F3 [medium] Observability pipeline may reject the new `system_prompt_kind` values
- F4 [medium] “general” mode is silently remapped to the augmented persona

## Rulings

- **[REFUTED] F1** [high] Stale allow‑list entries break the drift‑guard test
- **[SUSTAINED] F2** [high] Database schema incompatibility for new turn‑mode values
- **[SUSTAINED] F3** [medium] Observability pipeline may reject the new `system_prompt_kind` values
- **[SUSTAINED] F4** [medium] “general” mode is silently remapped to the augmented persona

## Raw adjudication

## RULINGS
- **[ruling: REFUTED] [id: F1]** — The updated drift‑guard test (`mira-contract-drift.test.ts`) now passes with both flag states, and a negative control confirms no stale `You are MIRA` entries remain, directly disproving the claim of stale allow‑list entries.
- **[ruling: SUSTAINED] [id: F2]** — The diff contains no schema changes or evidence that the `turn.mode` and `system_prompt_kind` fields are accommodated; the database schema remains unchecked, so the incompatibility risk remains.
- **[ruling: SUSTAINED] [id: F3]** — Although `tools/qa/retrieval_acceptance.py` was fixed, the production observability pipeline code was not altered to accept the new `system_prompt_kind` values; the risk of downstream rejection persists.
- **[ruling: SUSTAINED] [id: F4]** — The code continues to map “general” requests to the augmented persona, now documented and tested but still present, so the finding is not disproved.

## VERDICT
BLOCK

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
