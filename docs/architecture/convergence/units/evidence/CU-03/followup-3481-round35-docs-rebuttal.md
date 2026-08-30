# #3481 round 35 (S1: `docs/` + `.claude/` + `PLAN.md` + `HANDOFF.md`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round35-gate7-docs.md` — head `bd674af3e271eb7e814e1c36750034c22bb956f8`
(valid on attempt 1). The finding is about `mira-crawler/ingest/provenance.py`, outside the S1
scope; the adjudication scope adds `mira-crawler/ingest/` and `mira-crawler/tests/` so every
quoted `+` line is visible.

## F1 — "`url_has_userinfo` takes everything after `//` without stopping at `/`, `?` or `#`, so `http://example.com/path@foo` is refused" (high)

The quoted body is not the code. The real function slices the authority at the first `/`,
`?` or `#` **before** looking for `@` — these are `+` lines of this diff:

```diff
+    for stop in "/?#":
```
```diff
+            authority = authority[:idx]
+    return "@" in authority
```

and the contract says so in words:

```diff
+    in a path, query or fragment is not userinfo, and a value without a
```

The finding's own examples are the negative controls locked in this PR:

```diff
+    def test_an_at_sign_outside_the_authority_is_not_userinfo(self):
```

(`https://example.com/x?mail=a@b.c`, `https://example.com/p@th`, `https://example.com/x#a@b`
all assert `not url_has_userinfo`). The lines the finding quotes omit the truncation loop that
sits between `authority = rest[2:]` and `return "@" in authority`.
