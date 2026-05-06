# Telegram Bot Specification
**Version:** 1.0
**Last Updated:** 2026-05-05
**Owner:** Mike Harper / FactoryLM

## Purpose
The fastest field-tech surface for MIRA. A technician opens Telegram, sends a photo or short text ("contactor buzzing on line 3"), and gets a Guided Socratic Dialogue reply — typically inside 3 seconds. Telegram is **MIRA's primary chat surface** for inbound support today and the most-tested adapter against the shared engine. Voice work-orders, photo intake, and slash commands are first-class on this surface.

## Scope
**IN scope**
- `mira-bots/telegram/` adapter container (`mira-bot-telegram`)
- Slash commands for tech and ops users
- Photo + voice handling
- Polling-only operation (no webhook); singleton per bot token
- Bridge to shared engine (`Supervisor`)

**OUT of scope**
- Telegram-side group admin features
- Cross-platform message routing (handled at engine level)

## Architecture
- **Layer:** Adapter
- **Library:** `python-telegram-bot 21.x`
- **Mode:** Polling (`run_polling()`) — replaces the old VPS webhook gateway (March 2026 in `~/factorylm/CLUSTER.md`).
- **Networks:** `bot-net`, `core-net`
- **Singleton invariant:** Only one process may poll a given `TELEGRAM_BOT_TOKEN`. Stale pollers on Charlie are a documented incident pattern; agentic-OS self-healer enforces this.

```
Telegram ── HTTPS poll ─▶ mira-bot-telegram
                              ├── strip_mentions, normalize chat_id (str)
                              ├── photo? base64-encode → photo_b64
                              ├── voice? Ollama whisper-style transcription
                              └── Supervisor.process_full(chat_id, msg, photo_b64)
                                          │
                                          └── reply → telegram.send_message
```

## API Contract

### Slash commands (canonical set)
| Command | Args | Behavior |
|---|---|---|
| `/start` | — | Reset to IDLE, send onboarding message |
| `/reset` | — | `Supervisor.reset(chat_id)` |
| `/wo` | `<title>` (optional voice) | Create work order via `mira-mcp` `cmms_create_work_order` |
| `/asset <tag>` | tag | Look up asset, set context, prompt for problem |
| `/help` | — | Lists commands + escalation phone |
| `/feedback <up\|down> [reason]` | — | `Supervisor.log_feedback` |

### Inputs
- **Text** ≤ 4 KB: forwarded as-is.
- **Photo**: largest variant fetched, base64-encoded, passed as `photo_b64`.
- **Voice**: ≤ 60 s, transcribed via Ollama; transcript becomes the user message; original audio is dropped after transcription.
- **Document**: PDF ≤ 20 MB → forwarded to `mira-ingest /ingest/photo` (yes, name historical) or `mira-mcp /ingest/pdf` depending on type.

### Output
- Text replies sent in chunks ≤ 4096 chars.
- Confidence "low" replies are prefixed with `⚠️ Low confidence:`.
- Safety alerts use a dedicated red-bordered reply template.

### `chat_id` mapping
Telegram numeric `chat_id` is **always** cast to `str` before calling the engine.

## Configuration
| Var | Required | Default | Purpose |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | yes | — | Bot token (Doppler) |
| `MIRA_DB_PATH` | yes | `/data/mira.db` | Shared state |
| `OPENWEBUI_BASE_URL` / `OPENWEBUI_API_KEY` | yes | — | KB retrieval |
| `KNOWLEDGE_COLLECTION_ID` | yes | — | Open WebUI collection |
| `INFERENCE_BACKEND` | yes | `cloud` | Cascade vs local |
| `GROQ/CEREBRAS/GEMINI_API_KEY` | ≥ 1 | — | Cascade providers |
| `MIRA_TENANT_ID` | yes | — | Tenant scope |
| `LANGFUSE_*_KEY` | optional | — | Tracing |

## Quality Standards
| Metric | Current | Target |
|---|---|---|
| End-to-end p50 latency | ≤ 3 s (cloud cascade) | ≤ 2 s |
| Test files | covered by shared 12 + adapter | maintain |
| Singleton enforcement | self-healer-driven | regression test on competing-poller detection |
| Photo handler robustness | EXIF-stripped via mira-ingest | maintain |
| Voice transcription error rate | unmeasured | < 10 % WER on field audio |

## Acceptance Criteria
1. **Polling singleton:** Starting a second instance triggers either auto-shutdown (self-healer) or a clear startup error within 30 s; never two concurrent pollers.
2. **Photo round-trip:** A 2 MB JPEG of a VFD nameplate produces an `ASSET_IDENTIFIED` state and a relevant first question.
3. **Voice WO:** `/wo` followed by a voice note results in an Atlas work order created via `mira-mcp`; original audio is not persisted.
4. **PDF cap:** A 25 MB PDF is rejected with a friendly message; ≤ 20 MB succeeds.
5. **chat_id type:** No engine-side test ever observes an `int` chat_id from this adapter (cast invariant).
6. **Safety bypass:** `"there's smoke from the cabinet"` returns the canned safety response immediately, regardless of FSM state.
7. **Mention-strip:** `@MiraBot` and other Telegram entity tags are stripped before `Supervisor.process()`.
8. **Reset:** `/reset` empties history and resets state.

## Known Issues
- Polling competes with any prior polling process on the same token (per CLAUDE.md gotcha + memory `project_mira_state`).
- Voice transcription via Ollama has variable quality on noisy plant-floor audio.
- Telegram entity tags can wrap user-typed text; `strip_mentions` handles known cases but is conservative on unknown entities.

## Change Log
- 2026-03 — Polling moved to Charlie (`run_polling()`); replaced VPS OpenClaw webhook gateway.
- 2026-04 — Voice WO command (`/wo`) added.
