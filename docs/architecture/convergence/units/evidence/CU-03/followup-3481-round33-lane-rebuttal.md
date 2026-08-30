# #3481 round 33 (S4: `tools/` + `.github/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round33-gate7-lane.md` — head `01699b6690544ce0b955bddf118d942897d6dcb3`
(valid on attempt 1). Every quoted line is a `+` line of this PR's diff; the adjudication scope
adds `tests/` so the lane locks are visible. Both findings are re-raises (rounds 29–32) with no
new evidence.

## F1 — "case-sensitive `startswith(_EVIDENCE_DIR)` is evadable on case-insensitive filesystems" (high)

A `diff --git` header carries the path **in the git tree**, byte-exact — there is no filesystem
in the comparison. `Docs/architecture/…` is a different tree path from `docs/architecture/…`,
so it is **not** an evidence artifact and is **kept in review** — reviewed and redacted like
every other byte. That is the correct outcome: the exclusion exists so the reviewer does not
judge an earlier model's words as the author's; it was never a secrecy boundary. Redaction is
unconditional and precedes classification (locked):

```diff
+    redact_at = src.index("title, body, diff = redact(title), redact(body), redact(diff)")
+    kind_at = src.index("kind = pr_kind(")
```
```diff
+    assert redact_at < cascade_at, "redaction must precede every provider call"
```

The artifact rule is also narrower than "a prefix": it additionally requires a doc/log suffix:

```diff
+    if not path.startswith(_EVIDENCE_DIR):
```
```diff
+    name = path.rsplit("/", 1)[-1].lower()
```
```diff
+    if not name.endswith(_DOC_SUFFIXES):
```

## F2 — "`.log` in `_DOC_SUFFIXES` excludes logs from secret scanning" (high)

`_DOC_SUFFIXES` feeds only the PR-kind *brief*; no scanning step is keyed on it, and the lane's
redaction is not conditioned on kind — locked:

```diff
+def test_redaction_is_unconditional_and_covers_log_content_whatever_the_kind():
```
```diff
+    assert "if kind" not in src[:redact_at] and "if kind" not in src[redact_at:cascade_at]
+    assert kind_at > redact_at, "kind is classified after redaction; it cannot gate it"
```

Repository secret scanning (`gitleaks` in `.githooks/pre-commit`, `code-review.yml`) never reads
`_DOC_SUFFIXES`.
