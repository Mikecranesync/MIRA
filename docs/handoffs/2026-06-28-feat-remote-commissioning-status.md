# Handoff → next branch `feat/remote-commissioning-status`

**Date:** 2026-06-28 · **From:** this cloud-wiring PR (stacked on #2362/#2363) · **Do NOT build the
commissioning dashboard in this PR** — this is the handoff so the *next* branch can.

## Why this is now ready to build
The remote-commissioning loop is already ~80% built and was audited in
`docs/handoffs/2026-06-28-remote-commissioning-discovery.md` (read it first — it has the verified
"what exists / what's missing / smallest next PR" map). The recommendation there is **PR-1: a
read-only "Connector Commissioning status view"** that aggregates existing signals — no new
architecture, no migration, no new connector system. This cloud-wiring PR finished the CV-200 inputs
that view needs:

- **Approved tags complete** — `tools/seeds/approved_tags_northwind_cv200.sql` now covers **every tag
  the staged `NorthwindBottling` Perspective project binds** (added the 11 missing MIRA_IOCheck tags);
  pinned by `tests/test_northwind_cv200_seed_and_config.py::test_northwind_allowlist_covers_every_staged_project_tag`.
- **Display target fixed** — the display seed + config now point at `…/client/NorthwindBottling`
  (not the garage `ConvSimpleLive`); dev/staging via the 8890 proxy, prod via ADR-0024.
- **Ask-MIRA UNS-bound** — `MiraAsk` calls the `mira_chat` project script → `POST /api/v1/ignition/chat`
  with HMAC + `asset_id`/`asset_context` (direct_connection, no chat-gate).
- **Gateway timer folder** — `northwind-cv200.json` documents `STREAM_TAG_FOLDER=[default]MIRA_IOCheck`.

## What `feat/remote-commissioning-status` should build (PR-1)
A per-connector checklist surface in the Hub (`app.factorylm.com/hub`), proving the Orlando-remote thesis.
Assemble **from existing data only** (discovery §4) — one read endpoint
(`GET /api/command-center/commissioning`, or extend `/command-center/gateways`) + one panel:

| Checklist row | Source (reuse) |
|---|---|
| Claimed | `plg_activation_codes` (mira-web connect) |
| Online | `isGatewayOnline()` probe — `mira-hub/.../command-center/gateways/route.ts` |
| Claimed-to machine/UNS | `kg_entities` / `cmms_equipment` (seeded CV-200 row) |
| Source reachable | `tag_events.source_system` = `ignition` |
| Display reachable | `display_endpoints` probe — `command-center/tree` |
| Approved tags present | `SELECT count(*) FROM approved_tags WHERE tenant_id=? AND enabled` |
| Live data flowing | `live_signal_cache` freshness (`lib/command-center-freshness.ts`, 60s) |
| Ask-MIRA ready | asset has a resolvable `uns_path` (CV-200 does) |
| Next action | derived (no live tags → "start gateway timer / approve tags"; display down → "check proxy") |

## Hard constraints (carry forward)
Reuse before build · no parallel connector/relay/edge system · garage `ConvSimpleLive` untouched ·
Northwind/CV-200 separate · read-only · fail-closed allowlist · don't weaken HMAC/tenant-isolation ·
dev/staging = 8890 proxy, prod = ADR-0024 dedicated origin (never raw gateway) · tests as pure-function
aggregation units. The one genuine gap (discovery §5 PR-2) — persist discovered/rejected tags + an
approve-to-UNS UI — is a *follow-up*, not PR-1.

## Acceptance for PR-1
From Orlando, the Hub shows the CV-200 connector: **online · claimed to Riverside/Line1/CV-200 · display
reachable · live tags arriving · Ask-MIRA bound · next action** — with the garage demo unaffected.
