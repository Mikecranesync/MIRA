# Slack Phase 1 — Discovery & Existing Code Audit

**Date:** 2026-05-14
**Node:** CHARLIE
**Branch:** `claude/happy-chatterjee-7ce28f`
**Issue:** [#1270](https://github.com/Mikecranesync/MIRA/issues/1270)
**Status:** Discovery complete. Crash root cause identified and patched.

---

## TL;DR

- **Crash root cause:** `mira-bots/slack/Dockerfile` did not COPY `chat_adapter.py` into the image. `bot.py` imports `from chat_adapter import SlackChatAdapter` → `ModuleNotFoundError: chat_adapter`. The file exists in the repo; it was simply never copied. **Fixed in this PR** (one-line Dockerfile change).
- **Architecture:** the Slack adapter already implements the platform-agnostic `ChatAdapter` protocol (same pattern as Telegram). It wires `SlackChatAdapter` → `ChatDispatcher` → `Supervisor` (shared engine). No re-architecture required.
- **Secrets:** all 3 required Slack secrets exist in Doppler `factorylm/prd`. Nothing to ask Mike for on credentials.
- **Specs:** the two spec docs referenced by issue #1270 (`docs/specs/slack-technician-workflow-spec.md` and `docs/specs/mira-component-intelligence-architecture.md`) **do not exist yet**. So is the cited rule `.claude/rules/uns-confirmation-gate.md`. These are prerequisites for Phase 2 and must be written before further Slack work.
- **Tests:** `test_slack_adapter.py` and `test_slack_relay.py` exist in `mira-bots/tests/`. Coverage status not measured in Phase 1.

---

## 1. Every Slack-related file in the repo

### 1a. Slack bot adapter (`mira-bots/slack/`)

| File | Size | Role |
|---|---|---|
| `mira-bots/slack/bot.py` | 14 KB | Entry point. Socket Mode app, `app_mention` + `message.im` handlers, `/mira-equipment`, `/mira-faults`, `/mira-reset`, `/mira` slash commands. Wires `Supervisor` + `SlackChatAdapter` + `ChatDispatcher`. |
| `mira-bots/slack/chat_adapter.py` | 3.9 KB | `SlackChatAdapter` class implementing the platform-agnostic `ChatAdapter` protocol. `normalize_incoming` / `render_outgoing` / `download_attachment`. Renders via `shared/chat/renderers/slack_blocks.py`. |
| `mira-bots/slack/pdf_handler.py` | 4.4 KB | Uploads PDFs from Slack DMs into Open WebUI KB. |
| `mira-bots/slack/requirements.txt` | 131 B | `slack-bolt`, `httpx`, `Pillow`, etc. |
| `mira-bots/slack/Dockerfile` | 392 B | Build recipe. **Bug:** chat_adapter.py was missing from COPY (fixed in this PR). |
| `mira-bots/slack/.doppler.yaml` | 42 B | Pins Doppler project=factorylm, config=prd. |
| `mira-bots/slack/.env.example` | 962 B | Local-dev example of required env vars. |

### 1b. Shared abstractions used by Slack

| File | Role |
|---|---|
| `mira-bots/shared/chat/dispatcher.py` | `ChatDispatcher` — feeds `NormalizedChatEvent`s into `Supervisor` (the engine). |
| `mira-bots/shared/chat/types.py` | `NormalizedChatEvent`, `NormalizedChatResponse`, `NormalizedAttachment`. Platform-agnostic. |
| `mira-bots/shared/chat/renderers/slack_blocks.py` | `render_slack()` — converts a `NormalizedChatResponse` into Slack Block Kit JSON. |
| `mira-bots/shared/engine.py` | `Supervisor` — the GSD/diagnostic engine all adapters share. |

### 1c. Tests

| File | Notes |
|---|---|
| `mira-bots/tests/test_slack_adapter.py` | Stubs `slack_bolt` (MIT) before import. Fixtures use placeholder tokens. |
| `mira-bots/tests/test_slack_relay.py` | Slack relay/webhook tests. |

### 1d. OAuth / install (mira-hub)

| File | Role |
|---|---|
| `mira-hub/src/app/api/auth/slack/route.ts` | Initiates Slack workspace install / OAuth flow. |
| `mira-hub/src/app/api/auth/slack/callback/route.ts` | OAuth callback — exchanges code for workspace tokens. |

### 1e. Compose

| File | Defines `slack-bot`? |
|---|---|
| `mira-bots/docker-compose.yml` | YES — service `slack-bot` (`container_name: mira-bot-slack`, `bot-net` + `core-net`). |
| `docker-compose.hub.yml` (repo root) | No `slack-bot` block. |
| `docker-compose.saas.yml` (repo root) | No `slack-bot` block. |

### 1f. Docs

| File | Notes |
|---|---|
| `docs/integrations/slack_api_reference.md` | Reference of Slack OAuth + Bolt + webhook capabilities we use. |

---

## 2. Slack environment variables

### 2a. Required by `mira-bots/slack/bot.py`

| Var | Required? | Source |
|---|---|---|
| `SLACK_BOT_TOKEN` | required (`os.environ[...]`) | Doppler `factorylm/prd` — present (`xoxb-10648436040919-...`). |
| `SLACK_APP_TOKEN` | required (`os.environ[...]`) | Doppler `factorylm/prd` — present (`xapp-1-A0AK2DL94EB-...`). |
| `OPENWEBUI_BASE_URL` | optional (default `http://mira-core:8080`) | core compose env. |
| `OPENWEBUI_API_KEY` | optional | Doppler. |
| `MCP_BASE_URL` | optional | Doppler. |
| `MCP_REST_API_KEY` | optional | Doppler. |
| `KNOWLEDGE_COLLECTION_ID` | optional | Doppler. |
| `SLACK_ALLOWED_CHANNELS` | optional (CSV channel IDs) | — |
| `MIRA_DB_PATH` | optional (default `/data/mira.db`) | mira-bridge mounted volume. |
| `VISION_MODEL` | optional (default `qwen2.5vl:7b`) | Doppler. |
| `MIRA_TENANT_ID` | optional | Doppler. |

### 2b. Used by `chat_adapter.py`

| Var | Required? |
|---|---|
| `SLACK_SIGNING_SECRET` | passed in (optional, used for signature verification in non-Socket-Mode deployments). |

### 2c. Doppler status (`factorylm/prd`)

| Var | In Doppler? |
|---|---|
| `SLACK_APP_TOKEN` | ✅ present |
| `SLACK_BOT_TOKEN` | ✅ present |
| `SLACK_SIGNING_SECRET` | ✅ present |

**Conclusion: no missing credentials. Mike does not need to provision new Slack secrets.**

---

## 3. The `chat_adapter` crash — root cause

### 3a. The error

`mira-bot-slack` container crash-looping with:

```
ModuleNotFoundError: No module named 'chat_adapter'
```

### 3b. The cause

`mira-bots/slack/Dockerfile` (line 10, pre-fix):

```dockerfile
COPY slack/bot.py slack/pdf_handler.py ./
```

But `bot.py` does:

```python
from chat_adapter import SlackChatAdapter
from pdf_handler import ingest_pdf
```

`chat_adapter.py` exists in the repo at `mira-bots/slack/chat_adapter.py`, but the Dockerfile never copied it into the image. When the container started, the Python sibling-import failed at module load time → crash loop.

### 3c. Why Telegram works and Slack didn't

Telegram's Dockerfile (line 8) copies its full module set:

```dockerfile
COPY mira-bots/telegram/bot.py mira-bots/telegram/chat_adapter.py mira-bots/telegram/renderers.py mira-bots/telegram/voice_transcription.py mira-bots/telegram/admin_commands.py mira-bots/telegram/start_command.py ./
```

`chat_adapter.py` is explicitly listed. Slack's was a `git mv` / refactor leftover — the file was added to the source tree but never to the Dockerfile manifest.

### 3d. The fix (in this PR)

`mira-bots/slack/Dockerfile`:

```diff
- COPY slack/bot.py slack/pdf_handler.py ./
+ COPY slack/bot.py slack/chat_adapter.py slack/pdf_handler.py ./
```

One-line change. No code change, no architectural change.

### 3e. Path convention difference (cosmetic, not bug)

- Slack compose uses `context: .` from inside `mira-bots/` → COPY paths are `slack/...`.
- Telegram compose uses `context: ../` (one level up) → COPY paths are `mira-bots/telegram/...`.

This is an inconsistency worth normalizing eventually, but it does **not** affect functionality. Leaving as-is for Phase 1 (out of scope per "surgical changes" rule in `karpathy-principles.md`).

---

## 4. Slack adapter ↔ Telegram adapter — pattern map

Both adapters implement the same `ChatAdapter` protocol. The shared engine never sees a Slack-specific or Telegram-specific object.

| Concern | Telegram | Slack |
|---|---|---|
| Entry-point lib | `python-telegram-bot` (`Application` + `MessageHandler`) | `slack-bolt` (`AsyncApp` + Socket Mode handler) |
| Event handler | `MessageHandler(filters.PHOTO, on_photo)`, etc. | `@app.event("app_mention")`, `@app.event("message")` |
| Normalize step | `TelegramChatAdapter.normalize_incoming(update)` → `NormalizedChatEvent` | `SlackChatAdapter.normalize_incoming(event)` → `NormalizedChatEvent` |
| Dispatch | `ChatDispatcher.dispatch(normalized)` (shared) | `ChatDispatcher.dispatch(normalized)` (shared) |
| Engine | `Supervisor` (shared) | `Supervisor` (shared) |
| Render | `shared/chat/renderers/telegram_md.py` (or similar) | `shared/chat/renderers/slack_blocks.py` |
| Attachment download | bearer-token-authenticated GET on file URL | bearer-token-authenticated GET on `url_private_download` |
| Session key | `f"telegram:{chat_id}"` | `f"slack:{channel}:{thread_ts or 'main'}"` |

**Slack-specific features beyond Telegram parity:**

- Thread awareness (`thread_ts` in session key + `say(thread_ts=...)`) — Slack conversations are tree-shaped, not linear.
- Slash commands: `/mira`, `/mira-equipment`, `/mira-faults`, `/mira-reset`.
- Block Kit responses (richer formatting via `slack_blocks.py`).

**Telegram features absent from Slack:**

- Voice transcription (`voice_transcription.py`)
- Admin commands (`admin_commands.py` — `/invite`, `/revoke`, `/team`)
- Identity service wiring (`shared.identity.service`)
- Photo batch queue (`shared.photo_batch_queue`)
- Atlas CMMS outbox drain (`shared.integrations.wo_outbox.run_drain_forever`)
- Push notification handoff
- Tenant authorizer
- Start command UX

These gaps are not in scope for Phase 1 (just discovery + crash fix). They are the candidates for Phase 2+ when we port the technician workflow to Slack.

---

## 5. What's implemented vs. broken vs. missing

### Implemented ✅

- Socket Mode connection to Slack workspace
- `app_mention` + `message.im` handlers
- Photo attachment normalization + vision pipeline pre-resize
- PDF ingestion into Open WebUI KB (`pdf_handler.py`)
- 4 slash commands (`/mira`, `/mira-equipment`, `/mira-faults`, `/mira-reset`)
- Block Kit response renderer
- Thread-aware session keying
- Channel allowlist gate (`SLACK_ALLOWED_CHANNELS`)
- ChatAdapter protocol conformance — drops cleanly into the shared dispatcher
- Doppler integration (`.doppler.yaml` pinned to `factorylm/prd`)
- OAuth install routes in mira-hub (TS) — for self-serve workspace install
- Unit tests stubbing `slack_bolt`

### Broken 🔧 (fixed in this PR)

- Dockerfile missing `chat_adapter.py` in COPY → `ModuleNotFoundError` crash loop

### Missing / not yet built ⏳

| Item | Notes |
|---|---|
| `docs/specs/slack-technician-workflow-spec.md` | Referenced by issue #1270; does not exist yet. Must be written before Phase 2. |
| `docs/specs/mira-component-intelligence-architecture.md` | Referenced; does not exist. |
| `.claude/rules/uns-confirmation-gate.md` | Referenced; does not exist. Only `karpathy-principles.md`, `python-standards.md`, `security-boundaries.md` present in `.claude/rules/`. |
| Identity service wiring on Slack | Telegram has `shared.identity.service.get_identity_service()` — Slack does not. Required before per-tech feature gating. |
| Tenant authorizer on Slack | Telegram has `Authorizer` — Slack does not. |
| WO outbox drain on Slack worker | Telegram runs `run_drain_forever` in-process. Slack would need either the same wiring or a shared worker. |
| Slack app manifest JSON | No `manifest.json` / `app_manifest.yaml` checked into repo. Workspace install today appears to be hand-configured. Should be codified before onboarding any new workspace. |
| Health endpoint | Compose healthcheck is `python -c "import slack_bolt"` — fine for build verification, but does not confirm Socket Mode is connected. Telegram bot also lacks a true liveness probe; not a regression. |
| Smoke test for Slack path | `install/smoke_test.sh` does not appear to exercise the Slack adapter. Worth adding once container is verified healthy on the VPS. |
| Coverage measurement | Tests exist; no coverage report on file. Not in scope for Phase 1. |

---

## 6. Slack API credentials Mike needs to set up

**None for Phase 1.** All three required secrets are already in Doppler `factorylm/prd`:

- `SLACK_APP_TOKEN`
- `SLACK_BOT_TOKEN`
- `SLACK_SIGNING_SECRET`

For Phase 2+ (multi-workspace / SaaS install), we will additionally need:

- `SLACK_CLIENT_ID` (for OAuth install flow in mira-hub)
- `SLACK_CLIENT_SECRET` (for the callback exchange)
- `SLACK_REDIRECT_URI` (set on app config: `https://factorylm.com/api/auth/slack/callback`)

These are NOT yet in Doppler. They are needed only when we open the Slack app to workspaces beyond Mike's dev workspace.

---

## 7. Recommended next steps for Phase 2

1. **Write the missing specs** (blocker for any further Slack work):
   - `docs/specs/slack-technician-workflow-spec.md` — what the technician journey on Slack looks like end-to-end (intake → diagnosis → confirmation → WO creation → recall).
   - `docs/specs/mira-component-intelligence-architecture.md` — the cross-bot component intelligence layer.
   - `.claude/rules/uns-confirmation-gate.md` — the UNS confirmation gate behavior rule.
2. **Verify the Dockerfile fix on the VPS** — rebuild `mira-bot-slack`, confirm Socket Mode connects, `app_mention` echoes through, no crash loop. Capture container logs as evidence (Law 1).
3. **Wire identity service + tenant authorizer** into Slack `bot.py`, matching the Telegram pattern. Mandatory before exposing the adapter to any real tech beyond Mike.
4. **Codify the Slack app manifest** as a checked-in `mira-bots/slack/app_manifest.yaml`. Source of truth for scopes, events, slash commands, OAuth URLs.
5. **Normalize the compose build-context convention** between Telegram (root context) and Slack (mira-bots context). Tiny refactor; pick one and align.
6. **Port the WO outbox drain** to a shared worker so every adapter benefits without duplicating `run_drain_forever`.
7. **Add a Slack-path smoke test** to `install/smoke_test.sh`.

---

## 8. Out-of-scope deferrals (intentionally not done in Phase 1)

- Migrating `slack-bot` service into `docker-compose.hub.yml` / `docker-compose.saas.yml` (currently only in `mira-bots/docker-compose.yml`).
- Standardizing COPY-path convention across all bot Dockerfiles.
- Adding Slack-specific photo batch queue.
- Writing the three missing prereq docs (specs + rule) — these need product-level input from Mike, not a discovery audit.
- Slack `manifest.yaml` — needs the spec doc first to know what scopes/events the technician workflow requires.

---

## Evidence

- Doppler secrets listed: `doppler secrets --project factorylm --config prd | grep -i slack` → 3 keys present.
- Dockerfile diff: see `mira-bots/slack/Dockerfile` in this PR.
- Telegram pattern reference: `mira-bots/telegram/Dockerfile` line 8 — `chat_adapter.py` explicitly copied.
- Files listed: `find . -path '*/slack*' -o -name '*slack*'` (filtered, see Section 1).
