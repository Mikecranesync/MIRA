# MIRA Known Issues, Deferred Features, and Abandoned Approaches

Extracted from CLAUDE.md to keep the build-state file lean.
Updated: 2026-06-19

## Beta Gate (North Star) — status

- **Gate:** a stranger uploads their own equipment manual, asks a real troubleshooting question, and gets a grounded, cited answer — zero manual fixing.
- **Status (2026-06-17): PASSING on deploy truth.** xfail removed (#2077); `tests/beta/beta_ready_upload_retrieval_citation.py` is now a real assertion, CI-enforced by `beta-gate.yml` (weekly Mon 07:00 UTC + gate-path PRs) against a real stranger provisioned on staging Neon. Upload→retrieval gap (#1592) closed.

## Known Broken / Incomplete

- **Ignition Perspective "No Connection to Gateway" always in DOM** — Ignition's
  Perspective client renders this WebSocket-init overlay in the DOM on every page
  load, hiding it via CSS when the WS connects. Accessibility snapshots and
  headless browser `innerText` therefore always include the string even when the
  screen is live. This is an Ignition framework behavior; the ConvSimpleLive view
  was built in Designer on the PLC laptop and cannot be patched from CHARLIE without
  Designer access. Workaround: use `evaluateIgnitionDisplay()` from
  `mira-hub/tests/e2e/ignition-display-health.ts`, which disambiguates by checking
  computed CSS visibility AND live tag value patterns. See issue #2064 and the
  disambiguation section in `docs/runbooks/hermes-find-convsimple-screen.md`.

- **Gemini key blocked** — `GEMINI_API_KEY` in Doppler returns 403 "Your project has been denied access". Get fresh key from aistudio.google.com and update Doppler `factorylm/prd`. Cascade falls through to Groq/Cerebras in the meantime (smoke-tested OK).
- **Teams + WhatsApp** — Code-complete, pending **cloud setup only** (Azure Bot Service for Teams; Twilio account + public domain for WhatsApp). WhatsApp FastAPI webhook is wired (`mira-bots/whatsapp/bot.py:96-113`); it just needs Twilio to point at it.
- **PLC at 192.168.1.100** — Unreachable from PLC laptop; needs physical check (power/switch/cable).
- **Charlie Doppler keychain** — Same SSH keychain lock as Bravo had; needs `doppler configure set token-storage file`.
- **Charlie HUD** — Needs local terminal session to start (keychain blocks SSH start of Doppler).
- **Reddit benchmark** — 15/16 questions hit intent guard canned responses, not real inference. No recent work on `mira-bots/reddit/`.
- **NVIDIA NIM / Nemotron** — Runtime code in `mira-bots/shared/nemotron.py` works (falls back gracefully when `NVIDIA_API_KEY` is unset); see "Deferred Features → Active" below. What's blocked is the **Regime 5 eval suite** specifically — it needs a working key to exercise the reranker path.
- **VPS deploy uses `main` HEAD, not version tags** — Customer-facing components are tagged (`mira-hub/v*`, etc.) but `deploy-vps.yml` checks out `main`, so the namespaced tags are documentation only — they don't enforce reproducible deploys or give us a real rollback target. Tracked in issue [#736](https://github.com/Mikecranesync/MIRA/issues/736). Partially mitigated by #1970: `version-gate.yml` auto-bumps `/VERSION` every code PR and `version-tag.yml` auto-creates `v<VERSION>` + `rollback/<date>` on every merge. Remaining half: `deploy-vps.yml` still checks out main HEAD, not the tag.
- **DOPPLER_TOKEN drift between Doppler config and saas compose** — Secrets set in Doppler `factorylm/prd` don't reach a container unless also listed in the `env:` block of `docker-compose.saas.yml`. Edit both in the same PR.
- **Default `deploy-vps.yml` TARGETS excludes mira-web** — Marketing-site PRs do not auto-deploy. Manual: `gh workflow run deploy-vps.yml -f services=mira-web`.
- **`tools/demo_plc_poller.py` ships a colliding `live_signal_cache` DDL** — the poller's embedded `SCHEMA_DDL` creates a `live_signal_cache` shaped `(topic, plc_tag, equipment_id, name, value, quality, updated_at)` keyed on `topic`, which does NOT match Hub migration `020`'s `(tenant_id, plc_tag, …, last_seen_at)`. Against a migrated NeonDB the poller's `CREATE TABLE IF NOT EXISTS` no-ops and its INSERT fails on missing columns. Pre-existing; surfaced 2026-05-29 while building Command Center (which deliberately does NOT read this table — liveness is a reachability probe). Fix the poller to UPSERT the migration-020 shape (with `tenant_id`) before relying on it to feed the Hub.

## Deferred Features

| Feature                      | Deferred To | Reason                      |
|------------------------------|-------------|-----------------------------|
| Modbus / PLC / VFD           | Config 4    | Out of scope for Config 1 MVP |
| NVIDIA Nemotron reranker     | **Active**  | Enabled when NVIDIA_API_KEY set (feature-flagged) |
| Kokoro TTS                   | Post-MVP    | Nice-to-have                |
| CMMS integration             | **Active**  | Atlas CMMS (mira-cmms/)     |

## Abandoned Approaches

| Approach | Replaced With | Why It Failed |
|----------|--------------|---------------|
| NemoClaw / NeMo Guardrails | Custom supervisor/worker | Not production-ready (Mar 17) |
| PRAW OAuth for Reddit | No-auth public JSON endpoints | Too heavy — credentials, app registration, rate limits |
| zhangzhengfu nameplate dataset | Own golden set from Google Photos | Empty repo, dead Baidu Pan links, no license |
| Google Photos API direct | rclone + Ollama triage | OAuth consent screen "Testing" mode returned empty results |
| GWS CLI for Gmail | IMAP with Doppler app passwords | Scope registration issues on Windows |
| glm-ocr model (as primary) | qwen2.5vl handles vision | Consistent 400 errors — retained as optional fallback in vision_worker.py |
| Anthropic / Claude as cloud LLM provider | Groq → Cerebras → Gemini cascade | Removed PR #610. Do not reintroduce. |

## Open low-watch

- **`cp_citation_vendor_relevance` (#1858)** — vendor-strip diagnostic invariant has no operable PR-time CI guard until the keyless replay store is recorded (D4 runbook). Founder-keyed, not stranger-reachable.

## Resolved (kept for context)

- **Cross-tenant IDOR / knowledge leak (#1833)** — per-tenant document uploads are now written `is_private = true`; hybrid read filter `(is_private = false OR tenant_id = $caller)` applied to per-tenant surfaces.
- **Upload→retrieval gap closed (#1592, #2077)** — Hub/web uploads now land in `knowledge_entries` and are retrievable on the NodeChat path. Beta gate CI-enforced by `beta-gate.yml`.
- **Asset-agent train/approve gate (#1899, #1903, #1909, #1919)** — citationCoverage≥5 gate, `is_private=true` node-attachment chunks, tenant FK row guard, chown fix for upload buffers. All merged.
- **Beta upload→ask flow closed (#1901)** — CV-101 approved; onboarding upload→ask beta-acceptance closed.
- **Staging usable (#2020)** — staging environment is functional with its own Neon branch.
- **Beta gate CI-enforced (#2077)** — xfail removed; `beta_ready_upload_retrieval_citation.py` is a real CI assertion on staging Neon.
- **Hub E2E wired (#2082)** — `hub-e2e.yml` running.
- **mira-sidecar (ChromaDB RAG backend)** — Removed from `docker-compose.saas.yml` 2026-05-20 per ADR-0014. Replaced by mira-pipeline + Open WebUI native KB. OEM chunks no longer block sunset.
- **mira-web → mira-pipeline cutover** — Done. `mira-web/src/lib/mira-chat.ts` now calls mira-pipeline `:9099/v1/chat/completions` (ADR-0008).
- **No CD pipeline** — Resolved. `deploy-vps.yml` gates on `smoke-test.yml` success and deploys to VPS automatically on push to `main`. Manual fallback: `gh workflow run deploy-vps.yml -f services=<svc>`.
