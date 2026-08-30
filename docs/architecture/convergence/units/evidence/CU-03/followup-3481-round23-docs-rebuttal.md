# #3481 round W (docs group) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round23-gate7-docs.md` — head `fa304168073ab585df4a8201b87f5778a89b6181`,
scope `docs/` (rounds R, T, U and V settled), **181,877/181,877** chars, sha256 in the report's
receipts (valid shape on attempt 1). Every quoted line below is a `+` line of this PR's diff.

## F1 — "Documentation claims evidence artifacts are not claims, but the lane still treats them as claims" (high)

This is the settled round-21 F2 / round-22 F1 finding, adjudicated **REFUTED** at `77b05c0c5`
and again at `99f18d8e9` (both supplied as settled context), restated a third time with no new
evidence. The finding's own quotation ends in the answer: the round-G row it cites says
"root cause structural → **round H lane fix**" — the exclusion mechanism was added in the head
*after* round G. A record that documents "round G reviewed artifacts as claims; round H added the
exclusion; from round H on they are excluded and named" is a chronology, not a contradiction.

**The doctrine sentence describes a mechanism and gives that history as its reason:**

```diff
+> *Evidence artifacts are not claims.* By default the lane excludes from the reviewed diff
```
```diff
+> preserved review output was being reviewed *for the prior model's text* — "the
+> documentation claims X was fixed", quoted from an earlier reviewer — recursively, on
```

**Round G (`4a1fa3b17`) precedes the fix; round H (`be9e41107`) carries it — both `+` lines of
this PR, in that order:**

```diff
+**Round G (`4a1fa3b17`) — evidence-complete on the first attempt (scopes measured first: docs
```
```diff
+**Round H (`be9e41107`, evidence-complete).** **Docs** (55 artifacts excluded and named in the
```
```diff
+H-C2 is **real and taken**: the artifact exclusion dropped *any* file under `units/evidence/`, so a
```
```diff
+| `followup-3481-round8-gate7-docs.md` + `-docs-rebuttal.md` + `-docs-adjudication.md` (+ logs) | #3481 round H (`be9e41107`) | docs with 55 artifacts excluded (named in receipts), **62,856/62,856**; adjudication on the full diff 128,208/128,208 | BLOCK ×1 (docs-scope artifact: "no code in the diff") → adjudication answered a bare `REFUTED` with no id → **UNKNOWN**; not re-rolled (head changed) |
```

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

The prior report's own run receipts record the mechanism working on this head (preserved
artifacts excluded from the reviewed diff and named). Nothing new is cited against the two
adjudications that already refuted this finding.
