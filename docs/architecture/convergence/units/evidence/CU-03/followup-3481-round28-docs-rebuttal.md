# #3481 round AD (S1: docs + `.claude/` + `PLAN.md` + `HANDOFF.md`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round28-gate7-docs.md` — head `f7820fc60ffa05d129a56d8388651f9f9f662365`,
**282,493/282,493** chars (attempt 2; attempt 1 malformed, preserved), 13 files excluded by scope
(the code the finding discusses is among them — covered by S4/S5). Every quoted line below is a
`+` line of this PR's diff (the adjudication scope includes `tools/` and `tests/` so each is
visible).

## F1 — "Evidence-artifact exclusion is case-sensitive; a differently-cased path bypasses it and leaks raw output to the provider" (high)

**(a) The diff's paths are git's, and git paths are exact.** The lane reviews the unified diff
of the PR (`diff --git a/X b/X` headers); a file committed at
`Docs/Architecture/Convergence/Units/Evidence/…` is a **different path** from the evidence
directory, whatever the checkout filesystem's case rules — and it is a file the PR added
**outside** the evidence directory. The exclusion is keyed on exactly the one directory that
holds preserved artifacts:

```diff
+_EVIDENCE_DIR = "docs/architecture/convergence/units/evidence/"
```
```diff
+    if not path.startswith(_EVIDENCE_DIR):
+        return False
```

Matching other paths as artifacts would **hide** them from review — the failure the contract
names:

```diff
+    # in the reviewed diff — the directory must never become a place to hide
```

**(b) "Bypassing the exclusion" keeps the file IN the reviewed diff.** It is reviewed with
everything else; the exclusion exists so preserved prior-model output is not misread as the
PR's present-tense claims, not to keep content away from the reviewer.

**(c) "Leaks sensitive content to the provider" — the exclusion is not a secret boundary**, by
contract; redaction is applied unconditionally to the whole diff before any provider call, and
that is locked:

```diff
+- **This is not a secret boundary.** Redaction (IP / MAC / serial / credential) is applied
+  unconditionally to the whole diff before any provider call — scope, kind and exclusion
```
```diff
+def test_redaction_is_unconditional_and_covers_log_content_whatever_the_kind():
```

The finding describes correct behaviour (a non-artifact path stays in review) and attributes to
the exclusion a protection the doctrine explicitly says it does not provide. The same claim was
raised in round 27 (scope D, attempt 4) and answered identically.
