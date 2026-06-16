## Why
Factory AI's `/notifications` is GET-only. No outbound push. We ship this first and publish a side-by-side blog post. **Biggest visible architectural hole in their product.**

## Source
- https://docs.f7i.ai/docs/api/notifications
- `docs/competitors/factory-ai-leapfrog-plan.md` #2 — Monday top-3

## Acceptance criteria
- [ ] Schema: `webhooks` (id, tenant_id, name, url, secret, event_types[], active, headers JSON)
- [ ] `/api/webhooks` CRUD
- [ ] Emit events: `alert.opened`, `alert.resolved`, `workorder.created`, `workorder.completed`, `asset.criticality_changed`
- [ ] HMAC signature header `X-Mira-Signature` (SHA256 of body with webhook secret)
- [ ] Fan-out worker: on event, POST to each matching webhook with 3x retry + exponential backoff
- [ ] First-class recipes: **Slack** (incoming webhook URL template), **MS Teams** (connector URL), **PagerDuty** (Events API v2), **Jira** (REST API + project key)
- [ ] Recipe UI on `(hub)/integrations/page.tsx` — pick recipe → enter URL → pick event types → save
- [ ] Delivery log per webhook: status, latency, response, retries
- [ ] Blog draft: `docs/marketing/blog-webhook-gap.md` — side-by-side vs. Factory AI

## Files
- `mira-hub/migrations/NNN_webhooks.sql`
- `mira-hub/src/app/api/webhooks/**/*.ts`
- `mira-hub/src/app/api/internal/webhook-dispatch/route.ts`
- `mira-hub/src/app/(hub)/integrations/webhooks/page.tsx`
