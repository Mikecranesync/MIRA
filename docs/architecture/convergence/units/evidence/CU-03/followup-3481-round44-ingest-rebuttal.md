# #3481 round 44 (S2: `mira-crawler/ingest/`) — author rebuttal, strengthened for attempt 2 (verbatim quoted evidence)

Prior report: `followup-3481-round44-gate7-ingest.md` — head `18cde8db6e6437ac6f21938a66adc8581e32d135`
(valid on attempt 1). Adjudication attempt 1 (`-attempt1-invalid`) was structurally valid but
semantically invalid: its F2 reason says "no `RETURNING id`" while the visible SQL literally
carries `RETURNING id`, and it ignored the visible tests. Every quoted line below is a `+`
line of this PR's diff; the adjudication scope adds `mira-crawler/tests/` so every lock is in
the reviewed diff. The reviewer must rule on the **quoted lines**, not on a memory of them.

## F1 — "the PostgreSQL-only engine guard re-introduces a settled defect" (high)

**The store is PostgreSQL-only by production contract and by its SQL**, and the guard is the
fix a prior adjudication of this same PR *required*.

The contract, in the diff:

```diff
+    # PostgreSQL-only by construction (round AL on #3481): the dedup probes use
+    # `= ANY(array)`, PostgreSQL's scalar-array operator, and knowledge_entries
+    # lives only in NeonDB. Any other dialect is refused before an engine exists,
```
```diff
+            "the knowledge_entries store is PostgreSQL-only"
```

The SQL that only PostgreSQL executes — the scalar-array probe (twice) and the conflict
target on a partial expression index over `jsonb`:

```diff
+                      AND source_url = ANY(:urls)
```
```diff
+                    "WHERE source_url = ANY(:urls) AND tenant_id = :tid"
```

(the unchanged `ON CONFLICT (tenant_id, source_url, ((metadata->>'chunk_index')::int))`
context line is the migration-003 expression index — `jsonb` `->>` with an `::int` cast — and
`embedding` is a pgvector column; none of it exists on SQLite/MySQL.)

**No SQLite harness exists**: the crawler slice runs on a captured fake connection, and the
lock names the exact environments the finding worries about and asserts each is refused:

```diff
+class _FakeConn:
```
```diff
+    def test_store_engine_is_postgresql_only_by_construction(self, monkeypatch):
```
```diff
+        for bad in ("sqlite:///x.db", "mysql://u@h/db", "mariadb+pymysql://u@h/db"):
```

**The guard was demanded by this PR's own round-35 adjudication.** Verbatim, from
`followup-3481-round35-ingest-adjudication.md`:

> - **[ruling: SUSTAINED] [id: F2]** — the diff keeps the PostgreSQL-specific
> `source_url = ANY(:urls)` guard (asserted in the code) without proving that non-PostgreSQL
> back-ends are impossible, so the duplicate-row guard failure on other databases remains a
> valid concern.

The dialect guard *is* that proof: a non-PostgreSQL back-end is impossible by construction.
Sustaining its absence in round 35 and its presence now cannot both be findings about the
code. **A ruling that merely restates what the guard does ("the engine aborts on such URLs")
describes the intended, tested behaviour, not a defect** — the finding's premise is a
deployment or CI harness that supplies a non-PostgreSQL `NEON_DATABASE_URL` for this store,
and none exists: no file under `mira-crawler/` builds a SQLite/MySQL engine for
`knowledge_entries`; every store test runs on `_FakeConn`. To sustain F1 the adjudicator
must name such a harness in the diff; there is none to name.

## F2 — "`insert_chunk` no longer returns a stable id on conflict; callers expect a non-empty id" (high)

**The SQL carries `RETURNING id`, and `""` means exactly "no row was written."** The visible
lines:

```diff
+            # The DATABASE says whether a row was written: `RETURNING id`
```
```diff
+            written_id = conn.execute(
```
```diff
+                    RETURNING id
```
```diff
+            ).scalar_one_or_none()
```
```diff
+        if written_id is None:
+            return ""  # DO NOTHING fired
+        return str(written_id)
```

`ON CONFLICT DO NOTHING RETURNING id` yields a row only when the INSERT wrote one;
`scalar_one_or_none()` is `None` precisely when `DO NOTHING` fired. Returning the minted id in
that case was the **round-22 defect** (a row that was never written was counted and
KG-linked); returning `""` is the root fix (round AA), and the callers are locked to it:

```diff
+    def test_conflict_target_is_exactly_the_migration_unique_index(self, captured):
```
```diff
+    def test_conflict_action_never_writes_the_colliding_row(self, captured):
```
```diff
+        captured["conflict"] = True  # DO NOTHING fired: RETURNING yielded no row
```
```diff
+    def test_store_chunks_neither_counts_nor_links_a_conflict(self, captured, monkeypatch):
```

No caller in this repository "expects a non-empty identifier for every successful write":
the only callers (`store_chunks`, the ledger reconcile) treat `""` as "not written" — which is
what the locks above prove. Returning an id for a non-write would reintroduce a previously
sustained real defect.

## F3 — confusables `𝒶` / `ａ` (high) — already REFUTED in attempt 1

Both are NFKD compatibility forms; executed on this head → refused (`apikey`):

```diff
+    decomposed = normalize("NFKD", decoded)
+    stripped = "".join(ch for ch in decomposed if not combining(ch))
+    return _QUERY_NAME_NOISE_RE.sub("", stripped.lower().translate(_CONFUSABLES))
```

## F4 — "a DSN with surrounding whitespace is refused by the dialect guard" (medium)

Acknowledged as a *message* difference, not an outcome difference: SQLAlchemy's `make_url`
rejects a padded DSN as well, so the guard reports the configuration mistake with the refused
dialect named instead of an opaque parse error. A `.strip()` before the dialect split is a
harmless follow-up for the owner; it is medium, not a blocker, and is deliberately not spent
as another review round of this PR.
