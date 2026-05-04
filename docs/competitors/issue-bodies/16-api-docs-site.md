## Why
Factory AI's Docusaurus API docs at docs.f7i.ai are their #1 credibility signal. Ours are scattered. Close this in two weeks.

## Source
- `docs/competitors/factory-ai-leapfrog-plan.md` #1
- Their 20-endpoint layout (see `docs/competitors/factory-ai.md` → "Their data model")

## Acceptance criteria
- [ ] Public docs site at `docs.factorylm.com` (Mintlify free tier or Docusaurus)
- [ ] Sidebar sections mirror theirs: Getting Started, User Guides, Hardware Setup, API Reference
- [ ] API Reference page per endpoint (mirror their 20): assets, components, work-orders, pms, maintenance-strategies, failure-codes, parts, inventory, purchase-orders, external-events, notifications, webhooks, sensors, fft, documents, templates, customer-settings, gateways, feedback, auth
- [ ] Each endpoint page: path, method, auth, request body schema, response schema, example curl + TS + Python
- [ ] OpenAPI 3.1 spec at `docs/api-reference/openapi.yaml` — source of truth for the rendered pages
- [ ] **Prominent callout:** "BYO-LLM, outbound webhooks, ISO 14224 taxonomy, no-training-by-default"
- [ ] Link from main `factorylm.com` nav

## Files
- `docs/api-reference/*.md`
- `docs/api-reference/openapi.yaml`
- `docs-site/` (new — Mintlify or Docusaurus)
