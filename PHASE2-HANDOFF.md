# Command Center — Phase 2 (cloud reach + registry CRUD) — Handoff

Branch `feat/hub-command-center-phase2` (off Phase-1 tip `9ce1d735`).
Worktree: `/Users/charlienode/cc-phase2-worktree`. Goal prompt:
`~/.claude/plans/polymorphic-wandering-dahl.md` (Phase 2).

## What Phase 2 adds

**1. Cloud-reach transport** — the cloud Hub (`app.factorylm.com`, DO VPS) can't reach
plant-LAN HMIs. The chain:

```
remote browser
  → https://app.factorylm.com/cc-display/{id}/…        (VPS nginx)
      ├─ auth_request → mira-hub /api/command-center/display/{id}/authz   (per-tenant RLS, 200/403)
      └─ proxy_pass HTTP+WS → 100.70.49.126:8889/display/{id}/…           (Charlie mira-proxy, Tailscale)
            → resolve {id} via display_endpoints allowlist → LAN HMI       (192.168.1.12:1880)
```

- **Hub owns per-tenant authz** (`auth_request`). **Charlie's mira-proxy owns the SSRF
  host allowlist** (unknown id → 404). **nginx carries the WS upgrade** (a Next route
  can't; that would freeze the page).
- Same-origin HTTPS to the browser → no mixed-content, `frame-src 'self'` suffices.

**2. Registry CRUD** — `/api/command-center/displays` (+`/[id]`): RLS-scoped
list/create/update/delete; `ManageDisplays.tsx` drawer + a **Manage** button on the
Command Center page. Register any web HMI by host/IP.

## Files

| Path | What |
|---|---|
| `mira-proxy/nginx.conf` | thin WS-capable proxy + SSRF-allowlist include |
| `mira-proxy/gen_allowlist.py` | generates the allowlist `map` from `display_endpoints` |
| `docker-compose.proxy.yml` | proxy container (pinned nginx, 64M, Tailscale-bound, healthcheck) |
| `mira-hub/.../display/[id]/authz/route.ts` | body-less per-tenant authz for `auth_request` |
| `mira-hub/.../display/[id]/route.ts` | + `COMMAND_CENTER_CLOUD_PROXY` env switch (redirect→same-origin proxy path) |
| `mira-hub/.../displays/route.ts` + `[id]/route.ts` | registry CRUD |
| `mira-hub/.../command-center/ManageDisplays.tsx` | CRUD drawer |
| `mira-hub/db/migrations/031_display_endpoints_grant_delete.sql` | GRANT DELETE (030 only had S/I/U) |
| `deployment/nginx-app-factorylm.phase2-command-center.conf.diff` | **reviewed VPS nginx diff (NOT applied live)** |

## Verified (local / staging — real, no mocks)

- **Transport (make-or-break):** through the proxy — HTTP 200, unknown-id → 404 (SSRF),
  POST → 403 (read-only), assets preserved, frame headers stripped, **WS upgrade → 101**,
  and a real browser opened a **live WS through the proxy** (`LIVE_WS_THROUGH_PROXY=yes`).
- **CRUD (staging DB, RLS):** CREATE 201, dup uns_path 409, bad host 422, UPDATE 200,
  DELETE 200 (after migration 031). Staging left clean (1 row, the real conveyor).
- `tsc` clean for all Phase-2 files; eslint clean.

## Honest status of the cloud chain

The **Charlie proxy hop** and the **Hub redirect/authz/CRUD** are independently verified
(real WS through the proxy; CRUD on staging). The **VPS nginx leg that glues them is
drafted + syntax-validated, NOT exercised end-to-end** — the composed cloud chain
(VPS→Tailscale→Charlie→HMI) has never run. The diff was `nginx -t`-checked in a harness
reproducing the prod http{} scope; that caught a real bug (missing `$connection_upgrade`
map → reload would've failed) now folded in. "Staging-proven; cloud chain syntax-checked
but unexercised pending the gated VPS deploy."

## NOT done (prod boundary — deliberate)

- VPS nginx change is a **reviewed, syntax-validated diff**, not live-applied and not run
  end-to-end. Apply via the gated deploy. It REQUIRES the `map $http_upgrade
  $connection_upgrade` line (see the diff header — prod lacks it today).
- Migration 031 applied to **staging** only — promote dev→staging→prod via
  `apply-migrations.yml` (dry-run first). 030 must also be on prod before this.
- **Full cloud verification waits on the VPS nginx deploy** (the mixed-content/LAN-reach
  gap only closes once the VPS leg exists). Don't read "works in staging" as "works in prod".
- Not merged. (`deploy-vps.yml` auto-deploys to prod on merge — keep that gated.)

## Run the proxy locally (test)

```bash
cd /Users/charlienode/cc-phase2-worktree
doppler run -p factorylm -c stg -- python3 mira-proxy/gen_allowlist.py > mira-proxy/conf.d/allowlist.conf
DOCKER_HOST=unix:///Users/charlienode/.colima/default/docker.sock \
  docker compose -f docker-compose.proxy.yml -f /tmp/proxy-localtest.yml up -d   # 127.0.0.1:8889
```

## To enable cloud reach in prod (later, gated)

1. Land the nginx diff into `deployment/nginx-app-factorylm.conf`, deploy via the gate.
2. Set Doppler `factorylm/prd`: `COMMAND_CENTER_CLOUD_PROXY=1`.
3. Run `mira-proxy` always-on on Charlie (Tailscale bind `100.70.49.126:8889`),
   allowlist generated from **prod** `display_endpoints`.
4. Apply migrations 030 + 031 to prod.
5. Verify: open Command Center on `app.factorylm.com` from off-LAN → green dot → click →
   live dashboard updates (WS). The "values move" check, not a screenshot.
