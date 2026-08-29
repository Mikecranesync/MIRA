# #3481 round T (docs group) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round20-gate7-docs.md` — head `4abb63d000f7760d506319a7edcbcee59ecf0e32`,
scope `docs/` (artifacts excluded; scope notice present), **139,659/139,659** chars, sha256
`dc7c030e79183758078202bf8ff2d0c492c98c38cbcd078767870661384c1b0a`. This adjudication runs on the
PR's full diff; every quoted line below is a `+` line of it.

## F1 and F2 — "documentation claims the only file changed in this PR is `CU-03.md`" (high, high)

The sentence is a **quotation of an earlier reviewer's finding**, inside an author rebuttal that
exists to refute it. The rebuttal's own heading marks it as the finding being answered, and the
next line answers it:

```diff
+## F1 — "the only file modified by this PR is `CU-03.md`; no change to `origins.py` is present" (high)
```
```diff
+The reviewer saw the `docs/` **slice**; the brief's SCOPE NOTICE listed `mira-crawler/ingest/origins.py`
```

and, in the round-I rebuttal the finding names:

```diff
+All four findings rest on one premise — "the only file changed in this PR is
```

A document that quotes a false claim in order to disprove it does not make that claim. The
`origins.py` change the finding says is missing is the very evidence those rebuttals quote.

## F3 — "'stands unfixed' contradicts Round H's fix" (high)

Two different defects. The sentence names its subject in the same breath — *adjudicator verdict
instability* (contradictory adjudications on identical inputs), still open:

```diff
+> (next section). **The lane defect recorded above stands unfixed.** Adjudicator verdict instability
```

Round H fixed a different defect — the artifact-exclusion *suffix rule*:

```diff
+script planted there would have escaped review — now only documentation/log suffixes count as
```

One open defect and one fixed defect, each named where it is discussed, is not a contradiction; the
`-`/`+` pair the finding shows as evidence does not exist in the diff.
