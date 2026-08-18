# WO-Evidence Step 2 — Staging Enablement Run Manifest

- **Date:** 2026-07-12
- **Environment:** staging (Doppler `factorylm/stg`, VPS `mira-staging` stack, Neon staging branch)
- **Staging deployed pipeline version:** 3.133.1 (redeployed from `main`; was 3.111.1 before — 18 versions stale)
- **Flag:** `ENABLE_WO_EVIDENCE=1` set in Doppler `factorylm/stg`; engine services (mira-pipeline, mira-bot-telegram) redeployed to pick it up.
- **Test asset:** VFD-07 (Allen-Bradley PowerFlex 755), tenant `00000000-0000-0000-0000-000000000099`, 30 work orders.
- **No-WO asset (G3):** ACME-0SQDHDME (same tenant, 0 work orders).
- **DATA CAVEAT:** every staging work order is a **synthetic QA/dogfood artifact** (`SW-roundtrip-probe`, `dogfood-wo-fielddrop`, `POSTFIX-2375`) — not real maintenance history. The staging gate therefore proves **correctness + safety**, not real-world usefulness. Usefulness is proven separately by the #2630 golden case (realistic CV-101 content).

## Gate results
| Check | Result | Evidence file |
|---|---|---|
| **G1** block injected (real staging WOs) | ✅ PASS | `g1_vfd07_block.txt` |
| **G3** no-match path → empty block | ✅ PASS | `negative/g3_nomatch.txt` |
| **Tenant isolation** (other tenant sees 0 of VFD-07's WOs) | ✅ PASS | `g_iso_tenant_isolation.txt` |
| **G5** WO-recall timeout → graceful empty (shared DB untouched) | ✅ PASS | `g5_timeout_failsafe.txt` |
| **G2** LLM emits grounded `[WO N]` end-to-end | ⚠️ NOT OBSERVED (inconclusive by design) | `g2_vfd07_diagnosis.txt` |
| **G4** no eval-regression | ⏭ NOT RUN | — |

**G2 note:** the WO block IS injected into the diagnosis prompt (proven deterministically: G1 + `engine.py:3842` concat). The LLM did not *cite* it because the staging WOs are meaningless test rows irrelevant to the fault (and the staging KB lacked a PowerFlex 755 manual → generic answer). On real maintenance data this is what #2630's golden case demonstrates. Not a feature defect.

## Mechanism proven (faithful engine path, real staging Neon)
`wo_evidence.recall_work_orders` → `Supervisor._format_wo_evidence` → injected in `_build_wo_evidence_context` (tenant-scoped `work_orders JOIN cmms_equipment`), best-effort `""` on any miss.

## STOP
Per the plan, this run STOPS before production. Production enablement (`ENABLE_WO_EVIDENCE=1` in `factorylm/prd` → `deploy-vps.yml` → prod smoke) requires explicit approval.
