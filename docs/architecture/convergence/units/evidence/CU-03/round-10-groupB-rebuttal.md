# CU-03 round-10 group B — author rebuttal (verbatim quoted evidence)

## F1 — "Uncurated redirects may be followed; client not forced to disable auto-redirects"

The production client in this PR's diff (`mira-crawler/tasks/ingest.py`) disables
auto-redirects explicitly and gates EVERY hop before its request is sent:

```python
            with httpx.Client(
                timeout=DOWNLOAD_TIMEOUT,
                follow_redirects=False,
                headers={"User-Agent": "MIRA-IngestBot/1.0 (KB builder)"},
            ) as client:
                current = url
                for _hop in range(MAX_REDIRECT_HOPS + 1):
                    with client.stream("GET", current) as resp:
                        if resp.status_code in (301, 302, 303, 307, 308):
                            location = resp.headers.get("location", "")
                            nxt = str(httpx.URL(current).join(location))
                            if _up(nxt).scheme.lower() not in ("http", "https"):
                                raise _UncuratedHop(f"non-http redirect target {nxt[:80]}")
                            hop_ok, hop_reason = shared_corpus_source_allowed(nxt)
                            if not hop_ok:
                                raise _UncuratedHop(f"{nxt[:80]}: {hop_reason}")
```

and the diff's comment states the contract: `Redirects are followed MANUALLY: every hop is
scheme-checked and curation-gated BEFORE its request is sent`. The behavior is test-locked
in this group's own diff (`test_write_path_visibility.py`, redirect-hop tests — curated→
uncurated hop refused, non-http hop refused, hop-cap enforced, final-URL provenance).

## F2 — "Percent-encoded ../ can escape the allowed directory"

The gate percent-decodes BEFORE resolve-then-contain: `_validated_local_path` calls
`Path(url2pathname(urlparse(url).path)).resolve()` and only then checks
`local.is_relative_to(base)` — `url2pathname` performs the percent-decoding. The exact
attack the finding hypothesizes is a committed regression test in this group's diff:

```python
    def test_percent_encoded_traversal_cannot_escape(self, monkeypatch, tmp_path) -> None:
        # url2pathname percent-decodes BEFORE resolve-then-contain, so encoded
        ...
        encoded = inbox.as_uri() + "/%2e%2e/etc-passwd"
```

## F3 — "_read_validated likely validates only the final path component"

The finding is speculative ("likely") and disproven by the diff, which contains the full
component walk:

```python
    rel = local_path.relative_to(base)  # ValueError -> caller refuses
    dir_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    fd = os.open(str(base), os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in rel.parts[:-1]:
            next_fd = os.open(part, dir_flags, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        file_fd = os.open(rel.parts[-1], os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
```

Every component below the allowed base is opened with `O_NOFOLLOW` relative to the previous
directory fd — a parent-component symlink swap is refused by the kernel, not just the final
component. Locked by four tests in this group's diff (`test_ingest.py`,
`TestReadValidatedSymlinkWalk`), including
`test_parent_component_symlink_swap_is_refused`, which performs exactly the swap the
finding describes and asserts `OSError`. (The Windows-dev fallback is the recorded residual
in `units/CU-03.md`; production crawler workers run in Linux containers.)

## F4 (medium) — AST scanner does not detect `is_private` supplied via `**kwargs`

Not disputed as a limitation statement — it is the scanner's documented design, quoted from
its own code, and bare `**kwargs` forwarding **no longer counts as explicit** (the scanner
was hardened in the Gate 9 round-2 calibration; self-tested with synthetic sources in this
group's diff). Runtime remains fail-loud: a caller that forwards without the key raises
`TypeError` at the required keyword-only parameter. Non-blocking medium; recorded.
