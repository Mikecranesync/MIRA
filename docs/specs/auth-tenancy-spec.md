# Auth & Tenancy Specification
**Version:** 1.0
**Last Updated:** 2026-05-05
**Owner:** Mike Harper / FactoryLM

## Purpose
Single specification for **how a request becomes a tenant-scoped session** across MIRA's surfaces. Defines the magic-link flow, Google OAuth, trial gate, admin bypass, and the JWT/cookie shape consumed by `mira-web` (PLG) and `mira-hub` (authenticated workspace). All NeonDB queries depend on this spec setting `MIRA_TENANT_ID` correctly.

## Scope
**IN scope**
- Magic-link sign-in (Resend email → click → cookie set)
- Google OAuth sign-in (mira-hub)
- Admin bypass (`PLG_ADMIN_TOKEN` for support staff in mira-web)
- Trial / activation gate (tier `pending` vs `active`)
- JWT shape and signing
- Tenant resolution at the request boundary (`mira-mcp/tenant_resolver.py`, mira-hub middleware, mira-web auth)
- HMAC for inbound webhooks (Stripe, Apps Script magic inbox, monday.com)

**OUT of scope**
- Atlas CMMS authentication (lives inside Atlas; surfaced through `mira-mcp` only)
- API-key auth between internal services (covered in each service's spec)

## Architecture

```
Marketing site (mira-web)
   ├── /api/register         → tenant: pending
   ├── Magic-link email (Resend)
   ├── Stripe webhook → tier: active → finalizeActivation
   └── /api/me cookie  → tier check

Hub (mira-hub)
   ├── auth.ts (jose) + middleware.ts → JWT cookie verify
   ├── magic-link OR Google OAuth     → JWT cookie set
   └── per-request: load tenant + role → set in handler context
```

Both services issue HS256 JWTs with **separate secrets**: `PLG_JWT_SECRET` (mira-web) and `HUB_JWT_SECRET` (mira-hub). Cross-service trust is via shared NeonDB `tenants` table; never share secrets across services.

## API Contract

### JWT shape (canonical)
```json
{
  "sub": "<tenant_id>",
  "email": "<user-email>",
  "role": "owner" | "admin" | "tech" | "support_bypass",
  "tier": "pending" | "active" | "churned",
  "iat": <unix>,
  "exp": <unix>
}
```
- `role: support_bypass` is **only** issued when an `x-admin-token` request matches `PLG_ADMIN_TOKEN`. Bypass tokens never grant write access on customer data; they list and read only.
- `tier` is duplicated from `tenants.tier` for cheap gating; the source of truth remains the DB.

### Cookie
- Name: `mira_session` (mira-web), `hub_session` (mira-hub)
- Flags: `Secure; HttpOnly; SameSite=Lax; Path=/`
- TTL: 7 days; refresh sliding 24 h

### Magic-link
- One-time signed link `https://<host>/auth/magic?t=<jwt-with-jti>`. `jti` is single-use; consumed in NeonDB `magic_links_used`.
- Tokens expire in 30 min.

### Google OAuth (mira-hub only)
- Standard OAuth Authorization Code flow with PKCE. `state` parameter mandatory.
- Email is matched against `tenants.email`; new emails create `pending` tenant unless invite exists.

### Trial / activation gate
- mira-web: `pending` tenants reach `/api/me` with limited fields and a Stripe Checkout CTA.
- mira-hub: `pending` tenants are redirected to `/upgrade` for any `(hub)/*` route except `/upgrade`.

### HMAC inbound webhooks
| Webhook | Header | Secret env |
|---|---|---|
| Stripe | `Stripe-Signature` | `STRIPE_WEBHOOK_SECRET` |
| Magic inbox (Apps Script) | `X-Inbox-Signature` | `INBOUND_HMAC_SECRET` |
| monday.com (scan) | `X-Monday-Signature` | `MONDAY_APP_SIGNING_SECRET` |

All three reject mismatched signatures with HTTP 401 and write **no DB rows** before verification.

## Configuration
| Var | Used by | Purpose |
|---|---|---|
| `PLG_JWT_SECRET` | mira-web | Sign/verify mira-web JWTs |
| `HUB_JWT_SECRET` | mira-hub | Sign/verify hub JWTs |
| `RESEND_API_KEY` | both | Magic-link email |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | mira-hub | Google sign-in |
| `PLG_ADMIN_TOKEN` | mira-web | Admin-bypass for `/api/admin/*` |
| `ADMIN_BYPASS_TOKEN` | mira-hub | Admin support read access |
| `STRIPE_WEBHOOK_SECRET` | mira-web | Stripe webhook signature |
| `INBOUND_HMAC_SECRET` | mira-web | Magic-inbox webhook signature |
| `MONDAY_APP_SIGNING_SECRET` | mira-web | monday.com scan webhook |

## Quality Standards
| Metric | Current | Target |
|---|---|---|
| Magic-link expiry | 30 min | maintain |
| Cross-tenant request rejection | required | covered by RLS regression in NeonDB-using services |
| Webhook signature failure → 401 | required | regression-tested per webhook |
| JWT token leakage in logs | 0 | log scrubbing test |
| Admin bypass write blocked | required | covered by mira-web `/api/admin/*` tests |

## Acceptance Criteria
1. **Magic-link single-use:** A second click on the same magic-link URL returns HTTP 410.
2. **Magic-link JWT fix (CRA-22 / CRA-21):** A magic-link click sets a usable session cookie and lands the user on the right surface (mira-web pending → activation, mira-hub active → workspace).
3. **Stripe sig:** A POST to `/api/stripe/webhook` with a tampered signature returns HTTP 400 and writes nothing.
4. **Tenant scoping:** Every NeonDB call after auth sets `app.current_tenant_id`; any RLS table query without it returns zero rows.
5. **Admin bypass read-only:** A request with `x-admin-token: $PLG_ADMIN_TOKEN` to a write endpoint returns HTTP 403; to a list endpoint returns HTTP 200.
6. **Tier gate:** A `pending` tenant calling `mira-hub` `/api/workorders` is redirected to `/upgrade`.
7. **monday.com HMAC:** A scan event with a wrong HMAC returns 401 (CRA-related: `mira-scan-spec.md`).
8. **No secrets in URL params:** Tokens, API keys, and webhook signatures never appear as query strings.
9. **Doppler-only secrets:** No real values for any secret listed above appear in `git ls-files`.

## Known Issues
- Two JWT secrets (`PLG_JWT_SECRET`, `HUB_JWT_SECRET`) — intentional, but a unified identity service (e.g. WorkOS) is on the long-term roadmap.
- Admin bypass is read-only by design; any write requires a real session.

## Change Log
- 2026-05-04 — Magic-link JWT fix landed (CRA-22, CRA-21).
- 2026-04-26 — `/api/admin/activation-health` introduced for support staff (admin-bypass surface).
