# Agentic OS Specification
**Version:** 1.0
**Last Updated:** 2026-05-05
**Owner:** Mike Harper / FactoryLM

## Purpose
A small set of always-on agents that keep MIRA's services healthy and learning between active sessions. Composed of:
- **Heartbeat** — periodically pings every container/service and writes liveness state to NeonDB / Discord.
- **Self-healer** — `mira-bots/v2_test_harness/healer.py` and `shared/agents/infra_guardian.py`; restarts unhealthy containers, rotates competing pollers, surfaces escalations.
- **Learning capture** — pulls recorded sessions (`SESSION_RECORDING_PATH`) and feedback rows into eval fixtures + lesson logs (`/cluster/betterclaw/logs/`).
- **Funnel tracker** — pulls `tenants` + Stripe events + PostHog into a daily funnel digest.

Together these form the "Cowork scheduled tasks" referenced in `~/factorylm/CLUSTER.md` (midnight, 6 AM, Sunday 02:00).

## Scope
**IN scope**
- `mira-bots/shared/agents/infra_guardian.py`
- `mira-bots/v2_test_harness/healer.py`
- `mira-crawler/reporting/agent_report.py`, `weekly_digest.py`, `telegram_notify.py`
- `tests/eval/analyze_sessions.py` (consumes recorded sessions for fixtures)
- Discord webhooks: `#alpha-status`, `#alpha-nightly`, `#alpha-morning`, `#weekly-review`

**OUT of scope**
- Cluster bootstrap (`~/factorylm/bootstrap.sh`)
- Per-service health endpoints (each service owns its own `/health`)

## Architecture
```
┌─────────────── Cowork Scheduler (Alpha) ────────────────┐
│                                                         │
│  midnight    → run open Task.md, write proof,           │
│                post #alpha-nightly                      │
│  06:00       → scan logs/ for repeat mistakes,          │
│                write rules, post #alpha-morning         │
│  Sun 02:00   → consolidate week, prune,                 │
│                push GitHub, post #weekly-review         │
│  every 5 min → infra-guardian heartbeat → NeonDB        │
│                                                         │
└──────────────────────────────────────────────────────────┘
```

- **Layer:** Infrastructure
- **Schedule owner:** Cowork on Alpha node (`192.168.1.10`)
- **Persistence:**
  - Liveness: NeonDB (`agent_health` table) + Discord
  - Lesson logs: `/cluster/betterclaw/logs/LESSON-<DATE>.md`
  - Eval fixtures: `tests/eval/`

## API Contract

### Heartbeat
| Surface | Behavior |
|---|---|
| `infra_guardian.run()` | One pass: probe each container's healthcheck + Ollama, write `agent_health` row, alert on transition |
| Discord post | `{node, service, status, since, last_error}` |

### Self-healer
- Detects competing Telegram pollers (per memory `project_mira_state` and CLAUDE.md gotcha) and shuts down older ones.
- Restarts `mira-pipeline` if `/health` 5xx for > 60 s.
- Never auto-pulls images; only restarts existing ones.
- Hard stop: never `docker volume rm`, never `git push --force`.

### Learning capture
- Pulls per-chat NDJSON from `${SESSION_RECORDING_PATH}` and produces deterministic eval grades (LLM judge optional via `EVAL_DISABLE_JUDGE=0`).
- Appends fixtures to `tests/eval/` only on rolled-up changes that survive 7-day decay window.

### Funnel tracker
- Reads `tenants` table + Stripe API + PostHog daily.
- Outputs `register → active → churned` funnel + 7/30/60-day cohort retention.
- Posts to `#weekly-review`.

## Configuration
| Var | Purpose |
|---|---|
| `DISCORD_ALERT_WEBHOOK` | `#alpha-status` |
| `DISCORD_NIGHTLY_WEBHOOK` | `#alpha-nightly` |
| `DISCORD_MORNING_WEBHOOK` | `#alpha-morning` |
| `DISCORD_WEEKLY_WEBHOOK` | `#weekly-review` |
| `SESSION_RECORDING_PATH` | Source of recorded sessions |
| `EVAL_DISABLE_JUDGE` | Skip LLM grading when `1` |
| `STRIPE_SECRET_KEY` | Funnel tracker pull |
| `PLG_POSTHOG_KEY` (server-side equivalent) | Cohort retention |
| `NEON_DATABASE_URL` | Heartbeat + tenants read |

## Quality Standards
| Metric | Current | Target |
|---|---|---|
| False-restart rate (self-healer) | unmeasured | < 1 / week |
| Heartbeat freshness | unmeasured | every 5 min, p99 < 60 s lag |
| Lesson log cadence | enforced (CLUSTER law #5) | one log per session |
| Funnel digest delivery | not yet automated weekly | every Sunday 02:00 |

## Acceptance Criteria
1. **Cluster law #1 (evidence-only):** No "completed" claim is written without a deterministic check (file exists, port open, test exit code 0).
2. **Cluster law #5 (lesson log):** Every session writes `/cluster/betterclaw/logs/LESSON-<DATE>.md` with mistakes (human + AI) + fine-tune candidates.
3. **Self-healer safety:** Self-healer never deletes data, never force-pushes, never bypasses signing/hooks.
4. **Heartbeat alerting:** A container kill produces a Discord alert in `#alpha-status` within 1 heartbeat cycle.
5. **Stale-poller hygiene:** Two Telegram pollers running on the same token results in exactly one survivor inside 60 s.
6. **Eval roll-up:** A session that grades < threshold produces a fixture suggestion in `tests/eval/` after 7-day decay window — not before.
7. **300-line orchestrator limit:** No single agent exceeds 300 lines of orchestration code; anything larger is delegated via `Task.md` (cluster law #3).

## Known Issues
- Funnel tracker is partially automated; weekly Discord digest still manual.
- Lesson-log writer expects `/cluster/betterclaw/logs/` to exist; fresh nodes need `bootstrap.sh` first.

## Change Log
- 2026-04 — `infra_guardian.py` added under `mira-bots/shared/agents/`.
- 2026-04 — Cowork scheduled tasks (midnight / 06:00 / Sun 02:00) formalized in `CLUSTER.md`.
