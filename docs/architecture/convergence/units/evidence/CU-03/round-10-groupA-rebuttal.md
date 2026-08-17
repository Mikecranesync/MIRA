# CU-03 round-10 group A — author rebuttal (verbatim quoted evidence)

## F1 — "Private-visibility flag never updated on conflict"

The finding's quoted diff block (a removed `DO UPDATE SET ... EXCLUDED.*` list) **does not
appear in this PR's diff**. The PR's only changes to the INSERT statement are:

```diff
-                         cast(:metadata AS jsonb), false, :verified, :chunk_type,
+                         cast(:metadata AS jsonb), :is_private, :verified, :chunk_type,
```

and the conflict clause is untouched context — at head it reads (visible as unchanged
context lines around the hunk):

```
                    ON CONFLICT (tenant_id, source_url, ((metadata->>'chunk_index')::int))
                    WHERE (metadata->>'chunk_index') IS NOT NULL
                    DO NOTHING
```

There is no `DO UPDATE` at head to omit `is_private` from; the finding describes code that
does not exist. On the residual concern (an existing row keeps its old visibility when the
same key is re-inserted): the conflict key **includes `tenant_id`**, so a collision is only
ever the SAME tenant re-ingesting the SAME `source_url` + chunk index — dedup of that
tenant's own earlier write. No cross-tenant row can be affected by construction, and
`DO NOTHING` (pre-existing behavior, unchanged by this PR) never makes any row more visible.

## F2 — "Mis-location of sources.yaml causing universal ingest rejection"

The consequence the finding describes is the **designed fail-closed contract**. The
decisive evidence is present VERBATIM as added (`+`) lines in the
`mira-crawler/tasks/ingest.py` section of this diff — search the diff for these exact
strings:

```diff
+    Any resolution/manifest failure fails CLOSED — an unvalidatable shared
+    write is a refused write.
```

```diff
+    try:
+        hosts = _curated_hosts()
+    except Exception as e:
+        return False, f"sources.yaml unreadable ({e}) — fail closed"
```

(Both are inside the added `shared_corpus_source_allowed` function; the literal substring
`fail closed` appears on multiple `+` lines of this diff.)

So the finding's own trigger ("deploy where sources.yaml is not found") produces exactly
the behavior the contract REQUIRES: every shared-corpus write is refused, loudly —
the diff also adds `logger.warning("Refusing shared-corpus ingest of %s: %s", ...)` at the
gate's call site. Refusing to write to the shared corpus when the curation manifest cannot
be read is the security requirement this unit exists to enforce (an unvalidatable shared
write must never proceed), not a defect. Availability of the manifest is a deployment
invariant, and the deployed image satisfies it: `Dockerfile.celery` does
`COPY mira-crawler/ /app/mira_crawler/`, so `Path(__file__).resolve().parents[1] /
"sources.yaml"` resolves to `/app/mira_crawler/sources.yaml`, which that COPY ships.
The finding identifies no path by which uncurated content is shared, and the
"universal rejection" it fears is the documented fail-closed posture with loud logs.

## F3 — "Undeclared runtime dependency on PyYAML"

Two independent disproofs, both in the diff:

1. The import is **lazy, inside `_curated_hosts()`** (the diff adds it inside the function
   body, not at module level):

```python
    from urllib.parse import urlparse

    import yaml

    manifest = Path(__file__).resolve().parents[1] / "sources.yaml"
```

2. `_curated_hosts()` is only ever called inside the fail-closed handler quoted under F2
   (`except Exception as e: return False, f"sources.yaml unreadable ({e}) — fail closed"`).
   An `ImportError` is an `Exception`: the claimed break ("aborting the task and leaving
   the system in a failed state") cannot occur — a missing PyYAML produces a per-URL
   refusal, exactly like an unreadable manifest.

(Operationally PyYAML is also pinned in `mira-crawler/requirements-celery.txt`
(`PyYAML>=6.0.3`) — outside this diff, recorded here for the human reader; the in-diff
fail-closed path above is sufficient to disprove the claimed failure mode on its own.)
