# #3481 round 34 (S4: `tools/` + `.github/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round34-gate7-lane.md` — head `c70782371ca87d743323d8c744f1746e20df0347`
(valid on attempt 1). Every quoted line is a `+` line of this PR's diff; the adjudication scope
adds `tests/` so the lane locks are visible.

## F1 — case-sensitive `startswith(_EVIDENCE_DIR)` "on case-insensitive filesystems" (high)

Re-raised from rounds 29–33 with no new evidence. A `diff --git` header carries the path in
the **git tree**, byte-exact; no filesystem takes part. `Docs/…/malicious.py` is a different
tree path, is **not** an artifact, and is **kept in review** — reviewed and redacted — which is
the correct outcome (the exclusion protects the reviewer from judging an earlier model's words
as the author's; it hides nothing). The rule additionally requires a doc/log suffix, so a `.py`
under the real evidence path is never excluded either:

```diff
+    if not path.startswith(_EVIDENCE_DIR):
```
```diff
+    if not name.endswith(_DOC_SUFFIXES):
```
```diff
+    assert redact_at < cascade_at, "redaction must precede every provider call"
```

## F2 — `.log` in `_DOC_SUFFIXES` "bypasses secret scanning" (high)

Re-raised from rounds 29–33. `_DOC_SUFFIXES` feeds only the PR-kind *brief*; redaction is
unconditional and precedes classification — locked:

```diff
+def test_redaction_is_unconditional_and_covers_log_content_whatever_the_kind():
```
```diff
+    assert "if kind" not in src[:redact_at] and "if kind" not in src[redact_at:cascade_at]
+    assert kind_at > redact_at, "kind is classified after redaction; it cannot gate it"
```

## F3 — "case-sensitive `--paths` matching lets an attacker exclude files" (high)

`--paths` is the **operator's own command-line argument**, not attacker input; a slice is a
deliberate reviewing choice, and everything the slice excludes is stated to the reviewer and
receipted, by design of this PR:

```diff
+    """Tell a scoped (--paths) reviewer what it cannot see. Pure.
```
```diff
+        f"\n⚠️ SCOPE NOTICE — you are reading a --paths SLICE of this PR, not the PR.\n"
```
```diff
+    an exclusion the record cannot see is exactly the silent-scope failure
```

A mis-cased prefix excludes *everything* (nothing matches), which the receipt shows as the
full file list under "excluded by scope" — there is no silent omission.

## F4 — "`adjudication_verdict_strict` never checks that every prior finding has a ruling" (high)

It delegates to `adjudication_verdict`, whose contract **is** the bijection — an unruled or
mis-accounted finding cannot pass:

```diff
+    structural bijection verdict over the rulings read from `## RULINGS` only.
```
```diff
+# bijection contract and the no-severity-channel rule are unchanged.
```

Verified live on this head: `adjudication_verdict([("REFUTED","F1")], [F1, F2])` →
`UNKNOWN` (F2 left unruled ⇒ no verdict, never PASS). The finding read the strict wrapper and
stopped before the function it calls.
