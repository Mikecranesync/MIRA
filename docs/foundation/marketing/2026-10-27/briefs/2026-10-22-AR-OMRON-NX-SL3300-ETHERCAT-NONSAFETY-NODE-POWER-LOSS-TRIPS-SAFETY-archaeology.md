# AR-2026-10-22-OMRON-NX-SL3300-ETHERCAT-NONSAFETY-NODE-POWER-LOSS-TRIPS-SAFETY — archaeology
MIRA tip: 15021b0da7b375aac3cc34fb1ba4707ef610dc4f (origin/main, fetched 2026-10-22 ~09:40 ET). Read-only; answer not researched; no MIRA calls.

## Verdict
PRIMARY: CONSOLIDATE (standing hold, same as all prior freezes) + CONNECT (Omron NX safety manuals absent from corpus).
## Technician need
Configuration/diagnosis of NX-SL3300 safety network: power loss on a non-safety EtherCAT NX node (7) trips whole safety system; comms loss alone does not. Needs Z930 (safety control unit), NX-ECC coupler (W519) and Sysmac NJ/NX EtherCAT/safety-network docs with citations.
## Current product path
mira-mobile/src/api/resources.ts (askNotebook) -> mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts -> mira-hub/src/lib/manual-rag.ts retrieveNodeChunks -> citation SSE. No Omron NX model mapping in manual-rag.ts.
## What already exists
- No Omron entries in mira-crawler/sources.yaml, tools/seeds/*.sql, mira-hub/src/lib/manual-rag.ts, answer_radar/ (rg "omron" = 0 hits).
- No hits anywhere in repo for NX-SL3300/SL3500/NJ501/Z930/W519/NX-ECC/NX-SID/NX-SOH.
- tools/vendor_coverage_ingest.py:92-134 Omron vendor stub (count 0); docs/v1/vendor-coverage-2026-04-15.md:35,52 Omron "MANUAL_INGEST_NEEDED, Demo-blocking" (MX2/CJ1M/CP1E only, 3 DDG chunks).
- mira-core/scripts/ingest_manuals.py:241 and manufacturer_normalize.py: Omron name normalization only.
- Safety: mira-hub/src/capabilities/answer-safety-check.ts:239 covers bypass of safety devices / hazardous energy generically; no safety-PLC/network-configuration pattern. Would flag answers that bypass safety functions; does not specifically classify safety-PLC config.
## Duplication
Omron refs in excluded surfaces only (mira-bots/shared/*, mira-bots/benchmarks/corpus/extractors/equipment.py:131 sysmac/NJ/NX regex, bot test harnesses). Do not reuse.
## Keep
manual-rag.ts retrieveNodeChunks, Hub notebook route, answer-safety-check.ts + answer-validation.ts, answer_radar/ harness.
## Retire/avoid
Bot-side Omron regex/manual_search (mira-bots), ask_api, pipeline, Open WebUI.
## Smallest step
Omron batch CONNECT: add Z930, W519 (NX-ECC20x), NX safety I/O, NJ/NX CPU (NJ501, NX-SL3500) to sources/seed + manual-rag model map; bind to a test notebook.
## Proof
Rerun answer_radar Hub batch with this seed after ingest; expect cited chunks from Z930/W519; safety check verdict recorded.
## Gate: BLOCKED
Unblock: (1) Z930 + W519 ingested and bound to a notebook with NX-SL3300/NX-ECC models; (2) retrieveNodeChunks returns cited Omron chunks for this seed; (3) standing CONSOLIDATE hold lifted by Mike.

| Manual | Status | Evidence |
|---|---|---|
| NX-SL3300 / NX safety control unit (Z930) | ABSENT | 0 hits repo-wide |
| NX-SID800/SID400/SOH200 safety I/O | ABSENT | 0 hits |
| NX EtherCAT coupler NX-ECC20x (W519) | ABSENT | 0 hits |
| Sysmac NJ/NX | ABSENT (bot regex only, excluded) | mira-bots/benchmarks/corpus/extractors/equipment.py:131 |
| NX-SL3500 | ABSENT | 0 hits |
| NJ501 | ABSENT | 0 hits |
Omron generally: PARTIAL-stub only (vendor_coverage doc: MX2/CJ1M/CP1E, MANUAL_INGEST_NEEDED).

## Repeat context
Omron freezes: 09-08 (Rockwell/Omron DeviceNet), 09-09 (Omron/Keyence EIP), 09-18 (CQM1), + 09-11 Keyence-vs-Sysmac compare -> this is 4th Omron freeze (5th Omron touch). NJ501/SL3500 appear only in Answer Radar candidate scans (/workspace/ar-2026-10-21/candidate-scan.md), not prior freezes.
## UNVERIFIED
- GitHub PR/issue search for Omron NX in Mikecranesync/MIRA not run (cursor-github not queried); prod DB/KB contents (only repo seeds checked).
