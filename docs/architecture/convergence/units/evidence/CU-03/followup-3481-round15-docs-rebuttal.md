# #3481 round O (docs group) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round15-gate7-docs.md` — head `e860c4a60b07a2d7b84a300aa762d7d7c06e9e2d`,
scope `docs/` (artifacts excluded; scope notice present; strict-shape lane), **110,004/110,004**
chars, sha256 `78c115b4f4b913629377eba78094c4429d7c50514a664627a188af117a5ae4a5`. This adjudication
runs on the full diff; every line below is a `+` line of it.

## F1 — "Contradictory documentation about lane-defect status" (high)

Two **different** lane defects. The sentence the finding quotes names its subject in the same
breath — *adjudicator verdict instability* (contradictory adjudications on identical inputs, still
open):

```diff
+> (next section). **The lane defect recorded above stands unfixed.** Adjudicator verdict instability
```

The round-H sentence is about a different defect — the artifact-exclusion *suffix rule* — and it
is the one that was fixed:

```diff
+script planted there would have escaped review — now only documentation/log suffixes count as
```

One open defect and one fixed defect, each named where it is discussed, is not a contradiction.

## F2 — "Unverified claim that every excluded path is named in the run receipts" (medium)

The tooling that emits the line, and the lock that asserts it, are both `+` lines of this PR
(`tools/gate7_review.py`, `tests/test_gate7_review.py`), outside the `docs/` slice the reviewer saw:

```diff
+            "- evidence artifacts excluded from review (raw reviewer output / logs under "
```
```diff
+def test_preserved_evidence_artifacts_are_dropped_from_the_reviewed_diff_and_receipted():
```
```diff
+    assert "evidence artifacts excluded" in out
```

## F3 — "Unverified claim that every commit passes the secrets scan" (medium)

The scan is the repository's pre-commit hook (`.githooks/pre-commit`, on `main` — `gitleaks
protect --staged`), which every commit on this branch ran; the record says so in the same words,
as a `+` line of this PR:

```diff
+`gitleaks protect --staged` scan ("no leaks found"), including the ones that added the logs.
```

*Outside the diff, for the human reader:* each commit's pre-commit transcript in this session shows
`gitleaks … no leaks found`; the hook is tracked in the repository, not in this PR.
