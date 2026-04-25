## Why
Factory AI's `/sensor-reports` + `/asset-charts` surface sensor telemetry comparable across asset sides. Basic reporting parity.

## Source
- Sitemap rows: `/docs/api/sensor-reports`, `/docs/api/asset-charts`
- `docs/competitors/factory-ai.md` → sensor rows

## Acceptance criteria
- [ ] `GET /api/sensors/{id}/report?window=7d` returns time-bucketed series (min/max/avg per 15m bucket)
- [ ] `GET /api/assets/{id}/charts` returns one series per sensor attached to the asset
- [ ] Chart component on asset detail page; uses Recharts or ECharts
- [ ] Time range picker (1h, 24h, 7d, 30d, custom)

## Files
- `mira-hub/src/app/api/sensors/[id]/report/route.ts`
- `mira-hub/src/app/api/assets/[id]/charts/route.ts`
- `mira-hub/src/app/(hub)/assets/[id]/charts/page.tsx`
