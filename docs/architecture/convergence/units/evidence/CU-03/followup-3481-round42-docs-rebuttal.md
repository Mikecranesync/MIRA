# #3481 round 42 (S1: `docs/` + `.claude/` + `PLAN.md` + `HANDOFF.md`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round42-gate7-docs.md` — head `03cd8357d202f5640d40b7ed2115ac169235c2fb`
(valid on attempt 1). The finding is about `mira-crawler/ingest/origins.py` and the
credential gate, outside the S1 scope; the adjudication scope adds `mira-crawler/ingest/` and
`mira-crawler/tests/` so every quoted `+` line is visible.

## F1 — "`_urls_in` ignores f-strings, so a credential-bearing URL built with an f-string bypasses `url_has_userinfo` and the query-name checks" (high)

Two different mechanisms are conflated. `_urls_in` is **manifest discovery**: it enumerates the
module-level constant origins of the feeder manifests so that the *policy-consistency* test
can prove every configured origin has a classification. It is not the credential gate and no
URL is "checked" by it:

```diff
+        n.value.strip()
```
```diff
+        and n.value.strip().lower().startswith(("http://", "https://"))
```

The credential gate runs on the **URL value at ingest time**, on every route that reaches
SQL, whatever expression produced the string — an f-string, a concatenation, a manifest
constant, a redirect:

```diff
+    refusal = url_credential_reason(url)
```
```diff
+    refusal = url_credential_reason(source_url)
+    if refusal:  # before classification: a credential-bearing URL is never a document
```

and it is locked on every route (`test_non_http_userinfo_is_refused_before_any_sql_on_every_route`,
`test_credential_query_is_refused_before_any_sql_on_every_route`):

```diff
+    def test_non_http_userinfo_is_refused_before_any_sql_on_every_route(self, captured, caplog):
```

A URL assembled at runtime is exactly the case the runtime gate exists for; a static
manifest scan could never be the boundary, and the diff never claims it is.
