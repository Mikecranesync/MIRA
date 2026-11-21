# 5. Build backlog — PENDING Foreman's repo-first REUSE/CONNECT/FINISH review
Reuse existing Hub notebook + manual-rag path. No broad platform.

## Before outreach
1. Land landing-page truth fix PR #4570 (prices off, remove unproven claims). FINISH
2. Re-chunk one-off script (clone repair-garbled-chunks.ts, dry run default) → re-run PF525 D4 to target 6/6 (#4859). CONNECT/S
3. #4851 leftover fault-table split. S
4. #4858 de-energize line quoting OEM text, ships with #4842 fix. S–M
5. Re-run prod retest on current build 92e892a4. Measurable outcome: the number we quote.

## Before a demo
6. Merge #4791 (A5001 family match, #4788) + readiness-honesty: "ready" only when citable. FINISH
7. **Approved document revisions:** show manual edition/revision on the citation; owner approves which rev is live (reuse document metadata). S
8. **Asset identity:** one notebook = one asset with a site tag/nameplate fields (reuse notebook identity). S
9. **Data permissions:** merge tenant-isolation proof #4674; run on prod; one site per tenant. S
10. **Integration failure handling:** failed answer shows Retry (#4846); upload shows real state, not "queued" (#4784); double-tap Send (R5). S
11. Phone viewer fixes #4749/#4847/large-PDF black screen. S–M
12. **Measurable outcomes:** per-pilot test-set runner + usage/time-to-answer report (reuse eval tooling, #4801). M

## Customer-specific after discovery
13. Load that site's manuals at approved revs; build its frozen test set.
14. Optional: read-only CMMS link to show asset's open WOs (connector research in briefs/2026-10-25-*). Only if buyer asks.
15. Optional: inspection checklist (e.g. brake-gap) as notebook doc — proposed, not built.
16. Scanned-manual OCR if their manuals are scans (#2562).
