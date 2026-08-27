# Equipment notebook deletion — API + operator runbook

Permanent deletion of an equipment notebook and every notebook-scoped
dependent row. Added because there was previously **no supported way to remove
a notebook at all** — `/api/equipment-notebooks/[id]` exposed only `GET` and
`PATCH`, `updateNotebook` had no archive/status field, and the only remaining
option was prod SQL, which is prohibited (`docs/environments.md` hard rule 1).

## API

```
DELETE /api/equipment-notebooks/{id}
```

Authenticated (`sessionOr401`), scoped to the **session** tenant. Same
authorization posture as `GET`/`PATCH` on the same route.

| Status | Body | When |
|---|---|---|
| `200` | `{ ok: true, id, deleted: { sources, turns, fileLinks } }` | Deleted. Counts are per dependent table. |
| `401` | `{ error: "unauthorized" }` | No session. Nothing is read or written. |
| `404` | `{ error: "not_found" }` | Unknown id, already deleted, **another tenant's notebook**, or a malformed (non-UUID) id. |
| `409` | `{ error: "conflict", detail }` | An unknown dependant still references the notebook (FK `23503`). Nothing was deleted. |
| `500` | `{ error: "delete_failed" }` | Unexpected DB error. The transaction rolled back; the notebook is intact and the call is safe to retry. |

**404 is deliberately overloaded.** A distinct `403` for "belongs to another
tenant" would confirm that another tenant's notebook exists — an enumeration
oracle. Missing and forbidden are reported identically, and a test asserts the
two bodies are byte-equal.

A malformed id is rejected *before* it reaches Postgres: an invalid uuid raises
`22P02`, which would otherwise surface as a 500 when the honest answer is 404.

## What is deleted, and what is kept

One transaction (`withTenantContext` supplies `BEGIN`/`COMMIT`, `ROLLBACK` on
throw, and `SET LOCAL ROLE factorylm_app` so RLS applies), in this order:

1. `workspace_file_links` where `target_type='equipment_notebook'` and `target_id = id`
2. `equipment_notebook_turns`
3. `equipment_notebook_sources`
4. `equipment_notebooks` (parent last)

**Kept, deliberately:**

- **The uploaded documents** (`namespace_direct_uploads` / `hub_uploads` /
  `knowledge_entries`). One file may be linked to many targets (migration 075,
  "one file, many links"), so a notebook owns its *links*, never the bytes.
  `workspace_file_links.file_id` is `ON DELETE RESTRICT`, which encodes exactly
  that.
- **The wrapped `kg_entities` node** (`node_id`). The knowledge graph outlives
  the notebook that surfaced it, and kg rows are approval-governed (ADR-0017) —
  deleting one here would be an unreviewed graph mutation.

### Why explicit deletes, not cascade

**No dependent table has a foreign key to `equipment_notebooks`.** Migration
073 keys `equipment_notebook_sources` / `equipment_notebook_turns` by
`notebook_id` with no FK; migration 075's `workspace_file_links` is polymorphic
on `target_type`/`target_id` and *cannot* carry one. There is therefore no
`ON DELETE CASCADE` to lean on. Deleting only the parent would leave rows that
still match `notebook_id`/`target_id` — and a future notebook issued the same
UUID would silently adopt them.

Nothing in the database enforces this cleanup; only
`src/lib/__tests__/equipment-notebooks-delete.test.ts` does. Treat those
assertions as the constraint.

**No migration was required:** migration 073 already grants
`SELECT, INSERT, UPDATE, DELETE` on all three notebook tables to
`factorylm_app`, and 075 grants the same on `workspace_file_links`.

## Concurrency

The parent row is selected `FOR UPDATE` before any delete. Two simultaneous
deletes of the same notebook serialize: exactly one gets `200`, the other a
clean `404` rather than a partial pass.

## UI

Both clients expose it, and both call the same Hub route.

- **Hub** — `src/app/(hub)/equipment/[id]/page.tsx`, trash control in the
  notebook header → `NotebookDeleteDialog`.
- **Mobile** — `mira-mobile/src/screens/NotebookScreen.tsx`, "Delete" beside
  the title, same confirmation copy.

The confirmation **names the notebook** and states the deletion is permanent
and irreversible; it also says uploaded documents are kept, so it never reads
as "this deletes my manuals too". Contract-tested in
`NotebookDeleteDialog.test.tsx`.

Double submission is blocked by `createSubmitGuard()` (a ref, not state): a
disabled button is not sufficient because Enter key-repeat and touch double-tap
both fire before React commits the disabled state, and the second `DELETE`
would `404` — showing a failure for a delete that actually succeeded.

Flow semantics live in `src/lib/notebook-delete.ts` and are **duplicated** in
`mira-mobile/src/lib/notebook-delete.ts` (separate bundles cannot import across
the boundary). A contract test on the mobile side asserts the two still agree —
**if you change one, change both.**

## Operator: deleting notebooks in production

Use the UI. If scripting against the API, note that the Hub 308-redirects
slash-less paths and a 308 on `DELETE` is not replayed with the method intact
by every client — **the trailing slash is load-bearing**:

```bash
# authenticate (NextAuth credentials), then:
curl -X DELETE -b cookies.txt \
  "https://app.factorylm.com/api/equipment-notebooks/<id>/"
```

Verify by re-listing and by fetching the id directly — a deleted notebook must
be absent from `GET /api/equipment-notebooks/` **and** return 404 on
`GET /api/equipment-notebooks/<id>/`. Absence from the list alone is not proof;
a cached list can lag.

## Related

- `mira-hub/db/migrations/073_equipment_notebooks.sql` — the three tables, no FKs
- `mira-hub/db/migrations/075_workspace_file_links.sql` — polymorphic links, `ON DELETE RESTRICT` on `file_id`
- `.claude/rules/mira-hub-migrations.md` — tenant typing, RLS, grants
- `.claude/rules/knowledge-entries-tenant-scoping.md` — why documents are shared and must survive
