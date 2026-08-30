# #3481 round 33 (S3: `mira-crawler/tests/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round33-gate7-crawler-tests.md` — head `01699b6690544ce0b955bddf118d942897d6dcb3`
(valid on attempt 1). Every quoted line is a `+` line of this PR's diff.

## F1 — "`_read_validated` likely performs a naïve prefix check; the test never asserts an outside path is rejected" (high)

A claim about production code the slice cannot see ("likely performs"), and false on that code:
`mira-crawler/tasks/ingest.py::_read_validated` (unchanged by this PR) does
`rel = local_path.relative_to(base)` — a `ValueError` for any path outside the base, which the
caller turns into a refusal — and then opens every component below the base with
`O_NOFOLLOW` from a directory fd (`dir_fd=`), so `..`, symlinks and case-folded paths cannot
redirect the read (Gate 7/9 TOCTOU findings, rounds 12 and earlier). The quoted test locks a
*different* contract — that the platform guard is set membership and reads on every platform:

```diff
+        """Gate 7 round-12 group A finding on #3268 claimed `os.supports_dir_fd` is
+        a *boolean*, so `os.open not in os.supports_dir_fd` would raise TypeError
```
```diff
+        assert isinstance(os.supports_dir_fd, (set, frozenset))
```

The outside-the-base refusal is exercised by the pre-existing ingest tests on `main`, not by
this diff; nothing in this PR touches the read path.

## F2 — "`_whole_dir_copy_dest` does not recognise a multi-line COPY, so the test misses the omission" (high)

Adjudicated **REFUTED** on the previous head (`followup-3481-round32-crawler-tests-adjudication.md`,
F2) against this identical code, and inverted again here: an unmatched form returns `None` and
the caller **fails loud** — the test cannot "miss" it, it goes red:

```diff
+        # a non-matching COPY makes the caller's assert fail LOUD (dest is
```
```diff
+        assert dest, (
```

## F3 — "`_update_set_clauses` misses a quoted column `SET "is_private" = true`" (high)

The column check is a separate, word-boundary regex over the captured SET clause, and `\b`
matches between `"` and `i`:

```diff
+    return re.search(r"\bis_private\b", set_clause, re.I) is not None
```

Verified: `re.search(r"\bis_private\b", 'SET "is_private" = true', re.I)` → match (`True`).
The quoted spelling is caught today; the finding did not run it.
