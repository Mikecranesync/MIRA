# mira-web — PLG Acquisition Funnel

## What This Is
Customer-facing web service for FactoryLM's Product-Led Growth funnel.
Visitor enters email at `/cmms` → gets a working Atlas CMMS tenant with
seeded demo data → 5 free Mira AI queries/day → email drip → upgrade.

## Stack
- **Runtime:** Bun
- **Framework:** Hono (TypeScript, MIT license)
- **Auth:** JWT via `jose` library
- **Database:** NeonDB (tenant/quota tracking via `@neondatabase/serverless`)
- **CMMS Backend:** Atlas CMMS (Spring Boot, Docker, `atlas-api:8080`)
- **AI Chat:** Proxies to `mira-sidecar:5000/rag` (dual-brain RAG pipeline)
- **Email:** Resend SDK (transactional + drip)

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
| `PLG_ATLAS_ADMIN_USER` | Admin email for Atlas API |
| `PLG_ATLAS_ADMIN_PASSWORD` | Admin password for Atlas API |
| `ATLAS_API_URL` | Atlas API base (default: http://atlas-api:8080) |
| `SIDECAR_URL` | mira-sidecar base (default: http://mira-sidecar:5000) |
| `NEON_DATABASE_URL` | NeonDB connection string |
| `PLG_DAILY_FREE_QUERIES` | Free tier limit (default: 5) |
| `RESEND_API_KEY` | Transactional email |

## Commands
```bash
bun install          # Install deps
bun run dev          # Dev with watch mode
bun run start        # Production
bun test             # Run tests
```

## PRDs
- `MIRA/PRDS/factorylm-plg-funnel.md` — PLG funnel spec
- `MIRA/PRDS/mira_factorylm_prd_v2.md` — Canonical product PRD
