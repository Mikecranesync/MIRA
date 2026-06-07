# RESUME — MIRA PLC Operator Dashboard

Paste the block below into a fresh session to pick up exactly where we left off.

---

```
Resume the MIRA PLC operator dashboard work.

CONTEXT (already done, merged to main):
- Canonical dashboard = the PMC STATION web operator panel, LIVE at
  http://100.68.120.99:8080/panel.html (Tailscale, phone-ready). Source:
  MIRA-monorepo/plc/edge-stack/ (web/panel.html + index.html, docker-compose.yml,
  mosquitto.conf). Flag file: plc/edge-stack/README.md ("CANONICAL … DO NOT DELETE").
- Pipeline: PLC 192.168.1.100:502 -> plc/mqtt_publisher.py (laptop edge node, start
  with plc/run_publisher.bat) -> Mosquitto on VPS factorylm-prod (Tailscale-only,
  ports 1883/9001) -> nginx :8080. Update a web page with NO admin via:
  scp plc/edge-stack/web/panel.html factorylm-prod:~/mira-plc-dash/web/
- Panel shows: 5 PMC lamps + START + selector + E-STOP, plus simple live drawings of
  the GS10 VFD (Hz/A/Vdc, RUN/STOP, CMD) and MLC1 main-line contactor (3-pole
  open/closed). Lamp->tag map: amber=DO_03, white=DI_02(safety), green=DO_00,
  blue=DO_02(drive/contactor=MLC), red=DO_01, START=DI_04, selector=DI_00/DI_01,
  E-STOP=DI_02. VFD from vfd.* MQTT fields.
- Ignition Perspective TWIN deployed at
  http://100.72.2.99:8088/data/perspective/client/ConvSimpleLive (project
  plc/ignition-project/ConvSimpleLive). Ignition runs on the LAPTOP as a service.
  Deploy = run plc/ignition-project/install.ps1 elevated (copy) THEN
  Restart-Service Ignition -Force (gateway does NOT hot-reload a view edit). UAC must
  be accepted at the moment of firing. Trial expires every 2h unless a free Maker
  license is applied. Gotcha: Ignition's expression parser rejects unicode glyphs in
  expr bindings (renders "null") — use plain ASCII.
- Status: all merged to main (PR #1598, merge 02a29559), tag plc-dashboard-v1.0.

START BY: read MEMORY.md (esp. canonical-operator-dashboard, web-dashboard-direction,
plc-modbus-tcp-slave-map, ignition-config-as-files) and git pull main.

OPEN FOLLOW-UPS (pick what I ask for):
1) Add the VFD + MLC drawings to the Ignition twin too (needs vfd_frequency/
   vfd_current/vfd_dc_bus dragged into Ignition tags via Designer first).
2) Apply free Ignition Maker license so the gateway trial stops expiring.
3) Make panel.html the default page (so plain :8080 shows the panel).
4) Make the laptop mqtt_publisher.py auto-start (Windows scheduled task) and/or move
   it to a dedicated edge box for true laptop-off operation.
5) Fix-as-needed: lamp->tag mapping if any physical lamp maps to a different output.
```

---

## Quick reference

| Thing | Where |
|---|---|
| Live web panel | http://100.68.120.99:8080/panel.html |
| Ignition twin | http://100.72.2.99:8088/data/perspective/client/ConvSimpleLive |
| Start live feed (laptop) | `plc/run_publisher.bat` |
| Redeploy stack (VPS) | `ssh factorylm-prod 'cd ~/mira-plc-dash && docker compose up -d'` |
| Update web page (no admin) | `scp plc/edge-stack/web/panel.html factorylm-prod:~/mira-plc-dash/web/` |
| Deploy Ignition view | run `plc/ignition-project/install.ps1` elevated, then `Restart-Service Ignition -Force` |
| Version tag | `plc-dashboard-v1.0` |
