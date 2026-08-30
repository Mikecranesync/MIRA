# #3481 round 32 (S3: `mira-crawler/tests/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round32-gate7-crawler-tests.md` — head `9e7230330704c9fa600a56cedc5da41b7ee2985e`
(valid on attempt 1). Every quoted line is a `+` line of this PR's diff.

## F1 — "`_update_set_clauses` misses a schema-qualified `UPDATE public.knowledge_entries`" (high)

The scanner is a contract test over **this repository's crawler source** — it walks
`_production_py_files()` and fails closed if it finds nothing:

```diff
+def _production_py_files() -> list[Path]:
```
```diff
+        assert updates, "population check: the crawler's UPDATE statements were not found"
```
```diff
+        assert not offenders, f"an UPDATE assigns is_private: {offenders}"
```

No production file under `mira-crawler/` spells the table with a schema prefix (grep of
`\w+\.knowledge_entries` over `mira-crawler/**/*.py` excluding tests: zero hits). The scanner's
own honesty lock states the forms it covers — alias, lowercase, line breaks, missing WHERE:

```diff
+    def test_update_scanner_catches_aliased_lowercase_and_multiline_forms(self, sql):
```

A hypothetical future spelling the repo does not contain is a coverage remark on a test helper
(the same remark as round-29 S3 F2), not a defect in the code under review; a "malicious update"
in this repository would have to pass code review as a new schema-qualified statement in the
crawler — the scanner is a guard rail, not the only boundary.

## F2 — "`_whole_dir_copy_dest` does not handle a backslash-continued multi-line COPY, so the test believes the manifest is packaged" (high)

Inverted: a form the helper cannot match returns `None`, and the caller asserts on it — the test
**fails loud**, it does not pass:

```diff
+        # a non-matching COPY makes the caller's assert fail LOUD (dest is
```
```diff
+        assert dest, (
```

So a Dockerfile that spells the copy across lines would break CI until the helper is taught the
form — the fail-closed direction. It can never "believe the manifest is packaged when it is
omitted"; the only way to pass is a single-line whole-directory copy, which the parametrised
lock enumerates (shell form, JSON form, flags; subset copies return `None`).
