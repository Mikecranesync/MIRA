# #3481 round V (docs group) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round22-gate7-docs.md` — head `99f18d8e9d8f65d330b85ba0f06d42894cc6c9dd`,
scope `docs/` (rounds R, T and U settled), **167,992/167,992** chars, sha256 in the report's
receipts (valid shape on attempt 1). Every quoted line below is a `+` line of this PR's diff.

## F1 — "Documentation claim that evidence artifacts are not claims is false" (high)

This restates round-21 docs finding F2, adjudicated **REFUTED** at `77b05c0c5` (settled context
supplied to this round). The only new material is a README row — and that row records a round
that ran **before** the exclusion mechanism existed, so it cannot contradict a sentence that
describes the mechanism.

**The sentence describes a mechanism, and states its own history as the reason for it:**

```diff
+> *Evidence artifacts are not claims.* By default the lane excludes from the reviewed diff
```
```diff
+> preserved review output was being reviewed *for the prior model's text* — "the
+> documentation claims X was fixed", quoted from an earlier reviewer — recursively, on
```

**The row the finding quotes is round G at head `4a1fa3b17`; the exclusion landed in the next
head, round H at `be9e41107`, and the row for that round records 55 artifacts excluded and named
in the receipts.** Both rows are `+` lines of this PR, in that order:

```diff
+**Round G (`4a1fa3b17`) — evidence-complete on the first attempt (scopes measured first: docs
```
```diff
+**Round H (`be9e41107`, evidence-complete).** **Docs** (55 artifacts excluded and named in the
```
```diff
+| `followup-3481-round8-gate7-docs.md` + `-docs-rebuttal.md` + `-docs-adjudication.md` (+ logs) | #3481 round H (`be9e41107`) | docs with 55 artifacts excluded (named in receipts), **62,856/62,856**; adjudication on the full diff 128,208/128,208 | BLOCK ×1 (docs-scope artifact: "no code in the diff") → adjudication answered a bare `REFUTED` with no id → **UNKNOWN**; not re-rolled (head changed) |
```
```diff
+H-C2 is **real and taken**: the artifact exclusion dropped *any* file under `units/evidence/`, so a
```

A record that says "round G reviewed every artifact as a claim; round H added the exclusion; from
round H on the artifacts are excluded and named" is a chronology, not a contradiction. Reading the
round-G row as a present-tense statement about the lane is the exact misreading the doctrine
sentence exists to stop.

**The mechanism is code in this PR, receipted, and locked:**

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

The prior report's own run receipts record it working on this head (preserved artifacts excluded
from the reviewed diff and named). No new evidence that the round-21 adjudication was wrong is
cited; the finding is the settled one, re-raised.
