# #3481 round 37 (S2: `mira-crawler/ingest/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round37-gate7-ingest.md` — head `d476aa753db1fc977427b612bf8526c87dbafb67`
(valid on attempt 1). Every quoted line is a `+` line of this PR's diff; the adjudication scope
adds `mira-crawler/tests/` so the locks are visible.

## F1 — "a second `?`" and F2 — "`%26` / `%3B`" (high, high)

Adjudicated **REFUTED** three times against this identical logic
(`followup-3481-round32/33/34-ingest-adjudication.md`), re-raised without new evidence. The
rule matches query-parameter **names as a server parses them** and **never inspects values**:

```diff
+# Query-parameter NAMES that carry a credential (round AD on #3481, round-27
```
```diff
+# `tokenizer` is not the family.
```
```diff
+    query = normalize("NFKC", str(url).strip().partition("?")[2].partition("#")[0])
+    for pair in re.split(r"[&;]", query):
```

`?foo=1?api_key=secret` and `?foo=1%26api_key=secret` are, to every server and to this rule,
the parameter **`foo`** with a value — values are outside the rule by contract.

## F3 — "`ingested_source_urls` drops credential-bearing URLs before the lookup, so such rows stay pending forever and are hidden from audit" (high)

By design and locked: a credential never reaches the database, **not even as a bind**, on any
route — that is the whole hop-0/store-boundary contract (rounds AB–AE). The probe filters
exactly as the finding quotes and the lock proves no query runs:

```diff
+    def test_ledger_probe_with_only_userinfo_urls_runs_no_query(self, captured):
```
```diff
+    def test_ledger_probe_never_binds_a_credential_and_never_returns_the_refused_spelling(
```

A credential-bearing ledger item **is supposed** to stay un-ingested: it was refused at hop-0
and never became a row, so "reported as ingested" would be the lie. "Existing rows that contain
credential-bearing URLs" cannot exist through any route of this store (every writer refuses
first), and an audit of historical rows is a database query, not this probe.

## F4 — "`chunk_exists` returns False for a credential URL without querying, so an existing credential row is never deduplicated" (high)

Same contract, same lock — the line the finding quotes states it:

```diff
+        return False  # no query: a credential never reaches the DB, not even as a bind
```
```diff
+    def test_chunk_exists_refuses_userinfo_without_a_query(self, captured):
```

`insert_chunk` refuses the same URL before any SQL, so a `False` here can never lead to a
duplicate insert — nothing with a credential is ever inserted:

```diff
+    def test_insert_refuses_userinfo_with_no_sql_and_no_credential_in_logs(
```

## F5 — "the PostgreSQL-only engine guard breaks test environments that use SQLite" (high)

No test in this repository builds an engine on SQLite for this store: the crawler slice runs
against a captured fake connection (`_FakeConn`) and asserts the SQL text; the guard is the
round-35 S2 F2 fix the adjudicator asked for ("prove non-PostgreSQL back-ends are
impossible"), locked with the very environments the finding names:

```diff
+    def test_store_engine_is_postgresql_only_by_construction(self, monkeypatch):
```
```diff
+        for bad in ("sqlite:///x.db", "mysql://u@h/db", "mariadb+pymysql://u@h/db"):
```

`knowledge_entries` lives only in NeonDB; a deployment "that does not use PostgreSQL" is not a
configuration this repository has, and failing at construction is the fail-closed outcome.
