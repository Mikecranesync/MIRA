# #3481 round U (code group) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round21-gate7-code.md` — head `77b05c0c580155fbfbee806cd1913f22a3a6911f`,
scope `mira-crawler/ tests/ .github/ tools/` (rounds C, E, P, R, T settled), **130,632/130,632**
chars, sha256 `be2f8584d6d13398fc34d8e76562fa5936b5f20ab66eb22a6beea9c96ee83058` (valid shape on
attempt 1). Every quoted line below is a `+` line of this PR's diff.

## F1 — "Duplicate logical entries due to asymmetric canonicalisation" (high)

Two claims are bundled. They are answered separately.

**(a) "Privacy regression — a pre-canonical row that was forced private can coexist with a
canonical row that is classified as curated or public."** False. Visibility is decided per row
by `enforce_visibility` on a lower-cased host, so every spelling of one origin receives the same
classification; a private row never widens a public one. Locked in this PR for both the casing
and the port / escape spellings:

```diff
+    def test_canonicalisation_never_changes_visibility_or_refusal(self):
```
```diff
+    def test_port_and_escape_canonicalisation_never_changes_visibility_or_refusal(self):
```

**(b) "`insert_chunk` does not guard against an existing raw-spelled row."** True of
`insert_chunk` read in isolation, and accepted at the boundary: the guard is added to
`insert_chunk` itself in the next head (red-first; a row that already exists under the exact
spelling the caller supplied wins, exactly as `ON CONFLICT DO NOTHING` lets an existing canonical
row win), so it no longer depends on callers. What this head already does — and what the record
says about it — is stated in `+` lines, not implied: the exact raw-spelling lookup exists at the
read seam every production route runs before writing, and the residual is documented as a
migration follow-up, never hidden:

```diff
+    # Look up the canonical key insert_chunk writes AND the spelling we were
+    # given: rows written before canonicalisation keep their raw casing, and the
+    # freshness recrawl re-supplies exactly that stored spelling — a canonical-
+    # only lookup would miss such a row and the recrawl would write a duplicate.
```
```diff
+                      AND (source_url = :url OR source_url = :raw)
```
```diff
+    Historical residual, documented not migrated: rows written before this
+    function keep their stored spelling; ``chunk_exists`` and the ledger probe
+    also look up the exact raw spelling they were given, so a recrawl of such a
+    row finds it. A one-off dedup migration is the follow-up, never a silent
```
```diff
+    def test_lookup_also_matches_a_historical_row_stored_in_the_callers_spelling(self, captured):
```

(Author evidence outside the diff, verifiable in the tree at this head: the three production
write routes each call `chunk_exists` before `insert_chunk` — `ingest/store.py:369→372`
(`store_chunks`), `tasks/ingest.py:464→493`, `tasks/_shared.py:126→147`.) The finding's
"mitigation 2" — a migration that rewrites historical rows — is the documented follow-up (#3482),
not a change this PR makes silently.

## F2 — "Mis-classification of PR kind after evidence-artifact exclusion" (medium)

The premise is that `kind` is computed from the filtered diff. It is computed from `paths` — the
PR's changed-file list — which `drop_evidence_artifacts` never touches (it rebinds only `diff`);
and an empty post-exclusion diff exits before `kind` is ever computed:

```diff
+        diff, artifacts = drop_evidence_artifacts(diff)
```
```diff
+                "error: nothing left to review after excluding evidence artifacts", file=sys.stderr
```
```diff
+    kind = pr_kind(scoped_paths(paths, tuple(a.paths)) if a.paths else paths)
```

A PR whose only changes are evidence artifacts therefore never reaches `pr_kind([])`: the lane
refuses to invent a verdict for it (exit 1, naming `--include-evidence`), the disposition
adjudicated in round T (F5).

## F3 — "Incomplete handling of empty or whitespace-only `tenant_id`" (low)

Settled in round T (F4, medium, ruled) and re-raised without new evidence. The refusal is the fix
for a real, pre-existing cross-tenant probe found by this lane in round M; no caller passes an
empty tenant to mean "all tenants" — the empty string came from an unset `MIRA_TENANT_ID`:

```diff
+    if not isinstance(tenant_id, str) or not tenant_id.strip():
+        # Fail closed — empty, None, whitespace-only or non-string is not a
```
```diff
+        # would have queried EVERY tenant's rows. Nothing is reported as
+        # ingested, so ledger items stay pending — the retryable direction.
```
```diff
+    def test_ledger_probe_refuses_to_run_without_a_tenant(self, captured):
+        """Gate 7 round M on #3481 (real, pre-existing): `ingested_source_urls`
+        took `tenant_id=""` and then dropped the tenant predicate, so an unset
+        MIRA_TENANT_ID turned the ledger's did-it-land probe into a cross-tenant
```

(Author evidence outside the diff: the only production callers are `tasks/rss.py:104` and
`tasks/sitemaps.py:81`, both passing `os.getenv("MIRA_TENANT_ID", "")`.) An `allow_cross_tenant`
flag would reintroduce the defect as an option; the retryable direction is the designed one.
