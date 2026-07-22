# mira-hub — Route Sitemap

> **Generated** by `scripts/sitemap.mjs` from the `src/app` filesystem. Do not edit by hand.
> Regenerate with `bun run sitemap`; CI fails (`bun run sitemap:check`) if this drifts.
>
> **basePath:** `/hub` — live URL = `https://app.factorylm.com/hub` + route.
> Example: `/command-center` → https://app.factorylm.com/hub/command-center/

## Summary

| Surface | Count |
|---|---|
| Pages | **64** (9 dynamic) |
| API routes | **161** (52 dynamic) |

## Pages (64)

| Route | Kind | Source |
|---|---|---|
| `/admin` | static | `(hub)/admin/page.tsx` |
| `/admin/review` | static | `(hub)/admin/review/page.tsx` |
| `/admin/roles` | static | `(hub)/admin/roles/page.tsx` |
| `/admin/users` | static | `(hub)/admin/users/page.tsx` |
| `/alerts` | static | `(hub)/alerts/page.tsx` |
| `/assets` | static | `(hub)/assets/page.tsx` |
| `/assets/[id]` | dynamic | `(hub)/assets/[id]/page.tsx` |
| `/assets/print-qr` | static | `(hub)/assets/print-qr/page.tsx` |
| `/channels` | static | `(hub)/channels/page.tsx` |
| `/cmms` | static | `(hub)/cmms/page.tsx` |
| `/command-center` | static | `(hub)/command-center/page.tsx` |
| `/contextualization` | static | `(hub)/contextualization/page.tsx` |
| `/contextualization/[id]` | dynamic | `(hub)/contextualization/[id]/page.tsx` |
| `/contextualization/review` | static | `(hub)/contextualization/review/page.tsx` |
| `/contextualization/review/[batchId]` | dynamic | `(hub)/contextualization/review/[batchId]/page.tsx` |
| `/conversations` | static | `(hub)/conversations/page.tsx` |
| `/demo/conveyor/[tag]` | dynamic | `demo/conveyor/[tag]/page.tsx` |
| `/documents` | static | `(hub)/documents/page.tsx` |
| `/documents/[id]` | dynamic | `(hub)/documents/[id]/page.tsx` |
| `/event-log` | static | `(hub)/event-log/page.tsx` |
| `/feed` | static | `(hub)/feed/page.tsx` |
| `/graph` | static | `(hub)/graph/page.tsx` |
| `/integrations` | static | `(hub)/integrations/page.tsx` |
| `/knowledge` | static | `(hub)/knowledge/page.tsx` |
| `/knowledge/manuals` | static | `(hub)/knowledge/manuals/page.tsx` |
| `/knowledge/map` | static | `(hub)/knowledge/map/page.tsx` |
| `/knowledge/suggestions` | static | `(hub)/knowledge/suggestions/page.tsx` |
| `/library` | static | `(hub)/library/page.tsx` |
| `/login` | static | `login/page.tsx` |
| `/m/[assetTag]` | dynamic | `m/[assetTag]/page.tsx` |
| `/magic` | static | `magic/page.tsx` |
| `/more` | static | `(hub)/more/page.tsx` |
| `/namespace` | static | `(hub)/namespace/page.tsx` |
| `/onboarding` | static | `(hub)/onboarding/page.tsx` |
| `/parts` | static | `(hub)/parts/page.tsx` |
| `/parts/[id]` | dynamic | `(hub)/parts/[id]/page.tsx` |
| `/pending-approval` | static | `(hub)/pending-approval/page.tsx` |
| `/plc-import` | static | `(hub)/plc-import/page.tsx` |
| `/proposals` | static | `(hub)/proposals/page.tsx` |
| `/quickstart` | static | `quickstart/page.tsx` |
| `/reports` | static | `(hub)/reports/page.tsx` |
| `/requests` | static | `(hub)/requests/page.tsx` |
| `/requests/new` | static | `(hub)/requests/new/page.tsx` |
| `/scan` | static | `(hub)/scan/page.tsx` |
| `/schedule` | static | `(hub)/schedule/page.tsx` |
| `/settings` | static | `(hub)/settings/page.tsx` |
| `/settings/audit-log` | static | `(hub)/settings/audit-log/page.tsx` |
| `/settings/integrations` | static | `(hub)/settings/integrations/page.tsx` |
| `/settings/organization` | static | `(hub)/settings/organization/page.tsx` |
| `/settings/review-queue` | static | `(hub)/settings/review-queue/page.tsx` |
| `/settings/roles` | static | `(hub)/settings/roles/page.tsx` |
| `/settings/security` | static | `(hub)/settings/security/page.tsx` |
| `/settings/usage` | static | `(hub)/settings/usage/page.tsx` |
| `/settings/users` | static | `(hub)/settings/users/page.tsx` |
| `/signup` | static | `signup/page.tsx` |
| `/team` | static | `(hub)/team/page.tsx` |
| `/upgrade` | static | `(hub)/upgrade/page.tsx` |
| `/usage` | static | `(hub)/usage/page.tsx` |
| `/visual` | static | `(hub)/visual/page.tsx` |
| `/visual/[id]` | dynamic | `(hub)/visual/[id]/page.tsx` |
| `/workflows` | static | `(hub)/workflows/page.tsx` |
| `/workorders` | static | `(hub)/workorders/page.tsx` |
| `/workorders/[id]` | dynamic | `(hub)/workorders/[id]/page.tsx` |
| `/workorders/new` | static | `(hub)/workorders/new/page.tsx` |

## API routes (161)

| Route | Kind | Source |
|---|---|---|
| `/` | static | `route.ts` |
| `/api/admin/review/asset/[...path]` | dynamic | `api/admin/review/asset/[...path]/route.ts` |
| `/api/admin/review/queue` | static | `api/admin/review/queue/route.ts` |
| `/api/admin/users` | static | `(hub)/api/admin/users/route.ts` |
| `/api/admin/users/[id]` | dynamic | `(hub)/api/admin/users/[id]/route.ts` |
| `/api/agents/morning-brief` | static | `api/agents/morning-brief/route.ts` |
| `/api/agents/pm-escalation/check` | static | `api/agents/pm-escalation/check/route.ts` |
| `/api/agents/safety-events` | static | `api/agents/safety-events/route.ts` |
| `/api/assets` | static | `api/assets/route.ts` |
| `/api/assets/[id]` | dynamic | `api/assets/[id]/route.ts` |
| `/api/assets/[id]/agent-status` | dynamic | `api/assets/[id]/agent-status/route.ts` |
| `/api/assets/[id]/agent-status/transition` | dynamic | `api/assets/[id]/agent-status/transition/route.ts` |
| `/api/assets/[id]/chat` | dynamic | `api/assets/[id]/chat/route.ts` |
| `/api/assets/[id]/children` | dynamic | `api/assets/[id]/children/route.ts` |
| `/api/assets/[id]/context` | dynamic | `api/assets/[id]/context/route.ts` |
| `/api/assets/[id]/documents` | dynamic | `api/assets/[id]/documents/route.ts` |
| `/api/assets/[id]/enrich` | dynamic | `api/assets/[id]/enrich/route.ts` |
| `/api/assets/[id]/machine-memory` | dynamic | `api/assets/[id]/machine-memory/route.ts` |
| `/api/assets/[id]/machine-memory/stream` | dynamic | `api/assets/[id]/machine-memory/stream/route.ts` |
| `/api/assets/[id]/qr` | dynamic | `api/assets/[id]/qr/route.ts` |
| `/api/assets/[id]/signal-history` | dynamic | `api/assets/[id]/signal-history/route.ts` |
| `/api/assets/[id]/signals` | dynamic | `api/assets/[id]/signals/route.ts` |
| `/api/assets/[id]/validation-qa` | dynamic | `api/assets/[id]/validation-qa/route.ts` |
| `/api/assets/[id]/validation-qa/[qaId]/verdict` | dynamic | `api/assets/[id]/validation-qa/[qaId]/verdict/route.ts` |
| `/api/assets/by-tag/[tag]` | dynamic | `api/assets/by-tag/[tag]/route.ts` |
| `/api/assets/export.csv` | static | `api/assets/export.csv/route.ts` |
| `/api/auth/[...nextauth]` | dynamic | `api/auth/[...nextauth]/route.ts` |
| `/api/auth/check-approval` | static | `(hub)/api/auth/check-approval/route.ts` |
| `/api/auth/confluence` | static | `api/auth/confluence/route.ts` |
| `/api/auth/confluence/callback` | static | `api/auth/confluence/callback/route.ts` |
| `/api/auth/dropbox` | static | `api/auth/dropbox/route.ts` |
| `/api/auth/dropbox/callback` | static | `api/auth/dropbox/callback/route.ts` |
| `/api/auth/google` | static | `api/auth/google/route.ts` |
| `/api/auth/google/callback` | static | `api/auth/google/callback/route.ts` |
| `/api/auth/magic-link` | static | `(hub)/api/auth/magic-link/route.ts` |
| `/api/auth/microsoft` | static | `api/auth/microsoft/route.ts` |
| `/api/auth/microsoft/callback` | static | `api/auth/microsoft/callback/route.ts` |
| `/api/auth/openwebui` | static | `api/auth/openwebui/route.ts` |
| `/api/auth/register` | static | `api/auth/register/route.ts` |
| `/api/auth/slack` | static | `api/auth/slack/route.ts` |
| `/api/auth/slack/callback` | static | `api/auth/slack/callback/route.ts` |
| `/api/auth/status` | static | `api/auth/status/route.ts` |
| `/api/auth/telegram` | static | `api/auth/telegram/route.ts` |
| `/api/channels` | static | `api/channels/route.ts` |
| `/api/cmms/deep-link` | static | `api/cmms/deep-link/route.ts` |
| `/api/cmms/health` | static | `api/cmms/health/route.ts` |
| `/api/cmms/sso` | static | `api/cmms/sso/route.ts` |
| `/api/cmms/stats` | static | `api/cmms/stats/route.ts` |
| `/api/command-center/commissioning` | static | `api/command-center/commissioning/route.ts` |
| `/api/command-center/display` | static | `api/command-center/display/route.ts` |
| `/api/command-center/display/[id]` | dynamic | `api/command-center/display/[id]/route.ts` |
| `/api/command-center/gateways` | static | `api/command-center/gateways/route.ts` |
| `/api/command-center/tree` | static | `api/command-center/tree/route.ts` |
| `/api/components/[id]` | dynamic | `api/components/[id]/route.ts` |
| `/api/connections` | static | `api/connections/route.ts` |
| `/api/connections/[provider]` | dynamic | `api/connections/[provider]/route.ts` |
| `/api/connectors/ignition/import` | static | `api/connectors/ignition/import/route.ts` |
| `/api/connectors/plc/import` | static | `api/connectors/plc/import/route.ts` |
| `/api/contextualization` | static | `api/contextualization/route.ts` |
| `/api/contextualization/[id]/export` | dynamic | `api/contextualization/[id]/export/route.ts` |
| `/api/contextualization/[id]/extractions` | dynamic | `api/contextualization/[id]/extractions/route.ts` |
| `/api/contextualization/[id]/extractions/[eid]` | dynamic | `api/contextualization/[id]/extractions/[eid]/route.ts` |
| `/api/contextualization/[id]/promote` | dynamic | `api/contextualization/[id]/promote/route.ts` |
| `/api/contextualization/[id]/sources` | dynamic | `api/contextualization/[id]/sources/route.ts` |
| `/api/contextualization/batches` | static | `api/contextualization/batches/route.ts` |
| `/api/contextualization/batches/[batchId]` | dynamic | `api/contextualization/batches/[batchId]/route.ts` |
| `/api/contextualization/batches/[batchId]/review` | dynamic | `api/contextualization/batches/[batchId]/review/route.ts` |
| `/api/contextualization/import` | static | `api/contextualization/import/route.ts` |
| `/api/conversations` | static | `api/conversations/route.ts` |
| `/api/decision-trace/[id]` | dynamic | `api/decision-trace/[id]/route.ts` |
| `/api/decision-trace/[id]/feedback` | dynamic | `api/decision-trace/[id]/feedback/route.ts` |
| `/api/demo/customer` | static | `api/demo/customer/route.ts` |
| `/api/demo/signals/events` | static | `api/demo/signals/events/route.ts` |
| `/api/demo/signals/set` | static | `api/demo/signals/set/route.ts` |
| `/api/demo/signals/summary` | static | `api/demo/signals/summary/route.ts` |
| `/api/demo/signals/toggle` | static | `api/demo/signals/toggle/route.ts` |
| `/api/documents` | static | `api/documents/route.ts` |
| `/api/documents/upload` | static | `api/documents/upload/route.ts` |
| `/api/events` | static | `api/events/route.ts` |
| `/api/events/[id]` | dynamic | `api/events/[id]/route.ts` |
| `/api/export` | static | `api/export/route.ts` |
| `/api/health` | static | `api/health/route.ts` |
| `/api/hub/status` | static | `api/hub/status/route.ts` |
| `/api/i3x/v1/info` | static | `api/i3x/v1/info/route.ts` |
| `/api/i3x/v1/namespaces` | static | `api/i3x/v1/namespaces/route.ts` |
| `/api/i3x/v1/objects` | static | `api/i3x/v1/objects/route.ts` |
| `/api/i3x/v1/objects/history` | static | `api/i3x/v1/objects/history/route.ts` |
| `/api/i3x/v1/objects/list` | static | `api/i3x/v1/objects/list/route.ts` |
| `/api/i3x/v1/objects/related` | static | `api/i3x/v1/objects/related/route.ts` |
| `/api/i3x/v1/objects/value` | static | `api/i3x/v1/objects/value/route.ts` |
| `/api/i3x/v1/objecttypes` | static | `api/i3x/v1/objecttypes/route.ts` |
| `/api/i3x/v1/objecttypes/query` | static | `api/i3x/v1/objecttypes/query/route.ts` |
| `/api/i3x/v1/relationshiptypes` | static | `api/i3x/v1/relationshiptypes/route.ts` |
| `/api/i3x/v1/relationshiptypes/query` | static | `api/i3x/v1/relationshiptypes/query/route.ts` |
| `/api/integrations/nango/callback` | static | `api/integrations/nango/callback/route.ts` |
| `/api/integrations/nango/connect` | static | `api/integrations/nango/connect/route.ts` |
| `/api/internal/kg` | static | `api/internal/kg/route.ts` |
| `/api/kg/graph` | static | `api/kg/graph/route.ts` |
| `/api/kg/sync` | static | `api/kg/sync/route.ts` |
| `/api/kg/trace` | static | `api/kg/trace/route.ts` |
| `/api/knowledge` | static | `api/knowledge/route.ts` |
| `/api/knowledge/growth` | static | `api/knowledge/growth/route.ts` |
| `/api/knowledge/manufacturer` | static | `api/knowledge/manufacturer/route.ts` |
| `/api/knowledge/search` | static | `api/knowledge/search/route.ts` |
| `/api/knowledge/stats` | static | `api/knowledge/stats/route.ts` |
| `/api/library/chunks` | static | `api/library/chunks/route.ts` |
| `/api/library/documents` | static | `api/library/documents/route.ts` |
| `/api/library/tree` | static | `api/library/tree/route.ts` |
| `/api/me` | static | `api/me/route.ts` |
| `/api/mira/ask` | static | `api/mira/ask/route.ts` |
| `/api/namespace/files/[id]` | dynamic | `api/namespace/files/[id]/route.ts` |
| `/api/namespace/files/[id]/verify` | dynamic | `api/namespace/files/[id]/verify/route.ts` |
| `/api/namespace/node` | static | `api/namespace/node/route.ts` |
| `/api/namespace/node/[id]` | dynamic | `api/namespace/node/[id]/route.ts` |
| `/api/namespace/node/[id]/chat` | dynamic | `api/namespace/node/[id]/chat/route.ts` |
| `/api/namespace/node/[id]/files` | dynamic | `api/namespace/node/[id]/files/route.ts` |
| `/api/namespace/path` | static | `api/namespace/path/route.ts` |
| `/api/namespace/tree` | static | `api/namespace/tree/route.ts` |
| `/api/picker/dropbox/key` | static | `api/picker/dropbox/key/route.ts` |
| `/api/picker/google/token` | static | `api/picker/google/token/route.ts` |
| `/api/pm-schedules` | static | `api/pm-schedules/route.ts` |
| `/api/pm-schedules/[id]` | dynamic | `api/pm-schedules/[id]/route.ts` |
| `/api/pm-schedules/[id]/complete` | dynamic | `api/pm-schedules/[id]/complete/route.ts` |
| `/api/pm-schedules/[id]/meter` | dynamic | `api/pm-schedules/[id]/meter/route.ts` |
| `/api/pm/export.csv` | static | `api/pm/export.csv/route.ts` |
| `/api/pm/export.ics` | static | `api/pm/export.ics/route.ts` |
| `/api/proposals` | static | `api/proposals/route.ts` |
| `/api/proposals/[id]/decide` | dynamic | `api/proposals/[id]/decide/route.ts` |
| `/api/public/report` | static | `api/public/report/route.ts` |
| `/api/quickstart/ask` | static | `api/quickstart/ask/route.ts` |
| `/api/quickstart/manufacturers` | static | `api/quickstart/manufacturers/route.ts` |
| `/api/readiness` | static | `api/readiness/route.ts` |
| `/api/readiness/recalculate` | static | `api/readiness/recalculate/route.ts` |
| `/api/reports/generate` | static | `api/reports/generate/route.ts` |
| `/api/scanbe/healthz` | static | `api/scanbe/healthz/route.ts` |
| `/api/sessions/[id]` | dynamic | `api/sessions/[id]/route.ts` |
| `/api/sessions/confirm` | static | `api/sessions/confirm/route.ts` |
| `/api/suggestions/[id]/decide` | dynamic | `api/suggestions/[id]/decide/route.ts` |
| `/api/suggestions/drive-pack-candidate` | static | `api/suggestions/drive-pack-candidate/route.ts` |
| `/api/team` | static | `api/team/route.ts` |
| `/api/uns/browse` | static | `api/uns/browse/route.ts` |
| `/api/uns/subtree` | static | `api/uns/subtree/route.ts` |
| `/api/uploads` | static | `api/uploads/route.ts` |
| `/api/uploads/[id]` | dynamic | `api/uploads/[id]/route.ts` |
| `/api/uploads/[id]/retry` | dynamic | `api/uploads/[id]/retry/route.ts` |
| `/api/uploads/folder` | static | `api/uploads/folder/route.ts` |
| `/api/uploads/local` | static | `api/uploads/local/route.ts` |
| `/api/usage` | static | `api/usage/route.ts` |
| `/api/user/preferences` | static | `api/user/preferences/route.ts` |
| `/api/version` | static | `api/version/route.ts` |
| `/api/visual/evidence/[id]/regions` | dynamic | `api/visual/evidence/[id]/regions/route.ts` |
| `/api/visual/evidence/[id]/view` | dynamic | `api/visual/evidence/[id]/view/route.ts` |
| `/api/visual/regions/[id]` | dynamic | `api/visual/regions/[id]/route.ts` |
| `/api/visual/sessions` | static | `api/visual/sessions/route.ts` |
| `/api/visual/sessions/[id]` | dynamic | `api/visual/sessions/[id]/route.ts` |
| `/api/visual/sessions/[id]/evidence` | dynamic | `api/visual/sessions/[id]/evidence/route.ts` |
| `/api/wizard/[step]` | dynamic | `api/wizard/[step]/route.ts` |
| `/api/work-orders` | static | `api/work-orders/route.ts` |
| `/api/work-orders/[id]` | dynamic | `api/work-orders/[id]/route.ts` |
| `/api/work-orders/export.csv` | static | `api/work-orders/export.csv/route.ts` |
| `/api/workflows` | static | `api/workflows/route.ts` |

## Change history (the route changelog)

This file + `docs/sitemap.snapshot.json` are the recorded route surface. Their
**git history is the route changelog** — every add/remove of a page or API
route shows up as a diff to the snapshot, enforced by the `sitemap-drift` test:

```
git log --oneline -p docs/sitemap.snapshot.json   # when did the surface change, and how
```

A PR that adds or removes a route fails CI until `bun run sitemap` is re-run and
both files are committed — so the surface area can never change silently.

## Functionality check

Per-route health (HTTP status, console errors, unhandled exceptions, paint
time) is crawled by `tests/e2e/hub-page-audit.spec.ts` against the live hub;
reports land in `docs/audits/<date>-audit.md`. Run on demand:

```
gh workflow run enforcement-audit.yml          # CI run against prod, uploads report
HUB_URL=https://app.factorylm.com npx playwright test tests/e2e/hub-page-audit.spec.ts
```
