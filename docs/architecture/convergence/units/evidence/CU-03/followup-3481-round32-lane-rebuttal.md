# #3481 round 32 (S4: `tools/` + `.github/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round32-gate7-lane.md` — head `9e7230330704c9fa600a56cedc5da41b7ee2985e`
(valid on attempt 1). Every quoted line is a `+` line of this PR's diff; the adjudication scope
adds `tests/` so the lane locks are visible.

## F1 — "Case-sensitive `startswith(_EVIDENCE_DIR)` can be bypassed on case-insensitive filesystems" (high)

The path in a `diff --git` header is the path **in the git tree**, not on a filesystem; git
stores paths byte-exact, so `Docs/Architecture/…` is a *different* path from
`docs/architecture/…` and is **not** an evidence artifact. A non-artifact is kept in the
reviewed diff — reviewed, and redacted like every other byte — which is the correct outcome, not
a bypass: the exclusion exists so the reviewer does not judge an *earlier model's* words as the
author's, never to hide content. Redaction is unconditional and precedes classification:

```diff
+    redact_at = src.index("title, body, diff = redact(title), redact(body), redact(diff)")
+    kind_at = src.index("kind = pr_kind(")
```
```diff
+    assert redact_at < cascade_at, "redaction must precede every provider call"
```

The artifact rule is also narrower than the finding's "plain prefix":

```diff
+    if not path.startswith(_EVIDENCE_DIR):
```
```diff
+    name = path.rsplit("/", 1)[-1].lower()
```
```diff
+    if not name.endswith(_DOC_SUFFIXES):
```

## F2 — "`.log` in `_DOC_SUFFIXES` bypasses secret-scanning" (high)

Round-29 S4 F1 re-raised. `_DOC_SUFFIXES` feeds the PR-kind *brief* only; no scanning step is
keyed on it. The lane's redaction runs on the whole diff before any provider call and is not
conditioned on kind — locked:

```diff
+def test_redaction_is_unconditional_and_covers_log_content_whatever_the_kind():
```
```diff
+    assert "if kind" not in src[:redact_at] and "if kind" not in src[redact_at:cascade_at]
+    assert kind_at > redact_at, "kind is classified after redaction; it cannot gate it"
```

Repository secret scanning (`gitleaks` in `.githooks/pre-commit`, `code-review.yml`) is a
separate system that never reads `_DOC_SUFFIXES`.

## F3 — "A rename of an artifact to a code path is kept, but the header has no content, hiding the code" (high)

The code path that "becomes code" is kept **in review** by design, and a pure rename carries no
content hunk by definition — there is nothing to hide; if the content changed, the hunks are in
the diff and are reviewed:

```diff
+            # excluded and is receipted under the new path; one that becomes
+            # code (`x.log` -> `x.py`) stays in review. A pure rename carries no
+            # content hunk, so nothing reviewable is lost either way.
+            moved_artifact = is_evidence_artifact(source) and target.lower().endswith(_DOC_SUFFIXES)
+            keep = not (is_evidence_artifact(target) or moved_artifact)
```

The finding restates the behaviour the quoted comment already decides, and draws the opposite
conclusion from it.
