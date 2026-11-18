# Direct equipment browser API

Additive GET routes; existing assets/notebook/component URLs and response shapes are unchanged.
This slice implements direct notebook/component reads and installed-instance `no_link` responses.
Frozen identity v1.2 is unchanged. Mapped-link B1–B12 are OPEN and unimplemented. Source #5510
landed with owner-accepted HIGH F27 still tracked in #5600; this API does not repair that defect.

## Requests

- `/api/equipment-browser/children?parentKind=root`
- `/api/equipment-browser/children?parentKind=namespace&parentId=<uuid>`
- `/api/equipment-browser/children?parentKind=asset&parentId=<uuid>`
- `/api/equipment-browser/children?parentKind=notebook&parentId=<uuid>`
- `/api/equipment-browser/search?scopeKind=notebook&scopeId=<uuid>&q=GS11N-20P2`
- `/api/equipment-browser/resolve?targetKind=notebook_component&notebookId=<uuid>&componentId=<uuid>`
- `/api/equipment-browser/resolve?targetKind=installed_instance&installedInstanceId=<uuid>`

Children/search accept `limit` (default 50, range 1–100), `cursor`, and optional `kind`
(`namespace`, `asset`, `notebook`, `notebook_component`, `installed_instance`). Search accepts
the same four scope kinds as browsing and requires nonempty `q` up to 200 characters. Search
is SQL substring matching, with NFKC/whitespace normalization and literal `%`, `_`, and backslash.
It does not infer a target from a catalog mention. Duplicate or unknown parameters are errors.

Responses contain `items`, `counts.total`, `counts.byKind`, `scope`, `hasMore`, `nextCursor`, and
`consistency: "live_keyset"`. Counts and items use the same authorized/filter snapshot. Each item
has an explicit kind/UUID, parent reference, placement and authorized direct-child count.
Notebook/component data reuses the existing canonical decoders. Retired notebook components
remain visible/countable, with `retiredAt`; resolving one as an active target returns 409.

## Placement and scope

Namespace rows follow the maintenance tree: the enterprise root, its descendants, and eligible
unpathed rows. Private unpathed notebook backing rows are excluded. The namespace parent is
the unique nearest strict ancestor. Ambiguous placement stays at root. Assets use their stored parent asset,
or unique nearest namespace ancestor. A unique verified same-tenant KG bridge whose `entity_id`
is the stored CMMS asset UUID exposes one machine branch, using its KG display name. Existing
KG machine references resolve to that same asset scope. The verified bridge’s current KG path
drives namespace placement and the returned path, including after a move. An explicit CMMS
parent takes precedence when eligible. A combined parent cycle is cut at one stable edge,
preferentially an inferred edge. The cut branch is reachable from root. Equal paths, names or UUIDs without
that bridge do not combine identities. Notebooks use their canonical verified asset binding;
the private document `node_id` is not placement. Components use their notebook FK. Installed instances use their explicit, authorized `asset_id`; absent or
foreign/missing placement stays visible at root. No tag, model, catalog or coincident UUID
creates a link between kinds. Namespace placement is browsing context, not identity approval.

Children returns only that parent's immediate children. Search returns descendants of its typed
scope (root searches the authorized tenant inventory), including unplaced and unknown records.
SQL filters/paginates on the server; the HTTP client never receives a plant-wide tree to filter.
Parent authorization is checked on every request, including signed-cursor requests. Notebook
visibility follows the existing tenant-wide notebook contract, not a newly invented creator ACL.

An installed instance is always explicit about missing notebook linkage:

```json
{"status":"unmapped","reason":"no_link","target":null,"installedInstance":{"id":"…"}}
```

Browsing carries the same information in `resolution`. Both unconfirmed and unplaced installed
instances remain visible. No installed retirement state, mapped target, correction or mapping
writer is fabricated; in particular B12 remains unsupported by the existing installed schema.

## Exact resolution and concurrency

Notebook-component resolution requires both notebook and component UUIDs. Optional
`expectedRevision` (0 means no revision) returns 409 `stale_revision` after a correction.
Optional `selectionVersion` requires `threadKey` and checks the current user's stored selection,
component and revision; a stale, cleared, different or corrected selection returns 409
`selection_changed`. `selectionVersion=none` represents no previous row. Resolving a target
never selects or confirms it. An unconfirmed identity returns `identityUsable: false`.

Unknown and foreign references share 404 `not_found`. Invalid/mixed arguments and invalid
cursors return 400. Missing cursor secret returns 503. Query errors disclose no database detail.
Successful and error API responses are private/no-store, including middleware denial. Missing
or invalid sessions return JSON 401, and blocked entitlements return JSON 403. Route authorization
also checks the live session through `sessionOr401`. Session lookup outages return JSON 503 with
`Retry-After`. No request tenant parameter is accepted.

Cursors are HMAC-SHA256 signed using existing `AUTH_SECRET`/`NEXTAUTH_SECRET`, with domain
separation. They bind caller/tenant/role, operation, scope, normalized query and kind filter.
Ordering is `(kind, UUID)` under C collation, so repeated or corrected labels never collapse or
implicitly pick the first record. The page size may change. Every request reads a fresh
repeatable-read, read-only transaction; there is no cross-request snapshot promise. New rows
before the cursor are seen after refresh, deleted rows disappear, and changed placement/query
membership can change counts on the next page. An exhausted cursor returns an empty page.

## Database and cancellation

Every data read runs under `SET LOCAL ROLE factorylm_app`, with both existing tenant keys set.
Read-only options enforce PostgreSQL `REPEATABLE READ READ ONLY`, including parent authorization
and exact resolution. Existing two-argument transaction callers retain their original preamble.
GET does not use the recency-writing `getNotebook`, change selection, bind equipment, confirm an
identity or revise history.

Abort before acquisition does no work. An aborted queued acquisition releases its late lease.
For active SQL, a separate connection uses public `pg_cancel_backend`; the original lease remains
held until query/cancel completion and rollback. Uncertain cancellation/rollback destroys the
lease. A five-second client deadline stays active through original-query settlement and rollback,
even after a positive cancellation acknowledgement. The abort deadline also applies during
COMMIT and ROLLBACK, without signalling a potentially released backend. Expiration destroys
the lease and settles the request. No private pg active-query API or product debug/sleep route is used. A normal completion
may win a late disconnect race; no read-side writes are committed in either outcome.
Backend identity is captured after BEGIN, while transaction pooling pins that backend. An abort
during setup, before that identity exists, destroys the lease instead of signalling a previously
borrowed autocommit backend. A separate control-path simulation checks this transaction-pooler
case; real Neon/TLS transport remains an unrun deployment check.

The canonical disposable bootstrap must include migrations 015, 016, 017, 018, 021, 023 and 115
in addition to its default migrations. This does not authorize applying any shared migration.
The runtime requires those existing tables and grants; missing schema is not silently stubbed.

## Qualification and disclosed boundaries

From `mira-hub`, run `MIRA_TEST_DB_CONFIRM=DISPOSABLE npm run test:integration:equipment-browser`
with `TEST_DATABASE_URL` pointing to a fresh loopback UTF-8 PostgreSQL database. The same
command bootstraps the TEXT tenant fixture and runs the named suites in CI. The standard
integration profile keeps its default schema and excludes the browser-specific suites.

`__tests__/http.integration.test.ts` runs a real TCP HTTP request through production GET handlers,
the production transaction helper and PostgreSQL using a non-superuser login. Its test-only Node
adapter maps socket disconnect to `Request.signal`. `sessionOr401` is injected with fixed test
identities. It is not proof of cookie/JWT login, the Next HTTP transport, Neon TLS/proxy cancellation,
staging, production or a physical device. No other data/store/transaction/cancellation stub is used.

The fixture reuses BRAVO's b061/f755 8×50×50 + foreign 1×50×50 definitions, repeated VFD1/MLC tags,
catalogs and distinct serials. Bulk fixture seeding is disclosed; existing canonical store tests
separately exercise corrections, selections, idempotency and tenant checks. Installed rows cover
no-link/unplaced/unconfirmed and coincident-UUID negatives. Retirement is fixture-only for A10.
Two compatibility controls retain Unicode-hyphen and long/spaced catalog switch offers without
automatic selection. Source, ontology, store and API coverage are distinct.

The hosted workflow names all three database files. Its proof validator rejects missing
prerequisites/reports, zero collection, skips, failed cases, omitted files and absent mandatory
case names; it also rejects four deliberately invalid report controls. Runner head/base/parents
and tree, raw named results, and measurements are preserved together. The actual runner checkout
and artifact must be inspected before claiming hosted qualification.

Measurements report request durations/response bytes after fixture seeding, and EXPLAIN ANALYZE
BUFFERS for the exact production page SQL under `factorylm_app`. The database cache is not
cleared; these are local/hosted observations, not an achieved latency target or cold-cache claim.

An immutable external `API-HANDOFF-FABLE.md` packet supplies full candidate SHA/base/tree,
branch/PR, build identity, commands, observed cases, hosted runner evidence and remaining gates.
Fable independently returns PASS/FAIL/BLOCKED/NOT RUN on that candidate only. No acceptance is
implied by this document. API native-review allowance is separate from #5510 source rounds.
