# AR-2026-10-23-ROCKWELL-MICRO850-2080-IF4-ANALOG-STUCK-MIN-MAX-UNTIL-POWER-CYCLE — archaeology
MIRA tip: 28430d68b43694f340465fccefa6f3196ee9c2fd (origin/main, fetched 2026-10-23 ~09:45 ET). Read-only; answer not researched; no MIRA calls.

## Verdict
PRIMARY: CONSOLIDATE (standing hold) + CONNECT (Micro800 hardware/plug-in manuals absent). Note: unlike other OEM gaps, retrieval routing already exists (MICRO800 family root), so only documents are missing.
## Technician need
Micro850 + 2080-IF4 plug-in: both analog channels latch min/max until power cycle, no fault, new module didn't help; evaluating 2085-IF4 expansion. Needs 2080-UM004 (plug-in specs/config), 2080-UM002 (controller), 2085-UM001, CCW config docs, cited.
## Current product path
mira-mobile/src/api/resources.ts askNotebook -> mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts -> mira-hub/src/lib/manual-rag.ts retrieveNodeChunks -> citation SSE.
## What already exists
- manual-rag.ts:337-341 ROCKWELL regex + FAMILY_ROOTS ["MICRO800", /^MICRO8\d0$/] — Micro850 notebook maps to Micro800 family (#4484, 08b4b634); :253 bareNumberFamilyRoot "800"; :336 "850" -> MICRO850 not ACS850.
- Closed #4511: fix for #4484 ambiguous-cover rejecting real Micro810 manual 2080-UM001 (implies 2080-UM001 was present in a Hub env; UNVERIFIED in seeds).
- tools/seeds/oem-manuals/chunks.jsonl + oem-manuals-knowledge.sql: Micro800 instruction-set MSG_MODBUS / ModbusLocPara pages only (FT Design Workbench help) — not I/O.
- tools/seeds/demo-conveyor-001.sql:303 references 2080-UM005 (Micro820) — reference text, not ingested manual (UNVERIFIED).
- Micro820 field-guide / demo seeds (gs11-field-guide-knowledge.sql, demo-hub-tenant.sql 2080-LC20, conveyor) — garage demo content, not 850/IF4.
- Other Rockwell in mira-crawler/sources.yaml: PowerFlex 525 (520-UM001) :145, PowerFlex 755 (750-PM001) :154, SLC500 (1747-UM011) :165, 100-C30 contactor :282, wye-delta 150-AT005 :365. PanelView/Kinetix: none in sources.yaml (prior briefs 10-14, 10-19 found them absent/partial).
- Open #403 "download 6 missing Rockwell publications for MIRA PLC kb": lists 9328-UM001 CCW User Manual (highest priority), 9328-QS003 CCW Quick Start, 2080-RM003 among others — a ready-made acquisition list to FINISH. Open #3636 corpus coverage gap umbrella.
- No hits repo-wide or in PR/issue search for 2080-UM002, 2080-UM004, 2080-IF4, 2085-IF4, 2085-UM001.
- answer_radar/: no Micro850/IF4 seed.
## Duplication
Micro800 content in mira-bots / garage-demo seeds is demo/excluded; do not reuse as corpus.
## Keep
manual-rag.ts MICRO800 family routing (#4484/#4511), Hub notebook route, answer-safety-check.ts, answer_radar/ harness, #403 acquisition list.
## Retire/avoid
Bot paths, ask_api, pipeline, Open WebUI; garage Micro820 demo seeds as evidence.
## Smallest step
Rockwell Micro800 batch CONNECT: add 2080-UM002, 2080-UM004, 2085-UM001, 9328-UM001 (CCW, per #403) to mira-crawler/sources.yaml (Rockwell literature block :143) + seed; bind to a Micro850 test notebook. Close out #403 alongside.
## Proof
Rerun answer_radar Hub batch with this seed; expect cited chunks from 2080-UM004 (2080-IF4 section) via MICRO800 family scope; confirm #4511 cover logic accepts the new covers.
## Gate: BLOCKED
Unblock: (1) 2080-UM004 + 2080-UM002 ingested and bound (2085-UM001, CCW 9328-UM001 nice-to-have); (2) retrieveNodeChunks returns cited 2080-IF4 chunks for a Micro850 notebook; (3) Mike lifts standing CONSOLIDATE hold.

| Manual | Status | Evidence |
|---|---|---|
| Micro800/Micro850 user manual 2080-UM002 | ABSENT | 0 hits repo/PRs/issues; routing ready manual-rag.ts:341 |
| Micro800 plug-in modules 2080-UM004 (2080-IF4) | ABSENT | 0 hits |
| 2085-IF4 expansion I/O 2085-UM001 | ABSENT | 0 hits |
| Connected Components Workbench (9328-UM001) | ABSENT (requested) | open #403 lists it as missing, highest priority |
| Micro800 instruction set (MSG_MODBUS only) | PARTIAL, off-topic | tools/seeds/oem-manuals/chunks.jsonl |
| Micro810 2080-UM001 | PARTIAL/UNVERIFIED | closed #4511 (Hub env), not in repo seeds |

## Repeat context
Rockwell freezes in /workspace/briefs: 09-08 DeviceNet, 09-15 Kinetix 5500, 09-22 CompactLogix, 09-30 GuardLogix, 10-01 Kinetix 6500, 10-14 PanelView/FTView, 10-19 Kinetix 6000 -> this is the 8th Rockwell freeze, first Micro800.
## UNVERIFIED
Production/staging KB contents (only repo seeds checked); acquisition allowlist specifics beyond sources.yaml; PR search used single combined query (issues+PRs).
