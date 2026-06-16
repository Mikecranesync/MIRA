## Why
Factory AI ships a proprietary 10-category × 4-severity taxonomy. We ship **ISO 14224** (the oil & gas / pharma / defense standard) as an opinionated default. This is a procurement-conversation win in regulated industries. MIT-licensed, open source, community-extendable.

## Source
- https://docs.f7i.ai/docs/api/failure-codes
- `docs/competitors/factory-ai-leapfrog-plan.md` #8
- ISO 14224:2016 (Petroleum, petrochemical and natural gas industries — Collection and exchange of reliability and maintenance data for equipment)

## Acceptance criteria
- [ ] Schema: `failure_codes` (code, name, description, category, severity, symptoms[], causes[], recommendations[], related_codes[], iso_14224_code)
- [ ] Seed: `mira-hub/taxonomies/iso-14224.yaml` with ~200 standard failure modes covering:
  - Rotating equipment (pumps, compressors, turbines, motors)
  - Static equipment (vessels, heat exchangers, piping)
  - Electrical (transformers, switchgear, UPS, batteries)
  - Safety/control (PSVs, BDVs, PLCs, sensors)
- [ ] CRUD: `/api/failure-codes/*`
- [ ] WO form: type-ahead failure-code picker with category + severity badges
- [ ] Export compliance: a report endpoint emits ISO 14224-shaped CSV for regulatory submissions
- [ ] README in `taxonomies/` noting MIT license and contribution guide

## Files
- `mira-hub/taxonomies/iso-14224.yaml`
- `mira-hub/migrations/NNN_failure_codes.sql`
- `mira-hub/src/app/api/failure-codes/**/*.ts`
