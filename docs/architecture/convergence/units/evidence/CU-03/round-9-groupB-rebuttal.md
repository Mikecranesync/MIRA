# Author rebuttal — group B (mira-crawler tests)

## Finding 1 — [high] "Uncurated redirects may be followed; the client is not forced to disable auto-redirects; httpx.Client has no follow_redirects keyword"

The production code passes exactly that keyword. Verbatim from
`mira-crawler/tasks/ingest.py` (in this PR's diff, group A files):

```python
            with httpx.Client(
                timeout=DOWNLOAD_TIMEOUT,
                follow_redirects=False,
                headers={"User-Agent": "MIRA-IngestBot/1.0 (KB builder)"},
            ) as client:
```

`httpx.Client(follow_redirects=...)` is the standard httpx constructor argument (it
is also settable per-request; both are valid API). Redirect hops are then followed
manually with per-hop validation before each request, verbatim:

```python
                        if resp.status_code in (301, 302, 303, 307, 308):
                            location = resp.headers.get("location", "")
                            nxt = str(httpx.URL(current).join(location))
                            if _up(nxt).scheme.lower() not in ("http", "https"):
                                raise _UncuratedHop(f"non-http redirect target {nxt[:80]}")
                            hop_ok, hop_reason = shared_corpus_source_allowed(nxt)
                            if not hop_ok:
                                raise _UncuratedHop(f"{nxt[:80]}: {hop_reason}")
```

The test's fake asserting `follow_redirects is False` is a contract lock on that
production call, and `test_uncurated_redirect_refused_before_request` proves the
uncurated target is never requested.

## Finding 2 — [high] "Path-traversal bypass: the diff does not show real path resolution"

It does. Verbatim from `_validated_local_path` in `mira-crawler/tasks/ingest.py`:

```python
        local = Path(url2pathname(urlparse(url).path)).resolve()
        base = Path(allowed_base).resolve()
        if local.is_relative_to(base):
            return local
```

`url2pathname` percent-decodes before `resolve()` normalizes `..`; containment is
checked on the resolved path, never on the URI string. Both traversal tests
(`test_file_scheme_traversal_cannot_escape`,
`test_percent_encoded_traversal_cannot_escape`) pass against this code.

## Finding 3 — [high] "Environment variable read at import time; tests set it after import"

The environment is read at call time, inside the function, not at import.
Verbatim from `_validated_local_path`:

```python
    allowed_base = os.getenv(
        "INGEST_LOCAL_ALLOWED_DIR",
        os.getenv("GDRIVE_SYNC_DEST", "/data/gdrive_sync"),
    )
```

A `monkeypatch.setenv` before the task call therefore takes full effect regardless of
import order — and the refusal tests (e.g. `test_file_scheme_refused_outside_operator_dir`)
demonstrably flip behavior with the env var, which would be impossible if it were
read at import.

## Finding 4 — [medium] "Upper-case scheme handling may be inconsistent (startswith)"

The implementation normalizes the scheme; there is no `startswith` scheme check.
Verbatim:

```python
    scheme = _up(url).scheme.lower()
    if scheme == "file":
```

## Finding 5 — [medium] "AST scanner flags **payload even when payload may contain is_private at runtime"

Deliberate and documented: the static contract requires the decision to be *visible
at the call site* (`is_private=..., **payload` passes); the runtime required
keyword-only argument remains the enforcement for dynamic content. Verbatim from the
scanner's docstring:

```python
        ``**kwargs`` forwarding does NOT count as explicit — the decision must
        be visible at the call site.
```
