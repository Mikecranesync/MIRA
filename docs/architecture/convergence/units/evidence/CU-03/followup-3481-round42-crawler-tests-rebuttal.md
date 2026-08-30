# #3481 round 42 (S3: `mira-crawler/tests/`) — author rebuttal (verbatim quoted evidence)

Prior report: `followup-3481-round42-gate7-crawler-tests.md` — head `03cd8357d202f5640d40b7ed2115ac169235c2fb`
(valid on attempt 1). Every quoted line is a `+` line of this PR's diff; the adjudication
scope adds `mira-crawler/ingest/`. Both claims were executed on this head first.

## F1 — "a JSON-form `COPY` split across lines returns `None`, bypassing the packaging contract" (high)

Two errors. (a) A Dockerfile instruction spans lines **only** with a `\` continuation, and the
helper joins continuations before matching (round AJ):

```diff
+    dockerfile_text = re.sub(r"\\\r?\n\s*", " ", dockerfile_text)
```

Executed: `COPY [ \␤  "mira-crawler/", \␤  "/app/" ]` → `"/app"`. A JSON array broken across
lines *without* `\` is not a Dockerfile instruction at all (the newline ends it), so no image
can be built from it. (b) The consequence is inverted, as in rounds 32–35: an unmatched form
returns `None` and the caller **fails loud** — the test goes red; it can never "bypass":

```diff
+        # a non-matching COPY makes the caller's assert fail LOUD (dest is
```
```diff
+        assert dest, (
```

## F2 — "the guard `os.open not in os.supports_dir_fd` is reversed and forces the plain-open path everywhere" (high)

Not reversed. `os.supports_dir_fd` is the set of functions that accept `dir_fd`; when `os.open`
is **not** in it (Windows), `dir_fd`/`O_NOFOLLOW` do not exist and the plain open is the only
possible path; when it **is** (POSIX, the production platform), the `dir_fd` + `O_NOFOLLOW`
walk runs. The test's own docstring states which branch runs where, and the read goes through
the guard on both platforms:

```diff
+        """Gate 7 round-12 group A finding on #3268 claimed `os.supports_dir_fd` is
+        a *boolean*, so `os.open not in os.supports_dir_fd` would raise TypeError
```
```diff
+        the guard line executes here on Windows (plain-open branch) and on Linux
+        CI (dir_fd walk), so a TypeError on either platform is a red test."""
```

The POSIX-only symlink-swap locks (`test_parent_component_symlink_swap_is_refused`,
`test_final_component_symlink_swap_is_refused`, unchanged on `main`) pass on Linux CI only
because the `dir_fd` branch — not the plain open — is the one taken there.
