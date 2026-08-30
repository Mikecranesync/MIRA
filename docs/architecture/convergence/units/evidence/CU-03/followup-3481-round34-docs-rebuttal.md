# #3481 round 34 (S1: `docs/` + `.claude/` + `PLAN.md` + `HANDOFF.md`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round34-gate7-docs.md` — head `c70782371ca87d743323d8c744f1746e20df0347`
(valid on attempt 1). The single finding is about `tools/gate7_review.py`, outside the S1
scope; the adjudication scope adds `tools/` and `tests/` so every quoted `+` line is visible.

## F1 — "`is_evidence_artifact` is case-sensitive; on a case-insensitive filesystem a renamed artifact bypasses exclusion and is sent unredacted" (high)

A `diff --git` header carries the path **in the git tree**, byte-exact — no filesystem takes
part in the comparison. `Docs/architecture/…/secret.log` is a different tree path from
`docs/architecture/…`, so it is **not** an evidence artifact and is **kept in review**. That is
the correct outcome: the exclusion exists so the reviewer does not judge an *earlier model's*
words as the author's; it was never a secrecy boundary, and a file the PR places at a new path
is a claim the PR makes. "Without redaction" is false — redaction covers the whole diff before
any provider call and is not conditioned on anything (locked):

```diff
+    redact_at = src.index("title, body, diff = redact(title), redact(body), redact(diff)")
+    kind_at = src.index("kind = pr_kind(")
```
```diff
+    assert redact_at < cascade_at, "redaction must precede every provider call"
```

The artifact rule is also narrower than a bare prefix — it requires a doc/log suffix:

```diff
+    if not path.startswith(_EVIDENCE_DIR):
```
```diff
+    name = path.rsplit("/", 1)[-1].lower()
```
```diff
+    if not name.endswith(_DOC_SUFFIXES):
```

This is the round-29–33 re-raise; nothing in the docs scope changed it.
