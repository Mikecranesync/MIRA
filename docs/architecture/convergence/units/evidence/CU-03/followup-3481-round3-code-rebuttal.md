# #3481 round C (code group) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round3-gate7-code.md` — head `611705cc5116a07c672b6a8e5cdf4b039ad94015`,
scope `mira-crawler/ tests/ .github/`, 30,255/30,255 chars, reviewed-diff sha256
`c8a1d958d298aa33be69d2ed70561e6e314b5af62956dff4b289482d75881904`. Every quotation below is a
verbatim `+` line of that diff.

## C-F1 — "Missing-dependency simulation does not exercise the intended ImportError path"

The premise is that `sys.modules["yaml"] = None` makes `import yaml` succeed and return `None`.
Python's import system does the opposite: a `None` entry in `sys.modules` makes the import statement
raise `ModuleNotFoundError` (a subclass of `ImportError`) — this is the documented mechanism for
blocking a module, and it is what the test relies on:

```diff
+        monkeypatch.setitem(sys.modules, "yaml", None)  # `import yaml` → ImportError
```

The test then asserts exactly the outcome the finding says would not occur — the gate refuses, the
boundary refuses, and nothing reaches the database:

```diff
+        assert ok is False and "fail closed" in reason, (ok, reason)
```
```diff
+        assert _insert(False, url) == ""
+        assert "sql" not in captured
```

Those assertions pass (the file is in the CI crawler slice). Even under the finding's own
hypothetical (an `AttributeError` on `yaml.safe_load`), both consumers catch `Exception`, not
`ImportError` — the refusal is the same. *Outside the diff, for the human reader:* measured on
Python 3.14.2 and 3.12.3, `import yaml` with `sys.modules["yaml"] = None` raises
`ModuleNotFoundError: import of yaml halted; None in sys.modules`.

## C-F2 — "Platform-guard test does not verify the actual guard logic"

The premise repeats the round-12 misconception that `os.supports_dir_fd` can be a boolean; it is a
`set` on every CPython. The guard is a *platform dispatch* (dir_fd walk on POSIX, plain open on
Windows), not the security property — the property (a symlink swapped into any component is
refused) is locked by the three POSIX tests already on `main`, which execute in Linux CI. The new test
executes `_read_validated` end-to-end on every platform:

```diff
+        assert isinstance(os.supports_dir_fd, (set, frozenset))
```
```diff
+        assert _read_validated((base / "doc.pdf").resolve()) == b"%PDF-1.4 legit"
```

If a refactor removed the guard, this test fails on Windows (`os.O_DIRECTORY` does not exist there,
so the walk raises) and the POSIX tests keep locking the walk on Linux. The `TypeError` the finding
fears cannot occur on any platform because the operand is a set.

## C-F3 — "Case-insensitive URL detection may create duplicate policy entries" (medium)

Discovery returns the original strings; the consumer collapses them to lower-cased hosts in a set
(`discover_feeder_origins`, unchanged on `main`), and the consistency test demands one policy entry
per host. Two spellings of one URL cannot produce two policy entries and cannot bypass anything: the
gate lower-cases scheme and host, and this PR now locks that directly for both the unclassified and
the curated case:

```diff
+    def test_uppercase_scheme_unclassified_origin_is_refused_and_forced_private(self, captured):
```

Non-blocking (medium).

## C-F4 — "`.dockerignore` scan ignores negation rules" (medium) — ACCEPTED as a documented, conservative limit

Correct that the scan has no `!` semantics:

```diff
+    def test_build_context_does_not_exclude_the_manifest(self):
```
```diff
+            variants = {pat, pat[3:] if pat.startswith("**/") else pat}
```
```diff
+                    assert not fnmatch.fnmatchcase(c, v), f".dockerignore `{raw}` excludes {c}"
```

The root `.dockerignore` has no negation rule today. If one that re-includes the manifest is ever
added, this test fails **loud** (a false failure to fix in the test), never silently passes — the
error is on the safe side. Recorded as a known limitation; non-blocking.

## C-F5 — "Un-mocked database write in a test can corrupt CI state"

False. The test takes the `captured` fixture:

```diff
+    def test_uppercase_scheme_unclassified_origin_is_refused_and_forced_private(self, captured):
```

and that fixture replaces the engine before any statement can be built:

```diff
+def captured(monkeypatch) -> dict:
```
```diff
+    monkeypatch.setattr(store, "_engine", lambda: _FakeEngine(box))
```

No connection is attempted; the same fixture backs every insert-capturing test in the file.

## C-F6 — "UPDATE scanner only matches a narrow set of patterns" (medium)

The scanner matches `UPDATE knowledge_entries` wherever it appears — inside a CTE or a subquery
included — and captures everything through to the `WHERE` (or the end of the text):

```diff
+            r"UPDATE\s+knowledge_entries\b(.*?)(?:\bWHERE\b|\Z)", text, re.I | re.S
```

and the self-test proves aliased, lower-case, multi-line and `WHERE`-less forms are caught:

```diff
+    def test_update_scanner_catches_aliased_lowercase_and_multiline_forms(self, sql):
```
```diff
+            "update knowledge_entries ke set content = :c, is_private=:p where id = :id",
```

A stored function that mutated `is_private` would have to be created in a migration, outside the
crawler; the lock's stated scope is the crawler's own statements. Non-blocking (medium).

## C-F7 — "large test file increases CI run time" (low)

24 tests, 4.6–12 s locally, inside a slice that already runs ~150 tests. Non-blocking.
