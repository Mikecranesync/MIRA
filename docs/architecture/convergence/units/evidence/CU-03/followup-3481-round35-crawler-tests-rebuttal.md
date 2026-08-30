# #3481 round 35 (S3: `mira-crawler/tests/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round35-gate7-crawler-tests.md` — head `bd674af3e271eb7e814e1c36750034c22bb956f8`
(valid on attempt 1). Every quoted line is a `+` line of this PR's diff; the adjudication
scope adds `mira-crawler/ingest/` so the production code the tests lock is visible. Every
claim below was executed against this head before it was rebutted.

## F1 — "`COPY` is matched case-sensitively; a lower-case `copy` bypasses the packaging contract" (high)

Inverted consequence. The helper returns `None` for any form it does not match, and the
caller **fails loud** — so a Dockerfile spelled `copy mira-crawler/ /app/` turns the contract
test red; it can never "allow a build that omits the manifest":

```diff
+        # a non-matching COPY makes the caller's assert fail LOUD (dest is
```
```diff
+        assert dest, (
```

Executed: `_whole_dir_copy_dest("copy mira-crawler/ /app/")` → `None` → the assert fails.
Every Dockerfile in this repository spells `COPY`; a lower-case spelling is a robustness
remark about a test helper, not a bypass.

## F2 — "`COPY mira-crawler/ extra/ /app/` is accepted with `extra/` as the destination — a false positive" (high)

False, by the regex the finding quotes: the destination is one token and the pattern is
anchored at end of line (`([^\s#]+)\s*(?:#.*)?$`), so a second source leaves ` /app/`
unmatched and the helper returns `None`. Executed:
`_whole_dir_copy_dest("COPY mira-crawler/ extra/ /app/")` → `None`. No false positive exists;
the lock's subset cases already prove the direction:

```diff
+        ("COPY mira-crawler/tasks/ /app/mira_crawler/tasks/", None),  # subset: manifest absent
```

## F3 — "an `UPDATE` after a `WITH … ` CTE is not matched" (high)

False: `re.finditer` is unanchored, so the `UPDATE` token is found wherever it appears.
Executed: `_update_set_clauses("WITH cte AS (SELECT 1) UPDATE knowledge_entries SET is_private = TRUE WHERE id = :id")`
→ `[' SET is_private = TRUE ']` — captured, and `_assigns_is_private` flags it. The scanner's
own honesty lock covers lowercase, alias, line-break, missing-WHERE, schema-qualified and
comment-bearing forms:

```diff
+    def test_update_scanner_catches_aliased_lowercase_and_multiline_forms(self, sql):
```

## F4 — "credential detection is a hard-coded whitelist, missing `access-token`, `sessionid`, `auth_token`, `clientToken`" (high)

By contract the rule is a **name family**, matched case- and separator-insensitively —
`access-token` → `accesstoken` **is** in the family — and it deliberately does not inspect
values or guess at every possible spelling (a longer name is not the family):

```diff
+# scope C F1 SUSTAINED). Matched on the percent-decoded name, lower-cased, with
+# `-`, `_`, `.` and whitespace removed — so `api_key`, `Api-Key`, `api%5Fkey`
+# and `X-Amz-Signature` all match; values are never inspected (a value that
+# merely contains the word "token" is an ordinary query), and a longer name
+# such as `tokenizer` is not the family.
```
```diff
+        "accesstoken",
```

An enumerated family is the design decided in round AD (round-27 scope C F1 SUSTAINED and
fixed); asking for an open-ended heuristic is a request to change that decision, not a
defect in this diff — and a URL whose host is not a curated origin is refused at hop-0
regardless of its query.

## F5 — "percent-encoded userinfo `https://%75%73%65%72:%70%61%73%73@host/` is not detected" (high)

False: userinfo is delimited by the literal `@` in the authority, which that URL carries.
Executed: `url_has_userinfo("https://%75%73%65%72:%70%61%73%73@host/path")` → `True` →
refused before any SQL. The rule looks only for `@` in the authority slice:

```diff
+    for stop in "/?#":
```
```diff
+    return "@" in authority
```

The lock for an encoded *password* with a literal `@` is on file:

```diff
+            ("https://user:p%40ss@example.com:443/x", "https://user:p%40ss@example.com/x"),
```
