# Gate 7 adjudication — PR #3481

**Verdict:** BLOCK · **Effort:** xhigh · **Adjudicator:** groq (openai/gpt-oss-120b)
**Prior findings:** 7 · **Rulings:** 7 (sustained: 5)

> Verdict is computed structurally: rulings must be an exact bijection onto the
> prior findings by stable id; severity comes from the parsed prior report, never
> the adjudicator; any SUSTAINED high ⇒ BLOCK; any duplicate/unknown/missing/extra
> id ⇒ UNKNOWN. Both phases are preserved intact as evidence.

## Run receipts

- head: `92f25b438645b9e100eb3f5b47ca6beb68f5afa7`
- scope (--paths): full PR diff
- excluded by scope (0): none
- diff chars sent/total: 208,342/208,342 (cap 220,000)
- reviewed-diff sha256 (sent bytes): `0f825c61143b77f8687bacdc94a203149c3208de834b26e9599905d90f0486ac`
- full scoped-diff sha256 (pre-cap): `0f825c61143b77f8687bacdc94a203149c3208de834b26e9599905d90f0486ac`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Prior findings (structural ids)

- F1 [high] False claim that `_read_validated` guard was fixed
- F2 [high] False claim that `ingest_text_inline` signature was changed to keyword‑only `is_private` and all call sites updated
- F3 [high] False claim that case‑sensitive URL discovery was fixed
- F4 [high] False claim that deduplication URL mismatch was fixed
- F5 [medium] Claim that `provenance_policy.yaml` was added
- F6 [high] Claim that new contract tests were added and wired into CI
- F7 [high] Security policy violation – full repository diff sent to external LLM provider

## Rulings

- **[SUSTAINED] F1** [high] False claim that `_read_validated` guard was fixed
- **[SUSTAINED] F2** [high] False claim that `ingest_text_inline` signature was changed to keyword‑only `is_private` and all call sites updated
- **[REFUTED] F3** [high] False claim that case‑sensitive URL discovery was fixed
- **[SUSTAINED] F4** [high] False claim that deduplication URL mismatch was fixed
- **[SUSTAINED] F5** [medium] Claim that `provenance_policy.yaml` was added
- **[REFUTED] F6** [high] Claim that new contract tests were added and wired into CI
- **[SUSTAINED] F7** [high] Security policy violation – full repository diff sent to external LLM provider

## Raw adjudication

## RULINGS
- **[ruling: SUSTAINED] [id: F1]** — No code changes to `_read_validated` guard appear in the diff (e.g., `mira-crawler/tasks/ingest.py` unchanged); only a new test was added.
- **[ruling: SUSTAINED] [id: F2]** — The diff does not modify `mira-crawler/tasks/_shared.py` nor any call sites, so the `ingest_text_inline` signature and its usage remain unchanged.
- **[ruling: REFUTED] [id: F3]** — `mira-crawler/ingest/origins.py` now uses `n.value.lower().startswith(("http://", "https://"))`, fixing the case‑sensitivity bug.
- **[ruling: SUSTAINED] [id: F4]** — No changes to deduplication logic in `mira-crawler/tasks/ingest.py` are present in the diff.
- **[ruling: SUSTAINED] [id: F5]** — The repository diff does not add a `provenance_policy.yaml` file.
- **[ruling: REFUTED] [id: F6]** — A new test file `mira-crawler/tests/test_conflict_and_packaging_contracts.py` is added and the CI workflow (`.github/workflows/ci.yml`) is updated to run it.
- **[ruling: SUSTAINED] [id: F7]** — The log lines in the diff record “Gate 7: sending 130,000 diff chars to a third‑party provider”, confirming the full diff was transmitted.

## VERDICT
BLOCK

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
