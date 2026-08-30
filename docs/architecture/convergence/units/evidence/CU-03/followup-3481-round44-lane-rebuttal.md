# #3481 round 44 (S4: `tools/` + `.github/`) — author rebuttal, strengthened for attempt 3 (verbatim quoted evidence)

Prior report: `followup-3481-round44-gate7-lane.md` — head `18cde8db6e6437ac6f21938a66adc8581e32d135`
(valid on attempt 1). Adjudication attempts 1 and 2 returned bare rulings without a
`## RULINGS` section (UNKNOWN, preserved); attempt 2's prose claimed "the rebuttal's quoted
test code does not appear verbatim in the diff" — every line below is a `+` line of this
PR's diff under `tests/test_gate7_review.py` and `tools/gate7_review.py`, and the adjudication
scope (`tools/`, `.github/`, `tests/`) contains all of them. Rule on the quoted lines.

## F1 — "`.log` in `_DOC_SUFFIXES` excludes log files from secret scanning" (high)

`_DOC_SUFFIXES` is consumed by exactly two things in the lane: the PR-kind *brief* and the
artifact *suffix rule*. No scanning step is keyed on it. The lane redacts the entire diff
before any provider call, and the lock proves the ordering and the absence of any `kind`
condition — verbatim from the diff:

```diff
+def test_redaction_is_unconditional_and_covers_log_content_whatever_the_kind():
```
```diff
+    redact_at = src.index("title, body, diff = redact(title), redact(body), redact(diff)")
+    kind_at = src.index("kind = pr_kind(")
```
```diff
+    assert redact_at < cascade_at, "redaction must precede every provider call"
+    assert "if kind" not in src[:redact_at] and "if kind" not in src[redact_at:cascade_at]
+    assert kind_at > redact_at, "kind is classified after redaction; it cannot gate it"
```

The suffix's only other consumer is the artifact rule, which is narrower than a suffix
match and never hides anything executable:

```diff
+    if not name.endswith(_DOC_SUFFIXES):
+        return False
+    return name != "readme.md" and "rebuttal" not in name
```

Repository secret scanning is `gitleaks` in `.githooks/pre-commit` and `code-review.yml`;
neither reads `_DOC_SUFFIXES`, and `.log` files under `units/evidence/` are committed
repository files that gitleaks scans on every commit regardless of the lane. There is no
pipeline in which this tuple decides what is scanned.

## F2 — "case-insensitive `_path_in_scope` can expose tenant data" (high)

`--paths` scopes one repository's diff for the operator running the lane; there is no tenant
in it. The comparison is deliberately case-insensitive so a differently-cased path can
neither escape nor be excluded by case, and every excluded path is named to the reviewer:

```diff
+    so a differently-cased spelling can neither escape nor be excluded by case.
```
```diff
+        f"\n⚠️ SCOPE NOTICE — you are reading a --paths SLICE of this PR, not the PR.\n"
```
```diff
+def test_scope_prefixes_match_case_insensitively():
```
