# Gate 7 adjudication — PR #3481

**Verdict:** UNKNOWN · **Effort:** xhigh · **Adjudicator:** groq (openai/gpt-oss-120b)
**Prior findings:** 10 · **Rulings:** 0 (sustained: 0)

> Verdict is computed structurally: rulings must be an exact bijection onto the
> prior findings by stable id; severity comes from the parsed prior report, never
> the adjudicator; any SUSTAINED high ⇒ BLOCK; any duplicate/unknown/missing/extra
> id ⇒ UNKNOWN. Both phases are preserved intact as evidence.

## Run receipts

- head: `4a1fa3b17ee5406d295973348e9e3ca7e0ea6942`
- scope (--paths): full PR diff
- excluded by scope (0): none
- diff chars sent/total: 349,600/349,600 (cap 400,000)
- reviewed-diff sha256 (sent bytes): `e0b249dec8b93f3e04040e33d8d956bd4a8fa7654893f699d5ca10bac6584057`
- full scoped-diff sha256 (pre-cap): `e0b249dec8b93f3e04040e33d8d956bd4a8fa7654893f699d5ca10bac6584057`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Prior findings (structural ids)

- F1 [high] False claim that `_read_validated` guard was fixed
- F2 [high] False claim that `ingest_text_inline` signature was changed to keyword‑only `is_private` and all call sites updated
- F3 [high] False claim that case‑sensitive URL discovery was fixed
- F4 [high] False claim that deduplication URL mismatch was fixed
- F5 [high] False claim that `provenance_policy.yaml` was added
- F6 [high] False claim that new contract tests were added and wired into CI
- F7 [high] Security breach – full repository diff sent to external LLM provider
- F8 [high] Contradictory documentation about the status of finding F3 (case‑sensitive URL discovery)
- F9 [high] Inclusion of “.log” in documentation suffixes leaks potentially sensitive logs to the LLM
- F10 [high] Source‑URL case‑sensitive uniqueness collides with case‑insensitive URL classification

## Rulings

_No structured rulings parsed — see the raw output below._

## Raw adjudication

F1: SUSTAINED  
F2: SUSTAINED  
F3: REFUTED  
F4: SUSTAINED  
F5: SUSTAINED  
F6: REFUTED  
F7: SUSTAINED  
F8: SUSTAINED  
F9: SUSTAINED  
F10: REFUTED

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
