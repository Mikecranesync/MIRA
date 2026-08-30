# #3481 round 44 (S2: `mira-crawler/ingest/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round44-gate7-ingest.md` — head `18cde8db6e6437ac6f21938a66adc8581e32d135`
(valid on attempt 1). Every quoted line is a `+` line of this PR's diff; the adjudication
scope adds `mira-crawler/tests/` so the locks are visible.

## F1 — "the PostgreSQL-only engine guard re-introduces a settled defect" (high)

Fifth raise. The guard **is** the round-35 adjudicated requirement ("prove non-PostgreSQL
back-ends are impossible" — `followup-3481-round35-ingest-adjudication.md`, F2 SUSTAINED). No
test in this repository builds an engine on SQLite for this store (the crawler slice runs
on a captured fake connection); the lock names the exact environments:

```diff
+    def test_store_engine_is_postgresql_only_by_construction(self, monkeypatch):
```
```diff
+        for bad in ("sqlite:///x.db", "mysql://u@h/db", "mariadb+pymysql://u@h/db"):
```

A finding cannot be sustained both for the guard's absence (round 35) and for its presence.

## F2 — "`insert_chunk` returns `""` on conflict; callers expect a non-empty id" (high)

That is round AA's root fix for round-22 F1/F2 (a minted id was returned on conflict and
`store_chunks` **counted and KG-linked a row that was never written**). `""` is the honest
answer — "not written" — and every caller in this PR treats it so:

```diff
+                return ""  # DO NOTHING fired
```

Locked: `test_conflict_returns_empty_and_is_neither_counted_nor_linked` and
`test_store_chunks_does_not_count_or_link_a_conflicted_row` (round AA), `_Returned` fakes in
`test_store_verified.py` / `test_write_path_visibility.py`.

## F3 — "the confusables map misses MATHEMATICAL SCRIPT SMALL A `𝒶` and FULLWIDTH `ａ`" (high)

Both are **compatibility** forms that NFKD maps to `a` before the confusables step —
executed on this head: `?𝒶pi_key=1` → refused (`apikey`), `?ａpi_key=1` → refused
(`apikey`). The map covers only what NFKD does not: visually identical Cyrillic/Greek
letters:

```diff
+    decomposed = normalize("NFKD", decoded)
+    stripped = "".join(ch for ch in decomposed if not combining(ch))
+    return _QUERY_NAME_NOISE_RE.sub("", stripped.lower().translate(_CONFUSABLES))
```

Locks on file: `?ａpi_key=` (full-width, round AL), `?pаssword=` (Cyrillic), `?tοken=`
(Greek), `?ѕecret=` (round AP).

## F4 — "a DSN with surrounding whitespace is refused as non-PostgreSQL" (medium)

A DSN with surrounding whitespace is not a URL SQLAlchemy accepts either (`make_url`
rejects it), so the guard changes the *message*, not the outcome, and it fails loud with the
refused dialect named — the configuration mistake is reported instead of hidden.
