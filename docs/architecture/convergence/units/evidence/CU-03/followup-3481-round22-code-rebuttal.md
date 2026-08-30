# #3481 round V (code group) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round22-gate7-code.md` — head `99f18d8e9d8f65d330b85ba0f06d42894cc6c9dd`,
scope `mira-crawler/ tests/ .github/ tools/` (rounds C, E, P, R, T, U settled), **133,836/133,836**
chars (valid shape on attempt 2; attempt 1 — an essay with a findings table and no `## VERDICT` —
preserved as `-attempt1-malformed`). Every quoted line below is a `+` line of this PR's diff.

## F1 — "insert_chunk returns a fabricated entry_id on conflict" (high)

**Accepted at the root, with one sub-claim corrected.** The return value is wrong when
`ON CONFLICT DO NOTHING` writes nothing: `insert_chunk` mints the id before the statement and
returns it regardless of `rowcount`. That is pre-existing behaviour on `main` (not introduced by
this PR), but it is real, it is in the write path this PR hardens, and it is fixed in the next
head: the id is returned only when the statement reports an affected row; a conflict returns `""`
(red-first: `test_insert_returns_empty_when_the_conflict_target_wrote_nothing`, with the
opposite-direction lock `test_insert_returns_the_id_only_for_a_row_it_wrote`).

The sub-claim "callers … record the ID in the ingestion ledger … corrupting the ledger" is false.
No caller records the returned id anywhere: `store_chunks`, `tasks/ingest.py` and
`tasks/_shared.py` only count a non-empty return (`if entry_id: inserted += 1`). The ledger's
authority for "did it land?" is the corpus itself, read back by `ingested_source_urls` — which is
why this PR made that probe look for both spellings and fail closed without a tenant:

```diff
+    Historical residual, documented not migrated: rows written before this
+    function keep their stored spelling; ``chunk_exists`` and the ledger probe
+    also look up the exact raw spelling they were given, so a recrawl of such a
+    row finds it. A one-off dedup migration is the follow-up, never a silent
```

So the consequence of the defect is an over-counted `inserted` tally — worth fixing, and fixed —
not a ledger that believes a row exists when it does not. The finding's own reproducer also
asserts the literal `INSERT INTO knowledge_entries` on mock-captured SQL; the contract suite's
Contract 13 (`tests/test_architecture.py`) treats that literal as a new writer, which is why the
locks in this PR assert on the statement prefix instead.

## F2 — "race condition yields duplicate success reports" (high)

Same root cause as F1 (the unconditional return), and the same fix closes it: with the id
returned only for an affected row, the second of two concurrent writers of one document — whose
statement hits `ON CONFLICT DO NOTHING` — returns `""`. No duplicate **row** was ever possible
(the conflict target is the migration's UNIQUE index, `+` line of this PR's contract suite,
`test_conflict_target_is_exactly_the_migration_unique_index`); the duplicate was the success
*report*, and it is removed. Accepted; root-fixed in the next head.

## F3 — "unnecessary SELECT per insert adds latency" (medium)

The premise "an extra `SELECT COUNT(*)` before every `INSERT`" is false. The guard runs only when
the spelling the caller supplied differs from the canonical key — the common (already-canonical)
path issues no lookup at all — and that is locked:

```diff
+    if raw_url != source_url and chunk_exists(tenant_id, raw_url, chunk_index):
```
```diff
+    def test_insert_pays_no_extra_lookup_when_the_spelling_is_already_canonical(self, captured):
```

`RETURNING` cannot replace the guard: the conflict target is the **canonical** key, while the
historical row sits under a **different** exact key (its raw spelling), which no `ON CONFLICT`
clause on the canonical key can see.
