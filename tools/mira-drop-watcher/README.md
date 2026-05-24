# MiraDrop watcher

Desktop drop-folder for MIRA. Drop a PDF or image into `~/MiraDrop/inbox/`
on CHARLIE and it auto-ingests into the Hub at http://localhost:3101.

Files move:

```
~/MiraDrop/
├── inbox/        ← drop files here
├── processing/   ← daemon is uploading (.lock present while in-flight)
├── done/         ← parsed successfully; .ingest.json sidecar with kb_file_id
├── failed/       ← upload or parse failed; .error.json sidecar with reason
└── .state/
    └── ledger.sqlite   ← SHA-256 → status (dedup across runs)
```

Re-dropping a file that's already in the ledger as `parsed` is a no-op:
the file moves straight to `done/` with a `.duplicate.json` sidecar and
no second HTTP call.

## Setup

1. **Doppler `factorylm/dev`** must define `AUTH_SECRET`, `NEXTAUTH_URL=http://localhost:3101`, and `HUB_INGEST_TOKEN`. The Hub container needs `AUTH_SECRET` to come online at all; the watcher needs `HUB_INGEST_TOKEN`.

2. **Install Python deps:**
   ```bash
   cd ~/MIRA/tools/mira-drop-watcher
   /opt/homebrew/bin/python3 -m venv .venv
   .venv/bin/pip install -r requirements.txt
   ```

3. **Smoke test (foreground):**
   ```bash
   doppler run -p factorylm -c dev -- ./.venv/bin/python main.py --dry-run
   ```
   Drop a PDF into `~/MiraDrop/inbox/` in another terminal — you should
   see a "would POST" log line; the file is moved back to `inbox/`.

4. **Install as LaunchAgent (auto-start on login, restart on crash):**
   ```bash
   ./install.sh
   ```

## CLI

| Flag | Effect |
|------|--------|
| `--dry-run` | Log events but don't POST. File is left in `inbox/`. |
| `--once` | Process current inbox contents and exit. Useful for cron. |

## Env vars

| Var | Default | Notes |
|-----|---------|-------|
| `HUB_URL` | `http://127.0.0.1:3101` | mira-hub base URL |
| `HUB_INGEST_TOKEN` | (required) | Matches Hub's `HUB_INGEST_TOKEN` |
| `MIRA_TENANT_ID` | (required) | UUID, your dev tenant |
| `MIRA_DROP_ROOT` | `~/MiraDrop` | Override the inbox/processing/done/failed root |
| `MIRA_DROP_LOG_LEVEL` | `INFO` | DEBUG for verbose |
| `MIRA_DROP_STABILITY_INTERVAL` | `0.5` | seconds between size checks |
| `MIRA_DROP_STABLE_ROUNDS` | `3` | consecutive equal sizes required |
| `MIRA_DROP_LOCK_TTL_SECS` | `3600` | stale-lock reclaim threshold |
| `MIRA_DROP_POLL_FALLBACK_SECS` | `30` | sweep interval for FSEvents misses |
| `MIRA_DROP_POLL_MIN_AGE_SECS` | `60` | only sweep files older than this |
| `MIRA_DROP_INGEST_POLL_INTERVAL` | `2` | Hub `/api/uploads/:id` poll interval |
| `MIRA_DROP_INGEST_POLL_TIMEOUT` | `180` | give up polling after this many seconds |

## Supported types

`.pdf`, `.jpg`/`.jpeg`, `.png`, `.webp`, `.heic`, `.heif`. 20 MB cap (Hub-enforced).
Anything else is ignored silently.

## Best-practice notes baked in

- **watchdog FSEvents** primary, with a 30 s polling sweep as a safety net for known FSEvents bugs (multi-move bursts dropping events — watchdog#736).
- **Stable-size loop** before processing — defends against partial writes from large copies.
- **SHA-256 ledger** in SQLite WAL — dedup across restarts; re-dropping a parsed file is free.
- **Atomic `os.rename()`** inbox→processing — no two workers process the same file.
- **`.lock` file with PID/timestamp + 1 h TTL** — stale locks from crashed workers are auto-reclaimed.
- **Bounded retries** — 3 attempts with exponential backoff (2 s, 8 s, 32 s). Auth/validation errors break the loop early.
- **`done/` sidecars** — every successful ingest leaves a JSON next to it so you can audit `kb_file_id` and `kb_chunk_count` without opening the Hub.
- **Hub is the channel surface** — files are POSTed to `/api/uploads/folder` and show up in `app.factorylm.com/knowledge`. The watcher never writes directly to NeonDB or Open WebUI.

## Troubleshooting

| Symptom | Likely cause |
|---------|-------------|
| File sits in `inbox/`, daemon logs "stability timeout" | Source still being written (slow copy from network drive?). Increase `MIRA_DROP_STABILITY_INTERVAL`. |
| Everything fails with HTTP 401 | `HUB_INGEST_TOKEN` mismatch between watcher env and Hub container env. |
| Everything fails with HTTP 503 `service_disabled` | Hub container has no `HUB_INGEST_TOKEN` set. |
| Files land in `failed/` with `hub status=timeout` | Open WebUI parse took >180 s — increase `MIRA_DROP_INGEST_POLL_TIMEOUT` or check `mira-core` logs. |
| Daemon dies on logout | LaunchAgent not installed. Run `./install.sh`. |
| Watcher sees no events but `find inbox/` shows files | macOS FSEvents not firing on this volume. Daemon's polling sweep will pick them up within 30 s; investigate with `fs_usage` if persistent. |

Plan: `/Users/charlienode/.claude/plans/optimized-tumbling-wilkes.md`
