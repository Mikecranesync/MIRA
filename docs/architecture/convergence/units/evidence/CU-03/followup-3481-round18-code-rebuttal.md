# #3481 round R (code group) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round18-gate7-code.md` — head `6e20c2b134954358680cdb978e0c25e54e7fef20`,
scope `mira-crawler/ tests/ .github/ tools/` (rounds C, E and P settled), **103,070/103,070**
chars, sha256 `4ef8881e9fe92918df0059b449b196ae434fe227d5dba3ce3b01a2c65e4191bd` (valid shape on
attempt 1). Every quoted line below is a line of that diff.

## F1 — "`_urls_in` incorrectly treats docstrings as origin URLs" (high)

The finding's own quotation shows the walk over every string `ast.Constant` is **pre-existing** —
identical on the `-` side and the `+` side; this PR changed one thing, the case-insensitive scheme
match:

```diff
-        and isinstance(n, ast.Constant)
-        and isinstance(n.value, str)
-        and n.value.startswith(("http://", "https://"))
```
```diff
+        and n.value.lower().startswith(("http://", "https://"))
```

`_urls_in` feeds only the CI consistency test (`ingest/origins.py` is imported by
`tests/test_provenance_policy.py`, not by production), and that test is deliberately
**conservative**: a URL constant anywhere in `tasks/*.py` must have a policy entry, or CI fails
closed. A docstring URL therefore produces at worst a loud CI failure for the author to classify —
never a production write and never a bypass. "Hide a URL from security scans" is inverted: such a
URL is *surfaced* by the scan, not hidden from it. Out of this PR's scope and not a defect it
introduced.

## F2 — "the scope notice can explode the token count" (medium)

The notice lists file paths (~60 bytes each; ~10 KB for the 160 files of this PR) and is **input**,
not output: `max_tokens` (24k/32k) bounds the model's completion, not the prompt, and the diff cap
is measured on the diff alone:

```diff
+def _scope_notice(excluded: Optional[list[str]]) -> str:
```

The round-R runs that produced this finding sent 103,070 chars of diff plus the notice and
returned a valid-shape review — the overflow did not occur. Sizing the notice is a reasonable
future refinement, not a defect of the review.
