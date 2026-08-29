# #3481 round K (docs group) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round11-gate7-docs.md` — head `502de5e155a9f35de86e848b18f6b6c70a5d29b5`,
scope `docs/` (artifacts excluded; SCOPE NOTICE listing every excluded file was in the brief),
**84,073/84,073** chars, sha256 `a66d570dced592fb2abd4a9cdce3e201c91e354415c9926561c94141f373a01f`.

## F1 — "the only files changed in this PR are documentation files; no modification to `mira-crawler/ingest/origins.py`" (high)

The reviewer saw the `docs/` slice and was told, in the brief, which changed files lie outside it —
`mira-crawler/ingest/origins.py` among them. This adjudication runs on the full diff, where the line
the record refers to is present exactly as the record says:

```diff
+++ b/mira-crawler/ingest/origins.py
```
```diff
+        and n.value.lower().startswith(("http://", "https://"))
```

The identical claim was adjudicated **REFUTED** on the previous head (round I, 4/4) on the same
evidence; nothing about that file changed since.

## F2 — "inconsistent narrative: the old 'closed GREEN at Gate 9' wording still appears" (medium)

It appears because the record is an audit trail: the wrong 2026-08-18 wording is kept **and marked
wrong in place**, with the correction and its date — the doctrine requires history preserved, not
rewritten. The lines the finding quotes are that correction:

```diff
+**Group A — BLOCK-disputed — ⛔ SUPERSEDED by round 12 (2026-08-29, below; the 2026-08-18
+  "closed GREEN at Gate 9" wording was wrong — there is no Gate 9 waiver); the dispute
```

A superseded statement that says of itself "this was wrong, see the correction" is not a
contradiction; deleting it would be.
