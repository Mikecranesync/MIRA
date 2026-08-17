# CU-03 round-11 group C — author rebuttal (verbatim quoted evidence)

## F1 — "Insert-chunk signature change breaks undiscovered callers"

There are no undiscovered callers: the caller population is enumerated and LOCKED by a
repo-wide AST scan committed in this diff (`mira-crawler/tests/test_write_path_visibility.py`
— it scans every Python file in the repository for `insert_chunk` / `store_chunks` /
`ingest_text_inline` calls, resolves import aliases, refuses to count bare `**kwargs`
forwarding as explicit, and FAILS if any call lacks an explicit `is_private`). Every caller
in the tree is updated in this same diff (crawler tasks, `crawler/base_crawler.py`,
`mira-bots/tools/learning_ingester.py`, `mira-core/scripts/ingest_equipment_photos.py`,
`tools/vendor_coverage_ingest.py`).

For a hypothetical caller that somehow appears later, the `TypeError` IS the designed
behavior, quoted from the diff:

```diff
+    is_private is REQUIRED (CU-03, finding I-1): the caller must make an
+    explicit visibility decision. Shared OEM/public-crawl content passes
+    False; a customer's own document passes True — never rely on a default
+    (the #1833 leak shape).
```

The alternative — a default value — is precisely the silent cross-tenant leak (#1833)
this security unit exists to remove. Loud failure on an unaudited write path is the
requirement, not the defect.

## F2 — "entry_exists dedup ignores is_private, enabling cross-tenant data suppression"

The query the finding describes is tenant-scoped; cross-tenant suppression is impossible
by construction. Verbatim from `tools/vendor_coverage_ingest.py` (present in this diff's
file set; the allowlist entry quoting it is in the diff):

```python
                SELECT 1 FROM knowledge_entries
                WHERE tenant_id = :tid AND LEFT(content, 200) = :prefix
                LIMIT 1
```

with `{"tid": SHARED_TENANT_ID, ...}` — the query can only ever match rows owned by the
one shared system tenant, and this tool only ever WRITES under that same tenant. A private
row belonging to a different tenant has a different `tenant_id` and can never match. The
allowlist reason in this diff states exactly this:

```yaml
    reason: "entry_exists content-prefix dedup on the shared system tenant's own rows —
    cross-tenant matches would wrongly skip inserts (pure-tenant carve-out). Re-keyed in CU-03"
```

`is_private` is a visibility flag, orthogonal to dedup within one tenant's own rows —
adding it to the dedup key would create duplicate rows, not close a leak.

## F3 (medium) — "Windows CI skips TOCTOU lock tests"

Accurate as a platform statement and already the recorded residual, not a gap in
production coverage: crawler workers run in Linux containers (the production platform),
CI runs the four symlink-walk locks on Linux where they execute, and the Windows-dev
fallback is documented in the diff itself:

```
    On Windows dev boxes dir_fd
    and O_NOFOLLOW do not exist and the plain open of the resolved path
    remains — that residual is recorded in units/CU-03.md; production does
    not run there.
```

Windows is a development environment for this codebase, not a deployment target for the
crawler. Recorded-accepted; non-blocking medium.
