# ADR-0002: Bot Adapter Pattern

## Status
Accepted

## Context

MIRA must deliver the same diagnostic experience across multiple messaging platforms
(Telegram, Slack, Teams, WhatsApp). Each platform has its own webhook format, auth
scheme, and message object structure. The diagnostic logic — FSM state management,
intent classification, worker dispatch, confidence scoring — must not be duplicated
across platform implementations.

## Considered Options

1. Monolithic bot — single process handling all platforms with branching logic
2. Webhook-only architecture — stateless per-request handlers, no shared session state
3. Abstract adapter base class — shared engine, platform-specific subclasses

## Decision

**Abstract adapter base class pattern.** `engine.py`'s `Supervisor` class contains all
diagnostic logic. Each platform (Telegram, Slack) subclasses a thin adapter that
handles auth, message extraction, and reply formatting. The adapter calls
`Supervisor.process()` or `process_full()` with a normalized `(chat_id, message, photo_b64)`
triple and passes the reply back to the platform SDK.

## Consequences

### Positive
- All diagnostic logic lives in `mira-bots/shared/engine.py` — one place to fix bugs
- FSM state is keyed on `chat_id` in SQLite, which is platform-agnostic
- Adding a new platform adapter requires ~150 LOC; no changes to engine or workers
- Guardrails, confidence scoring, and telemetry apply uniformly across all platforms

### Negative
- Platform adapters must agree on `chat_id` format — collision possible if Telegram user ID
  matches a Slack user ID (mitigated by prefixing: `tg_{id}` vs `slack_{id}`)
- Shared SQLite in WAL mode handles concurrent writes from multiple adapters, but
  write contention can cause retries under high load
