# Spec: Single-Poller Enforcement for the Telegram Bot

**Status:** Active
**Owner:** Charlie (operator) / VPS (prod)
**Date:** 2026-05-14
**Linked code:**
- `mira-bots/telegram/bot.py` (`_conflict_error_handler`, `_startup`)
- `mira-bots/docker-compose.yml` (`telegram-bot` service, `profiles: ["dev-bot"]`)
- `docker-compose.saas.yml` (`mira-bot-telegram` service, `restart: on-failure:3`)
- `mira-crawler/agents/heartbeat_monitor.py` (`check_telegram_polling`)
- `mira-crawler/agents/self_healer.py` (`PLAYBOOKS["dual_poller_409"]`)

## Problem

Telegram's Bot API enforces that only one process at a time may call `getUpdates`
for a given bot token. A second poller racing against the first produces HTTP
`409 Conflict` on roughly 25% of calls; the rest succeed. Each poller receives
*part* of the message stream and the rest is lost.

We have hit this three times because:

1. The repo ships a `docker-compose.yml` that includes `telegram-bot` on every
   host. Running `docker compose up -d` on CHARLIE (dev) starts a poller
   against the same production token the VPS is already polling.
2. `restart: unless-stopped` revives the bot after any exit, including a
   deliberate exit on detected conflict.
3. The old `_conflict_error_handler` swallowed 409s with a 15s sleep + retry,
   so two pollers could coexist forever — no signal ever escalated.

## Single-poller rule

> The production bot token (in Doppler `factorylm/prd` as `TELEGRAM_BOT_TOKEN`)
> is polled by the VPS (165.245.138.91) and **nowhere else**. CHARLIE and other
> dev hosts must NOT start `mira-bot-telegram` against this token. To develop
> the bot locally, use a separate test bot token (`TELEGRAM_BOT_TOKEN_DEV` —
> create via @BotFather) and opt in with `COMPOSE_PROFILES=dev-bot`.

## Enforcement layers (defense in depth)

### 1. Compose profile (load-bearing)

`mira-bots/docker-compose.yml` gates `telegram-bot` behind
`profiles: ["dev-bot"]`. A vanilla `docker compose up -d` on CHARLIE does NOT
start the bot. To intentionally run the bot in dev:

```bash
COMPOSE_PROFILES=dev-bot doppler run -- docker compose up -d telegram-bot
```

The VPS uses `docker-compose.saas.yml`, which has no profile gating — the bot
starts there by default. This is intentional and correct.

### 2. Restart policy

Both `mira-bots/docker-compose.yml` (dev) and `docker-compose.saas.yml` (prod)
use `restart: on-failure:3`, not `unless-stopped`. This means:

- A clean exit (`sys.exit(0)`) stays exited.
- A crashing bot retries up to 3 times then stays dead — bounded.
- An operator-initiated `docker stop` stays stopped.

### 3. Runtime guard in `bot.py`

`_conflict_error_handler` counts **consecutive** 409 Conflicts. Threshold:
`TELEGRAM_CONFLICT_THRESHOLD` env var, default `5`. When the counter hits the
threshold, the bot logs FATAL and calls `sys.exit(1)`. Any non-409 error path
resets the counter.

Why consecutive, not absolute? In the dual-poller pattern, ~25% of polls return
409 and 75% return 200. But the error handler is only invoked on errors, so
from its perspective the 409s arrive back-to-back — a real competing poller
produces a steady stream of error-handler invocations. A single 409 from a
transient network blip will not exit.

`_startup` already calls `delete_webhook(drop_pending_updates=True)` and
`get_me()` — if `get_me()` returns 409 (rare, requires a competing poller to
also be calling `getMe` at the same instant) it exits immediately. The new
runtime guard catches the common case: 409 only on the polling endpoint.

### 4. Heartbeat detection

`heartbeat_monitor.py` (`check_telegram_polling`) now distinguishes:

- **Container absent** (`No such container` in stderr) → `STATUS_UNKNOWN`.
  Expected on CHARLIE post-profile-gate; no alert.
- **>= 3 `409 Conflict` lines in the 5-minute window** → `STATUS_DOWN` with
  `remediation_hint: dual_poller_409`. Threshold is below the bot's own exit
  threshold (5) so the operator sees the alert BEFORE the bot self-terminates.
- **No `getUpdates` evidence** → `STATUS_DOWN` (`bot_not_polling`, unchanged).
- **`getUpdates` evidence, no excess 409s** → `STATUS_HEALTHY`.

### 5. Self-healer routing

`self_healer.py` routes `dual_poller_409` to `noop_escalate` (alert only).
Auto-restarting the local container would just rejoin the race — the operator
must locate and stop the other poller manually.

## Operator playbook: "I see a 409 alert"

1. On the alerting host, confirm: `docker logs mira-bot-telegram --tail 20 | grep 409`.
2. List every host that could be polling: any node with `mira-bot-telegram`
   running. From each: `docker ps --format '{{.Names}}\t{{.Status}}' | grep telegram`.
3. Production owns the token. Any non-VPS poller is the offender. Stop it:
   `docker stop mira-bot-telegram && docker rm mira-bot-telegram`.
4. If the offender's compose includes `mira-bots/docker-compose.yml`, verify the
   `profiles: ["dev-bot"]` gate is present (regression check). If absent on
   `main`, that is the root cause — restore the gate and PR.
5. Wait one heartbeat tick (15 min) and confirm `telegram_polling` is healthy.

## Non-goals

- We do NOT add `deleteWebhook` to the deploy workflow. `_startup` already
  calls it on every container start, and `deleteWebhook` does not arbitrate
  between two getUpdates pollers — it only clears webhook mode (mutually
  exclusive with polling).
- We do NOT use a Redis or filesystem mutex. The Telegram API itself is the
  source of truth — 409 IS the lock signal. Re-implementing it locally is
  redundant and only catches same-host races.

## Verification

After change:

```bash
# On CHARLIE — vanilla up should NOT start the bot
doppler run --project factorylm --config prd -- docker compose up -d
docker ps --format '{{.Names}}' | grep mira-bot-telegram && echo FAIL || echo OK

# Dev bot must opt in
COMPOSE_PROFILES=dev-bot doppler run --project factorylm --config prd -- docker compose up -d telegram-bot
docker ps --format '{{.Names}}' | grep mira-bot-telegram && echo OK || echo FAIL
docker stop mira-bot-telegram && docker rm mira-bot-telegram
```

On the VPS:

```bash
ssh root@165.245.138.91 "docker logs mira-bot-telegram --since 5m 2>&1 | grep -c '409'"
# Expect: 0 (or single-digit transient)
```

Heartbeat verification (CHARLIE):

```bash
doppler run --project factorylm --config prd -- python3 mira-crawler/agents/heartbeat_monitor.py --json | python3 -c "import json,sys; d=json.load(sys.stdin); print([c for c in d['checks'] if c['name']=='telegram_polling'])"
# Expect: status: "unknown", reason: "mira-bot-telegram not on this host (dev host expected)"
```
