# #3481 round H (docs group, evidence artifacts excluded) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round8-gate7-docs.md` — head `be9e41107e04b638148b76d1072c68249764eb81`,
scope `docs/` with the 55 preserved evidence artifacts excluded and named in the receipts,
**62,856/62,856** chars (sent-bytes sha256 = full-scoped sha256 =
`5d619c75bffe620059a9759f8fed055c221261cec082157c027f1c03f015ec6c`), briefed as *documentation*.

## F1 — "False claim that a code fix is included in this PR" (the diff "only touches documentation files")

The reviewer saw the `docs/` **scope** of the PR, not the PR. The record's sentence it quotes is
true of the PR's full diff, on which this adjudication runs: `mira-crawler/ingest/origins.py` is a
modified file of this PR and the lower-casing fix is a `+` line in it —

```diff
+++ b/mira-crawler/ingest/origins.py
```
```diff
+        and n.value.lower().startswith(("http://", "https://"))
```

— with its red-first test in the new test file this PR adds:

```diff
+++ b/mira-crawler/tests/test_conflict_and_packaging_contracts.py
```

A file list that contains only `docs/...` entries is the signature of a scoped run
(`--paths docs/`), which the run receipts record; it is not evidence about the PR's contents.
