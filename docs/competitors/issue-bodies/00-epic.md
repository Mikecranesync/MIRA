Tracking issue for closing feature gaps vs. Factory AI (https://f7i.ai, docs.f7i.ai).

**Full analysis:** `docs/competitors/factory-ai.md` + `docs/competitors/factory-ai-leapfrog-plan.md`
**Their sitemap archived:** `docs/competitors/snapshots/f7i-sitemap-2026-04-24.xml`

## Strategy in one sentence
Match their surface area on the hub (`mira-hub`); leap ahead on the 5 architectural holes they cannot quickly fix.

## Parity work (existing hub routes to flesh out)
- [ ] Asset hierarchy + QR codes (site → area → asset → component)
- [ ] Component template catalog
- [ ] Work-order lifecycle (7 states) + sub-resources (tasks, parts, notes, media)
- [ ] PM procedures with safety-first schema + auto-spawn work orders
- [ ] Maintenance strategies (7 types, MTBF/availability/cost)
- [ ] Inventory module (ABC/XYZ, reorder logic, multi-vendor)
- [ ] Purchasing module (POs w/ dollar-threshold approvals)
- [ ] Failure-code taxonomy (ISO 14224-aligned — our edge over their proprietary)
- [ ] FFT / vibration analysis (scipy.fft + bearing formulas)
- [ ] External events ingest (SCADA/ERP/MES/weather)
- [ ] Sensor reports + asset charts
- [ ] Mobile PWA for work orders (offline)
- [ ] Asset-scoped chat (GSDEngine streaming, BYO-LLM)
- [ ] Public API reference docs (docs.factorylm.com)
- [ ] Subdomain multi-tenancy (*.factorylm.com)

## Leapfrog work (things they don't have)
- [ ] Outbound webhooks (Slack/Teams/PagerDuty/Jira)
- [ ] SSO (SAML/OIDC)
- [ ] SOC 2 Type 1 kickoff
- [ ] On-prem / self-hosted packaging
- [ ] Open-source safety-keyword guardrail (`mira-safety-guard` PyPI)

## Related
- Competitor dossier: `docs/competitors/factory-ai.md`
- Catch-up plan: `docs/competitors/factory-ai-leapfrog-plan.md`
- Sitemap snapshot: `docs/competitors/snapshots/f7i-sitemap-2026-04-24.xml`
