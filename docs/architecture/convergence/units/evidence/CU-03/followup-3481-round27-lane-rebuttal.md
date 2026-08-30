# #3481 round AC (scope D: `tools/` + `tests/` + `.github/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round27-gate7-lane.md` — head `156b8484452a7fc717dd9e2cf2128412848b9234`,
**81,848/81,848** chars (attempt 4; attempts 1 and 3 malformed, attempt 2 a whole-cascade
failure — all preserved). Every quoted line below is a `+` line of this PR's diff.

## F1 — "Evidence-artifact detection is case-sensitive, so a differently-cased path bypasses the exclusion and exposes raw output / secrets" (high)

Three parts, each answered by the diff.

**(a) `Docs/Architecture/…` is not the evidence directory.** Git paths are case-sensitive; the
preserved artifacts live under exactly one path, and the exclusion is keyed on that path:

```diff
+_EVIDENCE_DIR = "docs/architecture/convergence/units/evidence/"
```
```diff
+    if not path.startswith(_EVIDENCE_DIR):
+        return False
```

A file under a differently-cased directory is a different file that the PR **added outside** the
evidence directory. Matching it as an artifact would *hide* it from review — the exact
"directory becomes a place to hide content from the gate" failure the exclusion is scoped
against:

```diff
+    # in the reviewed diff — the directory must never become a place to hide
```

**(b) "Bypassing the exclusion" leaves the file IN the reviewed diff** — it is reviewed with
everything else. The exclusion exists so that preserved prior-model output is not misread as the
PR's present-tense claims; failing to exclude an unusual file means more scrutiny, not less.

**(c) "Secrets may be exposed" — the exclusion is not a secret boundary**, by contract, and
redaction is unconditional on the whole diff before any provider call, locked:

```diff
+- **This is not a secret boundary.** Redaction (IP / MAC / serial / credential) is applied
+  unconditionally to the whole diff before any provider call — scope, kind and exclusion
```
```diff
+def test_redaction_is_unconditional_and_covers_log_content_whatever_the_kind():
```

The finding therefore describes correct behaviour (a non-artifact path stays in review) and
attributes to the exclusion a protection the doctrine explicitly says it does not provide.
