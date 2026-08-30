# #3481 round J (docs group) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round10-gate7-docs.md` — head `9212d2b48652f72fb02ada3853c28bccff3be2ce`,
scope `docs/` (artifacts excluded; scope notice present), **76,489/76,489** chars, sha256
`6b6e1577e95fbfe5c2d86d4dba5b95b3de19e16eb02f7fc0ffcef76706ecdb95`, briefed as *documentation*.

All four findings are about code this PR changes, as described by the record. This adjudication
runs on the PR's full diff, where the code is visible; every line below is a `+` line of it.

## F1 — "Inclusion of `.log` in documentation suffixes … excluded from the redaction step" (high)

`_DOC_SUFFIXES` feeds only `pr_kind` — the *classification* that chooses the brief's note. Nothing
about redaction or what is sent depends on it; the record says so in so many words:

```diff
+Kind affects only the note in the brief; the disprove brief, the escalation triggers and the
```

Redaction is applied to the whole diff before it leaves the machine, for every kind; `.log` files
were in reviewed diffs before this PR exactly as after it.

## F2 — "`is_evidence_artifact` excludes ALL files under `units/evidence/` … `malicious.py` bypasses Gate 7" (high)

That was true at an earlier head of this PR and was fixed at the root — the quoted docstring is
followed, in the same function, by a suffix guard that keeps anything executable or structured in
review:

```diff
+    # Only documentation/log files are artifacts. Anything executable or
```
```diff
+    if not name.endswith(_DOC_SUFFIXES):
```

and the lock names the finding's own scenario:

```diff
+    for smuggled in ("run.sh", "helper.py", "policy.yaml", "payload.json", "x.ts", "Dockerfile"):
```

## F3 — "Parser regression: a high finding without an id/severity is parsed as UNKNOWN and will not BLOCK" (high)

Two inversions. First, UNKNOWN is a **fail-closed** verdict in this lane: it never passes — the
existing structural locks are in this PR's test diff:

```diff
+def test_raw_zero_parsed_prior_findings_cannot_pass():
```

Second, the tolerant forms still require the discriminator (`[severity: X]` on a finding, the stable
`F<n>` id on a ruling); prose is not parsed as a ruling, and a parsed `high` still forces BLOCK
(`test_a_high_finding_overrides_a_stated_pass`, unchanged on `main`):

```diff
+    assert parse_rulings("F1 was discussed but the diff SUSTAINED nothing about F2\n") == []
```

What the tolerant parsers change is that a *well-formed* review whose model chose a heading instead
of a bullet is no longer discarded. Discarding it did not protect anyone: an unparsed report was
UNKNOWN (not green) before and is UNKNOWN (not green) now when it truly lacks the discriminator.

## F4 — "`canonical_source_url` does not normalise default ports" (medium)

By design and by name — the contract is scheme and host only, everything else byte-exact:

```diff
+    """Lower-case ONLY the scheme and the host of ``url``; every other byte —
```

Port normalisation is a different data-contract change, recorded as out of scope (#3482), not a
defect of this one.
