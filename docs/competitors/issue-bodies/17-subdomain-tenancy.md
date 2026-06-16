## Why
Factory AI uses `acme.f7i.ai/prod` — subdomain-per-tenant. Enterprise-RFP-standard. We already have per-tenant JWT; add subdomain routing.

## Source
- https://docs.f7i.ai/docs/api/overview (base URL pattern)
- `docs/competitors/factory-ai-leapfrog-plan.md` #10

## Acceptance criteria
- [ ] Wildcard DNS `*.factorylm.com` → hub app
- [ ] Next.js middleware resolves tenant from `Host` header → `req.tenantId` in request context
- [ ] Tenant lookup cached (Redis or in-memory with TTL)
- [ ] All DB queries scoped by `tenant_id` — audit with a grep for unscoped `pool.query` calls
- [ ] Reserved subdomains: `app`, `api`, `docs`, `admin`, `www`, `hub` cannot be used as tenant slugs
- [ ] Tenant onboarding sets slug at account creation; validated against reserved list

## Files
- `mira-hub/src/middleware.ts`
- `mira-hub/src/lib/tenant.ts`
- Migration: ensure `tenant_id` column on every tenant-scoped table
