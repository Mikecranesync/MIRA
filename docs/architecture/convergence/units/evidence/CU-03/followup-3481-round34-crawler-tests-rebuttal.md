# #3481 round 34 (S3: `mira-crawler/tests/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round34-gate7-crawler-tests.md` — head `c70782371ca87d743323d8c744f1746e20df0347`
(valid on attempt 1). Every quoted line is a `+` line of this PR's diff.

## F1 — "`_update_set_clauses` misses `UPDATE /* hidden */ knowledge_entries`" (high)

The scanner is a guard rail over **this repository's crawler source**, and it fails closed if it
finds no UPDATE at all:

```diff
+def _production_py_files() -> list[Path]:
```
```diff
+        assert updates, "population check: the crawler's UPDATE statements were not found"
```
```diff
+        assert not offenders, f"an UPDATE assigns is_private: {offenders}"
```

No production file in `mira-crawler/` contains an inline SQL comment between `UPDATE` and the
table name; a "covert" statement of that shape would have to be *added* to the crawler through
code review, where the scanner is one guard among several (the write boundary
`enforce_visibility`, the read allowlist checker, the review itself). The scanner's own honesty
lock states the forms it covers:

```diff
+    def test_update_scanner_catches_aliased_lowercase_and_multiline_forms(self, sql):
```

The forms already sustained (schema-qualified, round AI) were forms a real migration might
plausibly write; a comment inserted *inside* the statement to evade a test is not a defect in
this diff but a hypothetical about a future adversarial commit. Coverage remark.

## F2 — "a `COPY … /app/  # comment` line is not matched, so the test assumes the manifest is missing and lets a Dockerfile that excludes the policy pass" (high)

Two errors. (a) In a Dockerfile `#` starts a comment **only at the beginning of a line**; after
`COPY` arguments it is an ordinary argument, so `COPY mira-crawler/ /app/ # copy` is a
multi-source COPY whose destination is `copy` — not the whole-directory form, and the helper
is right not to match it. (b) The consequence is inverted: an unmatched line returns `None` and
the caller **fails loud** — the test goes red, it never "lets a Dockerfile pass":

```diff
+        # a non-matching COPY makes the caller's assert fail LOUD (dest is
```
```diff
+        assert dest, (
```

Adjudicated REFUTED on this exact logic in round 32 (F2 there); the continuation form was
added in round AJ; a trailing-comment form does not exist in Dockerfile syntax.
