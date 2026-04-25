## Why
Factory AI WOs have 7 states (Requested → Approved → Scheduled → In Progress → Waiting → Completed → Closed), 4 types (Corrective, Preventive, Emergency, Project), and sub-resources for tasks, parts, notes, and media. Ours is a skeleton.

## Source
- https://docs.f7i.ai/docs/prevent/user-guides/work-orders
- https://docs.f7i.ai/docs/api/work-orders
- `docs/competitors/factory-ai.md` → `/work-orders` row

## Acceptance criteria
- [ ] Schema: `work_orders`, `wo_tasks`, `wo_parts`, `wo_notes`, `wo_media` tables
- [ ] State machine: enforce valid transitions server-side; reject illegal ones with 422
- [ ] `POST/GET/PUT/DELETE /api/workorders`
- [ ] Sub-resources: `/api/workorders/{id}/tasks`, `/parts`, `/notes`, `/media`
- [ ] Presigned-URL upload for media (match their pattern — we already do this in `/api/uploads`)
- [ ] Fields: title, description, assetId, priority (Critical/High/Medium/Low), type, assignedTo, requestedBy, scheduledDate, estimatedDuration, failureCodeId, safetyRequirements
- [ ] `(hub)/workorders/page.tsx`: Kanban view grouped by state + list view
- [ ] `(hub)/workorders/[id]/page.tsx`: tabs for Tasks / Parts / Notes / Media / History

## Files
- `mira-hub/migrations/NNN_workorders_full.sql`
- `mira-hub/src/app/api/workorders/**/*.ts`
- `mira-hub/src/app/(hub)/workorders/**/*.tsx`
