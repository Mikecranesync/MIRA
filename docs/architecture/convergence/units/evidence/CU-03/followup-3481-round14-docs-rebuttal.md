# #3481 round N (docs group) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round14-gate7-docs.md` — head `10f30d5ee59db5d3c0f174713a7f65f54f43a466`,
scope `docs/` (artifacts excluded; SCOPE NOTICE present), **98,153/98,153** chars, sha256
`ded8d09eb70c382205d0d0883cc5e53479b014e9639bdc536f3a5144c72b852c`, briefed as *documentation*.

All three findings say a change the record describes "is not present in the diff". Each is present
in the PR's full diff — on which this adjudication runs — outside the `docs/` slice the reviewer
was sent, exactly as the SCOPE NOTICE listed.

## F1 — "no additions to any file under `mira-crawler/tests/`" (high)

```diff
+++ b/mira-crawler/tests/test_ingest.py
```
```diff
+    def test_platform_guard_is_set_membership_and_reads_on_every_platform(
```

(and a whole new file, `+++ b/mira-crawler/tests/test_conflict_and_packaging_contracts.py`).

## F2 — "no modifications to any lane source (`tools/gate7_review.py`)" (high)

```diff
+++ b/tools/gate7_review.py
```
```diff
+def is_evidence_artifact(path: str) -> bool:
```
```diff
+def drop_evidence_artifacts(diff: str) -> tuple[str, list[str]]:
```

## F3 — "no code changes address the `ingested_source_urls` cross-tenant leak" (high)

```diff
+++ b/mira-crawler/ingest/store.py
```
```diff
+    if not tenant_id:
```
```diff
+                    "WHERE source_url = ANY(:urls) AND tenant_id = :tid"
```
