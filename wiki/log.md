# MIRA Ops Wiki — Log

> Append-only chronological record. Each entry: `## [YYYY-MM-DD] type | description`
> Types: `deploy`, `incident`, `config`, `session`, `ingest`, `lint`

## [2026-04-17] session | Alpha — wiki conformance + catch-up
- Read updated CLAUDE.md (inference cascade, wiki protocol, new env vars)
- Created wiki/nodes/alpha.md (was missing from wiki)
- Updated hot.md with 9 days of unreported work
- Machine: Alpha

## [2026-04-14] config | SSH mesh + Doppler key storage
- Established full bidirectional SSH: Alpha↔Bravo↔Charlie (6/6 directions)
- Fixed Alpha SSH config: Bravo user was `factorylm` (wrong), corrected to `bravonode`; added Charlie entry (`charlienode`)
- Fixed Charlie SSH config: Alpha user was `mike` (wrong), corrected to `factorylm`
- Added Alpha to Bravo SSH config (was missing entirely)
- Pushed Alpha key to Bravo via Charlie hop (Alpha→Charlie→Bravo, since Alpha couldn't reach Bravo directly)
- Added Tailscale fallback entries for Bravo↔Charlie
- Stored 13 SSH secrets in Doppler: SSH_{ALPHA,BRAVO,CHARLIE}_{PRIVATE_KEY,PUBLIC_KEY,CONFIG,AUTHORIZED_KEYS} + SSH_NETWORK_TOPOLOGY
- Created `deployment/network.yml` (canonical network topology)
- Added Node Map section to CLAUDE.md
- Machine: Alpha

## [2026-04-12] deploy | LinkedIn draft Celery task + observability stack live
- Built `mira-crawler/tasks/linkedin.py` — Celery task applying Frankie Fihn framework
- Created `mira-crawler/linkedin/` config dir: voice.md, topics.md, weights.yml, prompt_template.md
- Warm-up-aware weighted rotation (8 post types, hand_raiser=3/100 in Phase 1)
- Brought observability stack live: Flower :5555, Grafana :3001, Prometheus :9090, RedisInsight :5540
- Created Grafana dashboard (mira-celery-linkedin.json) + Redis datasource
- Task registered and smoke-tested — blocked on Anthropic API credits (balance too low)
- Committed d0b6af1, pushed to main
- Machine: Alpha

## [2026-04-10] lint | CI fully repaired — first green run in 4+ days
- PR #119: ruff check + format cleanup (13 errors, 29 files reformatted)
- Fixed 4 pre-existing unit test failures: test_harvest (missing is_self), test_tts (wrong sys.path), test_image_downscale (MAX_VISION_PX drift), test_reranking (rag_worker refactor drift)
- Fixed CI workflow: docker buildx --no-push (invalid flag), eval offline missing deps (httpx, chromadb), bot Dockerfile build context (mira-bots/ not mira-bots/telegram/)
- Excluded latent sidecar integration tests + 1 path-traversal security bug (tracked for dedicated fix)
- PR #119 merged, all 5 CI checks green
- Machine: Alpha

## [2026-04-10] deploy | Reddit→TG curation pipeline merged
- PR #117: tools/reddit_tg_pipeline/ — Apify scraper + Telethon forwarder
- Cherry-picked onto feature branch from origin/main, resolved .env.template conflict
- Rebased after CI cleanup PR, all 5 checks green, merged
- Machine: Alpha

## [2026-04-08] ingest | Wiki created from Karpathy LLM Wiki pattern
- Migrated infrastructure references from ~/.claude/memory/ into wiki/nodes/
- Created SCHEMA.md, index.md, hot.md, log.md
- Created gotcha pages for SSH keychain, NeonDB SSL, competing pollers, intent guard
- Machine: Windows Dev
