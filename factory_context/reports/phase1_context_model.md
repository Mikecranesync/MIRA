# Phase 1 — Contextual Factory Model + UNS Draft (approval-ready)

source: `discovery_corpus/fixtures/synthetic_factory_export.json`

## Summary
- entities: 1 enterprise / 1 site / 2 area / 2 line / 2 (proposed) cell / 3 asset
- signals: 25 (live + metadata) ; relationships: 9
- suggestions: 45 total, 0 auto-approved (must be 0), 3 need review
- **no fact without evidence:** OK (0 violations)

## Entity UNS draft (enterprise -> asset)
| level | uns_path | name | confidence | status |
|---|---|---|---|---|
| enterprise | `synthetic_beverage_co` | Synthetic Beverage Co | high | suggested |
| site | `synthetic_beverage_co.demo_site` | Demo Site | high | suggested |
| area | `synthetic_beverage_co.demo_site.bottling` | Bottling | high | suggested |
| area | `synthetic_beverage_co.demo_site.liquid_processing` | Liquid Processing | high | suggested |
| line | `synthetic_beverage_co.demo_site.bottling.bottlingline1` | BottlingLine1 | high | suggested |
| line | `synthetic_beverage_co.demo_site.liquid_processing.tankfarm1` | TankFarm1 | high | suggested |
| cell | `synthetic_beverage_co.demo_site.bottling.bottlingline1.bottlingline1_cell` | BottlingLine1 cell | low | needs_review |
| cell | `synthetic_beverage_co.demo_site.liquid_processing.tankfarm1.tankfarm1_cell` | TankFarm1 cell | low | needs_review |
| asset | `synthetic_beverage_co.demo_site.bottling.bottlingline1.caploader01` | CapLoader01 | high | suggested |
| asset | `synthetic_beverage_co.demo_site.bottling.bottlingline1.filler01` | Filler01 | high | suggested |
| asset | `synthetic_beverage_co.demo_site.liquid_processing.tankfarm1.tank01` | Tank01 | high | suggested |

## Live signal UNS draft (by archetype)
### live_bool (6)
- `synthetic_beverage_co.demo_site.bottling.bottlingline1.caploader01.status.productionrun_running`  (medium, suggested)  unit=-
- `synthetic_beverage_co.demo_site.bottling.bottlingline1.caploader01.status.blocked_value_value`  (medium, suggested)  unit=-
- `synthetic_beverage_co.demo_site.bottling.bottlingline1.caploader01.status.starved_value_value`  (medium, suggested)  unit=-
- `synthetic_beverage_co.demo_site.bottling.bottlingline1.filler01.status.productionrun_running`  (medium, suggested)  unit=-
- `synthetic_beverage_co.demo_site.bottling.bottlingline1.filler01.status.blocked_value_value`  (medium, suggested)  unit=-
- `synthetic_beverage_co.demo_site.bottling.bottlingline1.filler01.status.starved_value_value`  (medium, suggested)  unit=-
### live_counter (3)
- `synthetic_beverage_co.demo_site.bottling.bottlingline1.caploader01.production.counts_outfeed_value_value`  (medium, suggested)  unit=Units
- `synthetic_beverage_co.demo_site.bottling.bottlingline1.filler01.production.counts_outfeed_value_value`  (medium, suggested)  unit=Units
- `synthetic_beverage_co.demo_site.bottling.bottlingline1.filler01.production.counts_defect_value_value`  (medium, suggested)  unit=Units
### live_state (4)
- `synthetic_beverage_co.demo_site.bottling.bottlingline1.caploader01.status.state_name`  (medium, suggested)  unit=-
- `synthetic_beverage_co.demo_site.bottling.bottlingline1.caploader01.status.state_duration_totalseconds_value`  (medium, suggested)  unit=s
- `synthetic_beverage_co.demo_site.bottling.bottlingline1.filler01.status.state_name`  (medium, suggested)  unit=-
- `synthetic_beverage_co.demo_site.bottling.bottlingline1.filler01.status.state_duration_totalseconds_value`  (medium, suggested)  unit=s
### live_analog (5)
- `synthetic_beverage_co.demo_site.liquid_processing.tankfarm1.tank01.process.level_value_value`  (medium, suggested)  unit=%
- `synthetic_beverage_co.demo_site.liquid_processing.tankfarm1.tank01.process.flow_value_value`  (medium, suggested)  unit=L/min
- `synthetic_beverage_co.demo_site.liquid_processing.tankfarm1.tank01.process.temperature_value_value`  (medium, suggested)  unit=°C
- `synthetic_beverage_co.demo_site.liquid_processing.tankfarm1.tank01.process.pressure_value_value`  (medium, suggested)  unit=bar
- `synthetic_beverage_co.demo_site.liquid_processing.tankfarm1.tank01.process.density_value_value`  (medium, suggested)  unit=kg/L

- static_metadata signals (excluded from UNS draft): 7
- unknown signals (needs_review): 0

## Relationships
- `contains` (structural, high): 8
- `feeds` (inferred upstream->downstream, low/needs_review): 1
  - `synthetic_beverage_co.demo_site.bottling.bottlingline1.caploader01` -> `synthetic_beverage_co.demo_site.bottling.bottlingline1.filler01`  (low, needs_review)

## Needs review (uncertain -- not presented as fact)
- [low] No cell layer is present in the evidence; assets attach directly to line 'BottlingLine1'. A cell grouping is OPTIONALLY proposed for review -- not asserted.
- [low] No cell layer is present in the evidence; assets attach directly to line 'TankFarm1'. A cell grouping is OPTIONALLY proposed for review -- not asserted.
- [low] Inferred material flow 'synthetic_beverage_co.demo_site.bottling.bottlingline1.caploader01' -> 'synthetic_beverage_co.demo_site.bottling.bottlingline1.filler01' from asset order within the line (export order; physical flow NOT confirmed by evidence).

_Every row above is a SUGGESTION carrying source evidence + confidence + the human approval it needs. Nothing here is an asserted fact; a Hub reviewer accepts, rejects, or sends each to review._
