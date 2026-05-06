# Atlas WO Outbox — Runbook

**Owner:** mira-bots adapter (Telegram + Slack)
**Source of truth:** `mira-bots/shared/integrations/wo_outbox.py`
**Schema:** `mira-bridge/migrations/004_add_wo_outbox.sql`
**Spec:** Linear CRA-17 / GitHub PR closing CRA-17
**Status:** active 2026-05-04

## What it does

When `atlas_cmms.create_work_order` exhausts its 3-attempt in-process retry budget, the failing payload is persisted to the `wo_outbox` table in the bot's local SQLite. A background drain task in mira-bots retries every 5 minutes and fires a single admin alert (via `notifications/push.send_push` → ntfy.sh) once a row has been unsent for more than 3 hours.

End result: zero work-orders are silently lost when Atlas is down.

## Where the data lives

```
SQLite path: $MIRA_DB_PATH (default /data/mira.db inside the bot container)
Table:       wo_outbox
```

Schema:

| column | meaning |
|---|---|
| `id` | row id |
| `payload_json` | original `create_work_order` kwargs |
| `attempts` | total attempts so far (1 = enqueue itself; +1 per drain attempt) |
| `last_error` | most recent error string (truncated to 1000 chars) |
| `created_at` | unix ts when enqueued |
| `last_attempt_at` | unix ts of most recent retry |
| `sent_at` | unix ts when Atlas accepted (NULL while pending) |
| `atlas_wo_id` | Atlas-side WO id once sent |
| `alerted_at` | unix ts when 3h-stale alert fired (NULL until then) |

## Inspecting the outbox on a live container

```bash
ssh bravonode

# bot container
docker exec -it mira-bot-telegram bash

# inside container
sqlite3 "$MIRA_DB_PATH" <<'SQL'
.headers on
.mode column
SELECT id, attempts, datetime(created_at, 'unixepoch') AS created,
       datetime(last_attempt_at, 'unixepoch') AS last_try,
       sent_at IS NOT NULL AS sent,
       alerted_at IS NOT NULL AS alerted,
       substr(last_error, 1, 80) AS err
FROM wo_outbox ORDER BY created_at DESC LIMIT 20;
SQL
```

Quick stats:

```bash
sqlite3 "$MIRA_DB_PATH" "SELECT
  SUM(sent_at IS NOT NULL) AS sent,
  SUM(sent_at IS NULL) AS pending,
  SUM(sent_at IS NULL AND alerted_at IS NOT NULL) AS alerted,
  COUNT(*) AS total
FROM wo_outbox;"
```

## Reading the logs

Drain task logs at INFO level on every non-empty pass:

```
WO_OUTBOX_DRAIN scanned=3 sent=2 still_pending=1 newly_alerted=0
```

Enqueue is WARNING-level so it surfaces in standard log filters:

```
WO_OUTBOX_ENQUEUE id=42 title='Bearing replace pump-3' error=HTTP 503: ...
```

Final-attempt-exhausted error is ERROR-level:

```
CMMS WO create exhausted 3 attempts — enqueued outbox_id=42 last_error=...
```

## Manually replaying a stuck row

If a row is stuck (e.g., the original Atlas request had bad data that never resolves):

```bash
# inspect the payload
sqlite3 "$MIRA_DB_PATH" "SELECT payload_json FROM wo_outbox WHERE id = <ID>;"

# fix it manually in Atlas, then mark the outbox row as sent
sqlite3 "$MIRA_DB_PATH" "UPDATE wo_outbox SET sent_at = strftime('%s','now'), atlas_wo_id = <ATLAS_ID> WHERE id = <ID>;"
```

If a row is bad data that should never reach Atlas (e.g., a test mistake):

```bash
sqlite3 "$MIRA_DB_PATH" "UPDATE wo_outbox SET sent_at = strftime('%s','now'), atlas_wo_id = -1, last_error = 'manually-cancelled' WHERE id = <ID>;"
```

(We don't `DELETE` because the audit trail is useful.)

## Tunables

Constants in `mira-bots/shared/integrations/wo_outbox.py`:

| const | default | meaning |
|---|---|---|
| `DRAIN_INTERVAL_SECONDS` | 300 | seconds between drain passes |
| `ALERT_AFTER_SECONDS` | 10800 | row age (s) at which admin alert fires (3h) |
| `MAX_DRAIN_BATCH` | 50 | safety: max rows scanned per drain pass |

To change at runtime: edit constants and restart the bot container.

## Chaos test (acceptance gate from CRA-17)

Goal: 30 minutes of Atlas being down → zero lost WOs + exactly one admin alert per stuck row past 3h.

Local simulation:

```bash
cd ~/MIRA
PYTHONPATH=mira-bots python <<'PY'
import asyncio, time
from shared.integrations import wo_outbox
from unittest.mock import patch
from shared.integrations.atlas_cmms import AtlasCMMSClient

async def chaos():
    c = AtlasCMMSClient(base_url="http://localhost:9", api_key="x")
    # All 5 calls hit a closed port -> ConnectError -> retry x3 -> outbox
    for i in range(5):
        result = await c.create_work_order(title=f"chaos-{i}", description="d")
        print(i, result)
    print("STATS:", wo_outbox.stats())

asyncio.run(chaos())
PY
```

Expect: 5 rows in `wo_outbox`, all `pending`, `attempts=3` each, ConnectError-flavoured `last_error`. No exceptions raised to the caller.

## Spec deviation note

CRA-17 originally specified "Add Node-RED outbox-drain flow (every 5 min)" inside `mira-bridge`. The implementation embeds an asyncio drain task in mira-bots itself instead — same effective behaviour, fewer moving parts (no Node-RED flow to keep alive). Easy to migrate to Node-RED later if cross-container concerns appear.
