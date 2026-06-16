# ⭐ CANONICAL MIRA OPERATOR DASHBOARD — DO NOT DELETE / DO NOT LOSE

**This is THE operator dashboard for the Conv_Simple PLC.** It is the live,
always-on, phone-viewable HMI. If you are cleaning up, refactoring, or unsure what
this folder is — **keep it.** This is production-of-record for the demo.

## What it is
A web "PMC STATION" operator panel that mirrors the physical control box (beige
panel, 5 pilot lamps, green START button, FWD/REV/OFF selector, red E-STOP
mushroom), driven by **live PLC data over MQTT**. No Ignition gateway, no admin
rights required.

## 🔗 Live URLs (open over Tailscale, phone included)
- **Operator panel (PRIMARY):** http://100.68.120.99:8080/panel.html
- Data readout (gauges/indicators): http://100.68.120.99:8080/

## Files (the dashboard — keep all of these)
| File | Role |
|---|---|
| `web/panel.html` | **The PMC STATION operator panel** (canonical HMI) |
| `web/index.html` | Data-readout dashboard (DC bus / VFD / I/O) |
| `mosquitto.conf` | MQTT broker config (1883 + 9001 websockets) |
| `docker-compose.yml` | Broker (`mira-mosquitto`) + nginx (`mira-plc-dash`) |
| `../mqtt_publisher.py` | Edge publisher: PLC → MQTT (run with `../run_publisher.bat`) |

## Data flow
```
Micro 820 PLC (192.168.1.100:502)
   → mqtt_publisher.py  [laptop edge node]   ← run_publisher.bat keeps this alive
   → Mosquitto broker   [VPS factorylm-prod, Tailscale-only]
   → panel.html / index.html  [VPS nginx :8080]
   → your browser / phone (Tailscale)
```

## Operate
- **Start the live feed (laptop):** double-click `../run_publisher.bat` (keep running).
- **Redeploy the stack (VPS):** `ssh factorylm-prod 'cd ~/mira-plc-dash && docker compose up -d'`
- **Update a web page (VPS, no admin):** `scp web/panel.html factorylm-prod:~/mira-plc-dash/web/` (nginx serves it live).
- **Stop everything:** `ssh factorylm-prod 'cd ~/mira-plc-dash && docker compose down'`

## Lamp → tag map (panel.html)
amber=DO_03 · white=DI_02 (safety) · green=DO_00 · blue=DO_02 (drive/contactor) ·
red=DO_01 · START=DI_04 · selector=DI_00/DI_01 · E-STOP=DI_02.

> There is an identical **Ignition Perspective** twin (`../ignition-project/ConvSimpleLive`)
> for the "proper SCADA" route; it requires the gateway + admin elevation to deploy.
> The MQTT panel above is the no-admin, always-on canonical view.
