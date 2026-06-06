# RESUME — Command Center cloud-reach (Phase 2) gated deploy

**Last worked:** 2026-05-31. **Goal:** light up cloud reach so the Command Center on
`app.factorylm.com` shows live plant HMIs (green dot + click-to-watch) for remote users.

## SEE IT LIVE NOW (on CHARLIE, dev DB — verified working)
Open **http://127.0.0.1:3991/** on CHARLIE → logs in → click Conveyor 1 (green dot) →
live Fault Detective dashboard frames with moving values. Uses the DEV DB (tenant
`e88bd0e8…`, display host `192.168.1.12:1880` = reachable). Verified liveCount=1 + a live
WS frame through. These are TEMP servers (die on reboot): `:3990` hub (cc-view-worktree,
`-c dev`, CSP_FRAME_SRC_DISPLAY_HOSTS=http://192.168.1.12:1880), `:3991` cookie-entry
(`/tmp/cc_dev_entry.py`, token `/tmp/cc_dev_token.txt`). Restart: re-run those.
⚠️ Do NOT use the staging `:3970/:3971` view — staging's row is `host=mira-bridge`
(Docker-only name) → gray dot + blank frame from a standalone server.
Cloud (`app.factorylm.com`) is NOT live yet — that's the deploy below.

## TL;DR state
- **Code: DONE + verified** (staging/local). Phase 1 = PR **#1593** (`feat/hub-command-center` → main).
  Phase 2 = PR **#1603** (`feat/hub-command-center-phase2` → `feat/hub-command-center`, stacked).
  Both OPEN, pushed, in sync. Nothing uncommitted.
- **Prod migrations 030+031: APPLIED** (display_endpoints table + DELETE grant live on prod
  NeonDB, via apply-migrations.yml on the phase2 ref, dry-run→apply, verified CREATE TABLE/INDEX/POLICY).
- **Everything else: NOT done.** No merges. No code deployed. Cloud mode off. Proxy not running.
- **Active blocker:** the on-prem proxy can't bind to Charlie's Tailscale IP under Colima
  (NAT'd VM → "cannot assign requested address"). Needs a bind decision (see below).

## The chain (where we are) — see PHASE2-HANDOFF.md for full detail
1. ✅ db-inspect prod — prod has 612 kg_entities, tenant `78917b56-f85f-43bb-9a08-1bb98a6cd6c3`,
   uns_path gist-indexed, live_signal_cache present. `display_endpoints` did NOT exist (now does).
2. ✅ migrations 030+031 → prod (DONE this session).
3. ⏸️ **NEXT: resolve the proxy-bind blocker**, then prove the tailnet hop (the residual risk —
   advisor says do this BEFORE the merges, while rollback is free).
4. ⏸️ merge #1593 → main (auto-deploys Phase 1 to prod via Smoke Test→deploy-vps; Smoke is GREEN
   on 9ce1d735; mergeStateStatus=UNSTABLE = allowed, 2 reds are pre-existing/non-required:
   apply-and-verify [tag_entities/wiring gap, fails on main+siblings] + staging-gate [fails on main too]).
5. ⏸️ retarget #1603 base→main, merge.
6. ⏸️ Doppler `factorylm/prd`: `COMMAND_CENTER_CLOUD_PROXY=1` +
   `COMMAND_CENTER_PROXY_BASE=http://100.70.49.126:8889`. **MUST set before the code deploy OR
   restart mira-hub after** — a Doppler change alone doesn't redeploy → else prod runs local-mode
   (raw-LAN probe → gray dot = the showstopper we fixed, reintroduced by ordering).
7. ⏸️ seed a prod display_endpoints row for tenant `78917b56` at an existing uns_path (Manage UI or apply-seeds).
8. ⏸️ mira-proxy always-on on Charlie (bind decision below), prod allowlist generated ON THE BOX
   (NOT from a code session — prod-guard blocks prod-NeonDB queries from here; gen_allowlist.py with -c prd was correctly denied).
9. ⏸️ nginx leg: fold `deployment/nginx-app-factorylm.phase2-command-center.conf.diff` (incl. the
   REQUIRED `map $http_upgrade $connection_upgrade` — prod lacks it; nginx -t proved this) into
   `deployment/nginx-app-factorylm.conf`, deploy via `deploy-nginx-staging-passthrough.yml`
   (gated SCP+reload; despite the name it deploys the whole app nginx conf). Fold the healthz
   hop-curl into its ssh step too.
10. ⏸️ **GO/NO-GO: verify off-LAN** — open Command Center on app.factorylm.com from a non-LAN
    network → green dot → click → **values move** (WS). Also confirm response CSP frame-src has 'self'.

## The proxy-bind blocker (decision pending — Mike)
`docker-compose.proxy.yml` binds `100.70.49.126:8889:8889`. Under Colima that FAILS (VM can't
see the host tailscale interface). The existing Node-RED uses bind-all `1880:1880` and is already
reachable on `100.70.49.126:1880`. Options (documented inline in the compose):
- **(a) match Node-RED: `"8889:8889"`** — same posture as what's already on the node (Mike leaned toward "explain simply"; this is the pragmatic precedent-matching choice).
- **(b) keep `127.0.0.1` + `tailscale serve`** in front — tailnet-only, more moving parts.
Mike has NOT finalized; classifier (correctly) blocked me from changing the bind or binding 0.0.0.0 unilaterally.

## Things I (the agent) CANNOT do from a code session (need Mike or gated workflow)
- Query prod NeonDB directly (prod-guard) — prod allowlist gen happens on the box / via gated tooling.
- SSH to prod / reload prod nginx directly — use the gated workflows.
- The one manual check Mike runs when we get there:
  `! ssh prod curl -sS -m5 http://100.70.49.126:8889/healthz`  (confirms the tailnet hop).

## Key facts to not re-derive
- Prod app connects as `neondb_owner` (rolbypassrls=t) → RLS bypassed for owner, but every CC
  route also filters `tenant_id = $1` explicitly, so isolation holds. `factorylm_app` role may be
  absent on prod → the GRANTs are no-ops there (owner already has all privs incl. DELETE).
- Prod tenant for the demo namespace: `78917b56-f85f-43bb-9a08-1bb98a6cd6c3`.
- Worktrees: `cc-phase2-worktree` (this, Phase 2 build), `cc-view-worktree` (Phase-1 staging view).
- Live HMI to frame: Node-RED fault-detective at `192.168.1.12:1880/dashboard/fault-detective` (FlowFuse SPA, socket.io over WS — needs the WS-forwarding proxy, proven `LIVE_WS_THROUGH_PROXY=yes`).
