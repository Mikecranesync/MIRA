# #3481 round AA (docs group) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round26-gate7-docs.md` — head `24f1db7ff4928737d401b65c05ec73a30923b7a9`,
scope `docs/` (rounds R, T, U, V, W, Y settled), sha256 in the report's receipts (valid shape on
attempt 1). Every quoted line below is a `+` line of this PR's diff.

## F1 — "Documentation claim that the lane's stderr logs are not evidence artifacts is false" (high)

The finding quotes the documentation as saying `the lane's stderr logs are not evidence artifacts`.
**No document in this PR — no unit record, index, doctrine, command or rebuttal — contains that
sentence**; it appears only in the finding itself. What the documentation says is the opposite,
and the finding's own description of the lane's behaviour ("excluded from the reviewed diff,
listed in receipts, identified as raw reviewer output and lane logs") is exactly what the
doctrine states:

```diff
+> *Evidence artifacts are not claims.* By default the lane excludes from the reviewed diff
+> the preserved **raw reviewer/adjudicator outputs and lane logs** under
```

The implementation's contract says the same, and the lock asserts a stderr log **is** an
artifact:

```diff
+    """A preserved review artifact: a file under units/evidence/ that is raw
```
```diff
+    assert is_evidence_artifact(e + "followup-3481-round5-docs-adjudication.stderr.log")
```

A claim that is not in the diff cannot be a documentation defect of the diff; the documentation
and the lane agree that stderr logs are evidence artifacts.
