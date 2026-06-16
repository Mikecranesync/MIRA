# /mira-map-codebase

Produce or refresh a high-level map of the MIRA codebase, the critical product flow, and visible gaps.

## What this command does

1. **Walk top-level directories** under `/Users/charlienode/MIRA/`. Skip `node_modules/`, `.venv/`, `__pycache__/`, `dist/`, `build/`, `.claude/worktrees/`, `tools/lead-hunter/.hourly_state.json` and other generated artifacts.
2. **Group modules** by role:
   - **chat front-doors** — `mira-bots/{slack,telegram,email,gchat,reddit}/`
   - **engine / brain** — `mira-bots/shared/`, `mira-sidecar/` (legacy), `mira-pipeline/`
   - **MCP** — `mira-mcp/`
   - **ingestion** — `mira-crawler/`, `mira-core/mira-ingest/`
   - **UNS / live** — `mira-relay/`, `ignition/`, `plc/`
   - **storage** — NeonDB migrations in `docs/migrations/`, `mira-hub/db/migrations/`
   - **web / SaaS** — `mira-web/`, `mira-hub/`
   - **CMMS** — `mira-cmms/`
   - **ops / observability** — `mira-ops/`
   - **fixtures / tools** — `tests/`, `tools/`, `mira-bots/scripts/`, `mira-core/data/`
3. **Trace the MIRA-critical flow** (use `/mira-trace-technician-flow` for the deep version) and list each hop's file path.
4. **Identify missing architecture pieces** against `.claude/CLAUDE.md`:
   - Is the UNS resolver wired into the Slack handler?
   - Is the confirmation-gate enforced before troubleshooting?
   - Are KG writes going through `kg_writer.py`?
   - Are ingest chunks tagged with `uns_path`?
   - Are work-order creates draft-first?
5. **Identify technical debt**:
   - Anthropic mentions (should be 0 — removed PR #610)
   - LangChain / n8n / TensorFlow imports (banned per PRD §4)
   - Hardcoded IPs or secrets (vs Doppler)
   - `:latest` / `:main` Docker tags (use pinned digests)
   - `mira-sidecar/` legacy references that still block sunset
6. **Identify tests** covering each module — count per-module test files, flag any module with `tests/` empty or absent.
7. **Write or update `docs/codebase-map.md`** with:
   - Section per module group with paths + 1-line role
   - "Critical path" subsection
   - "Gaps vs `.claude/CLAUDE.md`" subsection
   - "Tech debt / cleanup" subsection
   - "Tests by module" table
   - Date stamp at top

## Output requirements

- Cite real file paths, never invented ones.
- If a module is empty or deferred (`mira-connect/`, `mira-hud/`), call that out.
- Keep total file under 400 lines — link out to deep specs, don't duplicate.
- Do not run destructive operations. Read-only walk.

## Sub-agents

Use `Explore` agents for parallel `ls`/`grep` work when the repo is large; never read whole large files when a `head` will do.

## Verification

After writing `docs/codebase-map.md`:
- `wc -l docs/codebase-map.md` — sanity-check size
- `grep -c '^##' docs/codebase-map.md` — confirm section count
- Cross-check the "Critical path" against the actual file paths via `ls`
