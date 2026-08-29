# #3481 round L (docs group) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round12-gate7-docs.md` — head `e5f18a19f8be7fad841c79ec4f101d7e15145147`,
scope `docs/` (artifacts excluded; scope notice present), **88,793/88,793** chars, sha256
`82102007b78b12f2a91df07678f45778d8ef42c062c674d215936900e77f56c5`, briefed as *documentation*.
This adjudication runs on the PR's full diff; the code lines below are visible in it.

## F1 — "`n.value.lower()` raises `AttributeError` when `n.value` is `None` or non-string" (high)

The call is the last clause of a short-circuit `and` chain whose previous clause is a string
type-guard — an unchanged context line of the very hunk the finding quotes
(`mira-crawler/ingest/origins.py`):

```diff
         and isinstance(n.value, str)
```
```diff
+        and n.value.lower().startswith(("http://", "https://"))
```

`.lower()` is only ever evaluated on a `str`. A `None`, number or other constant fails the guard and
is skipped, exactly as before this PR.

## F2 — "committed review-artifact logs may expose IPs, MACs, serial numbers" (high)

The committed `*.stderr.log` files are the lane's own progress output; every payload line in them
records that it was redacted before leaving the machine, and that line is quoted verbatim in this
PR's rebuttals (a `+` line of this diff):

```diff
+Gate 7: sending 78,857/78,857 diff chars to a third-party provider (redacted: IP/MAC/SN)
```

The redaction is locked in this PR — unconditional, before any provider call, covering log content:

```diff
+def test_redaction_is_unconditional_and_covers_log_content_whatever_the_kind():
```

*Outside the diff, for the human reader:* every commit on this branch passed the pre-commit
`gitleaks protect --staged` scan ("no leaks found"), including the ones that added the logs.

## F3 — "'root-fixed IN THIS PR' mischaracterises a change already present at `fc00074c6`" (medium)

The finding's quoted `-`/`+` pair does not exist in the diff; the record's actual line reads:

```diff
+  **R12-F3 SUSTAINED at `fc00074c6` → root-fixed IN THIS PR.** `_urls_in` matched only lowercase
```

and the production change it refers to is in this PR, not in `fc00074c6` — `origins.py` at
`fc00074c6` had the lowercase-only match, which is why round 12 SUSTAINED it there:

```diff
+++ b/mira-crawler/ingest/origins.py
```
```diff
+        and n.value.lower().startswith(("http://", "https://"))
```
