-- Command Center — Northwind / Discharge Conveyor CV-200 display seed.
--
-- Registers ONE display for the CV-200 UNS node: the LIVE IGNITION PERSPECTIVE
-- conveyor dashboard `NorthwindBottling` running on the PLC-laptop Ignition gateway.
-- After this + migration 030, the Northwind Command Center shows a green dot on
-- the Discharge Conveyor and frames the live Perspective screen.
--
-- SEPARATE from the garage seed (command_center_conveyor.sql) — that one stays
-- bound to enterprise.home_garage.conveyor_lab.conveyor_1 and is NOT touched.
-- This ADDS a Northwind-tenant row (display_endpoints is per-(tenant, uns_path),
-- so both coexist — ADD, never repoint). Binding key:
-- enterprise.riverside.area.packaging.line.line1.equipment.discharge_conveyor_cv200.
-- Source: docs/handoffs/2026-06-28-plc-laptop-northwind-cv200-perspective.md.
--
-- DEV / STAGING ONLY. Do not run against prod NeonDB (env doctrine).
-- For PRODUCTION, do NOT use this seed and do NOT point at the 8890 proxy or the
-- raw gateway: register via POST /api/command-center/display against the dedicated
-- FactoryLM-controlled origin (ADR-0024 — e.g. northwind-cv200.factorylm-gateways.com),
-- which must be present in COMMAND_CENTER_DISPLAY_HOST_ALLOWLIST.
--
-- =========================================================================
-- RENDERING REQUIREMENT — read before changing :host / :port / :path.
-- =========================================================================
-- The Ignition gateway sends `X-Frame-Options: SAMEORIGIN` gateway-wide, and the
-- Perspective client is an SPA that loads ALL its assets + opens its WebSocket at
-- ABSOLUTE paths (`/res/perspective/...`, `/data/perspective/...`, `/system/...`).
-- So this display MUST be framed through an ORIGIN-ROOT, XFO-stripping reverse
-- proxy in front of the WHOLE gateway (strip X-Frame-Options + CSP, forward WS,
-- pass every path 1:1). Point :host / :port at that proxy's origin, NOT the raw
-- gateway. (Same constraint + proof as command_center_conveyor.sql.)
--
-- Reference (raw gateway, do NOT frame directly — XFO-blocked):
--   http://100.72.2.99:8088/data/perspective/client/NorthwindBottling   (Tailscale)
--   http://192.168.1.20:8088/data/perspective/client/NorthwindBottling  (LAN, when up)
--
-- Usage (dev/staging) — :host/:port point at the origin-root gateway proxy (8890):
--   psql "$NEON_DATABASE_URL_DEV" \
--     -v tenant_id="00000000-0000-0000-0000-0000000000b1" \
--     -v uns_path="enterprise.riverside.area.packaging.line.line1.equipment.discharge_conveyor_cv200" \
--     -v host="127.0.0.1" \
--     -v port="8890" \
--     -f db/seeds/command_center_northwind_cv200.sql

INSERT INTO display_endpoints
    (tenant_id, uns_path, display_type, scheme, host, port, path, label, enabled)
VALUES
    (:'tenant_id'::uuid,
     :'uns_path'::ltree,
     'web_iframe',
     'http',
     :'host',
     :'port'::int,
     '/data/perspective/client/NorthwindBottling',
     'Discharge Conveyor CV-200 — live Ignition Perspective (NorthwindBottling)',
     true)
ON CONFLICT (tenant_id, uns_path) WHERE uns_path IS NOT NULL
DO UPDATE SET
    display_type = EXCLUDED.display_type,
    scheme = EXCLUDED.scheme,
    host = EXCLUDED.host,
    port = EXCLUDED.port,
    path = EXCLUDED.path,
    label = EXCLUDED.label,
    enabled = true,
    updated_at = now();
