# #3481 round 35 (S5: `tests/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round35-gate7-lane-tests.md` — head `bd674af3e271eb7e814e1c36750034c22bb956f8`
(valid on attempt 1). The adjudication scope adds `tools/` so the implementation is visible.

## F1 — "`filter_diff_paths` uses `p.startswith(scope)`, so `--paths docs/` also includes `docs_extra/secret.py`" (high)

False on its own example. Executed on this head:
`"docs_extra/secret.py".startswith("docs/")` → **`False`** — the scope prefix carries its
trailing `/`, so a sibling directory that merely shares leading characters never matches.
The finding's premise ("evaluates to `True`") is a factual error about `str.startswith`.

`filter_diff_paths` is, moreover, **unchanged by this PR** (no `+` line of this diff touches
it), and the direction of any scope error is the safe one: a slice can only *exclude* files —
and every excluded path is named to the reviewer and in the receipts, by this PR:

```diff
+    """Tell a scoped (--paths) reviewer what it cannot see. Pure.
```
```diff
+        f"\n⚠️ SCOPE NOTICE — you are reading a --paths SLICE of this PR, not the PR.\n"
```

"Tenant isolation" does not apply: `--paths` is the operator's own command-line argument on
a single repository's diff; there is no tenant, and nothing outside the diff can be reached.
