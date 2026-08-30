# #3481 round AE (S2: `mira-crawler/ingest/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round29-gate7-ingest.md` — head `212861d5f860bd9493bb0e60c15e103012de7445`,
**23,821/23,821** chars (valid on attempt 1). Every quoted line below is a `+` line of this PR's
diff (the adjudication scope adds `mira-crawler/tests/` so the locks are visible).

## F1 — "A credential-bearing value without a scheme (`user:secret@host/path`) bypasses detection" (high)

The rule is defined, deliberately, for every syntactically valid **`scheme://authority`** form —
userinfo is an authority component, and an authority exists only after `//`:

```diff
+    """True when a ``scheme://authority`` URL of ANY scheme carries userinfo
```
```diff
+    in a path, query or fragment is not userinfo, and a value without a
+    ``scheme://`` authority form (bare path, drive letter, ``mailto:``,
+    ``file:/x``) is not a candidate. Every syntactically valid scheme counts —
```

A value with `@` but no `//` is the **specified negative control** — `mailto:a@b.example` is
an address, not a credential, and is locked as not-userinfo:

```diff
+            "mailto:a@b.example",  # no `//` authority form
```

`user:secret@host/path` is that same opaque form (`user:` is its "scheme"); treating it as
credentials would refuse every `mailto:` and every opaque-scheme value with an `@`. It is not a
URL the crawler produces, and the hop-0 gate admits only `http`/`https`/`file` (every other
scheme is refused before transport). The finding asks for a rule the contract excludes on
purpose.

## F2 — "Whitespace stripping limited to http/https/file re-introduces duplicate rows for other schemes" (high)

By stated contract: surrounding whitespace is stripped only from the schemes the hop-0 gate
admits; a padded value of any other scheme keeps every byte because those bytes are not ours to
change — locked:

```diff
+# Surrounding whitespace is stripped only from URLs of the schemes the hop-0
+# gate admits (http/https/file). A padded value of any other scheme, a padded
+# bare path or a padded drive-letter path keeps every byte: not ours to change.
+_STRIP_SCHEMES = frozenset({"http", "https", "file"})
```
```diff
+    def test_a_padded_non_url_or_disallowed_scheme_keeps_its_bytes(self, raw):
```

A padded `ftp://` value is refused at the hop-0 gate (unsupported scheme) and never becomes a
row; there is no duplicate to create.

## F3 — "`source_url = ANY(:urls)` may prevent index utilisation" (medium)

`col = ANY(array)` is PostgreSQL's scalar-array operator; it is an index condition on `col`
(the planner probes the index once per array element). The predicate binds the two exact
spellings — one when they coincide — on the UNIQUE index's column, inside the tenant equality:

```diff
+    urls = [source_url] if source_url == raw_url else [source_url, raw_url]
```
```diff
+                      AND source_url = ANY(:urls)
```

Non-blocking; no measurement or plan is offered.
