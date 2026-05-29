-- Command Center — Phase 1 tracer-bullet seed.
--
-- Registers ONE display: the fault-detective Node-RED conveyor dashboard
-- (mira-bridge :1880, path /dashboard/fault-detective) against the demo
-- conveyor's UNS node. After this + migration 030, the Command Center tab
-- shows a green dot on the conveyor and frames the live dashboard.
--
-- DEV / STAGING ONLY. Do not run against prod NeonDB (env doctrine).
--
-- Usage (dev):
--   psql "$NEON_DATABASE_URL_DEV" \
--     -v tenant_id="<demo-tenant-uuid>" \
--     -v uns_path="<conveyor-uns-path>" \
--     -v host="192.168.1.12" \
--     -f db/seeds/command_center_conveyor.sql
--
-- Find the demo tenant + conveyor uns_path first:
--   SELECT id FROM hub_tenants WHERE slug ILIKE '%demo%';        -- tenant_id
--   SELECT uns_path::text, name FROM kg_entities
--     WHERE uns_path::text ILIKE '%conveyor%' ORDER BY uns_path; -- uns_path
--
-- host: a Hub-server- AND LAN-browser-reachable address for mira-bridge. On
-- Charlie's local Hub the Charlie LAN IP (192.168.1.12) is reachable from both;
-- 'mira-bridge' (the docker service name) is reachable only server-side, so the
-- iframe redirect would fail in the browser — use the IP for the tracer bullet.

INSERT INTO display_endpoints
    (tenant_id, uns_path, display_type, scheme, host, port, path, label, enabled)
VALUES
    (:'tenant_id'::uuid,
     :'uns_path'::ltree,
     'nodered',
     'http',
     :'host',
     1880,
     '/dashboard/fault-detective',
     'Conveyor — live fault-detective dashboard',
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
