# #3481 round AC (scope B: `mira-crawler/ingest/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round27-gate7-ingest.md` — head `156b8484452a7fc717dd9e2cf2128412848b9234`,
**20,737/20,737** chars (valid shape on attempt 1). Every quoted line below is a `+` line of this
PR's diff.

## F1 — "OR condition in `chunk_exists` disables index usage and opens a DoS vector" (high)

Both arms of the predicate are **equality** tests on `source_url`, inside an equality on
`tenant_id` — the leading columns of the UNIQUE index the write targets; the planner serves an
`OR` of two equalities on one indexed column as two index probes (BitmapOr), never a table scan.
The index identity is a lock of this PR:

```diff
+    def test_conflict_target_is_exactly_the_migration_unique_index(self, captured):
```

The "attacker supplies many distinct raw URLs" scenario binds **two** values per call — the
caller's spelling and its canonical form — and every call is tenant-scoped:

```diff
+                      AND (source_url = :url OR source_url = :raw)
```

No measurement, plan or reproduction is offered; the second arm exists so a historical row
stored under its raw spelling is found (round F, real) and is the reason the recrawl does not
write a duplicate.

## F2 — "`canonical_source_url` does not strip userinfo — a future caller could persist credentials" (high)

That is the stated design, not an omission: userinfo is **never stripped into another identity**;
a credential-bearing URL is **refused before the identity is computed** on every route that
reaches SQL, through one helper:

```diff
+    if _refuse_userinfo(source_url):
+        return ""
```
```diff
+    if _refuse_userinfo(source_url):
+        return False  # no query: a credential never reaches the DB, not even as a bind
```
```diff
+    asked = [u for u in asked if not _refuse_userinfo(u)]
```

and at the policy gate before classification:

```diff
+    if url_has_userinfo(source_url):
+        return (False, True, _USERINFO_REFUSED)  # before classification: never a document
```

The docstring the finding quotes states exactly this ("neither stripped … nor persisted: such a
URL is refused … before this function is ever consulted for a write"). Locked for every route,
every `scheme://authority` form, with parameter capture proving no credential reaches a bind or
a log (`+class TestUserinfoRefusedAtTheBoundary:`). A hypothetical "future caller" that bypasses
the boundary is not a defect of this diff; the boundary is where every existing SQL route lives.

## F3 — "Non-default ports with leading zeros are not normalised" (medium)

By stated contract: only the scheme's **default** port names the same authority as no port
(RFC 3986 §6.2.3); a non-default port's text is preserved byte-exact, locked:

```diff
+      (RFC 3986 §6.2.3); non-default, empty (``:``) or invalid port text and the
+      ports of every other scheme are preserved byte-exact;
```
```diff
+    def test_non_default_empty_or_invalid_port_text_is_byte_exact(self, raw):
```

`:0081` and `:81` are two spellings the contract deliberately does not equate (no RFC rule
equates them); a historical-spelling lookup on the raw value still finds a row stored under
either. Non-blocking.

## F4 — "A 12-hex SHA-256 prefix of the URL in the refusal log can be brute-forced for short secrets" (medium)

Recorded residual, unchanged: the hash is the operator's only correlation key for a refused
write, guessing it requires the whole URL, and the reference never carries userinfo, path or
query:

```diff
+    """A log-safe reference to a source URL: its host (plus an explicit port)
```

Credential-bearing URLs no longer reach this log at all (they are refused with `_log_ref` of a
URL whose userinfo is never printed). Non-blocking.
