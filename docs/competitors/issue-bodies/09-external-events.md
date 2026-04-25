## Why
Factory AI's `/external-events` accepts events from SCADA, ERP, CMMS, MES, weather sources. Inbound only. We match.

## Source
- https://docs.f7i.ai/docs/api/external-events
- `docs/competitors/factory-ai.md` → `/external-events` row

## Acceptance criteria
- [ ] Schema: `external_events` (siteName, areaName, assetName, sensorId, companyName, timestamp, eventType, title, description, source, severity, metadata JSON)
- [ ] `POST /api/external-events` accepts events; validates against JSON schema; returns ID
- [ ] Filter by source: `?source=SCADA|ERP|CMMS|MES|WEATHER|API`
- [ ] UI: `(hub)/event-log/page.tsx` shows chronological feed with source badges
- [ ] Correlate to assets by name match (fallback: unassigned bucket)

## Files
- `mira-hub/migrations/NNN_external_events.sql`
- `mira-hub/src/app/api/external-events/**/*.ts`
- `mira-hub/src/app/(hub)/event-log/page.tsx`
