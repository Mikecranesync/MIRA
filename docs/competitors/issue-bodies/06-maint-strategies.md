## Why
Factory AI models maintenance strategy as a first-class concept with 7 types: preventive (time-based), predictive (data-driven), condition-based (monitoring-triggered), reactive (run-to-failure), reliability-centered (RCM), risk-based (RBM), total-productive (TPM). Tracked metrics: mtbf, availability, costPerMonth. Condition-based uses threshold rules (e.g., vibration > 10 mm/s).

## Source
- https://docs.f7i.ai/docs/api/maintenance-strategies
- `docs/competitors/factory-ai.md` → `/maintenance-strategies` row

## Acceptance criteria
- [ ] Schema: `maintenance_strategies` with type, criticality, frequency, duration, resources, procedures, applicableAssetTypes[], assignedAssets[], costs (labor/materials/downtime), metrics (mtbf/availability/costPerMonth), isActive
- [ ] Condition-based: `conditions` JSON array with `{parameter, threshold, unit, operator}` — operators: gt/gte/lt/lte/eq
- [ ] CRUD: `/api/maintenance-strategies/*`
- [ ] UI: `(hub)/cmms/strategies/page.tsx` picker + ROI display
- [ ] Compute MTBF from historical WO data (closed failure WOs per asset / time-window)

## Files
- `mira-hub/migrations/NNN_maintenance_strategies.sql`
- `mira-hub/src/app/api/maintenance-strategies/**/*.ts`
- `mira-hub/src/app/(hub)/cmms/strategies/page.tsx`
