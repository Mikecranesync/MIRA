# #3481 round 32 (S5: `tests/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round32-gate7-lane-tests.md` — head `9e7230330704c9fa600a56cedc5da41b7ee2985e`
(valid on attempt 1). Every quoted line is a `+` line of this PR's diff; the adjudication scope
adds `tools/` so the implementation the test locks is visible.

## F1 — "A `copy from` / `copy to` diff header copies an evidence artifact outside the directory and it is sent unredacted" (high)

Three independent reasons, each sufficient.

1. **No such header reaches the lane.** `git diff` emits `copy from`/`copy to` only when copy
   detection is requested (`-C` / `--find-copies`); neither `gh pr diff` nor the lane's fallback
   `git diff --no-color base...head` asks for it, so a copied file appears as an ordinary added
   file with its full content.
2. **The exclusion keys on the target path, whatever the header says.** `b/secret.log` at the
   repository root is not under `units/evidence/` and is therefore **not** an artifact — it is
   kept in review:

```diff
+            keep = not (is_evidence_artifact(target) or moved_artifact)
```
```diff
+                dropped.append(target)
```

   That is the correct outcome: a file the PR places outside the evidence directory is a claim
   the PR makes and must be reviewed. The exclusion exists so the reviewer does not judge an
   earlier model's words as the author's — it was never a secrecy boundary.
3. **"Sent unredacted" is false.** Redaction runs on the whole diff before any provider call and
   is not conditioned on anything:

```diff
+def test_redaction_is_unconditional_and_covers_log_content_whatever_the_kind():
```
```diff
+    assert redact_at < cascade_at, "redaction must precede every provider call"
```
