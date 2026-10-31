# CMMS connectors inventory (read-only), 2026-10-25
- MIRA main: `cb7545e456a610cfdd060d144a62eced82dc3932` (2026-10-25 03:48 ET).
- factorylm main: `67b2c64bade9d72df7e39e39e705fa93469af59b` (2026-09-04 17:25 ET), via the GitHub API; the repo isn't cloneable from the box.
- Env and Doppler variable names only.
- Note: MIRA history was squashed at `4682cf47` (2026-10-15). Every file's "last commit" is that import, and old remote branches share no merge base with main, so branch-vs-main diffs are not computable. Their content is UNVERIFIED as unique.

## Summary table
| # | System | Where | Direction | Auth (names) | Status | Tests |
|---|---|---|---|---|---|---|
| 1 | Atlas CMMS (self-hosted fork, "FactoryLM Works") – Hub sync | mira-hub/src/lib/atlas/client.ts (342L), atlas/sync.ts (643L: runForwardSync :386, runReverseSync :614), scripts/cmms-sync-worker.ts, container `mira-cmms-sync` (docker-compose.saas.yml:1193+, staging-vps.yml:738-756). PRs #1023 (P1 sync worker), #1022 (NeonDB-as-SoT), #1469 (staging wiring), #1580 (quota breaker) | Two-way: Neon work orders → Atlas, Atlas edits → Neon | ATLAS_API_USER, ATLAS_API_PASSWORD, HUB_CMMS_API_URL; gate CMMS_SYNC_ENABLED (default false), CMMS_SYNC_INTERVAL_MS | Dormant. Flag off in staging and SaaS; prod compose lists "cmms-sync … Atlas/CMMS" as deferred and fail-closed (docker-compose.production.yml:16-17) | atlas/__tests__/sync-quota-breaker.test.ts |
| 2 | Atlas – Hub provider/deep-link/SSO/stats | mira-hub/src/lib/cmms/{provider,registry,atlas-provider,deep-link,tenant-config}.ts; routes /api/cmms/{stats,deep-link,sso,health}. registry.ts:4 says "Phase 1 ships Atlas only; Phase 3 adds Maximo, Fiix…", and :19 falls back to Atlas. PRs #2305, #2325, #2206; #1030 closed unmerged (superseded); factorylm #190/#191/#194 (SSO on the Atlas side) | Read (stats, health) + SSO handoff + links | Same Atlas vars; SSO secret name UNVERIFIED | Wired in Hub code; live only where an Atlas host is deployed (not prod; UNVERIFIED for staging) | cmms/__tests__/atlas-provider, cmms-deploy-env, cmms-page-links, …; api/cmms/{health,sso}/__tests__ |
| 3 | Atlas – KG import | mira-hub/src/lib/knowledge-graph/cmms-sync.ts:334 syncCmmsToKg, called by /api/kg/sync/route.ts:28 | Read (Atlas assets → KG) | ATLAS_API_USER, ATLAS_API_PASSWORD, HUB_CMMS_API_URL | Wired as an on-demand route; needs Atlas reachable | knowledge-graph/__tests__/cmms-sync.test.ts, cmms-sync-propose.test.ts |
| 4 | Atlas – mira-web PLG | mira-web/src/lib/atlas.ts (signup/signin, createWorkOrder :116, createAsset, list*); callers server.ts:1907, csv-import.ts:126, seed/demo-data.ts:499. PRs #706, #947, #975 | Two-way (create + list) | ATLAS_API_URL, PLG_ATLAS_ADMIN_USER, PLG_ATLAS_ADMIN_PASSWORD | Wired in mira-web (marketing/PLG app), not the SUT; repositioned "no AI CMMS" (#1186) | mira-web tests reference it (UNVERIFIED which ones cover atlas.ts) |
| 5 | Multi-CMMS MCP adapters: Atlas, MaintainX, Limble, Fiix | mira-mcp/cmms/{base,factory,atlas,maintainx,limble,fiix}.py; mira-mcp/server.py:12/42 `create_cmms_adapter()`, MCP tools cmms_* at :330-420 (write/create/list/complete work orders, list/get assets) | Two-way via the selected adapter | CMMS_PROVIDER; ATLAS_API_URL, ATLAS_API_USER, ATLAS_API_PASSWORD; MAINTAINX_API_KEY; LIMBLE_API_KEY; FIIX_API_URL, FIIX_API_KEY | Atlas used in staging (stg-mira-mcp, #1469); MaintainX/Limble/Fiix dormant (no deployed config found, UNVERIFIED). mira-mcp is deferred in prod | No mira-mcp tests for cmms/* (tests/ has exports, faults, ignition, ingest, schematic only) |
| 6 | Bots → MCP → Atlas | mira-bots/shared/integrations/atlas_cmms.py (AtlasCMMSClient over MCP REST), wo_outbox.py (SQLite outbox + drain); used by mira-bots/shared/engine.py and telegram/bot.py; PRs #2472 (ENABLE_WO_EVIDENCE, off), #2630, #3172 | Write (WOs) + read (WO evidence) | MCP_BASE_URL, MCP_REST_API_KEY, MIRA_DB_PATH, ENABLE_WO_EVIDENCE | Bots path: **hard-excluded from the SUT**; dormant in prod | No dedicated tests found (UNVERIFIED) |
| 7 | MaintainX via Nango | nango-integrations/maintainx/{syncs/assets,parts,work-orders.ts; actions/create-work-order,get-asset.ts}; mira-hub/src/lib/nango.ts; /api/integrations/nango/{connect,callback}; /api/connections/*; Hub /integrations page tiles (MaintainX, Limble, Fiix at page.tsx:37-52). PR #808 merged 2026-04-28 | Two-way (sync assets/parts/WOs; create WO) | NANGO_SERVER_URL (staging default `disabled://staging`), NANGO_SECRET_KEY; server NANGO_ENCRYPTION_KEY, NANGO_DB_PASSWORD; per-tenant MaintainX API key stored in Nango | Dormant: Nango disabled on staging, deferred in prod. Limble/Fiix tiles have no Nango integration (stub UI) | None found |
| 8 | mira-connectors (Python lib): Maximo, SAP (PM), MaintainX, + Ignition and PI | mira-connectors/mira_connectors/{types/cmms.py CMMSConnector, factory.py, mocks/maximo_mock, sap_mock, maintainx_mock}. factory.py:30-34 has the real connectors commented out ("maintainx wraps mira-mcp/cmms/maintainx.py"). Consumer: mira-pipeline/connector_import.py (pipeline is SUT-excluded). Branches feat/mira-connectors, feat/connectors-sap-mx-pi (pre-squash, 2026-06-04) | Read (mock fixtures) | None (mocks) | Stub/mock only | tests/test_maximo_mock, test_sap_mock, test_maintainx_mock, test_factory, test_service, test_confirmation_gate |
| 9 | factorylm repo: Atlas app + Gist WOs | factorylm apps/cmms/ (Atlas CMMS fork: api, frontend, docker-compose); cmms/gist_work_order.py (GitHub Gist "work order", PR #52); services/plc-copilot/photo_to_cmms_bot.py; v0.2.0 #87 | Write (Gist WO) | GitHub token (name UNVERIFIED) | apps/cmms = the Atlas server itself (the target, not a connector). Gist WO is legacy/archived | UNVERIFIED |

**Not found anywhere** in code, on branches or in PRs: UpKeep, eMaint, Hippo CMMS, Fracttal, Dude Solutions, MPulse. They appear only in competitor/marketing docs and crawler intent lists (mira-crawler/*). SAP PM exists only as the mira-connectors mock. Maximo exists only as a mock plus the registry Phase-3 comment. No generic inbound CMMS webhook was found; webhook PRs are Stripe and Monday only.

## Duplicates
- **Four Atlas clients:**
  - Hub `lib/atlas/client.ts`
  - Hub `knowledge-graph/cmms-sync.ts` (own fetch, same vars)
  - mira-web `lib/atlas.ts`
  - mira-mcp `cmms/atlas.py` (+ `atlas_client.py` shim), with the bots reaching it over MCP REST
- **Three multi-CMMS abstractions:**
  - mira-mcp `CMMSAdapter`/`create_cmms_adapter`
  - mira-connectors `CMMSConnector`/`create_connector`
  - Hub `lib/cmms` `CMMSProvider`/registry
- **Two MaintainX paths:** mira-mcp/cmms/maintainx.py (API key) and Nango (nango-integrations/maintainx), plus a mira-connectors mock.

## Branches (remote, pre-squash, no merge base with main; unique content UNVERIFIED)
- claude/p1-cmms-sync (2026-05-06)
- feat/cmms-deep-link-phase1-v2 (2026-05-06)
- fix/cmms-sync-quota-breaker (2026-05-29, FactoryLM Bot)
- feat/mira-connectors, feat/connectors-sap-mx-pi (2026-06-04)
- codex/fix-2316-atlas-hub-sso (2026-07-27)
- ops/cmms-backfill-via-bridge (2026-09-09, Mike Harper; open draft PR #3728)
- Open PRs: #3715 (cmms_equipment inserts via asset bridge), #3728, #3810 (CRLF test fix).
- Most branch content appears on main via the merged PRs above.

## Verdict: CONSOLIDATE
**Canonical:** the Hub's `mira-hub/src/lib/cmms` provider registry, with `lib/atlas/client.ts` as its Atlas implementation and `lib/atlas/sync.ts` as the sync engine. Reasons:
- It's the only stack inside the SUT (Hub, Neon as source of truth) and the only one with a provider interface already shaped for more vendors.
- It has tests and a staging deploy path.

**Retire/avoid for new work:**
- mira-web atlas.ts (PLG only)
- the mira-bots MCP path (SUT-excluded)
- mira-connectors mocks (keep as fixtures only)
- the Hub `knowledge-graph/cmms-sync.ts` private Atlas fetch (should call AtlasClient)

**Port later:** the MaintainX, Limble and Fiix logic in mira-mcp/cmms/*.py and the Nango MaintainX syncs are the source material for Phase-3 providers, as TS `CMMSProvider` implementations; pick Nango or direct-API once.

**Round-trip note (#4732):** the project → work order → close loop runs on Hub/Neon work orders. No outside CMMS is needed or wired for it today. Atlas sync is optional and off by default.

**Smallest next step (needs Mike):** decide whether the first outside-CMMS target is Atlas (turn on `CMMS_SYNC_ENABLED` on staging only and rerun the forward/reverse sync proof) or MaintainX (add a `maintainx` CMMSProvider in lib/cmms/registry.ts backed by the existing mira-mcp/cmms/maintainx.py logic). Separately, a S-sized cleanup would point cmms-sync.ts at AtlasClient.

**Proof to rerun:**
- `bun test mira-hub/src/lib/cmms mira-hub/src/lib/atlas mira-hub/src/lib/knowledge-graph/__tests__/cmms-sync*`
- `pytest mira-connectors/tests`
- staging: `/api/cmms/health`
