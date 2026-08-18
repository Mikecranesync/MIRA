# Gate 7 adjudication — PR #3268

**Verdict:** BLOCK · **Effort:** xhigh · **Adjudicator:** groq (openai/gpt-oss-120b)
**Prior findings:** 5 · **Rulings:** 5 (sustained: 2)

> Verdict is computed structurally: rulings must be an exact bijection onto the
> prior findings by stable id; severity comes from the parsed prior report, never
> the adjudicator; any SUSTAINED high ⇒ BLOCK; any duplicate/unknown/missing/extra
> id ⇒ UNKNOWN. Both phases are preserved intact as evidence.

## Run receipts

- head: `2655e69863cb47dbc128dee1d5ea864cc40d5e50`
- scope (--paths): mira-crawler/, tools/, mira-bots/, mira-hub/, tests/, .github/, .claude/, mira-core/
- excluded by scope (29): docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md, docs/architecture/convergence/BACKLOG.md, docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/round-1-crash.log, docs/architecture/convergence/units/evidence/CU-03/round-2-crash.log, docs/architecture/convergence/units/evidence/CU-03/round-3-full-diff.md, docs/architecture/convergence/units/evidence/CU-03/round-4-full-diff.md, docs/architecture/convergence/units/evidence/CU-03/round-5-full-diff.md, docs/architecture/convergence/units/evidence/CU-03/round-6-groupA-crawler-prod.md, docs/architecture/convergence/units/evidence/CU-03/round-6-groupB-crawler-tests.md, docs/architecture/convergence/units/evidence/CU-03/round-6-groupC-rest.md, docs/architecture/convergence/units/evidence/CU-03/round-7-groupA-crawler-prod.md, docs/architecture/convergence/units/evidence/CU-03/round-7-groupB-crawler-tests.md, docs/architecture/convergence/units/evidence/CU-03/round-7-groupC-rest.md, docs/architecture/convergence/units/evidence/CU-03/round-8-groupA-crawler-prod.md, docs/architecture/convergence/units/evidence/CU-03/round-8-groupB-crawler-tests.md, docs/architecture/convergence/units/evidence/CU-03/round-8-groupC-rest.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupA-adjudication-1-scope-limited.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupA-adjudication-2-PASS.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupA-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupA-review.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupB-adjudication-1-scope-limited.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupB-adjudication-2-PASS.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupB-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupB-review.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupC-adjudication-PASS.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupC-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupC-review.md
- diff chars sent/total: 110,137/110,137 (cap 115,000)
- reviewed-diff sha256: `82e68385b0c9214d9ecc2ae29f74a8a438a795e390f98305d6634f2371bc51c4`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Prior findings (structural ids)

- F1 [high] Incomplete update of `insert_chunk` callers after required `is_private` parameter added
- F2 [high] Mismatch between `knowledge_entries_read_allowlist.yml` line numbers and source code
- F3 [high] Removal of architecture‑drift checks for visibility enforcement
- F4 [high] Gate 7 truncates diffs and records a hash only of the truncated view
- F5 [medium] `filter_diff_paths` performs case‑sensitive prefix matching, enabling exclusion‑by‑case on Windows

## Rulings

- **[REFUTED] F1** [high] Incomplete update of `insert_chunk` callers after required `is_private` parameter added
- **[REFUTED] F2** [high] Mismatch between `knowledge_entries_read_allowlist.yml` line numbers and source code
- **[REFUTED] F3** [high] Removal of architecture‑drift checks for visibility enforcement
- **[SUSTAINED] F4** [high] Gate 7 truncates diffs and records a hash only of the truncated view
- **[SUSTAINED] F5** [medium] `filter_diff_paths` performs case‑sensitive prefix matching, enabling exclusion‑by‑case on Windows

## Raw adjudication

## RULINGS
- **[ruling: REFUTED] [id: F1]** — the diff updates *all* `insert_chunk` (and related) call sites to pass an explicit `is_private=` argument (e.g. `learning_ingester.py` adds `is_private=True`, `ingest_equipment_photos.py` adds `is_private=False`, and `store_chunks` calls in many crawler tasks include `is_private=`), disproving the claim that only one caller was updated.  
- **[ruling: REFUTED] [id: F2]** — the allow‑list file `knowledge_entries_read_allowlist.yml` is rewritten with the corrected line numbers **and** new `query_sha256` hashes that reflect the signature change, showing the entries are now consistent with the source code.  
- **[ruling: REFUTED] [id: F3]** — the diff removes the two entries for `verify-node-subtree-retrieval.ts` and `folder‑brain‑proof.spec.ts` from the exemption list in `tests/test_architecture.py`, which *tightens* the visibility check rather than removing it; the added `is_private` columns in those INSERT statements confirm the contract is now enforced.  
- **[ruling: SUSTAINED] [id: F4]** — the new `receipts_block` function hashes only `sent_diff[:MAX_DIFF_CHARS]` and the review uses `diff[:MAX_DIFF_CHARS]` for the hash, exactly as described in the finding, meaning malicious changes beyond the cap would be invisible to the reviewer.  
- **[ruling: SUSTAINED] [id: F5]** — the `filter_diff_paths` implementation in the diff still uses `target.startswith(p)` without any case normalization, so case‑sensitive prefix matching remains unchanged.

## VERDICT
BLOCK

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
