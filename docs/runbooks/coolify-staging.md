# Coolify Staging — Bring-Up Runbook

**Status:** Phase 0 — handoff ready, droplet not yet provisioned.
**Owner:** Mike. **Last updated:** 2026-05-19.

> **Goal:** Mike opens a URL on his phone, sees the garage namespace seeded in NeonDB `ep-polished-hall-ahcqtcxe-pooler`, and can preview PR branches before they hit production.
>
> **Non-goal (Phase 1):** running Slack/Telegram bots, ingest, sidecar, relay, or PLC services in staging. Those join later.

---

## Placement decision

| Option | Outcome | Why |
|---|---|---|
| Existing prod VPS (165.245.138.91) | ❌ Rejected | Coolify takes over Docker on the host. Resource and config collision with the 14 running prod containers. User constraint: "never touch production." |
| CHARLIE (100.70.49.126) | ❌ Infeasible | Coolify is Linux-only; macOS is unsupported. Install script assumes systemd. |
| Other cluster Linux nodes (factorylm-hetzner, srv1078052) | ❌ Stale | Offline 13–53 days on Tailscale. Treat as gone. |
| **New DigitalOcean droplet** | ✅ Chosen | Clean separation, ~$12/mo, same DO account as prod for billing simplicity. `DO_API_KEY` already in Doppler `factorylm/dev`. |

**Cheaper alternative:** Hetzner CPX11 (~€4.50/mo) — `HETZNER_API_KET` is in Doppler. Same shape. Pick whichever Mike prefers for billing; runbook below assumes DO.

---

## Mike's actions (blocking)

You need to do these. I cannot do them without spending money on your account or making decisions that affect billing.

### 1. Create a Coolify droplet

**Option A — DigitalOcean Marketplace (3 minutes, recommended):**

1. https://marketplace.digitalocean.com/apps/coolify → "Create Coolify Droplet"
2. **Region:** NYC3 or SFO3 (or whatever's closest to your phone)
3. **Size:** Regular SSD, **2 GB / 2 vCPU / 60 GB** ($12/mo). Coolify's minimum is 2 GB; the 5-service Phase 1 subset fits.
4. **Authentication:** Add your SSH key. Add CHARLIE's pubkey too (`cat ~/.ssh/id_ed25519.pub` on CHARLIE) so I can deploy from here later.
5. **Hostname:** `factorylm-staging`
6. **Backups:** ✅ on (weekly, $2.40/mo extra — cheap insurance)
7. **Firewall:** create a new firewall, allow inbound 22 (your IP only), 80, 443, and 8000 from your IP only (Coolify admin).

Wait until status = "Active" and you can SSH in: `ssh root@<DROPLET_IP>`.

**Option B — Hetzner CPX11 (€4.50/mo, you self-install Coolify):**

1. Create CPX11 in Hetzner Cloud (Ubuntu 24.04 LTS)
2. SSH in: `ssh root@<IP>`
3. Run: `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash`
4. Lock down the firewall the same way as Option A.

### 2. Reserve a subdomain

Pick one and add an A record pointing to the droplet IP:

- `staging.factorylm.com` → `<DROPLET_IP>` (recommended)
- or `coolify.factorylm.com` if you want to keep `staging.*` for the deployed apps and route admin separately

Add a wildcard `*.staging.factorylm.com` → `<DROPLET_IP>` too, so per-PR previews can use `pr-123.staging.factorylm.com` automatically.

### 3. Give me the IP + admin password

After Coolify boots, it writes the first-login password to `/data/coolify/source/.env` on the droplet (or you set it via the web UI on first visit at `http://<IP>:8000`).

Tell me:
- Droplet IP
- Admin URL + initial password (or invite me as admin user)
- Subdomain you reserved

Then I take it from here.

---

## What I'll do after Mike hands off

(This section is the post-droplet checklist — left here so future-me / future-Claude has a clear plan.)

### 1. Lock down Coolify admin

Default `:8000` admin is a juicy target. After first login:

- Enable HTTPS via Coolify's built-in Let's Encrypt: set `COOLIFY_FQDN=staging.factorylm.com` (or `coolify.staging.factorylm.com`)
- Restrict admin source IPs via DO Firewall (already done in step 1.7)
- **Better:** install Tailscale on the droplet (`curl -fsSL https://tailscale.com/install.sh | sh && tailscale up`) and bind Coolify admin to the tailnet only. Mike accesses via phone Tailscale app.
- Rotate the initial root password to a Doppler-stored value (add `COOLIFY_ROOT_PW` to `factorylm/stg`).
- Enable 2FA on the admin account.

### 2. Wire Doppler `factorylm/stg`

Mint a Doppler service token scoped to `stg`:

```bash
doppler service-tokens create --project factorylm --config stg --name coolify-staging --plain
```

In Coolify → Project Environment Variables, paste each `factorylm/stg` secret. **Do not** hand-copy `prd` secrets.

Critical mappings:

| Env var | Source | Notes |
|---|---|---|
| `NEON_DATABASE_URL` | `factorylm/stg` | `ep-polished-hall-ahcqtcxe-pooler` — confirmed staging branch |
| `AUTH_SECRET` | mint fresh (don't reuse prod) | `openssl rand -hex 32` |
| `NEXTAUTH_URL` | `https://staging.factorylm.com/api/auth` | Phase 2 path shape |
| `NEXT_PUBLIC_APP_URL` | `https://staging.factorylm.com` | Baked into Hub bundle at build time |
| `NEXT_PUBLIC_PIPELINE_API_URL` | `https://staging.factorylm.com` | nginx routes `/v1/` to mira-pipeline |
| `HUB_AUTH_GOOGLE_CLIENT_ID/SECRET` | mint a new Google OAuth client | Add `https://staging.factorylm.com/api/auth/callback/google` to authorized redirect URIs |
| `MCP_REST_API_KEY` | mint fresh | Don't reuse prod |
| `STRIPE_*` | Stripe **test mode** keys, not prod | `factorylm/stg` should already have test keys |

### 3. Phase 1 service surface

Point Coolify at `Mikecranesync/MIRA`, branch `main`, compose path `coolify/docker-compose.staging.yml` (see that file — it's a curated subset that pulls service definitions from existing module composes via `include:`, so it stays in sync with prod).

Phase 1 services: **mira-hub, mira-pipeline, mira-mcp, mira-web, atlas-api, atlas-db**.

**Explicitly excluded** from Phase 1:

| Service | Reason |
|---|---|
| `mira-bot-slack` | `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` in `factorylm/stg` are **identical to `factorylm/prd`**. Running staging bot would dual-poll the same Slack workspace and race with prod. Either rotate stg to a separate Slack app or keep bots out of staging. |
| `mira-bot-telegram` | Telegram token differs between stg and prd (good), but bots also need Doppler-injected runtime — defer until Hub-only preview is green. |
| `mira-sidecar` | Sunset pending (see `docs/known-issues.md`). Don't drag it forward. |
| `mira-ingest` / `mira-docling` | Heavy; not needed for Hub read-only preview. |
| `mira-relay` | Customer-facing factory→cloud streaming. Out of staging scope. |
| `mira-cmms-sync` | Writes to NeonDB. Should run against stg branch only after Hub preview validates. Add in Phase 2. |
| `nango-server` / `nango-db` | Integration layer; defer to Phase 2. |

### 4. Verify staging works

```bash
# From CHARLIE
curl -sf https://staging.factorylm.com/api/health
curl -sf https://staging.factorylm.com/hub/api/health

# Hub should serve the garage namespace
curl -sf https://staging.factorylm.com/api/namespace/proposals?tenant=mike | jq .
```

Then from Mike's phone: `https://staging.factorylm.com/hub` should show the garage equipment from the seed.

### 5. Per-PR preview deploys

In Coolify → Project → Settings → Preview Deployments:

- Toggle **Enable Preview Deployments** on
- Pattern: `pr-{number}.staging.factorylm.com`
- All PR previews share the same NeonDB `stg` branch (Phase 1). Per-PR Neon branching is a separate project — don't try to wire it now.
- GitHub webhook: Coolify generates it; add to `Mikecranesync/MIRA` repo settings → Webhooks.

**Phase 2 future work:** per-PR Neon branches via Neon API (`NEON_API_KEY` already in Doppler) — wire a GitHub Action that calls `POST /projects/{id}/branches` on PR open, sets `NEON_DATABASE_URL` per preview, deletes branch on PR close.

---

## What I prepared on this branch

| Path | Purpose |
|---|---|
| `coolify/docker-compose.staging.yml` | Curated Phase 1 subset compose, pulls service defs from existing module composes via `include:`. |
| `coolify/README.md` | Coolify-specific bring-up notes and security checklist (admin lockdown, secret minting). |
| `docs/runbooks/coolify-staging.md` | This file. |

I did **not** write `docs/evaluations/paas-deployment-evaluation-2026-05-18.md` — the file you cited isn't in this worktree. Either it lives on a branch I don't have or the cite was aspirational. The placement analysis above stands on its own merits; if the missing eval contradicts it, surface that and I'll revise.

---

## Hard rules

- **Never deploy services to staging that share secrets with prod.** Slack tokens are the live example.
- **Never expose Coolify admin :8000 to the public internet.** Tailscale or firewalled to Mike's IPs only.
- **All staging secrets via Doppler `factorylm/stg`.** Never hand-paste prod values.
- **NeonDB writes are namespace-isolated** (`tenant=mike-staging` or similar) — don't reuse the prod tenant scope.
- **Smoke test after every Coolify deploy:** the same `install/smoke_test.sh` works if you set `BASE_URL=https://staging.factorylm.com`.
