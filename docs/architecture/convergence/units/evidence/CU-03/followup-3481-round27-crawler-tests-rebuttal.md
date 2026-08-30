# #3481 round AC (scope C: `mira-crawler/tests/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round27-gate7-crawler-tests.md` — head `156b8484452a7fc717dd9e2cf2128412848b9234`,
**72,418/72,418** chars (valid shape on attempt 1). Every quoted line below is a `+` line of this
PR's diff.

## F1 — "Secrets in query strings are persisted to the database" (high)

The finding describes a property of the data model on `main`, not a change of this PR: a
source's URL — path **and query** — is its identity and its re-fetch key, and it was stored
verbatim before this PR. This PR **narrows** exposure in exactly the two places it touches and
says so in `+` lines:

1. The RFC credential slot — userinfo — is refused before identity or SQL on every route:

```diff
+class TestUserinfoRefusedAtTheBoundary:
```
```diff
+    def test_non_http_userinfo_is_refused_before_any_sql_on_every_route(self, captured, caplog):
```

2. A refusal never logs the path or query (the lines the finding quotes are that lock):

```diff
+        assert "Secret-Doc-Name" not in text and "token=abc123" not in text
```

The remedy the finding proposes — strip or hash query parameters matching "known secret
patterns" before insert — is a heuristic identity change: a signed or tokenised document URL
would no longer be re-fetchable or deduplicable, and no RFC equates `?token=a` with the bare
path. That is a product/data-policy decision outside this PR's assignment (the canonical
identity is stated as "every other byte is preserved exactly as given"):

```diff
+    * every other byte is preserved exactly as given. The transform is
+      idempotent.
```

The finding is therefore not a defect the diff introduces or worsens, and its fix is not one the
diff can take without a policy decision. If it is sustained, it is recorded as an explicit
owner item (query-secret handling at ingest), never silently waived.
