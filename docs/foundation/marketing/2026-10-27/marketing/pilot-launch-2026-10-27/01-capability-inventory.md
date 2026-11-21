# 1. Honest capability inventory (Oct 27, 2026)
Source of truth: /workspace/marketing/capabilities.md (rebuilt Oct 27 ~7:40 AM ET). Only section A may be used as a product claim.

## A. Demonstrated on the real path (mira-mobile → Hub equipment-notebook chat → manual-rag → cited answer)
| Claim (as we may say it) | Evidence |
|---|---|
| Answers from an uploaded OEM manual and cites the page (Micro810, 5/5, p.57) | /workspace/punchlist/p1-p7-p8-p9-prod-2026-10-23.md; https://github.com/Mikecranesync/MIRA/issues/4607 |
| On prod, fault-code questions on two Rockwell manuals (PowerFlex 525, Micro820): right page 6/6, full answer **5/6** (F005 dropped its fix) | https://github.com/Mikecranesync/MIRA/issues/4607#issuecomment-6433026714 |
| Says "not in this manual" with no citation and no guess when the manual doesn't cover it (5/5) | p1-p7-p8-p9-prod-2026-10-23.md (TQ-04/05/06/27/28) |
| Tap a citation on desktop → manual opens at that page (~20 s render; PDF page number, #4794) | /workspace/punchlist/prover/p8-page57.webp |
| Web ↔ Android app conversation continuity (emulator, not a physical phone) | https://github.com/Mikecranesync/MIRA/pull/4619 |
| Not a CMMS; doesn't read PLC data or write work orders | gtm-readiness-2026-10-18.md (A5/A6) |
| Mike works onsite in Central Florida or remotely | approved claim A9 |

## B. Lab demo / partial (show live only, say what fails, never claim)
- Right page "in general" (R1): 0/6 forum threads fully right on staging; model-number and P041 misses; same question two answers (R7).
- Safety notes on hazardous questions (R3): staging only, generic; prod probe never run.
- Phone citation viewer (R4): black >60 s on 34 MB manual, off-by-one counter (#4847).
- Tenant separation (R9): 34/34 on staging only, PR #4674 unmerged.
- Attach-and-ask (R8): ~30 s to a cited answer on staging; readiness "1.0" ≠ citable (#4788).
- Siemens S7-1200/TP700, ABB ACS355: staging only.

## C. Proposed (not built or untested — never sell as existing)
CMMS sync/write-back, PLC/equipment data, digital inspections & measurement history, nameplate photo ID, OCR of scans, equipment history across shifts, guided procedures (untested), work-order close from phone (untested), SSO/SOC 2, predictive anything.

## Known gaps (state plainly in every demo)
1. **ACS355 A5001 abstain (#4788)** — MIRA wrongly says "not in the manual"; fix draft #4791 unmerged. /workspace/briefs/2026-10-26-4788-archaeology.md
2. **Right row, missing fix (#4842)** — 5/5 fault answers that cited the right row dropped part of its fix (Rockwell and ABB). /workspace/live-test/2026-10-27-missing-fix-pattern.md
3. **Re-chunk gap (#4859)** — #4850 fixes only new uploads; no way to re-process existing manuals. /workspace/briefs/2026-10-27-4842-4859-archaeology.md
4. **Safety line (#4858)** — 2/3 hands-on electrical answers lacked a de-energize line. /workspace/manuals/safety-deenergize-quotes-2026-10-27.md
5. Prod retest is **5 of 6**, on build cc0d26c1; current prod 92e892a4 not re-tested.
6. factorylm.com still over-claims (prices, CMMS sync, PLC tags); fix in draft https://github.com/Mikecranesync/MIRA/pull/4570.
