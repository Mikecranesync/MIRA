# GTM execution backlog — 2026-10-30 (preparation lane, #4982 stage 1)

Canonical schedule: the [MIRA Go-To-Market Plan](https://claude.ai/artifact/73QPJ4ksMqcrevw9T5x7uE).
Daily evidence log: #4372. This file is the prioritized worklist behind the plan's stage-1 rows; it
is not a second tracker (no dates of its own; owners are named or "unassigned").

Pilot status: **NO-GO**. T-1 fresh set 11/29 lexical, 15/29 hybrid (#4983); T-2 checker uncalibrated
(BRAVO fixing); T-3 12/16; T-4 blocked on the staging run; T-5 pass.

## Priority 1 — can start now, no approval needed

| # | Item | Owner | Depends on | Next action | Evidence when done |
|---|---|---|---|---|---|
| 1 | Review draft PR for the stage-1 prototypes (parts breakdown, Work Packet, gap check) | Codex exact-head review; Mike merges | — | run `scripts/adversarial-review-trusted.sh <PR> --review-only`; fix findings | GREEN/CONVERGED at the exact head |
| 2 | Work Packet: card layout for the parts table at phone width | unassigned | PR 1 | small CSS change in `tools/work-packet/build_packet.py` STYLE | mobile screenshot without horizontal scroll |
| 3 | Second OEM layout for the parts-breakdown extractor (e.g. a Rockwell or AutomationDirect parts sheet) | unassigned | — | add `tools/parts-breakdown/<oem>_breakdown.py` with a fictional fixture | tests + a real-sheet run noted in the README |
| 4 | Nameplate test with a real pump photo (not the data sheet) | Mike (photo) + unassigned (run) | a photo of the 5CP6120 nameplate, employer permission not needed for a pump nameplate without site info | `POST /nameplate/recognize/` on the staging notebook | candidate fields + confirmation recorded |
| 5 | T-2 checker fix and re-score on Mike's 40 labels | BRAVO | — | per #4870 | wrongly flagged good answers near 0/37 |
| 6 | T-1 next lever decision prep: cost/benefit of query rewriting vs a stronger embedder | CHARLIE T-1 session | — | #4983 | a measured number on a second fresh set |

## Priority 2 — needs one approval from Mike first

| # | Item | Owner | Waits on | Next action |
|---|---|---|---|---|
| 7 | Merge + deploy #4970 (HubSpot lead passthrough) | Mike | O4 | merge; deploy-vps same release; one example.com signup → one contact → delete |
| 8 | Merge #4985 (Mission Control plan link) + runbook redeploy | Mike | O10 | merge; set `MC_PLAN_URL`; runbook install steps |
| 9 | Merge #4980 as the source index | Mike | O3 | merge; owner column follow-up issue |
| 10 | Register for the SMRP Florida chapter meeting (Nov 6, Jacksonville) | Mike | O1 | email chapters@smrp.org for cost/non-member access |
| 11 | Confirm or drop the "ISA Tampa Nov 4" line | Mike | O1 | email ISAtampasection@gmail.com |
| 12 | Approve the outreach drafts (local draft §6 items) and the leave-behind card | Mike | website claims fix (#4434/#4570) | see `docs/gtm/outreach-queue-2026-10-30.md` |
| 13 | Website "what works today vs what's coming" copy into the claims registry | BRAVO builds, Mike merges | claims list approved | `docs/gtm/website-examples-2026-10-30.md` |
| 14 | Price for paid continuation and separately for setup services | Mike | O8 | `docs/gtm/decision-register-2026-10-30.md` pricing appendix |
| 15 | Close the 19 close-superseded PRs one by one (after checking each) | Mike or a delegated session | O6 | `docs/gtm/pr-backlog-triage-2026-10-30.md` (#4471 disputed: keep) |

## Priority 3 — waits on evidence, not on a date

| # | Item | Owner | Waits on |
|---|---|---|---|
| 16 | Brake-gap Smart Sheet on a real form (schema, numeric input, approval) | unassigned | a permitted source form + limits; `docs/gtm/smart-sheets-feasibility-2026-10-30.md` steps 4–10 |
| 17 | Work Packet persistence (`work_packets` table, technician sign-off capability, supervisor role) | unassigned | a design review; migrations only once the shape is settled (rule 8) |
| 18 | Photo-to-work-queue capture (experiment A) on synthetic screenshots | unassigned | the nameplate/OCR path proven on item 4 |
| 19 | Workflow trials with a real crew | Mike | items 16–18 proven on synthetic data; written employer permission (O9) |
| 20 | Diagnostic pilots | Mike | T-1…T-5 pass; Nov 21 gate review |
| 21 | Read-only CMMS/PLC connections | unassigned | rungs 1–3 proven; separate integration authorization |

## Disposable staging artifacts to sweep later
- Tenant `59e8ff15-2fde-41f0-94b9-105100963777` (demo-5cp6120-…@example.com) with notebook
  `c0ab3c00-6835-4c42-b03c-d158f16118f8`: keep while Mike asks questions; sweep with
  `mira-hub/scripts/provision-beta-gate.ts --cleanup <tenantId>` under Doppler stg; then delete
  `STAGING_DEMO_5CP6120_PW` from Doppler stg.
