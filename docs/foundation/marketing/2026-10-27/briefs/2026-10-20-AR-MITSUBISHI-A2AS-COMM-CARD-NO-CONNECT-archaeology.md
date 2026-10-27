# Path archaeology: AR-2026-10-20-MITSUBISHI-A2AS-COMM-CARD-NO-CONNECT-RD-FLASH-SD-DARK

**Technician need:** A PC can't talk to a MELSEC A2AS through its serial computer-link card. RD flashes, SD stays dark, and the PC shows no error. Need to know what to check.

**Frozen source:** PLCTalk 150162, OP hdaniel1171, posted 2026-10-20 04:26:59 ET. Frozen OP-only; replies not read.

**Evidence:** live read-only GitHub search. MIRA tip `b7d64bf3e361006c80b1a47329e80e465add26ce` (2026-10-20 02:47 ET). factorylm tip `67b2c64b`.

## Verdict
- **CONSOLIDATE (primary):** standing hold.
- **CONNECT (secondary):** full gap. There are no A-series or computer-link docs.
- **Gate: BLOCKED.** APPROVED FOR FACTORYLM OPS TEST: NO.

## What exists
- `A2AS`: 0 hits. `AJ71UC24 / A1SJ71UC24`: 0 hits.
- `path:mira-crawler mitsubishi`: 4 hits. They are only manufacturer-name normalization, discovery, and provenance policy (`ingest/manufacturer_normalize.py`, `tasks/discover.py`, `provenance_policy.yaml`, plus a test). There are no Mitsubishi source entries or manual URLs.
- `MELSEC`: 29 hits.
  - Answer Radar FIELD-SEED-004 runs (`answer_radar/runs/2026-09-27..29`, `answer_radar/seeds.py`). These come from a prior Hub staging run and are a seed, not a manual.
  - mira-bots benchmark corpus and v2 harness (excluded).
  - Nameplate benchmark.
- This is **not the first Mitsubishi freeze.** Earlier ones: 09-17 FX5U Modbus, 09-21 RJ71SEIP91, 09-23 GX Developer export, 09-29 Q06UDV Modbus. All were blocked on missing Mitsubishi manuals. Mitsubishi is now a 5x repeat gap, and the A-series is a new family within it.

## Duplication
`answer_radar/` in the repo already holds frozen seeds and Hub batch runs (FIELD-SEED-004). Reuse that harness for the re-ask. Do not create a new one.

## Unblock criteria
Each item must be in notebook `sourceDocIds`, model-bound, and retrievable via mira-mobile → Hub notebook chat → `retrieveNodeChunks` → citation SSE.
1. MELSEC A2AS / A2USH-S1 (AnS/A2AS) CPU user's manual.
2. Computer-link / serial module user's manual for the AJ71UC24 / A1SJ71UC24-R2/R4 class. Needed sections: wiring, station number and transmission settings, RD/SD LED meaning, protocol mode switches.
3. Optional: the GX Developer A-series connection setup.

**Recommendation:** do a single Mitsubishi batch CONNECT covering FX5U, iQ-R (RJ71SEIP91), Q (Q06UDV), A-series, and GX Developer.

## Proof to rerun
Re-ask the frozen question on the SUT through the existing `answer_radar` Hub batch harness.
