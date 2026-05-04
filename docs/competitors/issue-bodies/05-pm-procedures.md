## Why
Factory AI's `/pms` API embeds safetyRequirements (LOTO, PPE, electrical) as first-class per-procedure data with schedulingRules (preferred days, weekend avoidance, lead time). `POST /pms/{id}/createworkorder` spawns a WO directly.

## Source
- https://docs.f7i.ai/docs/api/pm-procedures
- `docs/competitors/factory-ai.md` → `/pms` row

## Acceptance criteria
- [ ] Schema: `pm_procedures` with `steps[]` (description, estimatedTime, tools, parts), `required_skills[]`, `safety_requirements[]`, `scheduling_rules` JSON
- [ ] CRUD: `/api/pms/*`
- [ ] `POST /api/pms/{id}/createworkorder` spawns a WO referencing the PM
- [ ] Scheduler (cron on `mira-hub` server action or Vercel cron) spawns upcoming WOs per frequency
- [ ] Safety requirements appear as a **required checklist** on the generated WO; technicians must tick before "In Progress"
- [ ] UI: `(hub)/schedule/page.tsx` calendar view of upcoming PMs

## Files
- `mira-hub/migrations/NNN_pms.sql`
- `mira-hub/src/app/api/pms/**/*.ts`
- `mira-hub/src/app/(hub)/schedule/page.tsx`
