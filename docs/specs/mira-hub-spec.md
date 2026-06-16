# mira-hub Specification
**Version:** 1.0
**Last Updated:** 2026-05-05
**Owner:** Mike Harper / FactoryLM

## Purpose
Authenticated **Next.js hub** that becomes the technician/manager workspace once a tenant is `active`: 17 sections covering work orders, assets, schedule, parts, channels, integrations, knowledge, and admin. Acts as a **non-destructive overlay** on top of the existing MIRA backend — every endpoint proxies to `mira-pipeline:9099`, `mira-mcp:8001`, or NeonDB; no Python service is modified. (See `docs/specs/factorylm-platform-v2.md`.)

## Scope
**IN scope**
- All authenticated routes under `/(hub)/*` — workorders, assets, schedule, parts, channels, integrations, knowledge, conversations, alerts, requests, reports, more, admin, magic, team, usage, upgrade
- `src/app/(hub)/layout.tsx` shell (drawer + bottom tabs + responsive nav)
- API route handlers under `src/app/api/*` that proxy/aggregate
- Auth — `src/auth.ts` + magic-link, Google OAuth, admin bypass
- Refine.dev resource configuration (`src/app/refine-providers.tsx`)
- Playwright suites: smoke, signup, e2e

**OUT of scope**
- Marketing pages and PLG onboarding (lives in `mira-web`)
- Diagnostic engine, retrieval, vision (lives in `mira-bots/shared` + `mira-pipeline`)
- CMMS data plane (proxies to Atlas via `mira-mcp`)

## Architecture
- **Layer:** Presentation
- **Container:** `mira-hub` (Next.js + Bun; standalone build)
- **Stack:** Next.js (custom internal version — read `node_modules/next/dist/docs/` before assuming defaults), Refine.dev, shadcn/ui, Tailwind, Vitest, Playwright
- **Network:** `core-net`, `cmms-net`
- **Persistence:** No DB of its own; uses NeonDB via API routes and proxies to `mira-pipeline`/`mira-mcp`
- **Versioning:** Independent namespaced git tags `mira-hub/vMAJOR.MINOR.PATCH`. First tagged release: `mira-hub/v1.1.0` (2026-04-24).

```
Browser ──HTTPS──▶ mira-hub (Next.js) ──HTTP──▶ mira-pipeline:9099 (chat)
                                       └─HTTP──▶ mira-mcp:8001     (CMMS REST)
                                       └─SQL───▶ NeonDB            (tenants, KG, usage)
```

## API Contract
Hub-internal route handlers (subset). Authentication is JWT (cookie set by `auth.ts`).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/me` | Tenant profile, quota, provisioning state |
| POST | `/api/chat` | Proxy to `mira-pipeline:9099/v1/chat/completions` |
| GET/POST | `/api/workorders` | Proxy to `mira-mcp:8001/api/cmms/work-orders` |
| GET | `/api/assets` | Proxy to Atlas via mira-mcp |
| GET | `/api/schedule` | PM calendar view |
| POST | `/api/integrations/connect` | Initiate OAuth on a CMMS connector |
| GET | `/api/admin/*` | Admin-bypass routes; gated on session role |

UI routes follow Next.js App Router; each `(hub)/<section>/page.tsx` is server-rendered first, then hydrates Refine.dev list/show/edit views.

## Configuration
| Var | Required | Default | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_HUB_BASE_URL` | yes | — | Public origin of the hub |
| `MIRA_PIPELINE_URL` | yes | `http://mira-pipeline:9099` | Pipeline target |
| `MIRA_PIPELINE_API_KEY` | yes | — | Bearer for pipeline |
| `MCP_REST_API_KEY` | yes | — | Bearer for mira-mcp REST |
| `NEON_DATABASE_URL` | yes | — | Tenancy + usage |
| `HUB_JWT_SECRET` | yes | — | Sign/verify hub JWTs |
| `GOOGLE_OAUTH_CLIENT_ID/SECRET` | optional | — | Google sign-in |
| `RESEND_API_KEY` | yes | — | Magic-link email |
| `ADMIN_BYPASS_TOKEN` | optional | — | Admin staff sign-in for support |

## Quality Standards
| Metric | Current | Target |
|---|---|---|
| Smoke test pass | 100 % | maintain |
| Signup test pass | 100 % | maintain |
| Vitest unit suite | exists, partial | ≥ 60 unit tests |
| TS strict | enforced | maintain |
| Lighthouse (mobile) | unmeasured | ≥ 80 perf, ≥ 95 a11y |
| Bundle size budget | unset | < 350 KB initial JS per route |

## Acceptance Criteria
1. **Auth:** Magic-link email lands in Resend, link sets cookie, redirect lands on `/(hub)`.
2. **Section nav:** Each of the 17 sections renders without a console error.
3. **Drawer + tabs:** On viewports < 768 px, bottom tabs are visible; ≥ 768 px, side drawer.
4. **CMMS proxy:** Creating a work order from `/(hub)/workorders/new` results in a row in Atlas (verify via `mira-mcp /api/cmms/work-orders`).
5. **Chat:** Sending a message from `/(hub)/conversations` calls `mira-pipeline /v1/chat/completions` with the right `user` id (visible in `x-mira-trace-id`).
6. **Quota:** `/api/me` returns `{tier, quota_used, quota_limit, provisioning}` and the upgrade banner shows when `quota_used >= quota_limit`.
7. **Smoke + signup Playwright suites:** Both green in CI.
8. **No direct engine import:** No `@mira-bots/shared` import — all chat goes via `mira-pipeline`.

## Known Issues
- Custom internal Next.js fork — assistants must read `node_modules/next/dist/docs/` before relying on stock APIs (per `mira-hub/AGENTS.md`).
- Several sections still scaffolded — see `mira-hub/CHANGELOG.md` for stub vs. live.

## Change Log
- 2026-04-24 — `mira-hub/v1.1.0`: OAuth persistence + full platform build.
- 2026-04 — Established as authenticated workspace; non-destructive overlay model.
