# Linear Backlog Triage Report

**Report Date:** 2026-05-15
**Total Issues:** 155
**Demo Deadline:** 2026-05-21 (6 days away)

---

## Summary

- **AUTO_CLOSE:** 0 issues (strict criteria only)
- **NEEDS_REVIEW:** 30 issues (widened criteria, flagged for operator review)
  - Type A' (recent GH closure): 12
  - Type D (within-Linear duplicates): 2
  - Type E (completed-claim language): 16
- **KEEP:** 125 issues (no match; leave in backlog)

---

## AUTO_CLOSE Candidates

**None.** All high-priority items and demo-sensitive issues are correctly filtered out.

---

## NEEDS_REVIEW: Type A' (Recent GitHub Closure, <7 day buffer)

| Linear ID | Title | GH Ref | Days Closed | Status | Reason |
|-----------|-------|--------|-------------|--------|--------|
| CRA-41 | [web-review/P1] (site-wide) — Button without acces... | mira#964 | 1 | Backlog | Recently closed in GitHub |
| CRA-44 | [web-review/P1] /magic — landing page has no H1... | mira#967 | 1 | Backlog | Recently closed in GitHub |
| CRA-48 | [web-review/P2] (site-wide) — Heading hierarchy sk... | mira#971 | 4 | Backlog | Recently closed in GitHub |
| CRA-61 | [web-review/P1] factorylm.com — apex CSP header mi... | mira#994 | 1 | Backlog | Recently closed in GitHub |
| CRA-63 | [web-review/P2] app.factorylm.com/pricing — Stripe... | mira#995 | 1 | Backlog | Recently closed in GitHub |
| CRA-78 | P1: /actions route slow paint 5.7s... | mira#1054 | 1 | Backlog | Recently closed in GitHub |
| CRA-80 | P2: hub-page-audit harness needs auth-aware mode... | mira#1056 | 1 | Backlog | Recently closed in GitHub |
| CRA-108 | [web-review/P1] factorylm.com — apex CSP header mi... | mira#994 | 1 | Backlog | Recently closed in GitHub |
| CRA-119 | [web-review/P2] app.factorylm.com/pricing — render... | mira#1115 | 1 | Backlog | Recently closed in GitHub |
| CRA-121 | [web-review/P2] app.factorylm.com/pricing — consol... | mira#1116 | 0 | Backlog | Recently closed in GitHub |
| CRA-122 | [web-review/P2] app.factorylm.com/pricing — color ... | mira#1117 | 1 | Backlog | Recently closed in GitHub |
| CRA-99 | [web-review/P1] factorylm.com / — SVG console erro... | mira#1094 | 1 | Backlog | Recently closed in GitHub |

**Action:** Review if development is confirmed complete. Safe to close if confirmed.

---

## NEEDS_REVIEW: Type D (Within-Linear Duplicates, Levenshtein <8)

**CRA-100:** [web-review/P2] factorylm.com / — color contrast failures (Lighthouse a11y 94/100)
- Reason: Possible within-Linear duplicate(s): CRA-186 (dist=6)
- Action: Merge or close after confirming with duplicate.

**CRA-186:** [web-review/P2] factorylm.com / — color contrast failures (Lighthouse a11y score 94/100)
- Reason: Possible within-Linear duplicate(s): CRA-100 (dist=6)
- Action: Merge or close after confirming with duplicate.

---

## NEEDS_REVIEW: Type E (Completed-Claim Language, Status Open)

| Linear ID | Title | Status | Days Updated | Reason |
|-----------|-------|--------|--------------|--------|
| CRA-12 | Unit 3 — Magic inbox (Postmark inbound → PDF → KB)... | Backlog | 11 | Contains completion language |
| CRA-45 | [web-review/P2] (site-wide) — Missing canonical li... | Backlog | 11 | Contains completion language |
| CRA-46 | [web-review/P2] (site-wide) — Incomplete Open Grap... | Backlog | 11 | Contains completion language |
| CRA-51 | [web-review/P3] (site-wide) — Missing twitter:card... | Backlog | 11 | Contains completion language |
| CRA-83 | RAG cross-vendor citation pollution — Yaskawa/Rock... | Backlog | 7 | Contains completion language |
| CRA-101 | [web-review/P2] factorylm.com — 3,335 KiB cache sa... | Backlog | 5 | Contains completion language |
| CRA-102 | [web-review/P2] factorylm.com / — label-content-na... | Backlog | 5 | Contains completion language |
| CRA-103 | [web-review/P2] factorylm.com / — render-blocking ... | Backlog | 5 | Contains completion language |
| CRA-107 | [web-review/P2] (site-wide) — Tap targets < 44px o... | Backlog | 5 | Contains completion language |
| CRA-111 | [web-review/P1] app.factorylm.com/login — LCP 4.6s... | Backlog | 5 | Contains completion language |
| CRA-112 | [web-review/P2] app.factorylm.com/pricing — 12 tap... | Backlog | 5 | Contains completion language |
| CRA-116 | [web-review/P2] app.factorylm.com / — 3-hop redire... | Backlog | 5 | Contains completion language |
| CRA-118 | [web-review/P2] app.factorylm.com/login — 92 KiB u... | Backlog | 5 | Contains completion language |
| CRA-247 | ralph-phase1 ✓: variable-manifest.json committed —... | Backlog | 4 | Contains completion language |
| CRA-259 | feat(api): Build i3X-compatible API facade over KG... | Backlog | 3 | Contains completion language |
| CRA-272 | chore(ops): upgrade VPS /opt/mira-deploy-cra to cu... | Backlog | 3 | Contains completion language |

**Action:** Verify status matches actual state. Update status if completed, or add clarifying comment if work is still in progress.

---

## Duplicate Clusters (Type D)

**Cluster 1:**
- Primary: CRA-100
- Possible duplicates: CRA-186

**Cluster 2:**
- Primary: CRA-186
- Possible duplicates: CRA-100

---

## Sanity Checks

✓ **No AUTO_CLOSE with priority=1 (Urgent):**
  Count: 0 (expected 0)

✓ **No AUTO_CLOSE in Demo Readiness or Automation Tie-In:**
  Count: 0 (expected 0)

✓ **No AUTO_CLOSE with demo markers in title/body:**
  Count: 0 (expected 0)

✓ **NEEDS_REVIEW count by type:**
  A' (recent closure): 12
  D (duplicates): 2
  E (completed language): 16
  Total: 30

---

## Top 10 Oldest Issues in Backlog (KEEP)

| Linear ID | Title | Created | Days Old | Priority | Status |
|-----------|-------|---------|----------|----------|--------|
| CRA-10 | W7–W9 sales push — 30 prospects/wk, 3 demos/wk (Ju... | 12d ago | 12 | 🟡 | Backlog |
| CRA-34 | factorylm #138 — feat(brain): remote HTTP MCP serv... | 11d ago | 11 | 🟡 | Backlog |
| CRA-35 | factorylm #137 — fix(ci): brain-feed circuit break... | 11d ago | 11 | 🟡 | Backlog |
| CRA-36 | factorylm #106 — Add health check endpoint to disc... | 11d ago | 11 | 🟢 | Backlog |
| CRA-39 | [web-review/P1] (site-wide) — NEXT_PUBLIC_PIPELINE... | 11d ago | 11 | 🟠 | Backlog |
| CRA-42 | [web-review/P1] /admin/roles — page returns 404 (r... | 11d ago | 11 | 🟠 | Backlog |
| CRA-47 | [web-review/P2] (site-wide) — ~6 dead clickables p... | 11d ago | 11 | 🟡 | Backlog |
| CRA-49 | [web-review/P2] (site-wide) — 5 tap targets <44px ... | 11d ago | 11 | 🟡 | Backlog |
| CRA-50 | [web-review/P2] /login — Lighthouse performance sc... | 11d ago | 11 | 🟡 | Backlog |
| CRA-62 | [web-review/P2] app.factorylm.com/admin/ → 404 (d8... | 10d ago | 10 | 🟡 | Backlog |

---

## Operator Notes

- **Demo deadline is 6 days away (2026-05-21).** Any NEEDS_REVIEW closure should be reviewed carefully.
- **Type A' candidates** are safe closes if development is confirmed complete.
- **Type D candidates** may represent genuine duplicate work — merge or consolidate if appropriate.
- **Type E candidates** likely have status mismatches — update status or clarify in comments.
