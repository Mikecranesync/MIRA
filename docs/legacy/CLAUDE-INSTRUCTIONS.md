# CLAUDE-INSTRUCTIONS.md

**Standing orders for every Claude Code session on the MIRA project**

---

## 1. Startup Ritual

Every session, before doing anything else:

1. Read `MIRA-MASTER-PLAN.md` (this project's living plan)
2. Read `~/.claude/projects/C--Users-hharp-Documents-MIRA/memory/MEMORY.md`
3. Print this status block:

```
MIRA v{version} | Phase: {active_phase} | Status: {status}
Last session: {date} — {summary}
Next task: {next_unchecked_item}
```

If either file is missing, warn the user immediately.

---

## 2. Session Modes

The user starts a session with one of three modes. If no mode is specified, ask which one.

### CONTINUE

Pick up where we left off. Read the plan, find the next unchecked task in the current active phase, execute it. Do not skip ahead. Do not go backward.

### NEXT

Current phase is complete. Move to the next phase. Show what is coming: list all unchecked tasks, identify dependencies, estimate effort. Wait for approval before starting work.

### AUDIT

Read-only mode. Do not change anything. Check the health of every component:

- Container status (`docker ps`)
- Git status of all 4 repos (uncommitted changes, ahead/behind remote)
- SQLite tables exist and have data
- Ollama models loaded
- Key environment variables present in Doppler
- Last session log entry

Print a full health report. Flag anything broken, stale, or missing.

---

## 3. During-Session Rules

These rules are always in effect. No exceptions unless Mike explicitly overrides.

### Build discipline

- No skipping tasks in the checklist. Execute in order.
- No breaking working code to build new features.
- Test before shipping. Verify before tagging.
- One repo at a time. Commit before switching to another repo.

### Tool preferences

- CLI over MCP. Bash commands always preferred over MCP server equivalents.
- Doppler for all secrets. Never read .env files directly, never hardcode tokens.
- Show diffs before committing. Run `git diff --stat` and wait for explicit approval.

### Safety

- Never restart the bot without asking Mike first. The bot being down means technicians lose access.
- Never run destructive git commands (`reset --hard`, `push --force`) without explicit approval.
- Never docker build over SSH to the Mac Mini. Use the docker cp workaround (see memory: feedback_docker_ssh.md).

### Architecture constraints (AD-01 through AD-10)

- No cloud APIs. All inference stays on Ollama localhost:11434.
- No LangChain, no n8n, no TensorFlow.
- Apache 2.0 or MIT licenses only. Flag anything unclear.
- Respect 16GB RAM ceiling. Max model size 13B.
- Equipment-agnostic. Only .env and knowledge-base documents change per site.

---

## 4. End-of-Session Ritual

Before ending any session:

1. **Update MIRA-MASTER-PLAN.md:**
   - Check off completed tasks with `[x]`
   - Add a row to the Session Log table
   - Update the Version & Status header if anything changed

2. **Handle uncommitted changes:**
   - Run `git status` in every repo that was touched
   - Show `git diff --stat` for each
   - Wait for explicit approval before committing
   - Use descriptive commit messages (`feat:`, `fix:`, `chore:`, `docs:`)

3. **Tag if a phase was completed:**
   - Only after ALL checklist items are checked
   - Only after live test confirmed by Mike
   - Apply to all affected repos

4. **Update MEMORY.md if there are new learnings:**
   - New infrastructure details
   - New gotchas or workarounds
   - Changed credentials or endpoints

5. **Print closing status block:**

```
Session complete.
Completed: {list of items checked off this session}
Next up: {next unchecked item in active phase}
Repos touched: {list}
Uncommitted changes: {yes/no — list if yes}
```

---

## 5. Phase Completion Checklist

Before marking ANY phase as DONE in the master plan, every item must be true:

- [ ] All checklist items in that phase are checked
- [ ] All affected containers healthy (`docker ps`)
- [ ] Live test passed (Mike confirmed via Telegram or direct observation)
- [ ] Changes committed to correct repos with descriptive messages
- [ ] Git tag applied (if warranted by the phase)
- [ ] MIRA-MASTER-PLAN.md updated (phase status, session log)
- [ ] MEMORY.md updated (if new learnings discovered)
- [ ] No regressions in existing functionality

---

## 6. Architecture Quick Reference

For fast context loading without reading the full master plan.

```
SERVICES:
  mira-core      Open WebUI          :3000             core-net, bot-net
  mira-mcpo      mcpo proxy          :8003             core-net
  mira-ingest    Photo/doc ingest    :8002             core-net
  mira-mcp       FastMCP + REST      :8000/:8001       core-net
  mira-bridge    Node-RED            :1880             core-net
  mira-bots      Telegram (polling)  no exposed port   bot-net, core-net

MODELS (Ollama on host :11434):
  mira:latest           qwen2.5:7b-instruct-q4_K_M    ~4.7 GB
  qwen2.5vl:7b          vision                         ~5.0 GB
  nomic-embed-text      embeddings                     ~0.3 GB

DATABASE:
  mira.db -> equipment_status, faults, maintenance_notes, conversation_state
  webui.db -> inside mira-core container (Docker volume)

REPOS (github.com/Mikecranesync):
  mira-core     mira-bridge     mira-bots     mira-mcp

KB: dd9004b9-3af2-4751-9993-3307e478e9a3 (10 docs)
```

---

## 7. File Reference

| File | Purpose | When to read |
|------|---------|-------------|
| `MIRA-MASTER-PLAN.md` | Living plan, phases, session log | Every session start |
| `CLAUDE-INSTRUCTIONS.md` | This file — behavioral rules | Every session start |
| `CLAUDE.md` | Technical reference, commands, schema | When building |
| `MIRA_v1.1.0_PRD.md` | GSD engine requirements (historical) | When debugging GSD |
| `MIRA-Build-Plan.md` | Original 10-phase plan (historical) | For context only |
| `MIRA Spec..md` | Condensed system prompt (historical) | For context only |
| `~/.claude/.../MEMORY.md` | Cross-session memory index | Every session start |

---

*End of standing orders — applies to every Claude Code session on the MIRA project*
