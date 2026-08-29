# #3481 round R (docs group) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round18-gate7-docs.md` — head `6e20c2b134954358680cdb978e0c25e54e7fef20`,
scope `docs/` (artifacts excluded; scope notice present), **128,152/128,152** chars, sha256
`bc74e6b41fb7f64ccd446735f5555d063bd0820d87ccc225a7254a637cbda090`. This adjudication runs on the
PR's full diff; every quoted line below is a `+` line of it unless marked as context.

## F1 — "exclusion is not in effect: rounds G and H show artifacts treated as claims" (high)

Rounds G and H are the rounds that **motivated** the exclusion; it landed at the round-H head and
the record says so in the sentence the finding is reading past:

```diff
+script planted there would have escaped review — now only documentation/log suffixes count as
```

The mechanism and its lock are `+` lines of this PR (`tools/gate7_review.py`, `tests/`):

```diff
+def drop_evidence_artifacts(diff: str) -> tuple[str, list[str]]:
```
```diff
+def test_preserved_evidence_artifacts_are_dropped_from_the_reviewed_diff_and_receipted():
```

Every review since round H carries a receipts line naming the excluded artifacts (the round-R
report itself: 91 excluded).

## F2 — "redaction is conditional on `pr_kind`" (high)

The opposite is locked: `main()` redacts title, body and the whole diff **before** any provider
call, with no kind conditional, and kind is classified *after* redaction:

```diff
+def test_redaction_is_unconditional_and_covers_log_content_whatever_the_kind():
```
```diff
+    assert redact_at < cascade_at, "redaction must precede every provider call"
```
```diff
+    assert kind_at > redact_at, "kind is classified after redaction; it cannot gate it"
```

`pr_kind` chooses only the note in the brief; it never selects diff content.

## F3 — "no test named `test_preserved_evidence_artifacts_…` exists in the current tree" (medium)

It is a `+` line of this PR (quoted under F1), and its receipts assertion:

```diff
+    assert "evidence artifacts excluded" in out
```

## F4 — "the exclusion rule is suffix-based, so `.py`/`.sh`/`Dockerfile` would be excluded" (low)

Inverted: only documentation/log suffixes are *artifacts*; anything else under that directory
stays in review, and the lock names the finding's own examples:

```diff
+    if not name.endswith(_DOC_SUFFIXES):
```
```diff
+    for smuggled in ("run.sh", "helper.py", "policy.yaml", "payload.json", "x.ts", "Dockerfile"):
```

## F5 — "the repository does not contain `.githooks/pre-commit`" (low)

The hook is tracked on `main` and unchanged by this PR — which is why it is not in the diff; the
record quotes its gitleaks step:

```diff
+`gitleaks protect --staged` scan ("no leaks found"), including the ones that added the logs.
```

*Outside the diff, for the human reader:* `git ls-files .githooks/pre-commit` on `main` lists the
file, and `git config core.hooksPath` is `.githooks` in every checkout that ran these commits.
