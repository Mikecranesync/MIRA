# #3481 round 42 (S4: `tools/` + `.github/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round42-gate7-lane.md` — head `03cd8357d202f5640d40b7ed2115ac169235c2fb`
(valid on attempt 1). Every quoted line is a `+` line of this PR's diff; the adjudication
scope adds `tests/` so the lane locks are visible.

## F1 — "`.log` in `_DOC_SUFFIXES` bypasses secret scanning" (high)

Re-raised in every round since 29 (16 times) with no new evidence. `_DOC_SUFFIXES` feeds the
PR-kind *brief* and the artifact suffix rule only; no scanning step is keyed on it. The lane
redacts the whole diff before any provider call, unconditionally — locked:

```diff
+def test_redaction_is_unconditional_and_covers_log_content_whatever_the_kind():
```
```diff
+    assert "if kind" not in src[:redact_at] and "if kind" not in src[redact_at:cascade_at]
+    assert kind_at > redact_at, "kind is classified after redaction; it cannot gate it"
```

Repository secret scanning (`gitleaks` in `.githooks/pre-commit` and `code-review.yml`) never
reads `_DOC_SUFFIXES`.

## F2 — "a new `malicious.log` under `units/evidence/` is silently omitted from review — a place to hide code" (high)

A `.log`/`.md` under the evidence directory is consumed by nothing — no interpreter, build,
workflow or import reads it — so there is no code to hide *in* one; every executable or
structured suffix is kept in review precisely so the directory cannot become that place,
and the rule says so:

```diff
+    # Only documentation/log files are artifacts. Anything executable or
+    # structured under units/evidence/ (a script, a policy, a Dockerfile) stays
+    # in the reviewed diff — the directory must never become a place to hide
+    # code from the gate (#3481 round H).
+    if not name.endswith(_DOC_SUFFIXES):
+        return False
```

Every excluded artifact is **named in the receipts** (never silent), and repository secret
scanning covers it regardless of the lane. The round-AR correction went the other way for
the one real gap: an artifact moved OUT of the directory is now kept in review.

The NOT-REVIEWED note about a `diff_paths_excluded` case mismatch describes code this head
no longer has — both functions call the one `_path_in_scope` helper:

```diff
+            if not _path_in_scope(target, prefixes):
```
