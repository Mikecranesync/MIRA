# Author rebuttal — group A (mira-crawler production code)

## Finding 1 — [high] "TOCTOU race on file:// validation allows unauthorized file reads"

Fixed in the current diff. The read no longer uses `read_bytes()`; it opens the
validated resolved path with O_NOFOLLOW on POSIX — the production platform (crawler
workers run in Linux containers) — so a symlink swapped into the final path component
after validation is refused by the kernel at open time. Verbatim from
`mira-crawler/tasks/ingest.py`:

```python
def _read_validated(local_path: Path) -> bytes:
```
```python
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)
    fd = os.open(str(local_path), flags)
    with os.fdopen(fd, "rb") as fh:
        return fh.read()
```

and the call site:

```python
            # Open the exact resolved path validation returned — never a
            # re-parse of the URL; O_NOFOLLOW on POSIX (see _read_validated).
            data = _read_validated(local_path)
```

The docstring the finding quoted ("NOT an object-handle guarantee") was the
pre-fix wording; the current docstring reads, verbatim:

```python
    The caller must open THIS returned resolved path via _read_validated —
    never re-parse the URL. That closes the validate-one-path/open-another
    bug (Gate 9 round 1); _read_validated adds O_NOFOLLOW on POSIX (the
    production platform) so a final-component symlink swap after validation
    is refused there.
```

The remaining scope (Windows dev boxes, parent-component swaps) is a recorded,
accepted residual in the unit record — exploiting it requires write access inside
the operator-controlled inbox on the ingest host, and any row so ingested is still
`is_private=False, verified=False` (non-citable under enforced retrieval).

## Finding 2 — [high] "Missing is_private in existing callers, e.g. mira-crawler/ingest/legacy.py"

The cited file does not exist: there is no `mira-crawler/ingest/legacy.py` in this
diff or in the repository, so the claim's evidence cannot appear in the diff. Every
real caller is updated in this diff — for example the Reddit task (the one caller
that genuinely was missed earlier, found and fixed at Gate 9 round 1), verbatim:

```python
                        embed_model=embed_model,
                        is_private=False,  # public forum content -> shared corpus
                    )
```

and the caller population is locked repo-wide by an AST contract that walks every
`.py` file (imports aliases resolved, `**kwargs` not accepted as explicit), verbatim
from `mira-crawler/tests/test_write_path_visibility.py`:

```python
            missing.extend(self._scan_tree(tree, rel.as_posix()))
```

A hypothetical future caller that omits the argument fails loudly at first call —
that is the unit's intended design (a loud TypeError replaces the silent
`is_private=false` default that was the #1833 leak shape), not a regression.

### Additional quotable evidence for Finding 2 (the exhaustiveness proof)

The exhaustive caller proof is a repository-wide AST contract, present in this diff
(`mira-crawler/tests/test_write_path_visibility.py`). Verbatim:

```python
        missing: list[str] = []
        py_files: list[Path] = []
        for root, dirs, files in os.walk(REPO_ROOT):
            dirs[:] = [d for d in dirs if d not in self.PRUNE_DIRS]
            py_files.extend(Path(root) / f for f in files if f.endswith(".py"))
```

```python
            missing.extend(self._scan_tree(tree, rel.as_posix()))
```

```python
    def test_every_call_site_passes_is_private(self) -> None:
        missing = self._call_sites_missing_is_private()
        assert not missing, (
```

This walks EVERY `.py` file in the repository (default-deny; import aliases resolved;
`**kwargs` not accepted as explicit) and fails CI on any call to
`insert_chunk`/`store_chunks`/`ingest_text_inline` lacking an explicit `is_private`.
It runs in CI (the "knowledge_entries write-path visibility locks (CU-03)" step) and
is green — that IS the exhaustive proof the prior ruling said was missing. The
finding's own named example (`mira-crawler/ingest/legacy.py`) does not exist anywhere
in this diff or repository.
