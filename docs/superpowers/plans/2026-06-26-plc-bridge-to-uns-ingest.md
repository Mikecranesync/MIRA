# PLC Bridge to UNS Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing `plc-modbus` service publish canonical conveyor/Stardust readings into the existing MIRA relay ingest path so Hub reads live data from `live_signal_cache`.

**Architecture:** Reuse `mira-relay` `POST /api/v1/tags/ingest` as the only production ingest boundary. `plc-modbus` becomes a `source_system="plc_bridge"` producer, optionally HMAC-signing requests with the same contract as Ignition; MIRA seed scripts approve the canonical tags for both simulator and PLC bridge sources.

**Tech Stack:** TypeScript/Bun seed scripts and Vitest in `mira-hub`; Python stdlib HTTP/HMAC plus pytest in `services/plc-modbus`; existing `mira-relay` ingest contract.

## Global Constraints

- Reuse existing `mira-relay` `/api/v1/tags/ingest`; do not add a second Hub-local ingest route unless relay proves unusable.
- Every source tag must pass `approved_tags` fail-closed matching before it can reach `tag_events` or `live_signal_cache`.
- Local development must not require production secrets: publisher remains disabled unless URL and tenant are configured; unsigned body-tenant payloads remain for open/dev relay mode only.
- Production/real relay mode must support HMAC headers: `X-MIRA-Tenant`, `X-MIRA-Nonce`, `X-MIRA-Timestamp`, `X-MIRA-Signature`.
- Canonical tag names remain the Task 4 contract: `conv_simple.*` and `stardust.<zone>.*`.
- Use TDD: failing test first for each behavior change, then minimal implementation.

---

### Task 1: Approve PLC Bridge Canonical Tags in Demo Seed

**Files:**
- Modify: `mira-hub/scripts/seed-demo-signals.ts`
- Modify: `mira-hub/src/lib/hub/seed-demo-signals.test.ts`

**Interfaces:**
- Consumes: `DEMO_SIGNAL_ROWS`, `REQUIRED_DEMO_TAGS`, `normalizeSourceTagPath`.
- Produces: `APPROVED_DEMO_SOURCE_SYSTEMS = ["simulator", "plc_bridge"]` and seed SQL that writes both source systems for each canonical tag.

- [ ] **Step 1: Write failing test**

Add a test that asserts the seed exports both approved source systems and would create `DEMO_SIGNAL_ROWS.length * 2` allowlist entries.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mira-hub && npm run test -- src/lib/hub/seed-demo-signals.test.ts`

- [ ] **Step 3: Implement seed loop**

Loop `approved_tags` UPSERTs over `APPROVED_DEMO_SOURCE_SYSTEMS`, keeping `live_signal_cache` seeded only once as simulator state.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mira-hub && npm run test -- src/lib/hub/seed-demo-signals.test.ts`

- [ ] **Step 5: Commit**

Commit with: `feat(hub): approve plc bridge demo tags`

### Task 2: Build PLC Relay Publisher

**Files:**
- Create: `services/plc-modbus/src/factorylm_plc/relay_publisher.py`
- Create: `services/plc-modbus/tests/unit/test_relay_publisher.py`

**Interfaces:**
- Consumes: canonical tag dict from `canonical_tags_from_snapshot(snapshot)`.
- Produces:
  - `RelayPublisherConfig`
  - `RelayIngestPublisher.build_request(tags, timestamp=None)`
  - `RelayIngestPublisher.publish_tags(tags, timestamp=None)`

- [ ] **Step 1: Write failing tests**

Test payload shape, value-type mapping, unsigned dev payload includes `tenant_id`, HMAC payload omits body tenant and signs exact bytes, and non-2xx responses raise a clear error.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/plc-modbus && PYTHONPATH=src pytest tests/unit/test_relay_publisher.py -q`

- [ ] **Step 3: Implement publisher**

Use stdlib `json`, `hmac`, `hashlib`, `time`, `uuid`, and `urllib.request`; avoid adding a runtime dependency.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/plc-modbus && PYTHONPATH=src pytest tests/unit/test_relay_publisher.py -q`

- [ ] **Step 5: Commit**

Commit with: `feat(plc): publish canonical tags to relay`

### Task 3: Wire Optional PLC Runtime Publisher

**Files:**
- Modify: `services/plc-modbus/backend/config.py`
- Create: `services/plc-modbus/backend/services/hub_signal_publisher.py`
- Modify: `services/plc-modbus/backend/main.py`
- Create: `services/plc-modbus/tests/unit/test_hub_signal_publisher.py`
- Modify: `services/plc-modbus/.env.example`
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: `backend.services.plc_connection.plc_service.read_io()`.
- Produces: optional background loop enabled by env:
  - `FACTORYLM_HUB_PUBLISH_ENABLED`
  - `FACTORYLM_HUB_RELAY_URL`
  - `FACTORYLM_HUB_TENANT_ID`
  - `FACTORYLM_HUB_HMAC_KEY`
  - `FACTORYLM_HUB_PUBLISH_INTERVAL_SECONDS`
  - `FACTORYLM_HUB_SOURCE_CONNECTION_ID`

- [ ] **Step 1: Write failing tests**

Test IO snapshot conversion to canonical tags, disabled config no-ops, and publish-once sends canonical tags through the publisher.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/plc-modbus && PYTHONPATH=src pytest tests/unit/test_hub_signal_publisher.py -q`

- [ ] **Step 3: Implement runtime service**

Start the background task in FastAPI lifespan only when publish is enabled and required URL/tenant settings are present. Never fail service startup because publishing is disabled.

- [ ] **Step 4: Run focused tests**

Run: `cd services/plc-modbus && PYTHONPATH=src pytest tests/unit/test_hub_signal_publisher.py tests/unit/test_relay_publisher.py tests/unit/test_modbus_tag_source.py -q`

- [ ] **Step 5: Commit**

Commit with: `feat(plc): stream live tags to hub relay`

### Task 4: Verification

**Files:**
- No code changes expected.

- [ ] **Step 1: MIRA affected checks**

Run:
`cd mira-hub && npm run test -- src/lib/hub/seed-demo-signals.test.ts src/lib/hub/status.test.ts`
`cd mira-hub && npm run lint`

- [ ] **Step 2: FactoryLM affected checks**

Run:
`cd services/plc-modbus && PYTHONPATH=src pytest tests/unit -q`

- [ ] **Step 3: Summarize**

Report root cause, files changed, tests added, verification results, and remaining deployment/config risk.
