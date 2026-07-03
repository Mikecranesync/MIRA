# Discovery Recorder — Remote Commissioning status view (PR-1)

> Date 2026-06-28 · Branch `feat/remote-commissioning-status` (fresh off `origin/main`) ·
> Read-only assembly of the existing commissioning loop. No new connector/relay/claim system,
> no migration, no write capability.

## Question
Now that discovery proved the remote-commissioning loop already exists ~80% (ignition/ edge →
mira-web claim → mira-relay ingest → mira-hub command-center), build the **smallest** read-only
status surface so a user in Orlando can open `app.factorylm.com/hub` and see whether a customer-site
connector is ready — and what still needs doing on-site — **without** building new infrastructure.

## Files inspected (to reuse, not rebuild)
- `mira-hub/src/app/api/command-center/gateways/route.ts` — claim/online: `plg_activation_codes` query + `isGatewayOnline` probe.
- `mira-hub/src/app/api/command-center/tree/route.ts` — `withTenantContext` query pattern; exact `live_signal_cache` / `display_endpoints` / `kg_entities` columns; display reachability probe.
- `mira-hub/src/lib/command-center-freshness.ts` — `tagStatuses` / `freshnessCounts` (live/stale/simulated). Reused as-is.
- `mira-hub/src/lib/session.ts` (`sessionOr401`, `ctx.tenantId`), `mira-hub/src/lib/tenant-context.ts` (`withTenantContext`), `mira-hub/src/lib/db.ts` (`pool`).
- `mira-hub/src/app/(hub)/command-center/page.tsx` — where `ConnectedGatewaysBar` mounts (panel insertion point).
- `mira-hub/src/lib/command-center-freshness.test.ts` — vitest template for the pure-logic test.

## Existing pieces reused (no rebuild)
- **Claim/online**: `plg_activation_codes` (mira-web claim flow) + the shared gateway probe.
- **Allowlist count**: `approved_tags` (fail-closed ingest stays intact — read-only count only).
- **Live data**: `live_signal_cache` freshness via the existing pure freshness lib.
- **UNS binding / Ask-MIRA**: `kg_entities` equipment nodes with `uns_path`.
- **Display reachability**: `display_endpoints` + the shared read-only probe.
- The gateway probe (`parseGatewayHost` / `isLinkLocalHost` / `isGatewayOnline`) was **extracted**
  from the gateways route into `lib/gateway-probe.ts` and reused by both routes — DRY, behavior-identical.

## Commands / tests run
- `vitest run src/lib/commissioning.test.ts src/lib/command-center-freshness.test.ts` → **28 passed** (12 new + 16 existing).
- `eslint` on all changed files → **clean (exit 0)**.
- `tsc --noEmit` → **no type errors in any changed file** (17 total errors exist on `origin/main`, all in unrelated files — pre-existing, not introduced here).

## Endpoint / UI files changed
- NEW `mira-hub/src/lib/gateway-probe.ts` — shared read-only HTTP probe (extracted).
- NEW `mira-hub/src/lib/commissioning.ts` — pure `buildCommissioningStatus(signals)` → checklist + ready + nextAction.
- NEW `mira-hub/src/lib/commissioning.test.ts` — 12 vitest cases.
- NEW `mira-hub/src/app/api/command-center/commissioning/route.ts` — `GET` aggregation endpoint (read-only).
- NEW `mira-hub/src/components/command-center/commissioning-panel.tsx` — "Remote Commissioning" panel.
- EDIT `mira-hub/src/app/api/command-center/gateways/route.ts` — import the extracted probe (removed local copies).
- EDIT `mira-hub/src/app/(hub)/command-center/page.tsx` — mount `<CommissioningPanel />` (import + 1 JSX line).
- EDIT `VERSION` 3.50.0→3.51.0, `mira-hub/package.json` 2.22.0→2.23.0 (version-gate).

## What this proves (the Orlando demo path)
From the Hub, the user sees, per tenant/connector, a read-only checklist: **Claimed · Online · Bound
to equipment/UNS · Source reachable · Display reachable · Approved tags present · Live data flowing ·
Ask-MIRA ready**, plus the single **Next action**. Each derives from data the Hub already holds. So a
user in Orlando can tell whether the CV-200 (or any) connector is online, bound, flowing live data,
and Ask-MIRA-ready — and what the on-site person must still do — without touching the laptop.

## What remains for remote tag approval (NOT in this branch → `feat/remote-tag-approval`)
- `discovered_tags` table + persist seen/rejected tags at ingest (one-pipeline path).
- Hub UI to browse discovered tags, approve/reject, and map to UNS (write path).
- "Rejected tags blocked" visibility (needs the persisted store; today rejects are response-only).
- Optional hardening: persistent connector heartbeat (explicit last-seen) + per-connector HMAC.

## Assumptions / notes
- A "connector" is modeled at tenant scope (one customer = one demo tenant); per-gateway tag
  attribution isn't in the data today (`source_connection_id` is stamped but unread) — out of scope.
- `ready` requires the core path (claimed→online→bound→tags→live→Ask-MIRA); display reachability is
  secondary and never blocks `ready`.
- Production Perspective framing stays tied to ADR-0024 (dedicated FactoryLM origin); this view only
  *reports* reachability, it does not register displays or weaken any header.
- Garage conveyor path untouched; Northwind/CV-200 work lives on PR #2362; this PR is Hub-only.
