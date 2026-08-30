# #3481 round 34 (S5: `tests/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round34-gate7-lane-tests.md` — head `c70782371ca87d743323d8c744f1746e20df0347`
(valid on attempt 1). The adjudication scope adds `tools/` so the implementation the tests lock
is visible. Both findings quote regexes that **do not exist in the code**.

## F1 — "`parse_findings` only recognises lower-case `[severity:`" (high)

The quoted `FINDING_RE = re.compile(r"- \*\*\[severity:…")` is fabricated. The real
`_FINDING_RE` (`tools/gate7_review.py`, `_FINDING_RE = re.compile(…, re.I)`) is compiled with
`re.I` and accepts bullet and heading forms. Verified live on this head:

```
parse_findings("## FINDINGS\n- **[Severity: HIGH] X** — y\n", strict=True)
→ [Finding(severity='high', title='X', detail='y')]
```

The heading/bullet forms the PR added are locked (`+` lines of this diff):

```diff
+def test_heading_form_findings_parse_with_the_same_severity_and_title():
```

## F2 — "`parse_rulings` only matches lower-case `[ruling:` and upper-case `SUSTAINED|REFUTED`" (high)

The quoted `RULING_RE` is fabricated too. The real `_RULING_RE` and `_BARE_RULING_RE` are
compiled with `re.IGNORECASE` — the flag is a `+` line of this diff:

```diff
+    re.IGNORECASE,
```

Verified live on this head:

```
parse_rulings("## RULINGS\n- **[Ruling: sustained] [id: F1]** — r\n", strict=True)
→ [('SUSTAINED', 'F1')]
```

And even an unparsed ruling could not "incorrectly return PASS": an unruled prior finding makes
the bijection verdict UNKNOWN, never PASS (verified: `adjudication_verdict([("REFUTED","F1")],
[F1, F2])` → `UNKNOWN`):

```diff
+# bijection contract and the no-severity-channel rule are unchanged.
```
