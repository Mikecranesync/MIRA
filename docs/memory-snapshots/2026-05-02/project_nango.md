---
name: Nango Integration Layer
description: Nango is MIRA's credential vault and auth proxy for CMMS/platform integrations. Self-hosted on VPS, free tier = auth+proxy only.
type: project
originSessionId: 8a49ad2f-bca7-4286-b4d9-0d6aea89f48b
---
Nango is deployed as `nango-server` in `docker-compose.saas.yml` alongside a dedicated `nango-db` (Postgres 16-alpine).

**Why:** Nango encrypts third-party API keys at rest and proxies authenticated requests so MIRA never stores raw credentials. Also handles OAuth2 consent flows for future connectors like Limble.

**Current state (PR #808):** Self-hosted free tier. MaintainX is the first connector (API_KEY auth, Bearer token). Sync/action scripts written in `nango-integrations/` but require Nango Cloud or Enterprise to run; free tier supports auth + proxy only.

**Key env vars (Doppler factorylm/prd):**
- `NANGO_ENCRYPTION_KEY` — AES key, generate with `openssl rand -base64 32`
- `NANGO_SECRET_KEY` — used by mira-hub to call Nango APIs
- `NANGO_DB_PASSWORD` — Postgres password for nango-db
- `NANGO_SERVER_URL` — internal Docker URL (http://nango-server:3003) + public URL for OAuth callbacks

**Files:**
- `nango-integrations/providers.yaml` — custom provider auth config (mounted into container)
- `nango-integrations/nango.yaml` — integration manifest (syncs, actions, models)
- `nango-integrations/maintainx/` — work-orders/assets/parts syncs + create-WO/get-asset actions
- `mira-hub/src/lib/nango.ts` — server-side client (proxyGet, proxyPost, createApiKeyConnection)
- `mira-hub/src/app/api/integrations/nango/connect/route.ts` — POST/DELETE/GET connections
- `mira-hub/src/app/api/integrations/nango/callback/route.ts` — OAuth callback (future connectors)

**How to apply:** When adding new CMMS connectors (Limble, UpKeep, Fiix), use Nango as the credential store. Add provider to providers.yaml, write sync/action scripts, add ConnectorCard to channels page.

**Upgrade path:** Point `NANGO_SERVER_URL` to Nango Cloud to activate sync/action scripts without code changes.
