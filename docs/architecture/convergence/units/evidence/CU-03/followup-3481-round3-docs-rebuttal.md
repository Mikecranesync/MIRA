# #3481 round C (docs group) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round3-gate7-docs.md` — head `611705cc5116a07c672b6a8e5cdf4b039ad94015`,
scope `docs/` only, 87,719/87,719 chars, reviewed-diff sha256
`1a2ca9c6ed86cabe6157ec8dc80cd6f44ea4a44b29f396a1ccedb0025d7c245a`.

Every finding in that report is the same scope artifact the round-10 group D review produced: the
reviewer saw only the `docs/` slice of this PR and concluded the code it describes does not exist.
This adjudication is run on the **full PR diff**, where every quoted line below is present as a
`+` line.

## D-F1 — "False claim that the `_read_validated` guard was fixed"

The record makes no such claim. It records the finding as **refuted**, i.e. the guard was correct all
along and no code change was needed:

```diff
+  **R12-F1 REFUTED** — `os.supports_dir_fd` is a `set` (measured: Linux 3.12.3 `os.open in
```

## D-F2 — "False claim that `ingest_text_inline` was changed and all call sites updated"

Same shape — recorded as refuted (the signature and the callers were already in the reviewed #3268
diff), not as fixed here:

```diff
+  **R12-F2 REFUTED** — `_shared.py` forwards `is_private=is_private` (a `+` line), all seven
```

## D-F3 — "False claim that case-sensitive URL discovery was fixed"

The fix IS in this PR:

```diff
+++ b/mira-crawler/ingest/origins.py
```
```diff
+        and n.value.lower().startswith(("http://", "https://"))
```

with its red-first test named in the record:

```diff
+  (`test_discovery_matches_url_constants_case_insensitively`).
```

## D-F4 — "False claim that the deduplication URL mismatch was fixed"

Not claimed. Recorded as refuted — the finding had quoted a removed line:

```diff
+  on `final_url`. **R12-F3 SUSTAINED — accepted.** `_urls_in` matched only lowercase schemes, so the
```

(the preceding record line reads `**R12-F4 REFUTED** — the finding quoted the *removed* ``-`` line; head dedups and stores`).

## D-F5 — "Claim that `provenance_policy.yaml` was added"

The phrase "new in the PR" sits under the heading for the round-12 review of **#3268's** final head,
and refers to that PR — which did add the file. This PR does not claim to add it:

```diff
+### Gate 7 round 12 — fresh group A review of the FINAL head `fc00074c6` (2026-08-29, Gate 9 follow-up)
```

## D-F6 — "Claim that new contract tests were added and wired into CI"

Both are in this PR's diff:

```diff
+++ b/mira-crawler/tests/test_conflict_and_packaging_contracts.py
```

and the CI slice line (`.github/workflows/ci.yml`) ends with
`tests/test_conflict_and_packaging_contracts.py -q)`:

```diff
+        run: pip install -r mira-crawler/requirements-celery.txt && (cd mira-crawler && pytest tests/test_write_path_visibility.py tests/test_store_verified.py tests/test_oem_trust.py tests/test_ingest.py tests/test_provenance_policy.py tests/test_ingest_lifecycle.py tests/test_conflict_and_packaging_contracts.py -q)
```
