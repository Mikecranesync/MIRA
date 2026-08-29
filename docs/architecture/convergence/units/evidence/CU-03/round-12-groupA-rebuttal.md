# CU-03 round-12 group A — author rebuttal (verbatim quoted evidence)

Prior report: `round-12-groupA-final-head.md` — reviewed head `fc00074c6751748643493744247c1582dd285a01`
(the commit that merged as #3268), reviewed-diff sha256
`c70b35306646fe10f35235408ad615133b42385d879e50e42cd68a452b11d58f` (78,857/78,857 chars, untruncated).
Every quotation below is a verbatim line of that diff. Nothing is quoted from outside it except
where explicitly labelled *outside the diff* for the human reader.

## R12-F1 — "`_read_validated` uses an invalid check for `dir_fd` support, causing a `TypeError`"

The finding's premise is that `os.supports_dir_fd` is a boolean. It is a `set` — the
standard-library idiom is `os.stat in os.supports_dir_fd`. The guarded line is exactly as the diff
shows, and the expression is a set-membership test:

```diff
+    if os.open not in os.supports_dir_fd or not hasattr(os, "O_NOFOLLOW"):
+        return local_path.read_bytes()
```

The diff also adds three POSIX tests that execute this very line on Linux CI on every run:

```diff
+_POSIX_ONLY = pytest.mark.skipif(
+    os.name != "posix",
```

```diff
+        from tasks.ingest import _read_validated
+
+        with pytest.raises(OSError):
+            _read_validated(validated)
```

A `TypeError` on the guard would abort those tests before `pytest.raises(OSError)` is satisfied;
they are green on the merge. *Outside the diff, for the human reader:* measured on Linux python
3.12.3 — `type: set | os.open in os.supports_dir_fd: True | O_NOFOLLOW: True`; on Windows 3.14.2 —
`type: set | False | False`. The follow-up proof commit `663144a142d0af75f159fe058091c97754e57b47`
adds `test_platform_guard_is_set_membership_and_reads_on_every_platform`, which asserts
`isinstance(os.supports_dir_fd, (set, frozenset))` and executes the guard on Windows and Linux alike.

## R12-F2 — "`ingest_text_inline` requires a keyword-only `is_private`, but internal calls are not updated"

The finding says the diff shows no body modification forwarding the argument and that existing
callers will raise. The `mira-crawler/tasks/_shared.py` hunk contains both the signature and the
forwarding to the store:

```diff
+    *,
+    is_private: bool,
 ) -> int:
```

```diff
                 chunk_type=chunk.get("chunk_type", "text"),
+                is_private=is_private,
             )
```

Every caller of `ingest_text_inline` passes it explicitly, and every one of those call sites is a
`+` line in this diff:

```diff
+            is_private=False,  # public manual crawl -> shared corpus (unverified)
```
(`mira-crawler/tasks/full_ingest_pipeline.py`)

```diff
+                is_private=False,  # declaration only — ingest/store.py enforces the
```
(`mira-crawler/tasks/manualslib_scraper.py`, both call sites)

```diff
+                        is_private=False,  # declaration only — ingest/store.py enforces
```
(`mira-crawler/tasks/patents.py`, `mira-crawler/tasks/reddit.py`)

```diff
+                            is_private=False,  # public web content -> shared corpus
```
```diff
+            is_private=False,  # public web content -> shared corpus
```
(`mira-crawler/tasks/playwright_crawler.py`)

*Outside the diff, for the human reader:* the repo-wide AST caller contract
`TestCallerPopulationExplicit::test_every_call_site_passes_is_private`
(`mira-crawler/tests/test_write_path_visibility.py`, `TARGETS` includes `ingest_text_inline`) fails
CI on any caller that omits the keyword.

## R12-F3 — "URL discovery in `discover_manifests` is case-sensitive" — ACCEPTED (consequence narrowed), fixed at the root

Not refuted. The match was lowercase-only, exactly as the finding quotes (it is a `+` line —
`ingest/origins.py` is new in this diff):

```diff
+        and n.value.startswith(("http://", "https://"))
```

The claimed consequence — "allowing uncurated origins to be ingested" — does not follow from the
diff: the production gate lowercases the scheme and the host before classifying, and an origin with
no policy entry is refused or forced private, never shared:

```diff
+    scheme = _up(url).scheme.lower()
```
```diff
+    host = (urlparse(str(url)).hostname or "").lower()
```

So the gap was in the CI consistency proof (a `HTTPS://…` manifest constant would have escaped
discovery), not in the write boundary. Fixed at the root in the follow-up proof commit
`663144a142d0af75f159fe058091c97754e57b47` (`n.value.lower().startswith(...)`), red-first test
`test_discovery_matches_url_constants_case_insensitively`. Per doctrine, a fix is followed by a fresh
review of the new head — that is the follow-up PR's own Gate 7 run, not this adjudication.

## R12-F4 — "Deduplication uses the original URL while the stored row uses the final (post-redirect) URL"

The finding quotes a **removed** line as current code. The hunk reads:

```diff
             # Dedup
-            if chunk_exists(tenant_id, url, chunk_idx):
+            if chunk_exists(tenant_id, final_url, chunk_idx):
                 skipped += 1
```

and the row is stored under the same key:

```diff
+                source_url=final_url,
```

Dedup and storage both key on `final_url` at head; the `+` line is the very change that closed the
mismatch the finding describes.
