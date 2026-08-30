# #3481 round 35 (S4: `tools/` + `.github/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round35-gate7-lane.md` — head `bd674af3e271eb7e814e1c36750034c22bb956f8`
(valid on attempt 1). Every quoted line is a `+` line of this PR's diff; the adjudication scope
adds `tests/` so the lane locks are visible.

## F1 — "rename-to-code keeps the whole diff, including removal lines with the artifact's content — a leak" (high)

The behaviour is the one the quoted comment decides, on purpose: an artifact that *becomes
code* is a claim the PR makes and **must** be reviewed — including whatever it removed or
kept from the earlier model's text, because that text is now the author's code. A pure
rename carries no hunk; a rename with edits carries exactly the edits:

```diff
+            # excluded and is receipted under the new path; one that becomes
+            # code (`x.log` -> `x.py`) stays in review. A pure rename carries no
+            # content hunk, so nothing reviewable is lost either way.
+            moved_artifact = is_evidence_artifact(source) and target.lower().endswith(_DOC_SUFFIXES)
+            keep = not (is_evidence_artifact(target) or moved_artifact)
```

"Leaks raw reviewer output / secrets": the artifacts are committed repository files, not
secrets; and every byte of the reviewed diff is redacted before any provider call, without
condition — locked:

```diff
+    assert redact_at < cascade_at, "redaction must precede every provider call"
```

The exclusion exists so the reviewer does not judge an earlier model's words as the author's;
it was never a secrecy boundary, and hiding a rename-to-code would be the actual defect.

## F2 — case-sensitive `startswith(_EVIDENCE_DIR)` "on case-insensitive filesystems" (high)

Re-raised from rounds 29–34; adjudicated **REFUTED** on the previous head
(`followup-3481-round34-docs-adjudication.md`: "diff paths are case-sensitive regardless of
the underlying filesystem"). A `diff --git` header carries the path in the git tree,
byte-exact; a differently-cased path is a different, non-artifact file that is reviewed and
redacted — the correct outcome. The rule also requires a doc/log suffix:

```diff
+    if not path.startswith(_EVIDENCE_DIR):
```
```diff
+    if not name.endswith(_DOC_SUFFIXES):
```
