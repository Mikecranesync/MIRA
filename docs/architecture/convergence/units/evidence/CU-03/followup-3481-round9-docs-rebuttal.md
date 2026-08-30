# #3481 round I (docs group) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round9-gate7-docs.md` — head `085a1b909cb6d7a560d290df318330c2bb86ee22`,
scope `docs/` (evidence artifacts excluded and receipted), **67,437/67,437** chars, sha256
`6468b1a277e95d6a688759757ac5d392e5ac92f65056ce07fb68df824957a3e8`, briefed as *documentation*.

All four findings rest on one premise — "the only file changed in this PR is
`docs/architecture/convergence/units/CU-03.md`". That is the `--paths docs/` **slice** the reviewer
was sent, not the PR. This adjudication runs on the PR's full diff, where every line below is a `+`
line.

## F1 — "claims a fix in `mira-crawler/ingest/origins.py`, yet the diff contains no modifications to that file"

```diff
+++ b/mira-crawler/ingest/origins.py
```
```diff
+        and n.value.lower().startswith(("http://", "https://"))
```

## F2 — "asserts `canonical_source_url` … but the diff does not modify `mira-crawler/ingest/store.py`"

```diff
+++ b/mira-crawler/ingest/store.py
```
```diff
+def canonical_source_url(url: str) -> str:
```
```diff
+    source_url = canonical_source_url(source_url)
```
```diff
+                      AND (source_url = :url OR source_url = :raw)
```

## F3 — "states a new contract test file was added and wired into CI, yet the diff adds no such file"

```diff
+++ b/mira-crawler/tests/test_conflict_and_packaging_contracts.py
```

and the `.github/workflows/ci.yml` slice line, which ends with
`tests/test_conflict_and_packaging_contracts.py -q)`:

```diff
+        run: pip install -r mira-crawler/requirements-celery.txt && (cd mira-crawler && pytest tests/test_write_path_visibility.py tests/test_store_verified.py tests/test_oem_trust.py tests/test_ingest.py tests/test_provenance_policy.py tests/test_ingest_lifecycle.py tests/test_conflict_and_packaging_contracts.py -q)
```

## F4 (medium) — "R12-F1 REFUTED is supported only by a citation, not by code changes or new tests in this PR"

The record says, in the bullet itself, that no code change was made or claimed for R12-F1; the
supporting artifact this PR adds is a test, in `mira-crawler/tests/test_ingest.py`:

```diff
+    def test_platform_guard_is_set_membership_and_reads_on_every_platform(
```
```diff
+        assert isinstance(os.supports_dir_fd, (set, frozenset))
```
