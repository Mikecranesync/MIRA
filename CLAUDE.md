# MIRA — Build State

**Version:** v3.4.0 | **Updated:** 2026-04-17
**One-liner:** AI-powered industrial maintenance diagnostic platform
**Inference:** `INFERENCE_BACKEND=cloud` → Gemini → Groq → Cerebras → Claude (cascade) | `local` → Open WebUI → qwen2.5vl:7b
**Chat path (VPS):** User phone → Open WebUI → mira-pipeline (:9099) → GSDEngine → Anthropic API

---

## Agent Coding Principles

*Adapted from [Karpathy's CLAUDE.md](https://github.com/forrestchang/andrej-karpathy-skills). Bias toward caution over speed.*

### Think Before Coding
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.

### Simplicity First
- No features beyond what was asked. No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- If you write 200 lines and it could be 50, rewrite it.

### Surgical Changes
- Don't "improve" adjacent code, comments, or formatting.
- Match existing style. Every changed line traces to the user's request.
- Remove orphans YOUR changes created. Don't remove pre-existing dead code.

### Goal-Driven Execution
- Transform tasks into verifiable goals with explicit success criteria.
- For multi-step tasks, state a brief plan: `[Step] → verify: [check]`
- Loop until verified. "Verify Before Declaring Done" rules apply (see global CLAUDE.md).

---

## KANBAN Board

**Board:** https://github.com/users/Mikecranesync/projects/4 (project ID: 4, owner: Mikecranesync)

### On Session Start
```bash
gh project item-list 4 --owner Mikecranesync --format json --limit 100 | python3 -c "
import sys, json
items = json.load(sys.stdin)['items']
for s in ['In Progress', 'Todo']:
    hits = [i for i in items if i.get('status') == s]
    if hits:
        print(f'\n## {s} ({len(hits)})')
        for i in hits: print(f'  {i[\"title\"]}')
"
```

### On Every Commit
```bash
gh project item-add 4 --owner Mikecranesync --url <issue-url>
gh project item-edit --project-id PVT_kwHODSgiRM4BSa9e --id <item-id> --field-id PVTSSF_lAHODSgiRM4BSa9ezg_9d4k --single-select-option-id 47fc9ee4  # In Progress
gh project item-edit --project-id PVT_kwHODSgiRM4BSa9e --id <item-id> --field-id PVTSSF_lAHODSgiRM4BSa9ezg_9d4k --single-select-option-id 98236657  # Done
```

---

## Hard Constraints (PRD §4)

1. **Licenses:** Apache 2.0 or MIT ONLY.
2. **No cloud except:** Anthropic Claude API + NeonDB (Doppler-managed secrets).
3. **No:** LangChain, TensorFlow, n8n, or any framework that abstracts the Claude API call.
4. **Secrets:** All via Doppler (`factorylm/prd`). Never in `.env` files committed to git.
5. **Containers:** One per service. `restart: unless-stopped` + healthcheck. Pinned image versions.
6. **Commits:** Conventional format (`feat/fix/security/docs/refactor/test/chore/BREAKING`).

---

## Repo Map

```
MIRA/
├── mira-core/       # Open WebUI + MCPO proxy + ingest service
├── mira-bots/       # Telegram, Slack adapters + shared diagnostic engine
├── mira-bridge/     # Node-RED orchestration, SQLite WAL shared state
├── mira-mcp/        # FastMCP server, NeonDB recall, equipment diagnostic tools
├── mira-pipeline/   # OpenAI-compat API wrapping GSDEngine — active VPS chat path
├── mira-web/        # PLG funnel — Hono/Bun, Stripe, /cmms landing + Mira AI chat
├── mira-cmms/       # Atlas CMMS — work orders, PM scheduling, asset registry
├── mira-hud/        # AR HUD desktop app (Express + Socket.IO)
├── mira-sidecar/    # ⚠️ LEGACY — ChromaDB RAG, superseded by mira-pipeline (ADR-0008)
├── wiki/            # LLM-maintained ops wiki (Karpathy pattern) — Obsidian vault
├── tests/           # 5-regime testing framework (76 offline tests, 39 golden cases)
├── docs/            # PRD, ADRs, C4 diagrams, runbooks, CHANGELOG, env-vars, known-issues
├── tools/           # Photo pipeline, Google Drive ingest, migration scripts
└── plc/             # PLC program files
```

See local CLAUDE.md in each module for deep context.

## Container Map

| Container | Port(s) | Network(s) |
|-----------|---------|------------|
| mira-core | 3000→8080 | core-net, bot-net |
| mira-pipeline | 9099 | core-net |
| mira-ingest | 8002→8001 | core-net |
| mira-mcp | 8000, 8001 | core-net |
| mira-docling | 5001 | core-net |
| mira-bridge | 1880 | core-net |
| mira-bot-telegram | — | bot-net, core-net |
| mira-bot-slack | — | bot-net, core-net |
| atlas-api | 8088→8080 | cmms-net, core-net |
| atlas-db | 5433 | cmms-net |
| mira-web | 3200→3000 | core-net, cmms-net |

## Start / Stop

```bash
doppler run --project factorylm --config prd -- docker compose up -d
docker compose down
docker compose logs -f <service>
bash install/smoke_test.sh
```

---

## Key Env Vars (Doppler: factorylm/prd)

| Var | Used By |
|-----|---------|
| `ANTHROPIC_API_KEY` | mira-bots (Claude inference) |
| `GEMINI_API_KEY` | mira-bots, mira-pipeline (primary free tier) |
| `GROQ_API_KEY` | mira-bots, mira-pipeline (secondary free tier) |
| `OPENWEBUI_API_KEY` | mira-bots, mira-ingest, mira-pipeline |
| `PIPELINE_API_KEY` | mira-pipeline (bearer), mira-core |
| `MCP_REST_API_KEY` | mira-mcp (server), mira-bots (client) |
| `NEON_DATABASE_URL` | mira-ingest (NeonDB) |
| `TELEGRAM_BOT_TOKEN` | mira-bot-telegram |
| `STRIPE_SECRET_KEY` | mira-web (Stripe API) |
| `ATLAS_DB_PASSWORD` | atlas-db (PostgreSQL) |

Full table (25 vars): `docs/env-vars.md`

---

## Where to Resume

- **MVP vision** — `docs/vision/2026-04-15-mira-manufacturing-gaps.md` (12 problems). Alignment: ~4.5/10 per `docs/vision/mvp-gap-analysis.md`.
- **Funnel** — First signup tested 2026-04-16 (harperhousebuyers@gmail.com). Open issues: #335 (Resend), #337 (ingest routing), #340 (collection scoping), #341 (read-side tenant isolation), #338 (Atlas on VPS).
- **Photo pipeline** — 3,694 equipment photos on Bravo, ready for KB ingest.
- **Eval baseline** — 8/11 binary pass. 51 fixtures. Judge + active learning nightly.

---

## Offline Testing

```bash
# Nameplate photo → vendor/model + FSM
python3 tests/eval/offline_run.py --photo nameplate.jpg

# Fresh diagnostic conversation
python3 tests/eval/offline_run.py --scenario "Yaskawa V1000 OC fault" --synthetic-user

# Full nightly-equivalent (text + photos + judge)
python3 tests/eval/offline_run.py --suite full --judge

# Replay production failure
python3 tests/eval/replay.py --file tests/eval/fixtures/replay/pilz_safety_relay.json
```

Full eval reference: `tests/eval/README.md`

---

## Gotchas

- **macOS keychain over SSH** — `docker build`/`doppler` fail on Bravo/Charlie. Workaround: `docker cp` + restart. Bravo fixed with `doppler configure set token-storage file`.
- **NeonDB SSL from Windows** — `channel_binding` fails. Use macOS hosts instead.
- **Intent guard false positives** — `classify_intent()` catches real maintenance questions as greetings. Test with realistic phrasing.
- **Competing Telegram pollers** — Only one process per bot token. Check CHARLIE for stale pollers.
- **Gemini key blocked** — 403 in Doppler. Cascade falls through to Groq/Claude.

---

## Pointers

- **Release notes:** `docs/CHANGELOG.md`
- **All env vars:** `docs/env-vars.md`
- **Known issues / deferred / abandoned:** `docs/known-issues.md`
- **Eval loop + active learning:** `tests/eval/README.md`
- **ADRs:** `docs/adr/`
- **Runbooks:** `docs/runbooks/`
- **Ops wiki:** `wiki/` — **Session start: read `wiki/hot.md`. Session end: update it.**
- **Wiki schema:** `wiki/SCHEMA.md`
- **Skills:** `.claude/skills/`
- **Sprint state:** `.planning/STATE.md`
- **Institutional knowledge:** `KNOWLEDGE.md`

---

## CLAUDE.md Maintenance

This file targets ~200 lines. Compliance drops past that threshold.
- If you repeat an instruction in chat >2x, add it here.
- Delete rules Claude follows naturally. Audit monthly.
- Verbose details live in reference files (docs/, tests/eval/).
- Line count as of last audit: 185 (2026-04-17)
