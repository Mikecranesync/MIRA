## Why

The cowork branches introduce 13+ new env vars used by the auth, encryption, and SSO surfaces. None are in Doppler `factorylm/prd` yet. Once the auth-sweep PR lands and `getKEK()` / `verifySession()` / etc. start running for real, every parity feature crashes on first request.

This issue tracks a SINGLE Doppler operation that provisions every var across all environments (dev, stg, prd) and documents the rotation policy for each.

## Source

- `docs/competitors/cowork-gap-report-2026-04-25.md` §3.3
- `docs/competitors/pre-merge-review-2026-04-25.md` per-branch findings
- `docs/competitors/fixes/01-574-llm-keys-rotation.md` (LLM_KEK rotation procedure)

## Acceptance criteria

### Encryption keys (32-byte hex; generate via `openssl rand -hex 32`)

- [ ] `LLM_KEK` — encrypts customer LLM API keys. **CRITICAL: rotate via the script in `mira-hub/scripts/rotate-llm-kek.mjs`, not by simply replacing.**
- [ ] `WEBHOOK_KEK` — encrypts webhook endpoint secrets at rest.
- [ ] `CRON_SECRET` — Bearer token for `/api/v1/webhooks/cron` and `/api/v1/pms/spawn-due`. Verified with `crypto.timingSafeEqual` per fix #5.

### Multi-tenancy + JWT

- [ ] `TENANT_JWT_SECRET` — minimum 32 chars, HS256. Rotation: yearly. Old/new dual-acceptance window not implemented yet (track as v2).
- [ ] `MIRA_PRIMARY_DOMAIN` — `factorylm.com` in prd; `factorylm-stg.com` in stg; `localhost` in dev.
- [ ] `MIRA_INTERNAL_SECRET` — middleware → internal API shared secret. Rotation independent of tenant secret.
- [ ] `MIRA_STRICT_SUBDOMAIN` — `1` in prd (404 unknown subdomains), `0` in dev (allow whatever).
- [ ] `SUPER_ADMIN_USER_IDS` — comma-separated UUIDs for the `POST /api/v1/tenants` create-org endpoint. Empty in dev; populated only in prd.

### SSO (#579)

- [ ] `SAML_SP_PRIVATE_KEY` — RSA 2048 PEM. Generated once, never rotated without the cert-rotation cron (deferred).
- [ ] `SAML_SP_CERT` — matching X.509 PEM. Embedded in metadata served at `/api/v1/auth/sso/saml/{tenant}/metadata`.
- [ ] `SAML_REPLAY_CACHE_TTL_SEC` — default 300. Tunable per environment if you observe legitimate replays under load.
- [ ] `OIDC_CALLBACK_BASE_URL` — stable absolute URL (e.g. `https://api.factorylm.com`). **DO NOT CHANGE post-launch** — every customer's IdP config has this baked in.
- [ ] `SSO_PGCRYPTO_KEY_REF` — Doppler key NAME (not value) used by `pgcrypto.pgp_sym_encrypt` for `oidc_client_secret_enc`. The actual key lives at the named secret, indirected for rotation.

### Verification

- [ ] All vars present in Doppler `factorylm/prd` AND `stg` AND `dev` (different values per env).
- [ ] `doppler run -p factorylm -c prd -- env | grep -E "LLM_KEK|WEBHOOK_KEK|CRON_SECRET|TENANT_JWT_SECRET|MIRA_|SAML_|OIDC_|SSO_"` returns 13 lines.
- [ ] `mira-hub/.env.template` updated with placeholder lines per var (NEVER real values).
- [ ] `docs/env-vars.md` table updated; rotation cadence per var documented.
- [ ] Local-dev `.env.example` works: `cp .env.example .env && npm run dev` boots without errors.

## Dependency order

- Independent of all branches — this work happens in Doppler, not git.
- Land BEFORE rolling the auth-sweep into prod. Until vars are present, routes fail closed (their `if (!process.env.X)` checks return 503).
- The `LLM_KEK` rotation table in `llm_kek_versions` ships with #574; the env-var registry in `mira-hub/src/lib/llm-keys.ts` `KEK_REGISTRY` must stay in sync with what Doppler holds.

## Out of scope

- Per-tenant secrets (BYO-LLM keys, IdP credentials) — those go in the DB encrypted with the KEKs above, not in Doppler.
- The cert-rotation cron for SAML — deferred per #579 AGENT_NOTES.
