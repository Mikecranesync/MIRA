# i3X MVP Implementation Plan

**Status:** Phased plan (no code committed yet beyond this doc set)
**Date:** 2026-06-14
**Companions:** `docs/research/i3x-strategy-for-factorylm-mira.md` (why) ·
`docs/architecture/i3x-aligned-ingestion-and-context-model.md` (how/layers).

> **Goal:** ship a **read-only, capability-conformant i3X server** that projects
> MIRA's approved UNS/KG/live-signal context — positioning FactoryLM as the
> "industrial context compiler" — without touching the master model, enabling
> writes, or requiring a historian, Ignition 8.3, or direct PLC access.

**Global guardrails (apply to every phase):**
- ❌ No writes. `update.current=false`, `update.history=false` in `/info`. No
  `PUT /objects/*` handlers that mutate.
- ❌ No historian dependency. History comes from a bounded `tag_events` window.
- ❌ No Ignition 8.3 / Web Dev module requirement. Adapters work via export/
  browse/push.
- ❌ No direct PLC access required if tag export/browse provides data.
- ❌ Modbus semantics never auto-asserted — device profile + technician approval.
- ❌ OPC UA is an adapter, never the master model.
- ❌ Raw never exposed — only `approved_tags` + `approval_state=verified` content.
- ✅ One i3X mapping in the repo (extend public-ingest §10; don't fork).
- ✅ Every phase passes the relevant `tests/eval/` regime + a focused
  hallucination audit (`mira-run-hallucination-audit`) where engine-adjacent.

---

## Phase 0 — Research (this task) ✅

**Objective:** establish what i3X is, where it sits, and the gap list. **Done** —
this doc set.

**Deliverables:** the three docs (strategy, architecture, this plan).

**Open follow-ups carried out of Phase 0 (the UNKNOWNs from strategy §9):**
- **U1:** exact OPC UA node/reference → i3X object/relationship mapping
  (`OPCUA-i3X` README didn't specify). Resolve by reading the `OPCUA-i3X` source
  before Phase 3's OPC UA work — or defer OPC UA to the i3X-client path.
- **U2:** SM Profile (OPC-UA nodeset) → i3X ObjectType (JSON Schema) binding
  mechanics. Resolve before adopting SM Profiles as the ObjectType source
  (Phase 4); until then, derive ObjectTypes from MIRA's own component templates.
- **U3:** confirm there are no formal named conformance *tiers* in the spec (the
  labels "Full 1.0 / 1.0 Compatible" are conformance-suite *report* outputs).
  Verified against the conformance suite in Phase 5.

**What NOT to do:** don't start coding `i3x.ts` or any handler in Phase 0.

---

## Phase 1 — Architecture changes (typed-model foundations)

**Objective:** add the *additive* schema + vocabulary the typed i3X projection
needs — without rewriting the UNS/KG master model. These are the gaps G1–G5/G7
from the architecture doc, expressed as migrations + registries.

**Files affected (proposed):**
- `mira-hub/db/migrations/0XX_signal_class.sql` — add `signal_class` enum/column
  to `live_signal_cache` + `tag_events` (G5). Default `unknown`. Backfill via
  device profiles where known.
- `mira-hub/db/migrations/0XX_i3x_namespace_and_types.sql` — small tables:
  `i3x_namespaces (uri, display_name)`, `i3x_object_types (element_id,
  namespace_uri, display_name, json_schema JSONB, version)`,
  `i3x_relationship_types (element_id, namespace_uri, display_name, reverse_of)`
  (G2, G3, partial G1). Seed with MIRA's vocabulary (signal classes + KG entity
  types; HasComponent/ControlledBy/Drives/Monitors/AlarmFor/InstanceOf/HasParent
  + reverses).
- `docs/specs/i3x-object-type-registry.md` — the canonical ObjectType + JSON
  Schema definitions (derived from component templates + signal classes).
- Update `docs/specs/public-ingest-api-spec.md` §10 → one-line cross-ref to the
  strategy/architecture docs (kill the fork risk).

**Tests:**
- Migration `dry-run` then `apply` on a Neon **dev** branch (per
  `apply-migrations.yml`); never hand-edit prod.
- Unit tests: every relationship type has a `reverse_of`; every object type has a
  valid JSON Schema; `signal_class` enum is closed.

**Risks:**
- Migration numbering collisions on `mira-hub/db/migrations/` (the repo has had
  these — check the current max before numbering).
- Over-modeling: keep the ObjectType registry minimal (signal classes + the
  handful of asset/component types actually in use). Karpathy "simplicity first."

**What NOT to do:** don't migrate `kg_entities`/`kg_relationships` to i3X shapes;
don't add `reverseOf` by *doubling* every stored edge (synthesize the reverse at
the API layer in Phase 2 instead) unless query performance proves otherwise.

---

## Phase 2 — Read-only i3X API prototype ✅ DONE (read/query server)

**Status:** Read/query API server **DONE** — all 11 read/query endpoints
implemented, contract-tested, and passing. See detailed plan:
`docs/superpowers/plans/2026-06-15-i3x-readonly-api-server.md`.

**Conformance tier:** "1.0 Compatible (read/query)" — the server correctly
reports `update.current=false`, `update.history=false` in `/info`. Subscriptions
(`/subscriptions` create/register/sync/list/delete) are a **MUST for Full 1.0**
but are a distinct stateful subsystem (sequence numbers, TTL, 206-on-overflow);
they remain in a separate follow-on plan. Until subscriptions land, the server
is honestly "1.0 Compatible (read/query)", not "Full 1.0".

**Objective:** stand up the conformant **read** surface as a projection. This is
the core deliverable. Endpoints (all read/query; subscriptions sync-only):
`/info`, `/namespaces`, `/objecttypes` (+`/query`), `/relationshiptypes`
(+`/query`), `/objects` (+`/list`), `/objects/related`, `/objects/value`,
`/objects/history`, and the **MUST** subscription set (`/subscriptions` create/
register/sync/list/delete).

**Files affected (proposed):**
- `mira-hub/src/lib/i3x.ts` — the projection helpers (finally builds the planned
  `toI3xEnvelope`): `kg_entity → ObjectInstanceResponse`, `live_signal_cache row
  → CurrentValueResult/VQT` (with the §4.1 quality map), `tag_events window →
  HistoricalValueResult`, UNS ltree → `HasParent`/`isComposition`, relationship →
  `RelatedObjectResult` (+ synthesized reverse). **elementId = `kg_entities.id`
  UUID; UNS path = displayName/metadata** (strategy §8.1).
- `mira-hub/src/app/api/i3x/v1/.../route.ts` — one route per endpoint (or a
  small FastAPI sibling if Next routing is awkward — decide first, don't build
  both). Read-only; auth on all except `/info`.
- `mira-hub/src/lib/i3x-subscriptions.ts` — sync-mode subscriptions backed by
  `tag_event_diffs` (mig 037) / `live_signal_cache` deltas. SSE stream declared
  unsupported.

**Hard projection rules:**
- Filter **every** object/relationship on `approval_state='verified'`; filter
  every value on the `approved_tags` allowlist. `proposed` is invisible.
- `/info` returns `update.current=false`, `update.history=false`,
  `subscribe.stream=false`, `query.history=true`.
- `GET /info` MUST NOT require auth; everything else MUST require auth (scheme:
  bearer, reuse Hub's key/JWT — `public_api_keys` from the public-ingest spec).

**Tests:**
- Contract tests against the OpenAPI shapes (`api.i3x.dev/v1/openapi.json`) — each
  response validates against the published schema.
- Golden projection tests: a seeded asset+component+signal → expected
  ObjectInstance/VQT/related JSON.
- Hub e2e auth recipe (mint next-auth JWE) for the authed endpoints.
- Tenancy/RLS test: tenant A cannot read tenant B's objects.

**Risks:**
- **Subscriptions are MUST** even for "read-only" — don't skip them thinking
  read-only means GET-only (strategy §2). Sync-mode is enough; SSE is MAY.
- Reverse-relationship synthesis must be correct in `/objects/related` (i3X
  requires bidirectional queryability).
- N+1 / latency on `/objects/related` over large graphs — reuse the MCP traversal
  approach, cap depth (`maxDepth`), paginate.

**What NOT to do:** no `PUT` write handlers (even stubbed-to-501 is fine and
conformant, but no mutation). No exposing `proposed` content "just for the demo."
No second i3X mapping — use `i3x.ts` everywhere.

---

## Phase 3 — Ignition-first ingestion (feed the model)

**Objective:** prove the full pipeline end-to-end with the adapter MIRA already
has — Ignition → raw capture → classify → attach → approve → i3X read. Ignition
first because it exists and needs no new protocol client.

**Files affected (proposed):**
- `mira-relay/tag_ingest.py` — extend to stamp `signal_class` (from the
  device-profile/heuristic added in Phase 1) on `tag_events` + `live_signal_cache`.
  Keep the read-only, fail-closed, sim-protection invariants.
- `ignition/` (WebDev allowlist / tag export mapping) — ensure exported tags carry
  enough metadata (units, type) to classify. **No 8.3 / Web Dev module
  requirement** — tag export or existing push both work.
- Classification helper (`mira-crawler/ingest/` or a relay-local module) —
  profile → class, heuristic → class, else `unknown` (→ technician confirm).
- Approval UI touchpoint: classified-but-unconfirmed signals surface in the
  existing `/proposals` / `approved_tags` flow.

**Tests:**
- `tests/eval/` ingestion regime + `tests/simlab/` (juice bottling line) as a
  deterministic source for classification + projection.
- End-to-end: simulated Ignition batch → `tag_events` → classified → approved →
  visible via `/objects/value` with correct VQT; **unapproved tag is NOT visible**.
- Regression: `bot-grounding-tests` if any engine recall path reads the new field.

**Risks:**
- Classification false-positives writing wrong semantics — mitigate with the
  technician-confirm fallback; never auto-verify (`knowledge-graph-proposer`
  doctrine).
- Don't let the relay pull the heavy `mira-crawler/ingest` package (it inlines
  slug/normalize on purpose — keep that boundary; copy the classify heuristic if
  needed).

**What NOT to do:** don't add a customer-shipped Modbus/OPC-UA socket here
(`fieldbus-readonly.md`); Ignition is the customer path. Don't require direct PLC
access — export/browse is enough.

---

## Phase 4 — MCP / i3X client & server experiments

**Objective:** validate the two ecosystem reuses — (a) point CESMII's i3X MCP
server at MIRA's read API; (b) ingest from an external i3X server via the Python
client. Both are *experiments/spikes*, not customer-shipped surfaces yet.

**Files affected (proposed):**
- `tools/i3x/` (experiments, not in any customer compose):
  - `tools/i3x/mcp-against-mira.md` — config pointing `cesmii/i3X-MCP-Server`
    at MIRA's `/v1` (env `I3X_BASE_URL`, `I3X_AUTH_SCHEME=bearer`, `I3X_TOKEN`);
    record which of the 11 tools work end-to-end.
  - `tools/i3x/ingest_via_client.py` — spike using `pip install i3x-client`
    (`i3x.Client(url, token=…)`) to pull objects/values from an external i3X
    server (e.g. `OPCUA-i3X` in front of a UA server) into `tag_events` as an
    adapter (Layer 1 option b). Read-only (`get_value`/`get_history`/
    `get_related`); never `update_value`.
- (Optional, later) OPC UA: decide U1 — build a native read-only OPC UA adapter
  *or* standardize on `OPCUA-i3X` + the i3X client. Prefer the latter where a
  site already exposes OPC UA.

**Tests:**
- MCP smoke: `search_objects`, `read_current_value`, `get_history`, `find_related`,
  `describe_type` return grounded results against MIRA; `update_value`/
  `write_history` are absent/disabled.
- Client spike: round-trip an external demo server (`api.i3x.dev/v1`) → local
  `tag_events`, with quality/timestamp preserved.

**Risks:**
- The i3X MCP server's optional write tools — confirm they stay disabled
  (`update_value`/`write_history` off by default; verify).
- Auth-token scoping when exposing MIRA's i3X surface to an external MCP process —
  use a scoped read-only key (`public_api_keys`).

**What NOT to do:** don't ship the client adapter or the MCP wiring into a
customer compose in this phase — these are spikes. No writes via either path.

---

## Phase 5 — Conformance testing

**Objective:** measure MIRA's i3X server against the published conformance
requirements and the CESMII conformance suite; produce a conformance report.

**Files affected (proposed):**
- `tests/i3x/conformance/` — automated checks for every **MUST** from
  `cesmii/i3X` `spec/IMPLEMENTATION_GUIDE.md`:
  - `/info` reachable without auth, returns all four capability flags.
  - all MUST endpoints present + auth-gated; `/objecttypes` returns JSON Schemas;
    every relationship type has `reverseOf`; relationships queryable both ways;
    `parentId` matches `HasParent`; composition parents are `isComposition:true`;
    at least one Namespace (unique URI) + at least one root Object; VQT quality is
    one of the four enum values; sync subscriptions honor `clientId` scoping +
    TTL + 206-on-overflow.
- Run against the **CESMII conformance suite** (`i3x.dev/conformance`) — expect a
  report label (Full 1.0 / 1.0 Compatible / Not Compliant). Write-tests are
  non-destructive and only run if update capability is declared — MIRA declares
  none, so write-tests are skipped (correctly).
- `docs/implementation/i3x-conformance-report.md` — the result + any gaps.

**Tests:** the conformance suite *is* the test. Plus the internal MUST checks as
CI regression.

**Risks:**
- Subscription sync semantics (sequence numbers as uint64, TTL deletion, 206 on
  queue overflow) are easy to get subtly wrong — most likely conformance miss.
- "1.0 Compatible" vs "Full 1.0" — if any MUST is partial (e.g. subscriptions),
  we land "Compatible," which may be acceptable for MVP; decide the bar with Mike.

**What NOT to do:** don't claim conformance from passing internal tests alone —
run the actual suite (evidence over assertion, Cluster Law 1). Don't enable writes
to chase a higher tier — read-only is the doctrine, and writes are MAY anyway.

---

## Sequencing & dependencies

```
Phase 0 (done) ──► Phase 1 (typed-model migrations + vocab)
                      │
                      ▼
                  Phase 2 (read API projection)  ──► Phase 5 (conformance)
                      │                                    ▲
                      ▼                                    │
                  Phase 3 (Ignition ingestion) ───────────┘
                      │
                      ▼
                  Phase 4 (MCP + client spikes)
```

- Phase 2 depends on Phase 1 (needs the type/namespace/relationship vocab).
- Phase 3 can overlap Phase 2 (ingestion feeds the same model the API reads).
- Phase 4 depends on Phase 2 (needs a live i3X surface to point MCP/client at).
- Phase 5 can start partial after Phase 2 and finalize after Phase 3.

## Definition of done (MVP)

1. `GET /v1/info` returns `specVersion`, capabilities with `update.*=false`,
   no auth required.
2. All MUST read + query + base-subscription endpoints implemented, auth-gated,
   tenant-isolated, exposing **only** approved/verified context.
3. Ignition → raw → classified → approved → i3X read works end-to-end on the
   simlab line, with correct VQT quality + history from `tag_events`.
4. CESMII conformance suite run, report committed (target: ≥ "1.0 Compatible";
   stretch: "Full 1.0").
5. CESMII i3X MCP server returns grounded answers against MIRA with writes off.
6. One i3X mapping in the repo; public-ingest §10 points at it.
7. Zero write paths to the plant; zero historian dependency; zero Ignition-8.3
   requirement — verified by the guardrail checks above.
