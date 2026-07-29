# Discovery Recorder — Northwind / CV-200 Perspective integration (production-origin decision)

> No formal "Discovery Recorder" convention exists in this repo (closest analog: the `_`-scratch
> pattern, e.g. `docs/north-star/_discovery-scratch.md`). This note follows the task's requested
> shape. Date: 2026-06-28 · Branch: `feat/discharge-conveyor-cv200` · PR #2362.

## Question
How do we safely finish the Northwind / Discharge Conveyor CV-200 Perspective integration now that
Mike chose **dedicated FactoryLM-controlled origin per gateway/customer** for production Ignition
Perspective framing — without repointing the garage config, while keeping ingest fail-closed and the
integration read-only?

## Files inspected (grounding)
- `docs/handoffs/2026-06-28-plc-laptop-northwind-cv200-perspective.md` — the contracts/IDs map.
- `mira-hub/db/seeds/command_center_conveyor.sql` — garage display seed (the pattern to mirror, not mutate).
- `tools/seeds/approved_tags_conveyor.sql` — garage allowlist seed (58 rows; the rig tag set).
- `mira-hub/src/app/api/command-center/display/route.ts` — POST register + the **`COMMAND_CENTER_DISPLAY_HOST_ALLOWLIST`** prod lockdown (the production-origin enforcement point).
- `mira-hub/src/lib/display-registration.ts` — `validateDisplayRegistration` (host/uns/scheme/port rules; SSRF block).
- `mira-hub/db/migrations/030_display_endpoints_registry.sql` — `display_endpoints` schema (per-`(tenant,uns_path)`).
- `mira-hub/db/migrations/035_approved_tags.sql` — allowlist schema; match key `normalized_tag_path`.
- `mira-relay/relay_server.py` (`/api/v1/tags/ingest`), `mira-relay/auth.py` (HMAC), `mira-relay/ingest_contract.py` (`normalize_tag_path`/`build_*`), `mira-relay/tag_ingest.py` (`ingest_batch`).
- `mira-pipeline/ignition_chat.py` — `/api/v1/ignition/chat` direct-connection + 422 `uns_required`.
- Conventions: `docs/adr/` (next # = 0024), `.github/workflows/apply-seeds.yml` (`tools/seeds/`, `-v tenant_id` / `__TENANT_ID__`), `tests/simlab/test_approved_tags_seed.py` (normalizer-match pin pattern).
- Existing coverage: `mira-pipeline/tests/test_ignition_chat_direct_connection.py`, `mira-relay/tests/test_tag_ingest.py`.

## Commands / tests run
- `python3 -m pytest tests/test_northwind_cv200_seed_and_config.py -q` → **12 passed**.
- `python3 -m pytest mira-pipeline/tests/test_ignition_chat_direct_connection.py -q` → **9 passed** (422 uns_required + direct_connection already covered).
- `python3 -m pytest mira-relay/tests/test_tag_ingest.py -q` → **19 passed** (approved-accepted / unapproved-rejected fail-closed already covered).
- Generated the Northwind allowlist by transforming the garage seed (58 rows; uns_path → CV-200, notes updated; normalized paths unchanged) and verified row count + garage files untouched via `git status`.

## Observed results
- The garage config (display seed + allowlist seed) is untouched (`git status` clean on both).
- Northwind allowlist's `normalized_tag_path` for every row equals the relay's real `normalize_tag_path` (pinned) → tags will not silently drop.
- The production-origin policy needs **no new code/env/route** — the existing `COMMAND_CENTER_DISPLAY_HOST_ALLOWLIST` already rejects any `host` not in the operator allowlist.
- Ask-MIRA and tag-ingest CV-200 paths reuse already-tested code; only the seed↔normalizer match was CV-200-specific risk, now pinned.

## Code changes made (all NEW, Northwind-only)
- `tools/seeds/approved_tags_northwind_cv200.sql` — CV-200 allowlist seed (58 rows, `__TENANT_ID__`, CV-200 subtree, idempotent).
- `tools/command-center/northwind-cv200.json` — per-environment display origin + ingest config (dev/staging `8890`; prod dedicated origin; raw gateway marked do-not-frame).
- `mira-hub/db/seeds/command_center_northwind_cv200.sql` — dev/staging display registration seed (mirrors garage; DEV/STAGING ONLY; references ADR-0024).
- `docs/adr/0024-dedicated-factorylm-origin-per-ignition-gateway.md` — the framing decision.
- `tests/test_northwind_cv200_seed_and_config.py` — 12 pins (garage untouched, normalizer match, dev=8890, prod=dedicated origin).
- Updated the handoff doc §4/§10 (decision now made).

## Production framing decision
**Dedicated FactoryLM-controlled origin per gateway/customer** (ADR-0024). Example
`https://northwind-cv200.factorylm-gateways.com`. Never the raw gateway, never the `8890` dev proxy,
no shared wildcard origin. Enforced by `COMMAND_CENTER_DISPLAY_HOST_ALLOWLIST`. Read-only + tenant
isolation preserved (display stores only where to *watch*; `display_endpoints` is per-tenant RLS).

## Remaining manual verification / work (PLC-laptop agent + infra)
1. **Dev/staging now:** apply `command_center_northwind_cv200.sql` (`-v host=127.0.0.1 -v port=8890`)
   and `approved_tags_northwind_cv200.sql` (staging via `apply-seeds.yml`); start the gateway timer
   POSTing CV-200 tags as tenant `…b1`; confirm green dot + `live_signal_cache` fills + Ask-MIRA
   answers with no chat-gate.
2. **Prod (follow-up, infra):** provision `northwind-cv200.factorylm-gateways.com` (DNS + dedicated
   nginx server block: XFO/CSP stripped, WS forwarded, TLS, Tailscale-reachable), add it to the prod
   `COMMAND_CENTER_DISPLAY_HOST_ALLOWLIST`, register via `POST /api/command-center/display`.
3. Build the CV-200 Perspective view (clone `ConvSimpleLive`) + embed the Ask-MIRA panel.

## Assumptions
- The physical rig publishes the same Ignition source tag paths as the garage `ConvSimpleLive`
  (so the garage tag set is the correct CV-200 set, re-tenanted) — if the gateway exposes additional
  CV-200-specific tags, add rows to `approved_tags_northwind_cv200.sql` (fail-closed until then).
- Northwind demo tenant UUID is `00000000-0000-0000-0000-0000000000b1` (from the seed on this PR).
- `northwind-cv200.factorylm-gateways.com` is a placeholder origin per ADR-0024; the exact hostname
  is set when infra provisions it (update the config + prod allowlist together).
