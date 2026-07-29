# Make Staging Usable — HTTPS Subdomain + Doctrine Fix

**Date:** 2026-06-15
**Owner:** Mike + Claude
**Goal:** Give the already-running staging stack a real, padlocked web address so a human (and CI e2e) can log in and test changes — starting with the #1901 onboarding upload→ask gate — before they reach production.

## Background — what's actually true (verified 2026-06-15, read-only VPS inspection)

The staging stack is **already deployed and healthy**, contradicting `docs/environments.md` (which still lists it as unbuilt "Gap-1/Gap-3").

- Compose project `mira-staging`, from `/opt/mira-staging/docker-compose.staging-vps.yml`, up 35h, all healthy.
- Containers + host ports: `stg-mira-hub` 4101, `stg-mira-pipeline` 4099, `stg-mira-web` 4200, `stg-mira-mcp` 4000/4001, `stg-atlas-api` 4088, `stg-atlas-frontend` 4100, `stg-atlas-db` 4433, `stg-atlas-minio` 4900/4901, `stg-mira-bot-telegram` (no port).
- **DB isolation correct:** staging points at the Neon **staging branch** endpoint `ep-polished-hall-ahcqtcxe-pooler` (branch `br-small-term-ahtkz61d`), NOT prod (`br-lively-bread-ahoa86se`).
- **Bot isolation correct:** staging telegram bot uses `TELEGRAM_BOT_TOKEN_STG` → `@Mira_stagong_bot` (sic), separate from prod `@FactoryLM_Diagnose`.
- Deploy mechanism exists: `.github/workflows/deploy-staging.yml` (push to `staging`/`release/*`, or manual dispatch). Staging lives in `/opt/mira-staging` (separate working copy from prod `/opt/mira`).
- Firewall (`ufw`) currently **ALLOWs public** 4099/4100/4101/4200/4088/4000/4001.
- An existing side-door is live: nginx `location /__staging/` on the prod 443 listener (from `deploy-nginx-staging-passthrough.yml`).

### The actual blocker (why testing never worked)

The staging hub's auth is configured to a **Tailscale IP over plain http**:
- `NEXTAUTH_URL=http://100.68.120.99:4101/api/auth`
- `NEXTAUTH_URL_INTERNAL=http://165.245.138.91:4101/api/auth`

So any browser hitting staging (raw `:4101` → 308 redirect, or `/__staging/` → 307) gets bounced to that Tailscale http URL. Google OAuth refuses redirects to a bare-IP/non-HTTPS URI, and NextAuth secure-cookie/session handling is unreliable over http. Result: you can *reach* staging but can't *log in* → can't test. This plan fixes exactly that.

## Decision (2026-06-15)

Give staging a real subdomain with TLS. Chosen approach over Tailscale-only / side-door fix because it mirrors production, supports Google login, and works from any browser or CI runner.

**Subdomain:** `stg.factorylm.com` → staging hub at `localhost:4101` (staging hub runs at root, no `/hub` basePath — confirmed by its `NEXTAUTH_URL` having no `/hub`).

## Plan

### Phase 1 — DNS + TLS (front door)

1. **[Mike] DNS:** add an A record `stg.factorylm.com → 165.245.138.91` (same provider as the other factorylm.com records). TTL 300 while setting up.
2. **[Claude, repo] nginx vhost:** add `deployment/nginx-stg-factorylm.conf` — `server_name stg.factorylm.com`, `proxy_pass http://127.0.0.1:4101`, standard proxy headers, `X-Forwarded-Proto https`, websocket upgrade. (Model it on `deployment/nginx-app-factorylm.conf`.)
3. **[Claude, repo] deploy workflow:** add `.github/workflows/deploy-nginx-stg.yml` (mirror `deploy-nginx-staging-passthrough.yml`): scp the vhost to `/etc/nginx/sites-available/stg-factorylm`, symlink into `sites-enabled`, `nginx -t`, reload. (Runs under the `production` GH environment — it touches the prod nginx box. Human-dispatched.)
4. **[Mike, one-time] TLS cert:** on the VPS, `certbot --nginx -d stg.factorylm.com` (or the repo's existing cert flow). Requires the A record live + port 80 reachable (it is).

### Phase 2 — Hub auth points at the subdomain

5. **[Mike, Doppler `factorylm/stg`]** set:
   - `NEXTAUTH_URL=https://stg.factorylm.com/api/auth`
   - `NEXTAUTH_URL_INTERNAL=https://stg.factorylm.com/api/auth` (or keep the internal `:4101` form — either works once TLS terminates at nginx; prefer the https subdomain for consistency)
   - confirm `AUTH_SECRET` / `HUB_AUTH_GOOGLE_CLIENT_ID` / `HUB_AUTH_GOOGLE_CLIENT_SECRET` are populated for stg.
6. **[Mike, Google Cloud console]** on the OAuth client staging uses, add authorized redirect URI:
   `https://stg.factorylm.com/api/auth/callback/google` (and JS origin `https://stg.factorylm.com`).
7. **[Mike / CI] redeploy staging hub:** run `deploy-staging.yml` (services: `stg-mira-hub`) so the new Doppler values bake in. (`NEXT_PUBLIC_*` values are build-time — confirm the staging build passes the right public URL; if the hub bakes a public base URL at build, it must be set as a build ARG, per the known `NEXT_PUBLIC_*` baked-at-build gotcha.)

### Phase 3 — Hardening + doctrine

8. **[Mike, optional] firewall:** once the subdomain proxies work, restrict the raw 4xxx ports to Tailscale-only (drop the public ufw ALLOWs for 4099/4100/4101/4200/4088/4000/4001) so staging isn't also exposed raw + unencrypted. Keep 80/443 public.
9. **[Claude, repo] fix the stale doctrine:** rewrite `docs/environments.md` — mark Gap-1 (compose) and Gap-3 (staging bot) **closed**, document the real ports, the `stg.factorylm.com` URL, the `@Mira_stagong_bot` token, and the `deploy-staging.yml` path. Update the `CLAUDE.md` / `.claude/CLAUDE.md` Environments tables to match.
10. **[Claude, repo] reconcile compose files:** `docker-compose.staging.yml` (4 KB, local-dev) vs `docker-compose.staging-vps.yml` (19 KB, the deployed one). Add a header to each stating its role, or fold; the running one on the VPS is `staging-vps.yml` — make that unambiguous.

### Phase 4 — Prove it (the payoff)

11. Browse `https://stg.factorylm.com`, sign in (Google or password), confirm the hub loads.
12. Run the **#1901 gate on staging**: deploy `feat/onboarding-upload-ask-1901` to staging (`deploy-staging.yml`), then run `tests/e2e/onboarding-upload-ask-1901.spec.ts` against `https://stg.factorylm.com` + capture desktop/mobile screenshots → `docs/promo-screenshots/`. This is the durable proof the beta gate works end-to-end.

## Owner split

- **Claude (repo, no prod mutation):** nginx vhost file, deploy-nginx-stg workflow, environments.md rewrite, compose-file reconciliation, the e2e run config. All on a branch + PR.
- **Mike (the steps that need credentials / external consoles / prod apply):** DNS A record, certbot, Doppler `factorylm/stg` values, Google OAuth redirect URI, running the deploy workflows, optional firewall tightening.

## Open question for Mike

- Subdomain name: `stg.factorylm.com` (this plan) vs `staging.app.factorylm.com` vs other. Pick before the DNS + nginx + OAuth steps (they all hardcode it).
