# Author rebuttal — group C (tools / hub / tests / workflows / docs)

## Finding 1 — [high] "Unpinned third-party dependencies (celery, redis) in the CI workflow step"

Fixed in the current diff: the step now installs from the repository's pinned
requirements file. Verbatim from `.github/workflows/ci.yml`:

```yaml
        # celery: tasks/ingest.py + tasks/_shared.py import celery_app at module
        # level; not in this job's requirements files. Pinned to the versions
        # mira-crawler/requirements-celery.txt ships (Gate 7 round-9 finding).
        run: pip install -r mira-crawler/requirements-celery.txt && (cd mira-crawler && pytest tests/test_write_path_visibility.py tests/test_store_verified.py -q)
```

and the pins in `mira-crawler/requirements-celery.txt` (pre-existing, version-controlled):

```
celery==5.6.3
redis==5.2.1
```

## Finding 2 — [medium] "Module-level Celery app import may connect to the broker / make CI brittle"

Celery's application object does not connect to a broker at instantiation —
connections are established lazily on first use (task send/worker start), which the
CI step never does; it only imports the module and runs offline tests. Empirically:
this exact step has already run green in this PR's CI (the "knowledge_entries
write-path visibility locks (CU-03)" step inside the passing Architecture/unit job),
with no broker provisioned — the brittleness the finding predicts does not occur.
