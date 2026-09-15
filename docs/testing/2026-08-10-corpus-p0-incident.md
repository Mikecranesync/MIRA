# P0: canonicalize_manual.py was unsafe, and its rollback was not lossless

**Status:** harm found, mutation UNDONE, staging verified restored. Repair of the
tool itself is NOT done — see "Not done" below.

## What went wrong

Three defects in `tools/corpus/canonicalize_manual.py`, all mine, all shipped in
`2c2b9bd59` and exercised against staging.

### 1. The environment guard was a no-op

```python
if "prod" in url.lower(): raise
```

Neon connection strings look like `postgresql://…@ep-xxx-yyy.us-east-2.aws.neon.tech/neondb`.
They contain neither `prod` nor `staging`. **The guard could never fire on either
environment.** A destructive DELETE ran behind a check that was structurally
incapable of stopping it. Correct form is a positive identity assertion — assert
the database IS the expected staging branch — never a negative substring search.

### 2. Dedup crossed document boundaries

The partition was `md5(content)` over `model_number ILIKE '%525%'`, so identical
text appearing in DIFFERENT publications was collapsed to one row. Measured from
the manifest: **45 rows deleted from `520-qs001` (Quick Start) and 18 from the
Rockwell literature ingest**, because their text also appears in `520-um001`.
That is provenance corruption: a Quick Start citation would resolve to the User
Manual. Identity must be manufacturer + canonical document + revision, not a
model LIKE.

### 3. The "reversible" claim was false

`_COLS` omitted `embedding`, `image_embedding`, `created_at`, `updated_at`,
`doc_id`, `page_start`, `page_end`, `section_path`, `ingest_route`,
`equipment_entity_id`, `image_path`, `content_tsv`. A restore from that manifest
would have re-inserted 3,364 rows with **NULL embeddings — invisible to the
vector and product streams**. That is the exact NULL-embedding defect class
`.claude/skills/retrieval-diagnostics` exists to catch, and the rollback would
have caused it while appearing to succeed.

## Recovery

`tools/corpus/restore_dedup.py`. Embeddings were recoverable without re-embedding
because every deleted row was an EXACT content duplicate of a surviving row (that
is why it was deleted), so the vector is copied from the surviving twin matched on
`md5(content)`. Deterministic embedder + identical text = identical vector, so
this is a true restore of the column rather than an approximation.

Verified against the pre-experiment measurement:

| metric | pre-experiment | after restore |
|---|---|---|
| PF525 rows | 7,547 | **7,547** |
| distinct content | 4,183 | **4,183** |
| duplication | 1.80x | **1.80x** |
| page conflicts | 1,077 | **1,077** |
| `520-qs001` rows | 391 | **391** |
| NULL embeddings | 0 | **0** |

NOT recovered: `created_at` / `updated_at` were never captured, so restored rows
carry fresh timestamps. Recorded rather than hidden.

## Consequence for the earlier result

The "corpus integrity does not repair retrieval" finding still stands — it was
measured while the dedup was applied, and the before/after benchmark numbers are
unaffected by the rollback. But it was obtained via an unsafe path, and the
cross-document deletions mean the deduped corpus it measured was not the corpus
a correct canonicalizer would have produced. Treat the conclusion as supported
but re-runnable, not settled.

## Not done

The nine-priority repair program (TRH fail-closed semantics, live retrieval
snapshots, evidence-validation split, model-isolation matching, hierarchy
re-test, battery hashing, mutation green->red->green gating, cleanup) is NOT
started. Only the P0 harm was found and undone.

> **2026-08-10, later:** the recovery script `tools/corpus/restore_dedup.py` referenced above
> was retired after the rebuilt canonicalizer's quarantine round-trip was proven end-to-end on
> staging (see `2026-08-10-quarantine-roundtrip-proof.md`). This document is retained as the
> incident record.
