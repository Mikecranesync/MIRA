# #3481 round 44 (S3: `mira-crawler/tests/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round44-gate7-crawler-tests.md` — head `18cde8db6e6437ac6f21938a66adc8581e32d135`
(valid on attempt 1). The adjudication scope adds `mira-crawler/ingest/` so the discovery
code the tests lock is visible. Both claims were executed on this head first.

## F1 — "a static f-string (`f"https://example.com/feed.xml"`, no interpolation) is classified dynamic and dropped" (high)

False on the code. `_urls_in` renders a `JoinedStr` from its parts and substitutes `{…}`
**only** for interpolated expressions; a static f-string renders to its literal and is
reported as a normal origin:

```diff
+            rendered = "".join(
+                v.value if isinstance(v, ast.Constant) and isinstance(v.value, str) else "{…}"
+                for v in n.values
+            )
```

Executed on this head: `FEEDS = [f"https://static.example.com/feed.xml"]` →
`discover_manifests` reports `https://static.example.com/feed.xml` and
`discover_feeder_origins` yields `static.example.com`. Nothing is dropped; only an
*interpolated* origin becomes `https://{…}/…`, on purpose, so the proof fails loud on it:

```diff
+    literal head is a URL is reported as ONE dynamic origin (`https://{…}/feed.xml`,
```

## F2 — "tuple-literal manifests are not discovered" (medium)

`_urls_in` uses `ast.walk` over the assignment value — every nested node, lists, tuples,
sets and dict values alike; there is no `ast.List`-only branch:

```diff
+    for n in ast.walk(node):
```

Executed on this head: `TUP = ("https://tup.example.com/a", "https://tup2.example.com/b")` →
both URLs reported, both hosts in `discover_feeder_origins`.
