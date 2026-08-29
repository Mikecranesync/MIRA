# #3481 round G (docs group, evidence-complete) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round7-gate7-docs.md` — head `4a1fa3b17ee5406d295973348e9e3ca7e0ea6942`,
scope `docs/` briefed as *documentation* with the decision-point reminder, **291,274/291,274** chars
(sent-bytes sha256 = full-scoped sha256 = `2a480619c16fae14ceb60da8bede0fdaddf5004754c4f0ef42867b9773b420b0`).

**Every one of the ten findings names, as its File, a preserved evidence artifact under
`docs/architecture/convergence/units/evidence/CU-03/` — the verbatim raw output of an EARLIER round's
reviewer (`followup-3481-gate7-docs.md`, `followup-3481-round4-gate7-code.md`,
`followup-3481-round5-code.md`) or the lane's own stderr log — and quotes that earlier reviewer's
words as if they were this PR's present-tense claims.** Those files are committed history of what a
previous model said; doctrine requires them preserved intact. The PR's own claims live in
`units/CU-03.md` and the evidence `README.md`, and every quoted line below is a `+` line of this
PR's full diff, on which this adjudication runs.

## F1 — "False claim that the `_read_validated` guard was fixed" (cites `followup-3481-gate7-docs.md:5`)

The record's own bullet says the opposite, in the bullet itself:

```diff
+  **R12-F1 REFUTED — the finding was wrong; `_read_validated` in `mira-crawler/tasks/ingest.py` is
+  NOT modified by this follow-up and no fix is claimed.** `os.supports_dir_fd` is a `set` (measured:
```

## F2 — "False claim that `ingest_text_inline` signature was changed…" (cites `followup-3481-gate7-docs.md:13`)

```diff
+  **R12-F2 REFUTED — the finding was wrong; `mira-crawler/tasks/_shared.py` and its callers are NOT
```

## F3 — "False claim that case-sensitive URL discovery was fixed" (cites `followup-3481-gate7-docs.md:20`)

The fix is a `+` line of this PR, in a code file this PR modifies:

```diff
+++ b/mira-crawler/ingest/origins.py
```
```diff
+        and n.value.lower().startswith(("http://", "https://"))
```

## F4 — "False claim that deduplication URL mismatch was fixed" (cites `followup-3481-gate7-docs.md:27`)

```diff
+  **R12-F4 REFUTED — the finding was wrong; the deduplication code in `mira-crawler/tasks/ingest.py`
```

## F5 — "False claim that `provenance_policy.yaml` was added" (cites `followup-3481-gate7-docs.md:34`)

The record says the file was added by #3268 and is untouched here:

```diff
+(a file #3268 itself added — nothing in the follow-up adds or changes it), **untruncated**
```

## F6 — "False claim that new contract tests were added and wired into CI" (cites `followup-3481-gate7-docs.md:38`)

Both are `+` lines of this PR — the new test file and the CI slice line that ends with
`tests/test_conflict_and_packaging_contracts.py -q)`:

```diff
+++ b/mira-crawler/tests/test_conflict_and_packaging_contracts.py
```
```diff
+        run: pip install -r mira-crawler/requirements-celery.txt && (cd mira-crawler && pytest tests/test_write_path_visibility.py tests/test_store_verified.py tests/test_oem_trust.py tests/test_ingest.py tests/test_provenance_policy.py tests/test_ingest_lifecycle.py tests/test_conflict_and_packaging_contracts.py -q)
```

## F7 — "Security breach: full repository diff sent to an external LLM provider" (cites a `.stderr.log`)

The cited line is the lane's own preserved log, and it records that the payload was **redacted** and
**capped** before leaving the machine — the sanctioned Gate 7 design, not a defect this PR introduces:

```diff
+Gate 7: sending 78,857/78,857 diff chars to a third-party provider (redacted: IP/MAC/SN)
```

## F8 — "Contradictory documentation about the status of finding F3" (cites `followup-3481-gate7-docs.md:46`)

Two different findings carry the structural id `F3` in two different adjudications. Round 12 (head
`fc00074c6`) F3 = "URL discovery is case-sensitive" — SUSTAINED, then root-fixed in this PR (F3
above). Round C docs adjudication F3 = "False claim that the case-sensitive discovery was fixed" —
REFUTED, because the fix is in this diff:

```diff
+- **[SUSTAINED] F3** [high] URL discovery in `discover_manifests` is case‑sensitive, missing uppercase schemes
```
```diff
+- **[REFUTED] F3** [high] False claim that case‑sensitive URL discovery was fixed
```
```diff
+  **R12-F3 SUSTAINED at `fc00074c6` → root-fixed IN THIS PR.** `_urls_in` matched only lowercase
```

Sustained-then-fixed, and the claim-that-it-was-not-fixed refuted, is one consistent sequence.

## F9 — "Inclusion of `.log` in documentation suffixes leaks logs to the LLM" (cites `followup-3481-round4-gate7-code.md:30`)

`_DOC_SUFFIXES` feeds only `pr_kind`, the *classification* that chooses the brief; it does not select
what is sent. The reviewed diff has always been the scoped diff — logs included when they are in the
PR — redacted and capped (F7 above). The line in question:

```diff
+_DOC_SUFFIXES = (".md", ".markdown", ".rst", ".txt", ".log")
```

## F10 — "Source-URL case-sensitive uniqueness collides with case-insensitive classification" (cites `followup-3481-round5-code.md:4`)

This PR root-fixes exactly that: one canonical function applied inside BOTH constructors of the dedup
key, and a lookup that also matches a historical row stored in the caller's spelling —

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

— and the "private row duplicated as public" premise is disproven by the gate itself, which classifies
both casings identically:

```diff
+    def test_uppercase_scheme_curated_origin_classifies_like_lowercase(self):
```
```diff
+        assert _ingest_gate()(upper) == _ingest_gate()(lower)
```
