# #3481 round 40 (S2: `mira-crawler/ingest/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round40-gate7-ingest.md` — head `52f965daed9c870f8bc66203c96f58333b056cb9`
(valid on attempt 1). Every quoted line is a `+` line of this PR's diff; the adjudication scope
adds `mira-crawler/tests/` so the locks are visible.

## F1 — "the confusables map is incomplete: `т0кен` (Cyrillic т/к/н and a digit 0) folds to `0` and bypasses detection" (high)

The rule recognises the **name a server receives**. The fold now covers every way of
*spelling the same name* — case, separators, percent-encoding, NFKC compatibility forms,
diacritics, and the Cyrillic/Greek letters that are **visually identical** to Latin letters
(`а е о р с у х і ј ѕ … ο ν ι κ α τ`):

```diff
+# Latin-lookalike letters (Cyrillic and Greek) mapped to their Latin twins
+# before folding (round AP on #3481): `pаssword` with a Cyrillic а must fold to
+# `password`. Only visually identical lower-case letters are mapped; the map
```
```diff
+    Latin-lookalike Cyrillic/Greek letters mapped to Latin, then every
+    non-alphanumeric byte removed. Pure."""
```

`т0кен` is not a spelling of `token`: `т`, `к`, `н` are not Latin lookalikes (`т`≠`t`,
`н`≠`n`), and `0` is a digit, not `o`. No server, SDK or signing scheme reads `т0кен` as
`token`; a credential handed to a parameter named `т0кен` is a credential handed to a
parameter no consumer recognises. The rule is a recognition rule for real credential
spellings, by contract; an open-ended "any string an attacker asserts means `token`" rule has
no fixed point and is not the contract:

```diff
+# `tokenizer` is not the family.
```

The locks on file cover the lookalike class the finding's own reasoning relies on:

```diff
+        "https://example.com/doc.pdf?pаssword=abc123",  # Cyrillic а (U+0430)
```
```diff
+        "https://example.com/doc.pdf?tοken=abc123",  # Greek omicron (U+03BF)
```

## F2 — "`_engine` now aborts on any non-PostgreSQL DSN — previously graceful" (high)

This guard is the fix the round-35 adjudicator **required** ("without proving that
non-PostgreSQL back-ends are impossible" — `followup-3481-round35-ingest-adjudication.md`,
F2 SUSTAINED), and it was adjudicated against in round 34 the other way round. The store is
PostgreSQL-only (`knowledge_entries` lives only in NeonDB; `= ANY(array)` is PostgreSQL's
scalar-array operator); "a test suite that uses an in-memory SQLite URL" does not exist in
this repository — the crawler slice runs on a captured fake connection — and the lock names
the exact environments the finding worries about:

```diff
+    def test_store_engine_is_postgresql_only_by_construction(self, monkeypatch):
```
```diff
+        for bad in ("sqlite:///x.db", "mysql://u@h/db", "mariadb+pymysql://u@h/db"):
```

"Previously graceful" is false: the previous behaviour was a later, obscurer failure on the
first `= ANY` statement; failing at construction with a named reason is the fail-closed
outcome. A finding cannot be sustained both for the guard's absence (round 35) and for its
presence (this round).
