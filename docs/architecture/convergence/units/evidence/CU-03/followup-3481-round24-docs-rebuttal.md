# #3481 round Y (docs group) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round24-gate7-docs.md` — head `60c61870dc24891f82ac6146d703353bb7980960`,
scope `docs/` (rounds R, T, U, V, W settled), sha256 in the report's receipts (valid shape on
attempt 1). Every quoted line below is a `+` line of this PR's diff.

## F1 — "Evidence-artifact exclusion incorrectly drops executable/structured files" (high)

The finding quotes an `is_evidence_artifact` body containing a loop over
`("run.sh", "helper.py", "policy.yaml", "payload.json", "x.ts", "Dockerfile")` that returns
`True`. **No such code exists in the diff.** The function in this PR returns `False` for every
name that does not carry a documentation/log suffix, and only then distinguishes the README and
rebuttals:

```diff
+def is_evidence_artifact(path: str) -> bool:
```
```diff
+    if not path.startswith(_EVIDENCE_DIR):
+        return False
+    name = path.rsplit("/", 1)[-1].lower()
```
```diff
+    if not name.endswith(_DOC_SUFFIXES):
+        return False
+    return name != "readme.md" and "rebuttal" not in name
```

The tuple the finding attributes to the implementation is lifted from the **lock test**, which
asserts the opposite of what the finding claims — every one of those names is NOT an artifact and
stays in the reviewed diff:

```diff
+    for smuggled in ("run.sh", "helper.py", "policy.yaml", "payload.json", "x.ts", "Dockerfile"):
+        assert not is_evidence_artifact(e + smuggled), smuggled
```

The documented boundary ("executable or structured files never hide there") is therefore what the
code does and what the test proves; the quoted "implementation" is fabricated. (The docs slice
could not see `tools/` — its own receipts list the excluded files — but the adjudicated full diff
can.)
