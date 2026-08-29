# #3481 round E (code group) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round5-gate7-code.md` — head `92f25b438645b9e100eb3f5b47ca6beb68f5afa7`,
scope `mira-crawler/ tests/ .github/ tools/` (round C's adjudicated code report supplied as settled
context), 37,640/37,640 chars, reviewed-diff sha256
`e9e160476a41c6ac0881630cfbe705fd61b4975442b5f6fe69437f419e9a4ac2`. Every quotation below is a
verbatim `+` line of that diff.

## E-C1 — "Source-URL case-sensitive uniqueness collides with case-insensitive classification"

The finding's harm requires two rows of the same origin, differing only by casing, to receive
**different** visibilities ("one private, the other public"). They cannot: each row's visibility is
decided by `enforce_visibility` on its own URL with the scheme and host lower-cased, so the two
casings classify identically — and this PR asserts exactly that through the real gate:

```diff
+    def test_uppercase_scheme_curated_origin_classifies_like_lowercase(self):
```
```diff
+        assert _ingest_gate()(upper) == _ingest_gate()(lower)
```

Nor can one row change the other's visibility: the conflict action is `DO NOTHING` and no crawler
`UPDATE` assigns `is_private` (both locked in the same file). What remains is that two casings of
one URL can be stored as two rows under the pre-existing `idx_ke_chunk_dedup` key — a duplicate-
storage property of migration 003 that this PR neither introduced nor changed, with no visibility
consequence. The `_canon` assertions the finding cites compare the INSERT's conflict target to the
migration's index; they were never claimed to canonicalise URLs.

## E-C2 — "PyYAML-missing test may give a false green if `provenance` imports yaml at module import time" (medium)

The premise is false: `import yaml` is lazy, inside `load_policy`, and the test forces that path to
run under the patch by clearing the cached policy first:

```diff
+        monkeypatch.setattr(provenance, "_POLICY", None)
+        monkeypatch.setitem(sys.modules, "yaml", None)  # `import yaml` → ImportError
```

and then asserts the refusal the finding says would not happen:

```diff
+        assert ok is False and "fail closed" in reason, (ok, reason)
```

*Outside the diff, for the human reader:* measured on Python 3.12.3 and 3.14.2, `import yaml` with
`sys.modules["yaml"] = None` raises `ModuleNotFoundError: import of yaml halted; None in sys.modules`;
round C already adjudicated the same claim as REFUTED.
