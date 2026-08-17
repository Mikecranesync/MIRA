# CU-03 round-10 group D — author rebuttal (verbatim quoted evidence)

## F1 — "Missing implementation of promised security changes (diff contains only docs)"

The group-D review was deliberately scoped to `--paths docs/` (per-file-group review of a
large PR); the reviewed slice containing only documentation is the scope working as
declared, not the PR lacking code. This adjudication runs on the FULL PR diff, which
directly contains the claimed implementation. Verbatim from that diff:

I-1 — the required keyword-only visibility decision (`mira-crawler/ingest/store.py`):

```diff
+    *,
+    is_private: bool,
```

```diff
-                         cast(:metadata AS jsonb), false, :verified, :chunk_type,
+                         cast(:metadata AS jsonb), :is_private, :verified, :chunk_type,
```

I-2 — the curation gate in `mira-crawler/tasks/ingest.py`:

```python
    if scheme not in ("http", "https"):
        # Hop-0 contract (Gate 9 round 2): only http/https/file are ever
        # eligible — ftp://curated-host must fail at the GATE, not in transport.
        return False, f"unsupported scheme {scheme!r} — http/https/file only"
```

I-3 — private learning rows (`mira-bots/tools/learning_ingester.py`) passing
`is_private=True`, and the behavior-lock tests in
`mira-crawler/tests/test_write_path_visibility.py` / `test_ingest.py` /
`test_oem_trust.py` — all present as modified files in this diff, alongside the
`.github/workflows/ci.yml` step that runs them. The finding's premise ("does not modify
any source files") is contradicted by the diff itself.
