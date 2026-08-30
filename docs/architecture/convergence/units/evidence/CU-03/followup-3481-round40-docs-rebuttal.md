# #3481 round 40 (S1: `docs/` + `.claude/` + `PLAN.md` + `HANDOFF.md`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round40-gate7-docs.md` — head `52f965daed9c870f8bc66203c96f58333b056cb9`
(valid on attempt 1). The finding is about `mira-crawler/ingest/store.py`, outside the S1
scope; the adjudication scope adds `mira-crawler/ingest/` and `mira-crawler/tests/` so every
quoted `+` line is visible.

## F1 — "`canonical_source_url` never strips surrounding whitespace, so `' https://example.com'` and `'https://example.com'` are two keys with independent visibility; the round-Z fix is not in this PR" (high)

The quoted function body is not the code in this diff. The round-Z rule **is** in this PR, in
the contract and in the code:

```diff
+    * surrounding whitespace is not part of a URL and is stripped from a
+      recognised URL before any of the above (round Z on #3481); a value that
```
```diff
+_STRIP_SCHEMES = frozenset({"http", "https", "file"})
```

and it is locked:

```diff
+    def test_surrounding_whitespace_is_stripped_from_a_recognised_url(self, raw, expected):
```

"Independent visibility": false regardless of spelling — visibility is decided from the
origin's host by `classify_origin`, identical for both spellings, and a credential-bearing
value is refused before classification on every route:

```diff
+    refusal = url_credential_reason(source_url)
+    if refusal:  # before classification: a credential-bearing URL is never a document
```

There is no spelling under which a refused URL becomes a public row.
