## Why
Factory AI ships a closed catalog of component templates (Motor Systems, Pump Systems, Control Systems, Mechanical Systems, Electronics). Their five-phase authoring flow. We ship the same catalog **open-sourced as YAML**, richer than theirs, so it becomes the category default.

## Source
- https://docs.f7i.ai/docs/prevent/user-guides/component-templates
- Strategy: `docs/competitors/factory-ai-leapfrog-plan.md` #9

## Acceptance criteria
- [ ] `mira-hub/templates/*.yaml` — 10+ templates covering:
  - Electric motors (TEFC, TEAO), motor assemblies, VFDs, MCCs
  - Centrifugal pumps, positive-displacement pumps, booster stations
  - PLCs (Micro820, CompactLogix), HMI panels, control panels
  - Gearboxes, conveyors, compressors, valve assemblies
  - Power supplies, safety relays, monitoring equipment
- [ ] Each template: component hierarchy + specs + recommended PMs + safety requirements + common parts
- [ ] `GET /api/templates` lists; `POST /api/assets/from-template` creates an asset tree
- [ ] UI: "Use Template" picker on `(hub)/assets` new-asset flow
- [ ] Templates repo is MIT-licensed — publish to GitHub for community contribution

## Files
- `mira-hub/templates/**/*.yaml` (new dir)
- `mira-hub/src/lib/templates.ts` (loader + types)
- `mira-hub/src/app/api/templates/route.ts`
- `mira-hub/src/app/api/assets/from-template/route.ts`
