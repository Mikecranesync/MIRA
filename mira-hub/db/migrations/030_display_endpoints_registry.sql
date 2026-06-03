BEGIN;

-- Migration 030: display_endpoints — the Command Center display registry.
--
-- Spec / goal prompt: ~/.claude/plans/polymorphic-wandering-dahl.md
--   ("MIRA Hub Command Center"). Plan reference for the namespace tree this
--   builds on: docs/plans/2026-05-15-maintenance-namespace-builder.md.
--
-- WHAT THIS IS
--   The Command Center tab lists equipment in UNS order and shows a green dot
--   next to anything with a *live, watchable display* (a web HMI, a Node-RED
--   dashboard, …). There was no table linking a UNS node to such a display —
--   cmms_equipment carries no endpoint, device IPs live only in
--   device-profiles/*.yaml and unpersisted plc/discover.py output. This table
--   is that missing link.
--
-- KEYING — uns_path is canonical (UNS-compliance rule). A display is addressed
--   by where the equipment lives in the namespace, not by a free-form IP string.
--   equipment_id is an optional soft link (no hard FK — kg_entities/cmms_equipment
--   rows are append-with-status and may be reparented); when both are set,
--   uns_path wins.
--
-- LIVENESS — the green dot means "there is a live display to watch", i.e. the
--   display endpoint is reachable RIGHT NOW. The Command Center tree API decides
--   this with a short server-side reachability probe of {scheme}://host:port/path
--   (not by reading PLC-signal freshness — a dashboard can be perfectly watchable
--   while signal ingestion is down, and vice-versa; those would both lie). So no
--   liveness column lives here; liveness is computed at read time from this row's
--   URL. Equipment running/stopped/fault is a separate concept (the tree node's
--   `status`), deliberately not encoded here.
--
-- READ-ONLY — this registry only ever describes where to *watch* a display. It
--   never carries a control endpoint. See .claude/rules/fieldbus-readonly.md.

CREATE TABLE IF NOT EXISTS display_endpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,

    -- Canonical address in the Unified Namespace. The Command Center tree joins
    -- a kg_entities node to its display on uns_path equality.
    uns_path LTREE,

    -- Optional soft link to a cmms_equipment instance (no hard FK by design).
    equipment_id UUID,

    -- How to render the display.
    --   web_iframe — a panel/PLC that serves its own web page (browse http://ip)
    --   nodered    — a Node-RED dashboard (e.g. the fault-detective conveyor)
    --   signals    — Hub-native live-signal panel (future)
    --   vnc        — noVNC-bridged VNC HMI (future; input dropped at the proxy)
    display_type TEXT NOT NULL DEFAULT 'web_iframe'
        CHECK (display_type IN ('web_iframe', 'nodered', 'signals', 'vnc')),

    -- URL parts. The iframe target is {scheme}://{host}:{port}{path}.
    -- Phase 1 (local Charlie Hub) frames this directly; the cloud-reach phase
    -- swaps the target for the on-prem WS-capable proxy over Tailscale.
    scheme TEXT NOT NULL DEFAULT 'http'
        CHECK (scheme IN ('http', 'https')),
    host TEXT NOT NULL,                       -- LAN IP or service name, e.g. 'mira-bridge'
    port INTEGER,                             -- e.g. 1880; NULL => scheme default
    path TEXT NOT NULL DEFAULT '/',           -- e.g. '/dashboard/fault-detective'

    label TEXT,                               -- shown in the viewer header
    enabled BOOLEAN NOT NULL DEFAULT true,    -- soft-disable without delete

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID
);

-- One display per UNS node per tenant. Partial unique so rows that key only on
-- equipment_id (uns_path NULL) don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS uq_display_endpoints_uns_path
    ON display_endpoints (tenant_id, uns_path)
    WHERE uns_path IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_display_endpoints_tenant
    ON display_endpoints (tenant_id)
    WHERE enabled = true;

-- ltree gist for the tree-join lookup path (ltree extension already present —
-- kg_entities / cmms_equipment use it).
CREATE INDEX IF NOT EXISTS idx_display_endpoints_uns_path_gist
    ON display_endpoints USING gist (uns_path);

CREATE INDEX IF NOT EXISTS idx_display_endpoints_equipment
    ON display_endpoints (tenant_id, equipment_id)
    WHERE equipment_id IS NOT NULL;

ALTER TABLE display_endpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS display_endpoints_tenant ON display_endpoints;
CREATE POLICY display_endpoints_tenant
    ON display_endpoints
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID
           OR tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- Grant the limited app role used by withTenantContext. Mirrors 020.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factorylm_app') THEN
        GRANT SELECT, INSERT, UPDATE ON display_endpoints TO factorylm_app;
    END IF;
END $$;

COMMIT;

-- ROLLBACK (manual): DROP TABLE IF EXISTS display_endpoints;
