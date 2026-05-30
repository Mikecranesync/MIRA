# VPS Cowork / Hygiene Audit Runbook — 2026-05-19

**Target host:** MIRA production VPS (DigitalOcean — `72.60.175.144` per Mike / `165.245.138.91` per system-health doc / Tailscale `100.68.120.99`)
**Drafted on:** CHARLIE, 2026-05-19 (after Charlie cleanup pass — see `docs/system-health-2026-05-15.md` for prior VPS state)
**Use when:** running the equivalent Cowork/hygiene audit that was just completed on Charlie, adapted to VPS-specific keep/retire rules.

---

## How this differs from the Charlie audit

The generic prompt that worked on Charlie would be **dangerous on the VPS**. It treats every `factorylm` reference as a retirement candidate, but on the VPS that label covers **active production infrastructure**: the diagnostic engine, the Slack/Telegram bots, the chat path, the CMMS, and the RQ workers. Use the VPS-specific keep/retire list below — do **not** reuse the Charlie prompt verbatim.

---

## Paste this into Claude Code on the VPS

```
You are auditing this VPS as part of the Mira Copilot fleet hygiene pass.
Same shape as the Charlie audit, different keep/retire list. Be conservative:
AUDIT FIRST, then stop and ask before deleting anything.

CONTEXT — this is the MIRA production VPS (DigitalOcean).
Active production surfaces (KEEP, do not touch):
  - Open WebUI (port 3000→8080, container mira-core)
  - mira-pipeline OpenAI-compat API (port 9099)
  - mira-mcp REST + STDIO (ports 8000, 8001)
  - Atlas CMMS (atlas-api :8088→8080, atlas-db :5433)
  - mira-web (Hono/Bun, port 3200→3000) — factorylm.com + app.factorylm.com
  - mira-bot-telegram + mira-bot-slack (no exposed ports, bot-net)
  - mira-bridge Node-RED (port 1880)
  - mira-relay (cloud endpoint for Ignition factory→cloud tag streaming)
  - mira-docling (port 5001)
  - mira-ingest (port 8002→8001)
  - Redis (used by RQ workers — diagnostic engine background queue)
  - nginx reverse proxy (sites-enabled — see /etc/nginx/sites-enabled/)
  - Doppler CLI configured for factorylm/prd
  - NeonDB connection (off-VPS but credentials live here)
  - n8n workflow `7LMKcMmldZsu1l6g` (if present — confirm with Mike)

Active scheduled tasks (KEEP):
  - Any cron / systemd timer that hits /smoke endpoints
  - PR self-fix loop (scripts/pr_self_fix.sh) — manual-trigger only
  - Any GitHub Actions runner (if self-hosted)

RETIRE candidates (subject to Mike's approval):
  - Pre-rename docker compose project `mira` (replaced by mira-core / mira-cmms split)
  - Any container/volume tagged `latest` or `main` instead of pinned version
  - Stale nginx sites-enabled files with `.bak.*` suffix
    (per docs/system-health-2026-05-15.md: 6 of 17 are .bak.*)
  - Old container images not referenced by any docker-compose*.yml currently
    in the working copy
  - Cowork-style ephemeral session dirs anywhere on disk
  - factorylm-cosmos-cookoff / RIVET / RivetCEO / Pi Factory references
    (these should not exist on VPS at all — flag any that do)

PROCESSES TO FLAG (not auto-kill):
  - Zombie doppler+bun pairs from prior interactive sessions (same pattern
    that accumulated 105 procs on Charlie — check ps for stale claude-peers-mcp
    or similar)
  - Any python3 RAG / sidecar worker that doesn't match a current container
  - Old ChromaDB sidecar processes (mira-sidecar is "sunset pending" per
    docs/known-issues.md — should not be running, but flag if it is)

STEP 1 — IDENTIFY HOST + STATE
Run:
  hostname; uname -a; whoami
  uptime; df -h /; free -h
  docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
  docker compose -f docker-compose.yml ps
  docker images --format 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}' | head -40
  docker volume ls | head -40
Print as a single report.

STEP 2 — FIND COWORK / EPHEMERAL SESSION DIRS
  ls -la ~/.cowork ~/Library/Application\ Support/Cowork ~/.config/cowork 2>/dev/null
  find / -maxdepth 5 -iname '*cowork*' 2>/dev/null | grep -v '/proc\|/sys\|/var/lib/docker' | head -30
  find /tmp /var/tmp -iname '*claude*' -o -iname '*cowork*' 2>/dev/null | head -30

STEP 3 — SCHEDULED TASKS
  crontab -l
  systemctl list-timers --all | head -20
  ls /etc/cron.d/ /etc/cron.hourly/ /etc/cron.daily/ 2>/dev/null
  # Any timer referencing factorylm-cosmos-cookoff, rivet, or old mira_ compose
  grep -lriE 'cosmos-cookoff|rivet|pi-factory' /etc/cron.d /etc/systemd/system 2>/dev/null

STEP 4 — RUNNING PROCESSES (look for zombies)
  ps -eo pid,etime,user,command | grep -iE 'cowork|claude-peers|doppler.*bun' | grep -v grep
  ps -eo pid,etime,user,command | grep -iE 'factorylm-cosmos-cookoff|rivet' | grep -v grep
  # Anything older than 7 days that isn't a container or system process:
  ps -eo pid,etime,user,command --sort=-etime | head -30

STEP 5 — DOCKER VOLUMES + COMPOSE PROJECT NAMES
  # Pre-rename mira_* volumes that don't match current compose project names:
  docker volume ls --format '{{.Name}}' | grep -E '^mira_' | grep -v '^(mira-core|mira-cmms|mira-bots|mira-bridge|mira-mcp|mira-pipeline|mira-ingest|mira-docling|mira-relay|mira-web)_'
  # For each, check if any container references it:
  for v in $(docker volume ls --format '{{.Name}}' | grep '^mira_'); do
    users=$(docker ps -a --filter volume=$v --format '{{.Names}}')
    echo "$v: ${users:-<unused>}"
  done

STEP 6 — NGINX HYGIENE (from docs/system-health-2026-05-15.md issue #6)
  ls -la /etc/nginx/sites-enabled/ | grep -E '\.bak\.'
  nginx -t  # verify config still passes after any pruning

STEP 7 — REPORT, DO NOT DELETE YET
Print a clean summary table:
  - Host: <hostname>, uptime, disk usage
  - Containers: count, any unhealthy
  - Volumes: total, mira_* legacy, unused
  - Cowork-style dirs: list with paths + sizes + last-modified
  - Scheduled tasks: list referencing retired projects
  - Zombie processes: count + oldest start time
  - nginx .bak files: count

Then STOP and wait for Mike to approve before doing any of:
  - docker volume rm / docker image prune
  - rm of any /etc/nginx/sites-enabled/*.bak.*
  - kill of any process
  - mv of any directory to archive

When approved, retire scheduled tasks FIRST (so nothing respawns), then close
processes, then archive dirs to ~/cowork-archive-YYYY-MM-DD/ rather than
rm -rf. Touch /etc/nginx/sites-enabled/ only after `nginx -t` passes on the
pruned set.
```

---

## Expected findings (predicted before running)

Based on Charlie's audit and the system-health snapshot from 2026-05-15:

| Category | Predicted finding |
|---|---|
| Zombie processes | Likely same `doppler.*bun.*MCP` accumulation pattern from prior Claude Code sessions, possibly worse if the VPS hosts more interactive sessions |
| Pre-rename volumes | Likely same 6–8 `mira_*` volumes as Charlie. Empty placeholders safe to drop; sidecar `pathb-*` gated by #195 |
| nginx hygiene | 6 `.bak.*` files per the 2026-05-15 system-health report (Issue #6) — prune carefully |
| factorylm-cosmos-cookoff / RIVET | Should not exist on VPS. If found, **flag for Mike** — it would mean a deploy script bundled retired code |
| n8n workflow `7LMKcMmldZsu1l6g` | Unknown — needs Mike's confirmation whether it's still in use |
| Stale containers | The 2026-05-15 health report flagged `mira-mcp` as missing on VPS (P0) and `mira-hub` returning 500s — these are higher-priority than cowork hygiene |

---

## What this audit does NOT do (separate workstreams)

- **Does not deploy or restart anything.** Pure read + report + ask.
- **Does not touch NeonDB.** Schema gaps from issue #3 in system-health are a different repair workstream.
- **Does not run mira-pipeline regression tests.** That's the GS11 regime (per `bot-grounding-tests` skill).
- **Does not modify Doppler secrets.** Read-only — secret rotation needs Mike's hand.
- **Does not roll up open PRs.** PR #1368 (cowork rescue), #1369 (Slack-first spec), #1319, #1324 etc. — those are GitHub-side.

---

## After the VPS audit — fleet completion order

Per the original audit prompt:
1. ✅ **Charlie** — completed 2026-05-19 (this session). 105 zombies reaped, 2 Downloads dupes removed, factorylm-cosmos-cookoff archive blocked on uncommitted work
2. **Bravo** — same generic prompt, expect similar zombie pattern. Role TBD = low risk
3. **Alpha** — has the scraping/background tasks; do when Mike can babysit
4. **PLC laptop** — last, do not run mid-demo prep
5. **VPS** — use *this* prompt, not the generic one

---

## Cross-references

- `docs/system-health-2026-05-15.md` — VPS state snapshot that informed the keep/retire list
- `docs/runbooks/2026-05-15_physical-conveyor-readiness.md` — sister runbook, also rescued from cowork worktrees
- `docs/known-issues.md` — mira-sidecar sunset status (#195)
- `~/factorylm/CLUSTER.md` — fleet topology (Alpha/Bravo/Charlie/PLC/VPS)
- `.claude/skills/autonomous-run/SKILL.md` — pre-flight checklist for any unattended execution
