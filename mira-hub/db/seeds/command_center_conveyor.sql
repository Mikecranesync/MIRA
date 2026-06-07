-- Command Center — conveyor display seed.
--
-- Registers ONE display for the demo conveyor's UNS node: the LIVE IGNITION
-- PERSPECTIVE conveyor dashboard `ConvSimpleLive` ("Conv Simple Live", auto-built
-- 2026-05-29, bound to MIRA_IOCheck tags) running on the PLC-laptop Ignition
-- gateway. After this + migration 030, the Command Center tab shows a green dot
-- on the conveyor and frames the live Perspective screen.
--
-- This REPLACES the earlier tracer-bullet target (the Node-RED fault-detective
-- dashboard on mira-bridge :1880) — that was the wrong dashboard.
--
-- DEV / STAGING ONLY. Do not run against prod NeonDB (env doctrine).
--
-- =========================================================================
-- RENDERING REQUIREMENT — read before changing :host / :port / :path.
-- =========================================================================
-- The Ignition gateway sends `X-Frame-Options: SAMEORIGIN` gateway-wide, and the
-- Perspective client is an SPA that loads ALL its assets + opens its WebSocket at
-- ABSOLUTE paths (`/res/perspective/...`, `/data/perspective/...`, `/system/...`)
-- with no <base> tag. Two consequences (both verified 2026-05-31):
--   1. The Phase-1 direct 302 path (browser frames the gateway directly) is
--      BLOCKED by X-Frame-Options → blank frame.
--   2. The Phase-2 per-id sub-path proxy (`/cc-display/{id}/<rest>` → upstream
--      <rest>) CANNOT host Perspective: the SPA's absolute `/res|/data|/system`
--      requests resolve against the iframe ORIGIN ROOT, bypass the `{id}` prefix,
--      and 404 (assets + socket) → blank/frozen frame.
-- So this display MUST be framed through an ORIGIN-ROOT, XFO-stripping reverse
-- proxy in front of the WHOLE gateway (strip X-Frame-Options + CSP, forward WS,
-- pass every path 1:1). Point :host / :port at that proxy's origin, NOT the raw
-- gateway. Proven working: an nginx origin-root proxy frames ConvSimpleLive with
-- all assets 200 and XFO stripped (the gateway then showed "Trial Expired" — a
-- separate gateway-licensing state, reset on the gateway itself).
--
-- Reference (raw gateway, do NOT frame directly — XFO-blocked):
--   http://100.72.2.99:8088/data/perspective/client/ConvSimpleLive   (Tailscale)
--   http://192.168.1.20:8088/data/perspective/client/ConvSimpleLive  (LAN, when up)
--
-- Usage (dev) — :host/:port point at the origin-root gateway proxy:
--   psql "$NEON_DATABASE_URL_DEV" \
--     -v tenant_id="<demo-tenant-uuid>" \
--     -v uns_path="<conveyor-uns-path>" \
--     -v host="127.0.0.1" \
--     -v port="8890" \
--     -f db/seeds/command_center_conveyor.sql
--
-- Find the demo tenant + conveyor uns_path first:
--   SELECT id FROM hub_tenants WHERE slug ILIKE '%demo%';        -- tenant_id
--   SELECT uns_path::text, name FROM kg_entities
--     WHERE uns_path::text ILIKE '%conveyor%' ORDER BY uns_path; -- uns_path

INSERT INTO display_endpoints
    (tenant_id, uns_path, display_type, scheme, host, port, path, label, enabled)
VALUES
    (:'tenant_id'::uuid,
     :'uns_path'::ltree,
     'web_iframe',
     'http',
     :'host',
     :'port'::int,
     '/data/perspective/client/ConvSimpleLive',
     'Conveyor — live Ignition Perspective (ConvSimpleLive)',
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
