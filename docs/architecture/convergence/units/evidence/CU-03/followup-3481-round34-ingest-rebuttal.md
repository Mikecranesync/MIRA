# #3481 round 34 (S2: `mira-crawler/ingest/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round34-gate7-ingest.md` — head `c70782371ca87d743323d8c744f1746e20df0347`
(valid on attempt 1). Every quoted line is a `+` line of this PR's diff; the adjudication scope
adds `mira-crawler/tests/` so the locks are visible.

## F1 — "a second `?`" and F2 — "`%26`" (high, high)

Adjudicated **REFUTED** twice against this identical code (`followup-3481-round32-ingest-adjudication.md`,
`followup-3481-round33-ingest-adjudication.md`), re-raised without new evidence. The rule
matches query-parameter **NAMES as a server parses them** and **never inspects values**:

```diff
+# Query-parameter NAMES that carry a credential (round AD on #3481, round-27
+# scope C F1 SUSTAINED). Matched on the percent-decoded name, lower-cased, with
+# `-`, `_`, `.` and whitespace removed — so `api_key`, `Api-Key`, `api%5Fkey`
+# and `X-Amz-Signature` all match; values are never inspected (a value that
+# merely contains the word "token" is an ordinary query), and a longer name
+# such as `tokenizer` is not the family.
```
```diff
+    query = str(url).strip().partition("?")[2].partition("#")[0]
+    for pair in re.split(r"[&;]", query):
```
```diff
+        name = _QUERY_NAME_NOISE_RE.sub("", unquote(pair.split("=", 1)[0])).lower()
```

`?foo=1?token=abc` and `?foo=1%26token=abc` are both the parameter **`foo`** with a value —
to every server and to this rule. Values are outside the rule by contract.

## F3 — "`chunk_exists` / `ingested_source_urls` accept any `tenant_id` without authorization" (high)

These are library functions of the crawler's own store, not an API: the tenant is the
crawler's configured identity (`MIRA_TENANT_ID` / `oem_tenant_id` — `.claude/rules/oem-crawler-trusted.md`),
never a caller-supplied request field, and there is no "attacker with API access" to this
module. What the diff adds is the *fail-closed* half — a probe without a tenant is refused,
and the tenant predicate is unconditional:

```diff
+        logger.warning("ingested_source_urls called without a tenant_id — refusing the probe")
```
```diff
+                    "WHERE source_url = ANY(:urls) AND tenant_id = :tid"
```
```diff
+            "an invalid tenant (empty, None, whitespace, non-str) must never reach the database"
```

Authorization of a tenant is the Hub/API layer's job (`sessionOr401`); it is not a concern
this module can or should re-implement (`.claude/rules/knowledge-entries-tenant-scoping.md`).

## F4 — "`= ANY(:urls)` fails on SQLite (used in CI)" (high)

`knowledge_entries` lives only in NeonDB — PostgreSQL. The store's engine is built from
`NEON_DATABASE_URL` with `NullPool` and `sslmode=require` (`store.py` header, unchanged); no
SQLite ever executes this statement, in CI or anywhere: the CI slice runs against a captured
fake connection, which is why the lock asserts the SQL text rather than executing it:

```diff
+        assert "source_url = ANY(:urls)" in sql
```

The premise ("SQLite used in CI") is false for this table; `= ANY(array)` is PostgreSQL's
scalar-array operator and psycopg binds a Python list as an array.
