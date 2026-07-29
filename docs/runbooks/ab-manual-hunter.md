# AB Manual Hunter Runbook

`scripts/ab_manual_hunter/run.py` — an Allen-Bradley / Rockwell manual discovery job. It probes the Rockwell literature CDN for publication PDFs, downloads **new** ones into `~/MiraDrop/inbox/`, and hands off to the `mira-drop-watcher` → Hub node-ingest pipeline. It does **not** chunk/embed itself, and it does **not** touch the drive-pack path.

## Scope

- **Vendors:** Allen-Bradley / Rockwell only (reuses `plc/ccw/scripts/fetch_rockwell_docs.py` URL patterns).
- **Discovers vs. downloads:** discovers publication IDs; downloads PDFs **only in LIVE mode**.
- **Dedup:** `_already_have()` skips pubs already in `~/MiraDrop/{done,inbox}` (filename/pub-id glob — *not* content hash; hash dedup is the drop-watcher's SQLite ledger).

## Runtime config (env, as launchd sets it)

| Var | Default | Effect |
|---|---|---|
| `MIRA_AB_HUNTER_LIVE` | `0` | `0` = **DRY-RUN** (finds pubs, downloads nothing). `1` = fetch. |
| `AB_HUNTER_MAX_NEW` | `3` | Max new PDFs downloaded per run (VPS-overload cap). |
| `AB_HUNTER_TIMEOUT_SECS` | `1200` | Hard run timeout (20 min). |

**`MIRA_AB_HUNTER_LIVE=0` prevents any download** — the run reports what it *would* fetch. This is the default; the hunter is **dry-run only** until an operator sets `=1`.

## Schedule (launchd, Charlie)

- `scripts/ab_manual_hunter/launchd/com.factorylm.ab-manual-hunter.plist` — every 6 h at `:17`.
- **`RunAtLoad=false`** → it does **not** run on load; it must be explicitly loaded: `launchctl load ~/Library/LaunchAgents/com.factorylm.ab-manual-hunter.plist`. Confirm with `launchctl list | grep ab-manual-hunter`.

## STOP_INGEST kill switch (checked at step 0)

- Reads `~/.mira/STOP_INGEST`; if present, **exits clean (skip)** and alerts.
- Written either by an operator (`touch ~/.mira/STOP_INGEST`) or automatically by `scripts/ingest_guardrails.py` (first line = `AUTO_PAUSED_BY_GUARDRAILS`).
- **ingest_guardrails** (launchd every 15 min) auto-writes STOP_INGEST when: disk > 92 %, free mem < 1 GiB, MiraDrop inbox > 50, MiraDrop failed/24h > 20, or hunter fail rate ≥ 4/5. Clear with `rm ~/.mira/STOP_INGEST`.

## Evidence

- Run reports: `~/.mira/ab-hunter/run-<UTCts>.json` (`.overall`, `.at`, `.duration_s`, per-step detail).
- Logs: `/tmp/ab-manual-hunter{,-stdout,-stderr}.log`.
- Downloads land in `~/MiraDrop/inbox/` (then `done/`/`failed/` after the watcher).
- Quick check: `python mira-crawler/fleet_status.py` → the `[ab_manual_hunter]` line.

## Go-live procedure (dry-run → live)

1. Confirm a clean dry-run: `tail -50 /tmp/ab-manual-hunter.log` shows discovered pubs, 0 downloads.
2. Confirm guardrails healthy: `cat ~/.mira/guardrails-state.json | jq '.level'` == `ok`; no STOP_INGEST.
3. Set `MIRA_AB_HUNTER_LIVE=1` in the plist env (keep `AB_HUNTER_MAX_NEW=3`), reload the agent.
4. Watch the first live run's report + MiraDrop inbox depth; if guardrails trip, it auto-pauses.

## Boundary

The hunter feeds the **KB** via the generic Hub upload path. It has **no** vendor/model/publication/revision structuring beyond "an AB PDF", and no connection to `tools/drive-pack-extract/`. Turning an AB-hunter hit into a graded drive-pack candidate is the bridge in `docs/drive-commander/bridge-manual-discovery-to-drive-pack-grading.md`.
