# mira-web — Beta Onboarding Funnel

## What This Is
Customer-facing web service for FactoryLM's beta onboarding.
Visitor clicks "Join the Beta" → enters email/name/company →
tenant created as `pending` → 7-day Loom nurture sequence →
Stripe Checkout $97/mo → tier='active' → CMMS + unlimited Mira AI.

No free tier. Pricing hidden until Day 7 email.

## Stack
- **Runtime:** Bun
- **Framework:** Hono (TypeScript, MIT license)
- **Auth:** JWT via `jose` library
- **Database:** NeonDB (tenant/quota tracking via `@neondatabase/serverless`)
- **Payments:** Stripe (Checkout + webhooks + Customer Portal)
- **CMMS Backend:** Atlas CMMS (Spring Boot, Docker, `atlas-api:8080`)
- **AI Chat:** Proxies to `mira-sidecar:5000/rag` (dual-brain RAG pipeline)
- **Email:** Resend HTTP API (transactional + drip)

## Tenant Tiers
- `pending` — signed up, in nurture sequence, no product access
- `active` — paid $97/mo, full CMMS + unlimited Mira queries
- `churned` — subscription cancelled, no product access

## Port
- Container: 3000
- Host: 3200 (via docker-compose)

## Networks
- `core-net` — reach mira-sidecar, mira-mcp
- `cmms-net` — reach atlas-api

## Key Env Vars (all via Doppler)
| Var | Purpose |
|-----|---------|
| `PLG_JWT_SECRET` | Sign/verify mira-web JWTs |
| `STRIPE_SECRET_KEY` | Stripe API secret |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (whsec_...) |
| `STRIPE_PRICE_ID` | Price ID for $97/mo subscription |
| `NEON_DATABASE_URL` | NeonDB connection string |
| `RESEND_API_KEY` | Transactional email |
| `LOOM_URL_1..5` | Loom video URLs (env vars, swap without redeploy) |
| `PLG_ATLAS_ADMIN_USER` | Admin email for Atlas API |
| `PLG_ATLAS_ADMIN_PASSWORD` | Admin password for Atlas API |

## Commands
```bash
bun install          # Install deps
bun run dev          # Dev with watch mode
bun run start        # Production
bun test             # Run tests
```

## Key Routes
| Route | Auth | Purpose |
|-------|------|---------|
| `POST /api/register` | None | Create pending tenant, start nurture |
| `GET /api/checkout` | None | Stripe Checkout redirect (from payment email) |
| `POST /api/stripe/webhook` | Stripe sig | Handle payment events |
| `GET /api/billing-portal` | JWT | Stripe Customer Portal |
| `GET /api/me` | Active | User profile + quota |
| `POST /api/mira/chat` | Active | AI chat via mira-sidecar |

## PRDs
- `MIRA/PRDS/factorylm-plg-funnel.md` — PLG funnel spec
- `MIRA/PRDS/mira_factorylm_prd_v2.md` — Canonical product PRD
