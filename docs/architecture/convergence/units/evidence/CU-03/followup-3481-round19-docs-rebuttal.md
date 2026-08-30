# #3481 round S (docs group) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round19-gate7-docs.md` — head `c0ca9315ba1011123f64ba0177f23e27a449b1c9`,
scope `docs/` (artifacts excluded; scope notice present), **136,007/136,007** chars, sha256
`6fca6398237f9b4e0da240fcd34fd9c002c88ca1a127c8591262116d75fdc83d`. This adjudication runs on the
PR's full diff, where the implementation is visible.

## F1 — "documentation claims an incorrect path for evidence-artifact exclusion" (high)

The implementation's constant is exactly the path the documentation names — a `+` line of this PR
in `tools/gate7_review.py`:

```diff
+_EVIDENCE_DIR = "docs/architecture/convergence/units/evidence/"
```

and the predicate keys on it:

```diff
+    if not path.startswith(_EVIDENCE_DIR):
+        return False
```

The record's `units/evidence/` is the same directory written as the doctrine's own shorthand
(every `units/CU-*.md` record sits beside `units/evidence/`); there is no repository-root
`units/evidence/` and the code never looks for one. The lock exercises the full path:

```diff
+    e = "docs/architecture/convergence/units/evidence/CU-03/"
+    assert is_evidence_artifact(e + "round-12-groupA-final-head.md")
```
