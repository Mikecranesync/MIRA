# #3481 round 42 (S5: `tests/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round42-gate7-lane-tests.md` — head `03cd8357d202f5640d40b7ed2115ac169235c2fb`
(valid on attempt 1). The adjudication scope adds `tools/` so the implementation is visible.

## F1 — "`is_evidence_artifact` checks suffixes case-sensitively, so `SECRET.LOG` under `units/evidence/` stays in the diff" (high)

The quoted body (`_EVIDENCE_PREFIX`, `path.endswith(".md") or …`) is not the code. The real
function lower-cases the file name **before** the suffix test:

```diff
+    name = path.rsplit("/", 1)[-1].lower()
```
```diff
+    if not name.endswith(_DOC_SUFFIXES):
+        return False
+    return name != "readme.md" and "rebuttal" not in name
```

Executed on this head: `is_evidence_artifact(".../evidence/CU-03/SECRET.LOG")` → `True`,
`…/NOTE.MD` → `True`. And even a kept file is never "leaked": every byte of the reviewed diff
is redacted before any provider call (`test_redaction_is_unconditional_and_covers_log_content_whatever_the_kind`).
