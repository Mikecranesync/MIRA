# Gate 7 adjudication — PR #3481

**Verdict:** BLOCK · **Effort:** xhigh · **Adjudicator:** groq (openai/gpt-oss-120b)
**Prior findings:** 6 · **Rulings:** 6 (sustained: 4)

> Verdict is computed structurally: rulings must be an exact bijection onto the
> prior findings by stable id; severity comes from the parsed prior report, never
> the adjudicator; any SUSTAINED high ⇒ BLOCK; any duplicate/unknown/missing/extra
> id ⇒ UNKNOWN. Both phases are preserved intact as evidence.

## Run receipts

- head: `611705cc5116a07c672b6a8e5cdf4b039ad94015`
- scope (--paths): full PR diff
- excluded by scope (0): none
- diff chars sent/total: 117,974/117,974 (cap 130,000)
- reviewed-diff sha256 (sent bytes): `8ed0ebfaf6dc19c351a10c659fcdbb47bbbb95d58cb6e9ba4aa480a79bc6c2ea`
- full scoped-diff sha256 (pre-cap): `8ed0ebfaf6dc19c351a10c659fcdbb47bbbb95d58cb6e9ba4aa480a79bc6c2ea`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Prior findings (structural ids)

- F1 [high] False claim that `_read_validated` guard was fixed
- F2 [high] False claim that `ingest_text_inline` signature was changed to keyword‑only `is_private` and all call sites updated
- F3 [high] False claim that case‑sensitive URL discovery was fixed
- F4 [high] False claim that deduplication URL mismatch was fixed
- F5 [medium] Claim that `provenance_policy.yaml` was added
- F6 [high] Claim that new contract tests were added and wired into CI

## Rulings

- **[SUSTAINED] F1** [high] False claim that `_read_validated` guard was fixed
- **[SUSTAINED] F2** [high] False claim that `ingest_text_inline` signature was changed to keyword‑only `is_private` and all call sites updated
- **[REFUTED] F3** [high] False claim that case‑sensitive URL discovery was fixed
- **[SUSTAINED] F4** [high] False claim that deduplication URL mismatch was fixed
- **[SUSTAINED] F5** [medium] Claim that `provenance_policy.yaml` was added
- **[REFUTED] F6** [high] Claim that new contract tests were added and wired into CI

## Raw adjudication

## RULINGS
- **[ruling: SUSTAINED] [id: F1]** — No source changes to `mira-crawler/tasks/ingest.py` (`_read_validated`) appear; only a new test was added, so the claim that the guard was fixed is unsupported.  
- **[ruling: SUSTAINED] [id: F2]** — The PR makes no modifications to `mira-crawler/tasks/_shared.py` or any caller; the quoted signature change is confined to a markdown file, not actual code.  
- **[ruling: REFUTED] [id: F3]** — `mira-crawler/ingest/origins.py` now defines `_urls_in` with `n.value.lower().startswith(("http://", "https://"))`, fixing the case‑sensitivity issue.  
- **[ruling: SUSTAINED] [id: F4]** — No changes to `mira-crawler/tasks/ingest.py` (deduplication logic) are present; the purported fix exists only as quoted text in documentation.  
- **[ruling: SUSTAINED] [id: F5]** — The diff does not add a `provenance_policy.yaml` file; the file already existed, so the claim of adding it is false.  
- **[ruling: REFUTED] [id: F6]** — The PR adds `mira-crawler/tests/test_conflict_and_packaging_contracts.py` and updates `.github/workflows/ci.yml` to run this test, confirming the new contract tests were added and wired into CI.  

## VERDICT
BLOCK

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
