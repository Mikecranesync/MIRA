# #3481 round 33 (S5: `tests/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round33-gate7-lane-tests.md` — head `01699b6690544ce0b955bddf118d942897d6dcb3`
(valid on attempt 1). Every quoted line is a `+` line of this PR's diff; the adjudication scope
adds `tools/` and `.claude/` so the implementation and its contract are visible.

## F1 — "a differently-cased evidence path is retained and sent to the LLM without redaction" (high)

Two independent errors. (a) `Docs/architecture/…/secret.txt` is a different git path from
`docs/architecture/…`; it is **not** an evidence artifact, and keeping it in review is the
correct outcome — the exclusion exists so the reviewer does not judge an *earlier model's* words
as the author's, never to keep content from the reviewer:

```diff
+            keep = not (is_evidence_artifact(target) or moved_artifact)
```

(b) "without redaction" is false — redaction covers the whole diff before any provider call and
is not conditioned on anything (locked):

```diff
+def test_redaction_is_unconditional_and_covers_log_content_whatever_the_kind():
```
```diff
+    assert redact_at < cascade_at, "redaction must precede every provider call"
```

## F2 — "`## Verdict` in another case ⇒ UNKNOWN, which the driver treats as a successful review" (high)

The premise is false: UNKNOWN is **never** a success. It is not PASS, not BLOCK, is recorded as a
malformed attempt, and leaves the lane without a verdict — the contract, the code and the lock:

```diff
+  missing/duplicated sections ⇒ **UNKNOWN** — never PASS, never BLOCK. A review that states
```
```diff
+# anything else is UNKNOWN — never PASS, never BLOCK — and is preserved as a
```
```diff
+    """The verdict of FRESH reviewer output: UNKNOWN unless the shape validates
```
```diff
+        attempts.append(f"shape: {shape_error} — UNKNOWN (malformed attempt)")
```
```diff
+def test_fresh_review_without_the_exact_decision_sections_is_unknown_never_pass_or_block():
```

A model that mis-cases a heading produces no verdict at all — exactly the fail-closed outcome
this PR introduced (rounds 10–11, 29 attempt logs on file). Nothing is hidden: the malformed
attempt is preserved and the round is re-run until a valid shape exists.
