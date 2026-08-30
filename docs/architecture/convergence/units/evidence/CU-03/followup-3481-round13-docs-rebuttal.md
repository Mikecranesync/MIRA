# #3481 round M (docs group) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round13-gate7-docs.md` — head `aa84db7d4c8b7a7c29bafe39a42d81489c06555a`,
scope `docs/` (artifacts excluded; scope notice present), **94,701/94,701** chars, sha256
`50abc912c1859badd01d946d7baa43641d48fb6984ef55ab22b9e502dbcbc485`, briefed as *documentation*.

## F1 — "the only file modified by this PR is `CU-03.md`; no change to `origins.py` is present" (high)

The reviewer saw the `docs/` **slice**; the brief's SCOPE NOTICE listed `mira-crawler/ingest/origins.py`
among the changed files *outside* that slice — it does not say "only documentation files changed",
it says the opposite. This adjudication runs on the full diff, where the change is a `+` line of
this PR:

```diff
+++ b/mira-crawler/ingest/origins.py
```
```diff
+        and n.value.lower().startswith(("http://", "https://"))
```

The identical claim was adjudicated **REFUTED** on three previous heads (rounds I, K and L) on the
same evidence; the file has not changed since.
