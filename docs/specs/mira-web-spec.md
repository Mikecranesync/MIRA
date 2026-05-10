# mira-web Specification
**Version:** 1.0
**Last Updated:** 2026-05-05
**Owner:** Mike Harper / FactoryLM

## Purpose
Public marketing site + **PLG onboarding funnel** for FactoryLM. Visitor → "Join the Beta" → email/name/company → tenant created `pending` → 7-day Loom nurture → Stripe Checkout $97/mo → tenant flipped to `active` → Atlas CMMS account provisioned → unlimited Mira AI chat. Hosts the public `/cmms` landing, `/sample`, `/activated`, the magic-inbox PDF intake, and the embedded Mira AI chat for evaluation prospects.

No free tier. Pricing is hidden until Day 7 email.

## Scope
**IN scope**
- Public marketing routes (`/`, `/cmms`, `/sample`, `/activated`, etc.)
- PLG funnel API: `/api/register`, `/api/checkout`, `/api/stripe/webhook`, `/api/billing-portal`, `/api/me`, `/api/activation/retry`, `/api/admin/activation-health`, `/api/mira/chat`
- Activation orchestration: `lib/activation.ts` (Atlas user provisioning, demo seeding, welcome email, retry budget)
- Magic-inbox handoff (`Apps Script` → HMAC-signed webhook → `mira-ingest`)
- PostHog client analytics (when `PLG_POSTHOG_KEY` set)

**OUT of scope**
- Authenticated workspace (lives in `mira-hub`)
- Diagnostic engine (proxied to `mira-pipeline`/`mira-sidecar`)

## Architecture
- **Layer:** Presentation
- **Container:** `mira-web` (`3200 → 3000`)
- **Networks:** `core-net`, `cmms-net`
- **Stack:** Bun runtime, Hono (TypeScript, MIT), `jose` JWT, Stripe SDK, `@neondatabase/serverless`, Resend HTTP, Atlas REST API
- **Source of truth for tenant tier:** `tenants` table in NeonDB (`pending` | `active` | `churned`)

```
Visitor ──▶ mira-web (Hono on Bun)
              ├─ POST /api/register      → NeonDB tenants(pending) + Resend nurture
              ├─ POST /api/stripe/webhook → finalizeActivation(tenant)
              │                             ├── Atlas user create
              │                             ├── demo asset/WO seed
              │                             └── welcome email (Resend)
              ├─ GET  /api/me            → quota + provisioning state
              └─ POST /api/mira/chat     → mira-sidecar /rag (cutover to mira-pipeline pending #197)
```

## API Contract
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/register` | none | Create `pending` tenant; idempotent on email; origin allowlist `PLG_REGISTER_ALLOWED_ORIGINS` |
| GET | `/api/checkout` | none (token in URL) | Redirect to Stripe Checkout for the listed `STRIPE_PRICE_ID` |
| POST | `/api/stripe/webhook` | Stripe sig | Verify `STRIPE_WEBHOOK_SECRET`; on `checkout.session.completed` call `finalizeActivation` |
| GET | `/api/billing-portal` | JWT | Return Stripe Customer Portal URL |
| GET | `/api/me` | JWT (active) | Returns `{tier, quota, provisioning: {atlas, demo, email, attempts, ready}}` |
| POST | `/api/activation/retry` | JWT (active) | Re-run `finalizeActivation`; 1 / minute cooldown |
| GET | `/api/admin/activation-health` | `x-admin-token: $PLG_ADMIN_TOKEN` | Tenants stuck > 10 min in non-`ok` provisioning |
| POST | `/api/mira/chat` | JWT (active) | Proxy to mira-sidecar `/rag` (or pipeline once #197 lands) |
| POST | `/api/inbox/webhook` | HMAC `INBOUND_HMAC_SECRET` | Magic-inbox PDF handoff to `mira-ingest` |

### Tenant tier contract
| Tier | Effect |
|---|---|
| `pending` | In nurture sequence, no product access, no `/api/me` quota |
| `active` | Full CMMS + unlimited Mira queries; portal access |
| `churned` | No product access; emails suppressed |

## Configuration
| Var | Required | Purpose |
|---|---|---|
| `PLG_JWT_SECRET` | yes | Sign/verify mira-web JWTs |
| `STRIPE_SECRET_KEY` | yes | Stripe API |
| `STRIPE_WEBHOOK_SECRET` | yes | `whsec_...` for webhook verification |
| `STRIPE_PRICE_ID` | yes | $97/mo price id |
| `NEON_DATABASE_URL` | yes | Tenancy DB |
| `RESEND_API_KEY` | yes | Transactional + drip email |
| `LOOM_URL_1..5` | yes | Drip videos (env-swap, no redeploy) |
| `PLG_ATLAS_ADMIN_USER` / `PLG_ATLAS_ADMIN_PASSWORD` | yes | Atlas admin to provision new users |
| `PLG_ADMIN_TOKEN` | yes | Bearer for `/api/admin/activation-health` |
| `PLG_REGISTER_ALLOWED_ORIGINS` | no | Comma-separated origin allowlist (defaults documented in module CLAUDE.md) |
| `PLG_POSTHOG_KEY` / `PLG_POSTHOG_HOST` | no | PostHog public key + ingest host |
| `INBOUND_HMAC_SECRET` | yes | Magic-inbox webhook signature key |
| `MIRA_INGEST_URL` | yes | Magic-inbox forwarding target |
| `INBOX_DOMAIN` | no | Default `factorylm.com` |

## Quality Standards
| Metric | Current | Target |
|---|---|---|
| Test files | 5 | ≥ 20 (route + activation contract + Stripe webhook fakes) |
| TS strict | enforced | maintain |
| Stripe webhook signature failure handling | required | every signature failure → HTTP 400, no DB write |
| Activation latency p95 | unmeasured | ≤ 30 s (Stripe success → Atlas user + welcome email) |
| Funnel completion: register → active | tracked via PostHog | report weekly |

## Acceptance Criteria
1. **Origin allowlist:** A `POST /api/register` from an unlisted origin returns HTTP 403.
2. **Idempotent register:** Posting the same email twice returns HTTP 200 once and HTTP 409 on the second; no duplicate tenant row.
3. **Stripe round-trip:** Test-mode Stripe Checkout → webhook → `tenants.tier = 'active'` and Atlas API has a new user.
4. **Provisioning retry:** Forcing Atlas API down on first attempt; `/api/activation/retry` succeeds the second time without duplicating users.
5. **Magic-inbox HMAC:** A webhook with the wrong HMAC signature is rejected with HTTP 401.
6. **Quota response:** `/api/me` returns `provisioning: { atlas: "ok", demo: "ok", email: "ok", attempts, ready: true }` for an active tenant.
7. **Admin health:** `/api/admin/activation-health` lists tenants stuck > 10 min and respects `x-admin-token`.
8. **No secret-in-URL:** Magic-link tokens use signed JWT in cookie, never query string visible in referrer logs.
9. **Open CMMS button:** Every asset-scan page (CRA-20) routes to `/cmms`.

## Known Issues
- `mira-web/src/lib/mira-chat.ts` still calls `mira-sidecar /rag`; cutover to `mira-pipeline` tracked in PR #197.
- PostHog ships a no-op stub if `PLG_POSTHOG_KEY` is unset (intentional).

## Change Log
- 2026-05-04 — Magic-link JWT fix merged (CRA-22, CRA-21).
- 2026-05-04 — Open CMMS button added to asset-scan pages (CRA-20).
- 2026-04-26 — `/sample` + `/activated` routed via nginx to mira-web on `app.factorylm.com`.
