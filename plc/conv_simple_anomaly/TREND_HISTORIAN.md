# Trend Historian — run & deploy (Track A, bench bootstrap)

The bench data plane for live trending: owns the PLC's single Modbus connection, stores
time-series in SQLite, and serves the trend chart + derived summaries. Plan:
`.claude/plans/the-motor-is-connected-fuzzy-parasol.md`.

> **Track A vs Track B.** This Python service is the **bench bootstrap** (works today on the
> sparse Conv_Simple_1.8 map, offline, no Ignition config). The **shipped product (Track B)** is
> Ignition-native — built-in Modbus driver + Tag Historian + native Perspective Time-Series chart,
> packaged as an Ignition Exchange resource (near-zero external deps). This service survives as the
> dev/demo tool and a non-Ignition fallback connector.

## Install (once)
```bash
pip install -r plc/conv_simple_anomaly/requirements_trend.txt   # fastapi, uvicorn, pymodbus
```

## Run (PLC laptop — it is the SOLE Modbus poller)
```bash
# local only (chart viewed on the same laptop):
python plc/conv_simple_anomaly/trend_historian.py

# reachable from remote Perspective clients (phone / travel laptop) over the tailnet/LAN:
python plc/conv_simple_anomaly/trend_historian.py --bind 0.0.0.0
```
⚠ **Do NOT run `live_logger.py` / `live_check.py` while the historian is up** — the PLC has one
Modbus connection slot; they will fight. Stop the historian first to take a labeled capture.

## Endpoints (read-only, default `:8766`)
| Endpoint | Purpose |
|---|---|
| `GET /health` | liveness + connection state + poll rate |
| `GET /chart?asset=…` | the self-contained ISA-101 trend chart page (no external JS) |
| `GET /trend?tag=&window=&points=` | downsampled time-series JSON |
| `GET /trends/summary?window=` | per-tag derived summary (chart intel + MIRA, next phase) |
| `GET /viewer/` | the full trend viewer (`mira-trend-viewer/`, static mount, repo checkout only) — open with `?source=historian` |

Quick check: `curl http://127.0.0.1:8766/trends/summary?window=30`

## Wire into Ignition Perspective
The `Trends/TrendPanel` view + `/trends` route + NavBar **TRENDS** button are already in
`ignition/project/`. Deploy with the existing script, then open the page:
```powershell
PowerShell -ExecutionPolicy Bypass -File ignition\deploy_ignition.ps1
# browse: http://localhost:8088/data/perspective/client/ConveyorMIRA/trends
```
The TrendPanel iframe now embeds the **full trend viewer**
(`http://127.0.0.1:8766/viewer/index.html?source=historian` — the historian serves
`mira-trend-viewer/` itself at `/viewer`, same origin as `/trends/summary`, so the viewer's
adapter auto-targets the serving origin). The bare single-chart page is still at `/chart`.

**Remote clients:** the iframe URL defaults to `127.0.0.1` (same-laptop). For a phone/remote
Perspective session, set the `TrendPanel` `trendUrl` param to the PLC laptop's Tailscale IP
(e.g. `http://100.72.2.99:8766/viewer/index.html?source=historian`) and run the historian with
`--bind 0.0.0.0`.

## Verify
1. `/health` → `connection: ok`; `/trends/summary` lists the live signals.
2. `/trends` route renders; DC bus sits in its band; freshness chip ticks; quality pips green.
3. Force an excursion (load/brake the belt) → the trace flips gray→red, the intelligence panel
   emits a cause + next-check.
4. Stop the historian → the chart greys with a STALE banner within ~2× the poll interval.
5. `pytest plc/conv_simple_anomaly/` → green (data-layer + accumulator + rules).

## Config (env)
`PLC_HOST` (192.168.1.100) · `TREND_POLL_HZ` (2) · `TREND_SUMMARY_WINDOW_S` (60) ·
`TREND_RETENTION_HOURS` (24) · `TREND_HTTP_HOST` (127.0.0.1) · `TREND_HTTP_PORT` (8766) ·
`TREND_DB_PATH` (./trend_data.db, gitignored).
