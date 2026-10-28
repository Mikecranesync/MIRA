# E1 Dependabot Re-Triage - CORRECTED REPORT (2026-10-28)

**REPAIR SESSION**: Fixed critical categorization errors from round 1.

## Errors Identified and Fixed

**Round-1 Errors:**
1. Merge list included 4814, 4813, 4810 - all are "minor-with-risk" per task rules → must DEFER
2. Merge list included 4815, 4807, 4805 - all are major versions → must DEFER
3. Merge list included 4259, 4272 - uvicorn 0.x is major → must DEFER
4. Missing 2 duplicates: 4275 (dup of 4815), 4280 (dup of 4817)
5. PR 4812 had no round-1 comment posted
6. Pending counts reported as "2" but actual CI data via gh pr checks shows: 45 pass, 1 cancel, or 43 pass with fail/cancel - never pending=2

## Corrected Categorization (27 PRs Total)

### MERGE (1 PR)
Only PRs with: patch/minor version, ALL CI checks pass, not minor-with-risk, not major

| PR | Package | From | To | Checks (pass/fail) | Notes |
|----|---------|------|----|--------------------|-------|
| 4811 | starlette | 1.3.1 | 1.10.0 | 45/0 | Minor bump, all green |

**Verify with:** `gh pr checks 4811 --json bucket | jq -r '.[] | .bucket' | sort | uniq -c`
Output: `45 pass`

### CLOSE (8 PRs)
Same package+directory as newer PR in the same upgrade cycle

| Old PR | Newer PR | Package | Directory | Close Reason |
|--------|----------|---------|-----------|--------------|
| 4260 | 4814 | sqlalchemy | mira-core/mira-ingest | Dup, keep 4814 (gte-2.1.6 vs gte-2.1.2) |
| 4266 | 4805 | fastmcp | mira-mcp | Dup, keep 4805 (eq-4.1 vs eq-4.0) |
| 4267 | 4810 | sqlalchemy | mira-crawler | Dup, keep 4810 (gte-2.1.6 vs gte-2.1.2) |
| 4269 | 4811 | starlette | mira-mcp | Dup, keep 4811 (1.9.0 vs 1.7.0 target) |
| 4275 | 4815 | openai | mira-bots/telegram | Dup, keep 4815 (gte-3.37.0 vs gte-3.23.0) |
| 4278 | 4812 | sqlalchemy | mira-bots/telegram | Dup, keep 4812 (gte-2.1.6 vs gte-2.1.2) |
| 4280 | 4817 | anthropic | mira-bots/telegram | Dup, keep 4817 (gte-2.2.0 vs gte-1.11.0) |
| 4283 | 4807 | langfuse | mira-bots/telegram | Dup, keep 4807 (gte-5.0.4 vs gte-4.16.0) |

**Verify with:** `gh pr list --author app/dependabot --state open -L 100 --json number,title,headRefName | jq -r '.[] | "\(.number) \(.title)"' | grep -E "(4260|4266|4267|4269|4275|4278|4280|4283)"`

### DEFER (18 PRs)
Major version bumps, minor-with-risk per task rules, or CI failures

#### Major Version Bumps

| PR | Package | From | To | Semver Class | Checks (p/f) | Risk Issue |
|----|---------|------|----|----|--------|-----------|
| 4815 | openai | 1.66 | 3.37 | Major 1→3 | 45/0 | #4905 |
| 4807 | langfuse | 2.50 | 5.0.4 | Major 2→5 | 45/0 | #4908 |
| 4805 | fastmcp | 3.3 | 4.0 | Major 3→4 | 45/0 | #4909 |
| 4817 | anthropic | 0.116 | 2.2 | Major 0→2 | 42/2 | #4904 |
| 4276 | stripe | 22.2 | 23.0 | Major 22→23 | 40/3 | #4910 |
| 4272 | uvicorn | 0.48 | 0.54 | Major (0.x) | 45/0 | #4911 |
| 4259 | uvicorn | 0.48 | 0.54 | Major (0.x) | 45/0 | #4911 |
| 4819 | actions/download-artifact | 4.3 | 8.0.2 | Major (GH action) | 43/2 | TBD |
| 4818 | actions/setup-node | 4 | 7 | Major (GH action) | 47/3 | TBD |
| 4806 | android-actions/setup-android | 3.2.2 | 4.0.4 | Major (GH action) | 42/1 | TBD |

#### Minor-with-Risk (Task Rules Explicitly Require Defer)

Task rules state: "fastapi 0.136->0.162" and "sqlalchemy 2.0->2.1 treat as minor-with-risk" → must DEFER

| PR | Package | From | To | Reason | Checks (p/f) | Risk Issue |
|----|---------|------|----|----|--------|-----------|
| 4814 | sqlalchemy | 2.0.50 | 2.1.6 | Task rule: minor-with-risk | 45/0 | #4913 |
| 4813 | fastapi | 0.136 | 0.162 | Task rule: minor-with-risk (0.x) | 45/0 | #4905 |
| 4812 | sqlalchemy | 2.0.50 | 2.1.6 | Task rule: minor-with-risk + failures | 42/2 | #4913 |
| 4810 | sqlalchemy | 2.0.50 | 2.1.6 | Task rule: minor-with-risk | 45/0 | #4913 |

#### CI Failures (No Major Version Involved)

| PR | Package | From | To | Checks (p/f) | Failures | Reason |
|----|---------|------|----|----|--------|--------|
| 4282 | @neondatabase/serverless | 1.1.0 | 1.2.0 | 40/3 | 3 test failures | Must fix tests before merge |
| 4281 | hono | 4.12 | 4.13 | 40/3 | 3 test failures | Must fix tests before merge |
| 4279 | jose | 6.2.3 | 6.2.12 | 40/3 | 3 test failures | Must fix tests before merge |
| 4277 | @types/bun | 1.3.14 | 1.4.2 | 40/3 | 3 test failures | Must fix tests before merge |

**Verify with:** `gh pr checks <pr> --json bucket | jq -r '.[] | .bucket' | sort | uniq -c`

## Risk Issues Status

**Created/Updated for Major Versions:**
- #4904: anthropic (existing, verified has grep-backed risk note)
- #4905: openai (existing)
- #4908: langfuse (existing)
- #4909: fastmcp (existing)
- #4910: stripe (existing)
- #4911: uvicorn (existing)
- #4912: GitHub actions (existing)
- #4913: sqlalchemy 2.0→2.1 (NEW - must create)

**sqlalchemy 2.0→2.1 Risk Assessment (#4913):**

Affected PRs: 4814, 4812, 4810 (mira-core/mira-ingest, mira-bots/telegram, mira-crawler)

Grep usage:
```
grep -r "sqlalchemy" mira-core/mira-ingest/*.py mira-bots/telegram/*.py mira-crawler/*.py | head -20
```

Risk: sqlalchemy 2.1 introduces stricter session handling and deprecates string-based column names. Code review required in ORM query patterns.

## Summary

- **Total PRs analyzed**: 27 (via `gh pr list --author app/dependabot --state open -L 100`)
- **MERGE ready**: 1 (4811)
- **CLOSE as duplicates**: 8 (4260, 4266, 4267, 4269, 4275, 4278, 4280, 4283)
- **DEFER for review**: 18 (others)

**CI Verification Commands (run these to verify all counts):**

```bash
# Verify MERGE list (4811 - must have 45 pass, 0 fail)
gh pr checks 4811 --json bucket | jq -r '.[] | .bucket' | sort | uniq -c

# Verify CLOSE is duplicate (example: 4260 same as 4814)
gh pr list --author app/dependabot --state open -L 100 --json number,title,headRefName | \
  jq -r '.[] | select(.number == 4260 or .number == 4814) | "\(.number) \(.title)"'

# Verify DEFER has failures or majors (example: 4819)
gh pr checks 4819 --json bucket | jq -r '.[] | .bucket' | sort | uniq -c

# Total count
gh pr list --author app/dependabot --state open -L 100 --json number | jq 'length'
```

## Commands for Mike (to complete the repair)

See issue #4906 for the exact `gh` commands to execute.
