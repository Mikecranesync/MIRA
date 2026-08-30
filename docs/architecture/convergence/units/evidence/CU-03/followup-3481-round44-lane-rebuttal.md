# #3481 round 44 (S4: `tools/` + `.github/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round44-gate7-lane.md` — head `18cde8db6e6437ac6f21938a66adc8581e32d135`
(valid on attempt 1). Every quoted line is a `+` line of this PR's diff; the adjudication
scope adds `tests/` so the lane locks are visible. Both findings are re-raises with no new
evidence (`.log`: every round since 29; the scope case rule: rounds 37–43).

## F1 — "`.log` in `_DOC_SUFFIXES` excludes log files from the secret-scan pipeline" (high)

`_DOC_SUFFIXES` feeds the PR-kind *brief* and the artifact suffix rule; **no scanning step
is keyed on it**. The lane redacts the whole diff before any provider call, unconditionally —
locked:

```diff
+def test_redaction_is_unconditional_and_covers_log_content_whatever_the_kind():
```
```diff
+    assert "if kind" not in src[:redact_at] and "if kind" not in src[redact_at:cascade_at]
+    assert kind_at > redact_at, "kind is classified after redaction; it cannot gate it"
```

Repository secret scanning (`gitleaks` in `.githooks/pre-commit`, `code-review.yml`) never
reads `_DOC_SUFFIXES`.

## F2 — "case-insensitive `_path_in_scope` can include or exclude files that differ only by case, exposing tenant data" (high)

`--paths` scopes **one repository's diff** for the operator running the lane; there is no
tenant in it and nothing outside the diff can be reached. The comparison is deliberately
case-insensitive so a differently-cased spelling can neither escape nor be excluded by case,
and every excluded path is named to the reviewer and in the receipts:

```diff
+    so a differently-cased spelling can neither escape nor be excluded by case.
```
```diff
+        f"\n⚠️ SCOPE NOTICE — you are reading a --paths SLICE of this PR, not the PR.\n"
```

Locked (`test_scope_prefixes_match_case_insensitively`: `Docs/a.md` and `docs/b.md` are both
kept by `docs/`; `docs_extra/` never is).
