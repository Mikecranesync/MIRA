# Hot Cache — 2026-04-17T19:00 — Alpha

## Just Finished
- Read updated CLAUDE.md — conformed to wiki protocol, inference cascade change (Groq→Cerebras→Claude)
- Created `wiki/nodes/alpha.md` — Alpha was the only node missing from the wiki
- Brought the wiki current after 9 days of unreported work (see log.md for full list)

## Work Done Since Last Hot Cache (2026-04-08)
- **Reddit→TG pipeline** — built `tools/reddit_tg_pipeline/`, PR #117 merged to main
- **CI fully repaired** — lint, unit tests, docker build, eval offline all green (PR #119). First green CI on main in 4+ days.
- **LinkedIn draft Celery task** — `mira-crawler/tasks/linkedin.py`, Frankie Fihn framework, warm-up-aware weighted rotation via `weights.yml`. Observability stack brought live (Flower :5555, Grafana :3001, Prometheus :9090).
- **SSH mesh established** — full bidirectional Alpha↔Bravo↔Charlie. Fixed wrong usernames in SSH configs. Hopped Alpha→Charlie→Bravo to push keys.
- **SSH keys + configs stored in Doppler** — 13 secrets: `SSH_{NODE}_{PRIVATE_KEY,PUBLIC_KEY,CONFIG,AUTHORIZED_KEYS}` + `SSH_NETWORK_TOPOLOGY`
- **Network topology file** — `deployment/network.yml` (canonical, machine-readable)
- **Node Map added to CLAUDE.md** — table with all 3 nodes, IPs, users, roles

## Machine State
- **Alpha (100.107.140.12):** On main at d0b6af1+. Docker running. Celery + observability containers were running but may have stopped (session spans multiple days). LinkedIn draft task registered but blocked on Anthropic API credits (balance too low). Sleep not hardened.
- **Bravo (100.86.236.11):** SSH working from Alpha. Ollama running (4 models: qwen2.5vl, nomic-embed-text, mira, glm-ocr). Docker containers presumably running per last check.
- **Charlie (100.70.49.126):** SSH working from Alpha. 13 containers running (atlas-cmms, mira-bots, mira-core, mira-ingest, etc.). Teams/WhatsApp/Reddit bots restarting (pending cloud setup).
- **VPS (165.245.138.91):** No changes this session.

## Uncommitted Work
- `deployment/network.yml` — new (network topology)
- `wiki/nodes/alpha.md` — new
- `wiki/hot.md` — updated (this file)
- `wiki/log.md` — updated
- `wiki/index.md` — updated

## Blocked
- **LinkedIn draft generation** — Anthropic API credits exhausted. Task is wired and registered; will work once credits are topped up at console.anthropic.com.
- **PLC at 192.168.1.100** — still unreachable, needs physical check
- **Charlie Doppler keychain** — still locked, needs local terminal session
- **Teams + WhatsApp bots** — code-complete, pending Azure/Meta cloud setup
- **Alpha sleep hardening** — needs `sudo pmset -a sleep 0 disksleep 0 displaysleep 0 womp 1`

## Next (any machine)
1. Top up Anthropic API credits → verify LinkedIn draft generation end-to-end
2. Set up Trigger.dev cron for `linkedin.draft_post` (Mon/Wed/Fri 12:00 UTC) — upstream moved scheduling from Celery Beat to Trigger.dev
3. Commit wiki + network topology changes, push to main
4. Harden Alpha sleep settings (requires sudo)
5. Fix Charlie Doppler keychain (requires local terminal)
6. Create wiki pages for services (mira-core, mira-ingest, etc.)
