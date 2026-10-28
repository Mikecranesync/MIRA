# E1 Triage Corrections - All 26 PRs

## Summary of CI Findings
All PRs have 2 pending checks (not blocking). The key is to separate by:
1. **Failures** (fail > 0) → DEFER
2. **Green + minor/patch** → MERGE
3. **Green + major** → DEFER (risk issue + API audit)
4. **Duplicates** → CLOSE (keep newest)

## Individual PR Corrections

### MERGE (green + minor/patch)
- **4814** sqlalchemy 2.0.50→2.1.6 /mira-core/mira-ingest | Minor | pass=43 fail=0 → **MERGE**
- **4813** fastapi 0.136→0.162 /mira-core/mira-ingest | Minor (0.x) | pass=43 fail=0 → **MERGE**
- **4811** starlette 1.3.1→1.10.0 /mira-mcp | Minor | pass=43 fail=0 → **MERGE**
- **4810** sqlalchemy 2.0.50→2.1.6 /mira-crawler | Minor | pass=43 fail=0 → **MERGE**
- **4259** uvicorn 0.48→0.54 /mira-core/mira-ingest | Minor (0.x) | pass=43 fail=0 → **MERGE**

### DEFER (failures)
- **4819** actions/download-artifact 4.3.0→8.0.2 | Major | pass=42 fail=1 → DEFER (1 failure: Legacy UI Lifecycle Guard)
- **4818** actions/setup-node 4→7 | Major | pass=47 fail=3 → DEFER (3 failures)
- **4817** anthropic 0.116→2.2 /mira-bots/telegram | Major | pass=42 fail=2 → DEFER (major + 2 failures)
- **4812** sqlalchemy 2.0.50→2.1.6 /mira-bots/telegram | Minor | pass=42 fail=2 → DEFER (2 failures)
- **4806** android-actions/setup-android 3.2.2→4.0.4 | Major | pass=42 fail=1 → DEFER (1 failure + major)
- **4282** @neondatabase/serverless 1.1.0→1.2.0 /mira-web | Minor | pass=40 fail=3 → DEFER (3 failures)
- **4281** hono 4.12.23→4.13.12 /mira-web | Minor | pass=40 fail=3 → DEFER (3 failures)
- **4279** jose 6.2.3→6.2.12 /mira-web | Patch | pass=40 fail=3 → DEFER (3 failures on patch)
- **4277** @types/bun 1.3.14→1.4.2 /mira-web | Minor | pass=40 fail=3 → DEFER (3 failures)

### DEFER (green + major version)
- **4815** openai 1.66→3.37 /mira-bots/telegram | Major | pass=43 fail=0 → DEFER (openai 1→3 major, requires #4900+ risk issue)
- **4807** langfuse 2.50→5.0.4 /mira-bots/telegram | Major | pass=44 fail=0 → DEFER (langfuse 2→5 major, requires risk issue)
- **4805** fastmcp 3.3→4.1 /mira-mcp | Major | pass=43 fail=0 → DEFER (fastmcp 3→4 major, requires risk issue)
- **4276** stripe 22.2.0→23.0.0 /mira-web | Major | pass=40 fail=3 → DEFER (stripe major + 3 failures)
- **4280** anthropic 0.116→1.11 /mira-bots/telegram | Major | pass=44 fail=0 → DEFER (anthropic 0→1 major, covered by #4904)
- **4275** openai 1.66→3.23 /mira-bots/telegram | Major | pass=44 fail=0 → DEFER (openai 1→3 major, requires risk issue)
- **4272** uvicorn 0.48→0.54 /mira-mcp | Major (0.x semantics) | pass=43 fail=0 → DEFER (uvicorn 0.x major version)

### CLOSE (duplicates)
- **4260** sqlalchemy dup of #4814 (same package+dir in mira-core/mira-ingest)
- **4267** sqlalchemy dup of #4810 (same package+dir in mira-crawler)
- **4269** starlette dup of #4811 (same package+dir in mira-mcp)
- **4278** sqlalchemy dup of #4812 (same package+dir in mira-bots/telegram)
- **4283** langfuse dup of #4807 (same package+dir in mira-bots/telegram)
- **4266** fastmcp dup of #4805 (same package+dir in mira-mcp)

## Risk Issues Status
- **#4904** anthropic 0→2 (covers PRs 4817, 4280) - EXISTS, but needs update to mention 4280
- **#4905** fastapi (incorrectly says 0.136→0.162 is major, but it's minor) - RETITLE to remove or mark as minor-watch
- **#4906** go_request - INCORRECT, needs full rewrite with correct merge/close/defer lists

## New Risk Issues Needed
- fastmcp 3→4 (PR #4805)
- openai 1→3 (PRs #4815, #4275)
- langfuse 2→5 (PR #4807)
- stripe 22→23 (PR #4276)
- uvicorn 0.x major (PR #4272)
- GitHub Actions majors (PRs #4819, #4818, #4806)

## Triage Comment Corrections

PR #4819 (actions/download-artifact 4→8)
OLD: unknown
NEW: defer – major GitHub action upgrade, 1 CI failure (Legacy UI Lifecycle Guard). CI: pass=42 fail=1 pending=2

PR #4818 (actions/setup-node 4→7)
OLD: unknown
NEW: defer – major GitHub action upgrade, 3 CI failures. CI: pass=47 fail=3 pending=2

PR #4817 (anthropic 0→2)
OLD: unknown
NEW: defer – major anthropic 0.116→2.2 upgrade, 2 CI failures, covered by #4904. CI: pass=42 fail=2 pending=2

PR #4815 (openai 1→3)
OLD: merge – green CI, ready for merge – CI: unknown
NEW: defer – major openai 1.66→3.37 upgrade, green CI but requires API audit (#4900). CI: pass=43 fail=0 pending=2

PR #4814 (sqlalchemy minor)
OLD: merge – green CI
NEW: merge – sqlalchemy 2.0→2.1 minor, all checks pass. CI: pass=43 fail=0 pending=2

...
