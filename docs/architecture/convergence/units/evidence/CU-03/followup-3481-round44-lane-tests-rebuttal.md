# #3481 round 44 (S5: `tests/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round44-gate7-lane-tests.md` — head `18cde8db6e6437ac6f21938a66adc8581e32d135`
(valid on attempt 1). The adjudication scope adds `tools/` so the implementation is visible.
**Every one of the five quoted code blocks is fabricated** — none of `HEADING_FINDING_RE`,
`BARE_RULING_RE = re.compile(r'(?i)^\s*(F\d+)…`, `BOLD_RULING_RE`, `norm_prefix`,
`EVIDENCE_DIR = …` / `return path.startswith(EVIDENCE_DIR)`, or `cmd = ["git", "diff", …
base_oid…]` exists in the diff or the file.

## F1 — "heading-form findings are accepted outside `## FINDINGS`" and F2 — "bare/bold rulings are parsed from arbitrary text" (high, high)

Fresh provider output is parsed **strictly**: findings only from inside the single
`## FINDINGS` section, rulings only from inside the single `## RULINGS` section — prose,
comments and fenced examples never become one:

```diff
+    strict=True is what fresh provider output gets: findings are read ONLY from
```
```diff
+def test_strict_rulings_are_read_only_inside_a_single_rulings_section():
```
```diff
+def test_a_later_refuted_never_overrides_an_earlier_sustained():
```

And a ruling can only *add* to the bijection: an injected "SUSTAINED" makes the verdict
BLOCK, an injected "REFUTED" on an already-sustained id is UNKNOWN, an unruled id is UNKNOWN —
never PASS.

## F3 — "`Docs/secret.py` is dropped by `--paths docs/`" (high)

The opposite: the comparison is case-insensitive precisely so `Docs/…` is **kept** by
`docs/` — locked in this diff:

```diff
+def test_scope_prefixes_match_case_insensitively():
```

## F4 — "`is_evidence_artifact` is `path.startswith(EVIDENCE_DIR)`, case-sensitive" (high)

The real function lower-cases the prefix comparison and the file name, requires a doc/log
suffix and exempts README/rebuttals:

```diff
+    if not path.lower().startswith(_EVIDENCE_DIR):
```
```diff
+    name = path.rsplit("/", 1)[-1].lower()
```
```diff
+    if not name.endswith(_DOC_SUFFIXES):
```

Locked: `Docs/Architecture/…/round-1-crash.log` is an artifact
(`test_preserved_evidence_artifacts_are_dropped_from_the_reviewed_diff_and_receipted`).

## F5 — "`fetch_pr` interpolates unvalidated OIDs into a `git diff` command — command injection" (high)

The command is an **argv list** passed to `subprocess.run` (no shell), so no byte of the
OID can become a second argument or a shell metacharacter; and the OIDs come from
`gh pr view --json baseRefOid,headRefOid` — GitHub's own 40-hex commit ids:

```diff
+            f"three-dot diff `git diff {rev[:9]}...{rev[-9:]}` from the fetched objects",
```

A malformed OID makes `git diff` fail with `check=True` (fail loud), never run something
else. Locked: `test_fetch_pr_falls_back_to_the_local_three_dot_diff_when_github_refuses_it`.
