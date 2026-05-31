# mira-proxy — Command Center on-prem display proxy (Charlie, cloud-reach phase)

Phase 2 of the Hub **Command Center** (goal prompt:
`~/.claude/plans/polymorphic-wandering-dahl.md`). Phase 1 framed the conveyor
dashboard by having the *local* Charlie Hub reach `mira-bridge:1880` directly. The
**cloud** Hub (`app.factorylm.com`, DO VPS) cannot reach plant-LAN HMIs
(`192.168.1.x`). This proxy is the bridge.

## The chain

```
remote browser
  → https://app.factorylm.com/api/command-center/display/{id}/…   (VPS nginx)
      ├─ auth_request → mira-hub  /api/command-center/display/{id}/authz
      │     (per-tenant RLS check: may THIS tenant watch THIS display? 200/403)
      └─ proxy_pass (HTTP + WS) → http://100.70.49.126:8889/display/{id}/…  (Charlie, over Tailscale)
            → mira-proxy resolves {id} against its ALLOWLIST → upstream LAN HMI
                → http://192.168.1.12:1880/dashboard/fault-detective/…      (Node-RED)
```

- **Hub owns per-tenant authz** (the `auth_request` subrequest). The proxy never
  decides *who* may watch — only *which hosts are reachable at all*.
- **Charlie proxy owns the SSRF allowlist.** It will ONLY ever forward to a
  `(host:port)` that appears in `display_endpoints`. An attacker who reaches the
  proxy cannot pivot to an arbitrary LAN address — unknown `{id}` → 404.
- **nginx does the transport** because it forwards WebSocket upgrades natively
  (`Upgrade`/`Connection`), which a Next.js route handler cannot. socket.io / WS is
  what makes the dashboard *live*; a non-WS proxy renders a frozen page. This is the
  make-or-break detail (goal prompt risks §).

## Read-only (hard constraint — `.claude/rules/fieldbus-readonly.md`)

`GET`/`HEAD` and WS upgrades only. `POST/PUT/PATCH/DELETE` → 405 at the proxy. The
proxy never forwards a control verb to a panel. (VNC view-only lands in Phase 3 with
input dropped server-side.)

## Allowlist generation

nginx can't query Postgres, so the allowlist is **generated** from
`display_endpoints` into an nginx `map` include (`conf.d/allowlist.conf`) by
`gen_allowlist.py`, then nginx is reloaded. Re-run on registry change (the Hub CRUD
route can trigger it; until then it's a manual/cron refresh). Each entry maps
`display_id → upstream host:port`; the request path is preserved so relative assets
and the socket path resolve unchanged.

## Run (Charlie)

```bash
# generate the allowlist from the staging/prod display_endpoints, then start
doppler run -p factorylm -c stg -- python mira-proxy/gen_allowlist.py > mira-proxy/conf.d/allowlist.conf
docker compose -f docker-compose.proxy.yml up -d --build
```

Bound to Charlie's Tailscale IP (`100.70.49.126`) only — never `0.0.0.0` on a public
iface. Mem-limited (≤64M) per the VPS/Charlie OOM history.

## Phase status

- **This commit:** proxy + allowlist generator + authz endpoint + CRUD, proven on the
  LOCAL path (one real proxy hop, WS liveness verified). The VPS nginx leg ships as a
  **reviewed diff** (`deployment/nginx-app-factorylm.phase2-command-center.conf.diff`),
  applied via the gated deploy — NOT live-edited. Full cloud verification waits on it.
