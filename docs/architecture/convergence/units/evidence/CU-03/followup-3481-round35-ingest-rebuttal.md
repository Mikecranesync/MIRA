# #3481 round 35 (S2: `mira-crawler/ingest/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round35-gate7-ingest.md` — head `bd674af3e271eb7e814e1c36750034c22bb956f8`
(valid on attempt 1). Every quoted line is a `+` line of this PR's diff; the adjudication scope
adds `mira-crawler/tests/` so the locks are visible.

## F1 — "a Unicode hyphen (U+2011) in `api‑key` is not stripped, so the credential-family name is missed" (high)

The rule matches the parameter **name as a server receives it**, folding only the separators
that servers and SDKs actually treat as spelling variants of one name — `-`, `_`, `.` and
whitespace — by contract:

```diff
+# scope C F1 SUSTAINED). Matched on the percent-decoded name, lower-cased, with
+# `-`, `_`, `.` and whitespace removed — so `api_key`, `Api-Key`, `api%5Fkey`
+# and `X-Amz-Signature` all match; values are never inspected (a value that
```
```diff
+_QUERY_NAME_NOISE_RE = re.compile(r"[-_.\s]")
```

A name spelled with U+2011 is the literal parameter `api‑key` to every server; no server, SDK
or signing scheme reads it as `api-key`/`api_key`, so it is not a credential-family parameter
in that URL — exactly as `apikeys` or `tokenizer` are not (the contract's own "a longer name
… is not the family"). The name rule is a recognition rule for real credential spellings, not
a homoglyph classifier; treating every Unicode punctuation as a separator would be a new,
open-ended rule the contract does not make. A crawler that wanted to ingest such a URL would
still be refused at hop-0 unless the host is a curated origin.

## F2 — "`= ANY(:urls)` raises on SQLite/MySQL and the guard silently returns not-found" (high)

Adjudicated **REFUTED** on the previous head (`followup-3481-round34-ingest-adjudication.md`,
F4) against this identical code. `knowledge_entries` exists only in NeonDB — PostgreSQL; the
store's engine is built from `NEON_DATABASE_URL` (`store.py` header: "NullPool,
sslmode=require"), no other backend ever executes this statement, and the lock asserts the SQL
text the store emits:

```diff
+        assert "source_url = ANY(:urls)" in sql
```

`= ANY(array)` is PostgreSQL's scalar-array operator; the driver binds a Python list as an
array. A hypothetical non-PostgreSQL deployment is not a configuration this repository has.
