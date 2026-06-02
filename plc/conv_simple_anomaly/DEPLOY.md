# Deploying the Conv_Simple anomaly engine (always-on alerts)

**What this gives you:** real bench-PLC faults surfaced in Telegram `/fault`, the MCP
`/api/faults/active` API, and ntfy push — always-on, no laptop session required.

Verified end-to-end live on 2026-06-01 (laptop bridge → VPS broker → engine, idle-clean).

## Topology (why it's two services on two hosts)
```
  PLC laptop (bench LAN)                     VPS factorylm-prod (100.68.120.99)
  ┌─────────────────────┐   MQTT 1883        ┌──────────────────────────────┐
  │ live-plc-bridge.py  │ ───(Tailscale)───▶ │ mira-mosquitto                │
  │ reads PLC 192.168.. │                    │   ▲                          │
  └─────────────────────┘                    │   │ _streams/bridge/#        │
                                              │ conv_simple_anomaly engine   │
                                              │   └▶ conveyor_events (mira.db)│
                                              │      + diagnostics + ntfy    │
                                              └──────────────────────────────┘
```
The **VPS cannot reach the PLC** (no route to `192.168.1.0/24`, per the Tailscale route
gotcha), so the bridge MUST run on the **PLC laptop**. Only the engine runs on the VPS.

> ⚠️ Enable BOTH together. A persistent engine with no running bridge will see stale data
> and fire `A0_OFFLINE` into the fault table (spurious "PLC offline" pages). Don't deploy
> one without the other.

## 1. Laptop bridge (PLC laptop, Windows) — must be persistent
```powershell
# one-off (this session):
$env:PLC_HOST="192.168.1.100"; $env:MQTT_HOST="100.68.120.99"
$env:UNS_PREFIX="demo/cell1/conveyor/cv101"
python -u plc\live-plc-bridge\bridge.py     # needs: pip install aiomqtt pymodbus
```
For always-on, register it as a **Scheduled Task** (Trigger: At log on / At startup;
Action: the command above; Restart on failure). The bridge auto-reconnects to both PLC and
broker, so a task that simply keeps it running is enough.

> ⚠️ **Use a boot-scoped Scheduled Task, not a Startup-folder launcher.** A Startup-folder
> (or "At log on") launcher is **logon-scoped** — it stops the moment the user logs out, which
> with the always-on engine produces spurious `A0_OFFLINE` alerts every time someone logs off
> the laptop. The correct always-on mechanism is a **boot-scoped Scheduled Task**: Trigger
> **"At startup"**, **"Run whether user is logged on or not"**, and **"Restart on failure"**.
> Registering a task that runs whether logged on or not requires **administrator rights**.

## 2. Engine (VPS) — reversible container
```bash
# stage code (any dir; does NOT touch the /opt/mira git checkout):
mkdir -p /opt/conv-simple-anomaly
scp plc/conv_simple_anomaly/{rules.py,engine.py,config.yaml,requirements.txt} \
    factorylm-prod:/opt/conv-simple-anomaly/

ssh factorylm-prod 'docker run -d --restart unless-stopped --name mira-conv-simple-anomaly \
  --network mira-plc-dash_default \
  -v /opt/conv-simple-anomaly:/app -w /app \
  -v /opt/mira/mira-bridge/data:/mira-db \
  -e MQTT_HOST=mira-mosquitto -e MQTT_PORT=1883 \
  -e UNS_PREFIX=demo/cell1/conveyor/cv101 \
  -e UNS_EQUIPMENT_PATH=enterprise.factorylm.site.bench.area.conv_simple.equipment.cv101 \
  -e DB_PATH=/mira-db/mira.db -e LOG_LEVEL=INFO \
  -e NTFY_URL=https://ntfy.sh -e NTFY_TOPIC=mira-factorylm-alerts \
  python:3.12-slim sh -c "pip install -q aiomqtt PyYAML && python -u engine.py"'
```
- `mira-mosquitto` lives on the `mira-plc-dash_default` network (not `core-net`). This is
  the network the engine `docker run` above joins and is correct for the current VPS.
  > ⚠️ **Network-name drift:** the committed `docker-compose.fault-detective.yml` instead
  > declares an **external `core-net`** and refers to the broker by service name
  > **`mosquitto`** (not container `mira-mosquitto`). Both facts are accurate for their
  > respective contexts, but a future compose-based deploy of this engine must target the
  > network/service name that the broker actually runs on for that deploy — reconcile before
  > switching from this `docker run` recipe to compose.
- The shared fault DB is the host dir `/opt/mira/mira-bridge/data` → container `/mira-db`.
- Omit `NTFY_*` to run without push (DB + diagnostics only).
- `A0_OFFLINE` now pages at **LOW** priority by design (infrastructure-liveness signal), so a
  brief bridge outage will **not** send an urgent page — only genuine machine faults do.
- Roll back: `ssh factorylm-prod 'docker rm -f mira-conv-simple-anomaly'`.

## 3. Verify
```bash
ssh factorylm-prod 'docker logs --tail 20 mira-conv-simple-anomaly'   # "subscribing ..."
# engine heartbeat (should show active:[] at idle):
ssh factorylm-prod 'timeout 4 docker exec mira-mosquitto mosquitto_sub -h localhost \
  -t demo/cell1/conveyor/cv101/diagnostics/conv_simple_anomaly -v'
```
Then trip a fault at the bench (unplug RS-485 → A1; e-stop → A5) and confirm it appears in
Telegram `/fault`.
