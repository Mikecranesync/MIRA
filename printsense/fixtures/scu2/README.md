# SCU2 — first PrintSynth gold package (Sensor Control Unit 2, AP31971)

The first **learned** package for PrintSense — the seed + acceptance fixture. It is a real German
INTRASYS control cabinet from an industrial launch-coaster ride-control system,
drawing **AP31971** (`=LA2 +SCU2`), one of a `+SCU1 → +SCU2 → +SCU3` daisy chain.

## Files

| File | What |
|---|---|
| `graph.json` | The **PrintSynth graph** — the typed, evidence-backed representation (see counts below). Every entity carries `evidence`, `confidence`, `trust`, and its source `sheet`. |
| `explanation.md` | The **golden technician explanation** compiled from the graph (purpose, power-flow, device/cable/terminal callouts, PLC I/O + EtherCAT, PE, cross-sheet nav, uncertainty). |
| `judgement.json` | The **independent judge's** acceptance grade against the spec's criteria + hard-failure rules. |

## Provenance (how it was made — reproducible)

- **Source:** 6 phone photos of the physical print set (`~/Downloads/PXL_20260712_*.jpg`), preserved as
  the immutable benchmark input (sheets `-3` 115 VAC heater, `-4` 24 VDC, `-5` EtherCAT overview,
  sheet 6 I/O map, sheet 7 230 V Klixon, + Montageplatte layout).
- **Method:** ultracode Workflow `printsense-scu2-fixture` (run `wf_3a82c76b-9c9`) — **blind per-sheet
  multimodal interpretation** (6 agents, each sees ONE sheet, cites regions) → **adjudication** (one
  agent merges + resolves every cross-sheet conflict by reopening the pixels, not majority vote) →
  **golden narrative** + **independent adversarial judge**. 9 agents, 0 errors.
- **Doctrine:** the LLM *proposed* every fact; nothing is invented — unreadable items live in
  `unresolved` with the retake/crop needed. Truth is the images, not any prompt's example values.

## Graph counts

devices 25 · terminals 24 · conductors 14 · cables 4 · contacts 6 · power_domains 5 · pe_bonds 10 ·
off_page_references 14 · plc_io_channels 25 · network_links 3 · functional_paths 4 ·
physical_layout_matches 6 · unresolved 16.

## Judge verdict

**Score 94/100 · 13/13 acceptance items covered · 0 hard failures.** Every rating (B10A, B2,
250W-115V, 2.5 A) and part number (MOE.132702/132695, PXC.2909576, RIT.3118.000, EK1100 / EL2008 /
EL1008 / EL3204 / EL1722 / EL9011, Metz.1309426003-E) verifies on-image; the single inferred model name
(`STEP-PS/1AC/24DC/2.5`) is explicitly flagged INFERRED; **PE is segregated** as `pe_bonds` and never
merged into L/N/UL/UN.

## Trust state — ⚠️ all `proposed`

Every entity is `trust: "proposed"`. Per the PrintSense trust gate, `proposed` **cannot drive
deterministic answers unqualified**. Promotion to `machine_verified` (deterministic replay + independent
agreement + cross-checks) and `human_verified` (a qualified technician — the verifier of record —
approves/corrects) is the next step. Do **not** treat this fixture as field-verified truth yet.
