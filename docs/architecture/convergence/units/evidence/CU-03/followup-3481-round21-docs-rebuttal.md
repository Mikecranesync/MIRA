# #3481 round U (docs group) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round21-gate7-docs.md` — head `77b05c0c580155fbfbee806cd1913f22a3a6911f`,
scope `docs/` (rounds R and T settled), **152,748/152,748** chars, sha256
`1d35dd7e0f5b034cb9ae3a074746cc88a9e2186daa47ee8659e601f06d0c236c` (valid shape on attempt 1).
Every quoted line below is a `+` line of this PR's diff. The docs run was a `--paths docs/`
slice; its own receipts list `excluded by scope (11)` and name `mira-crawler/ingest/origins.py`
among the eleven files it could not see.

## F1 — "False claim of code modification in `mira-crawler/ingest/origins.py`" (high)

The finding's premise is "the PR diff contains only changes to documentation files and does not
modify `mira-crawler/ingest/origins.py`". The PR diff modifies that file; the reviewed slice did
not include it. The file header and the fix line are `+` lines of this PR:

```diff
+++ b/mira-crawler/ingest/origins.py
```
```diff
+        and n.value.lower().startswith(("http://", "https://"))
```

The sentence the finding quotes is the record's disposition of the round-12 finding R12-F3 —
its heading names the sequence ("SUSTAINED at the old head → root-fixed IN THIS PR"), and the
claim it makes is exactly the `+` line above:

```diff
+  **R12-F3 SUSTAINED at `fc00074c6` → root-fixed IN THIS PR.** `_urls_in` matched only lowercase
```
```diff
+  `ingest/origins.py` is imported only by the test). The fix is a `+` line of THIS PR's diff in
+  `mira-crawler/ingest/origins.py` (`n.value.lower().startswith(...)`, commit `663144a14`), red-first
```

"The diff does not contain X" is not a finding in a scoped run (the brief's SCOPE NOTICE says so);
on the full diff supplied to this adjudication the modification is visible.

## F2 — "Incorrect claim that evidence artifacts are not claims" (high)

The doctrine sentence describes a mechanism the lane implements, not an outcome it promises:

```diff
+> *Evidence artifacts are not claims.* By default the lane excludes from the reviewed diff
+> the preserved **raw reviewer/adjudicator outputs and lane logs** under
+> `docs/architecture/convergence/units/evidence/` — documentation/log suffixes only, keyed
```

The mechanism is code in this PR, receipted, and locked:

```diff
+def is_evidence_artifact(path: str) -> bool:
```
```diff
+def drop_evidence_artifacts(diff: str) -> tuple[str, list[str]]:
```
```diff
+        diff, artifacts = drop_evidence_artifacts(diff)
```
```diff
+            "- evidence artifacts excluded from review (raw reviewer output / logs under "
+            f"units/evidence/, not author claims; --include-evidence keeps them) "
```
```diff
+def test_preserved_evidence_artifacts_are_dropped_from_the_reviewed_diff_and_receipted():
```

The "repeated false findings" the finding cites are the history the same paragraph documents
as the *reason* the mechanism exists — rounds that ran before it did:

```diff
+> artifacts' contents are themselves the subject of review. Why: a PR that carries its own
+> preserved review output was being reviewed *for the prior model's text* — "the
+> documentation claims X was fixed", quoted from an earlier reviewer — recursively, on
```

The prior report's own run receipts record the mechanism working on this head: 189 preserved
artifacts were excluded from the reviewed diff and named. What stays in review by design is the
author-written `README.md` and `*rebuttal*` files — which is where F1's quoted sentence comes
from (an author disposition, reviewed as a claim, and true on the full diff). A documented
mechanism that behaves as documented is not an incorrect claim.
