# /mira-create-demo-plant

Generate a realistic demo plant dataset for evals, screenshots, and SaaS onboarding demos. Demo data must be clearly marked **demo/fake** and live alongside existing seed fixtures.

## Required demo scenario

The canonical demo (already scripted in `marketing/comic-pipeline/` and `docs/specs/mira-component-intelligence-architecture.md`):

```
Site:      Lake Wales Demo (Lake Wales Plant)
Area:      Conveyor Lab
Line:      Line 5
Asset:     Conveyor Section B16
Component: Occupancy Sensor B16.2 (Banner Q4X, photoeye)
PLC tag:   1.SOC_B16_2
Fault:     1.SOC B16.2 OCCUPIED TOO LONG
Pattern:   14 repeats in 6 months
Fix:       Reset at Panel B16 (no parts required)
UNS path:  enterprise.lake_wales_demo.site.lake_wales_plant.area.conveyor_lab.line.line5.work_cell.conveyor_b16.pe_b16_2

NOTE: Enterprise was renamed from "stardust_racers" → "lake_wales_demo" (2026-05-24).
"Stardust Racers" is now reserved for the real Epic Universe rollercoaster tenant
(tools/seeds/epic-universe-stardust-racers.sql). Do not reuse that name for demo data.
```

This scenario MUST appear in the generated dataset.

## What this command generates

1. **UNS hierarchy** — JSON or SQL seed for `kg_entities` rows covering:
   enterprise → tenant → site → area → line → work_cell → asset → component for at least 2 lines and 5 assets. Tagged with `is_demo: true` (or equivalent).

2. **Component profiles** — at least 3 fully-fleshed profiles per the `component-profile-builder` schema:
   - Occupancy Sensor B16.2 (the star)
   - Conveyor motor + VFD
   - Sortation diverter

3. **PLC tags** — CSV / JSON tag exports covering ~30 tags across one Micro820 PLC. Includes `1.SOC_B16_2`, `Conveyor_B16_Run`, `Conveyor_B16_Fault`, VFD tags (`HR100..HR102` from root CLAUDE.md), with verified mappings to components.

4. **MQTT / Sparkplug topics** — sample topic strings matching the UNS paths (read-side; this is mock data, no live broker).

5. **Manuals** — 1–2 short PDF stubs (synthetic) or markdown stand-ins under `mira-core/data/demo/manuals/`. Include realistic PM tables, troubleshooting tables, fault-code tables for the demo components.

6. **Work-order history** — 14+ work orders against the Occupancy Sensor B16.2 asset, covering 6 months, 11 of which are reset-only. Includes 2 unrelated assets so the "repeat-failure" detector has something to filter.

7. **Knowledge-graph relationships** — `verified` and `proposed` examples covering: asset→component (HasComponent), component→fault (HasFaultMode), tag→component (DescribesComponent), manual→component (DocumentsComponent), wo→fault (ResolvesFault).

## Where to place fixtures

Match existing seed-file conventions in the repo:

- `mira-core/data/demo/` — JSON seed files (extends pattern in `mira-core/data/seed_cases.json`)
- `mira-bots/scripts/seed_demo_plant.py` — Python loader that reads the JSON and writes to NeonDB (extends pattern in `seed_kb.py`, `seed_device_kb.py`)
- `mira-core/data/demo/manuals/` — synthetic manual PDFs / markdown
- `tests/fixtures/demo_plant/` — eval-side copies for golden cases
- `tools/seedance-scenarios.yaml` — already references demo scenes; add the B16 scenario if not present

## How demo data is marked

- Every row gets `is_demo: true` (NeonDB column) **or** all entity ids carry a `demo_` prefix
- A top-level `DEMO_PLANT.md` in `mira-core/data/demo/` describing the plant, the scenarios, and how to load/unload them
- Loader script `seed_demo_plant.py` accepts `--clean` to remove demo rows before reseeding

## Tests

- Add a pytest under `tests/fixtures/demo_plant/test_demo_plant_loads.py` that:
  - Runs the loader against a test DB
  - Verifies the 14 work-orders + repeat-failure detector returns the right pattern
  - Verifies the UNS resolver returns Line 5 / Conveyor B16 / PE-B16-2 for the message `"B16.2 won't clear"`
  - Verifies the confirmation message contains "Occupancy Sensor B16.2" and "1.SOC B16.2 OCCUPIED TOO LONG"

## Constraints

- **No real customer data.** All names, IDs, manuals are synthetic.
- **Mark every row demo.** Don't pollute production tenants.
- **Don't ship real Banner/Rockwell PDFs** — write summary stand-ins that look like manuals but cite "DEMO" in headers.
- **One PR per dataset bump.** Keep diffs surveyable.

## Verification

- Run `python mira-bots/scripts/seed_demo_plant.py --dry-run` — should print row counts per table without writing.
- `pytest tests/fixtures/demo_plant/` — passes.
- After running with `--apply`, a Slack message "B16.2 won't clear" should trigger the full confirmation gate with the right context.

## Cross-references

- `docs/specs/mira-component-intelligence-architecture.md` — canonical B16 scenario
- `marketing/comic-pipeline/scripts/storyboard_v1.yaml` — visual storyboard
- `.claude/skills/uns-location-gate-designer/SKILL.md` — gate flow that consumes this data
- `.claude/skills/component-profile-builder/SKILL.md` — profile schema
