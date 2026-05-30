# Always-On Web Dashboard for the Conv_Simple PLC — Ignition + MQTT

**Date:** 2026-05-29
**Status:** Design (awaiting review)
**Author:** PLC / MIRA session

## What this accomplishes (plain English)
Today the only way to see live PLC data is a terminal app (`live_monitor.py`)
running on the laptop, plugged into the PLC. The goal is to view the conveyor
dashboard **from any browser or phone, anywhere, at any time — without the laptop
being involved.** This spec lays out the two industry-standard ways to do that —
**(A) Ignition Perspective** (a real SCADA/HMI web server) and **(B) MQTT /
Sparkplug B** (edge publishes to a cloud broker + Grafana) — and the combined
architecture that uses both. The user asked for both.

## Why this is the standard pattern
- The **engineering laptop is never part of the runtime.** Live dashboards run on
  an **always-on server or edge gateway** on the control network.
- The PLC stays on an **isolated OT network** (Purdue model). Only a gateway
  bridges it outward. The PLC is never exposed to the internet.
- Remote access is via **VPN / zero-trust networking** (Tailscale here), never an
  open inbound port. Cloud data-out uses **MQTT Sparkplug B** (outbound only).

## Current environment (verified 2026-05-29)
- PLC: Micro 820 at `192.168.1.100:502`, Modbus TCP slave (Conv_Simple_1.5):
  13 non-contiguous coils + 5 HRs (see `plc-modbus-tcp-slave-map` memory). HRs
  scaled (Hz×100, V×10). DC bus ~324 V at idle confirmed live.
- PLC network `192.168.1.0/24`: **only** the laptop (`.50`) + PLC (`.100`),
  behind an **unmanaged switch** (no IP).
- Home Wi-Fi `192.168.4.0/24`: router `.1`, ~14 devices incl. **factorylm-bravo**
  (`192.168.4.109`, always-on Mac, on Tailscale).
- Tailscale online nodes: this laptop, alphanode, charlie mac-mini-1, **bravo**,
  **factorylm-prod (public VPS, 100.68.120.99)**. pi-factory / edge-pi offline 85–93d.
- Ignition **8.3.4** installed (Modbus + Micro800 drivers) — on the laptop today.
  `ConveyorMIRA` project broken (missing tag provider); `MIRA_Tags` works.

## Shared prerequisite — an always-on box on the PLC network
Both paths require one always-on host that can reach `192.168.1.100` and is on the
tailnet. Decision (recommend the first):

| Option | Description | HW cost |
|---|---|---|
| **Dedicated edge gateway (recommended)** | Pi / mini-PC into the PLC switch, static `192.168.1.x`. Revive pi-factory/edge-pi or a spare. Keeps OT isolated. | $0 reuse / ~$80 new |
| bravo Mac + join PLC to home net | Uplink dumb switch to router, re-IP PLC to home subnet; bravo reaches it. | $0 |
| VPS only | Cannot reach PLC alone — still needs a local bridge. | n/a |

## Path A — Ignition Perspective (full SCADA/HMI)
**Flow:** PLC `:502` → Ignition Modbus TCP driver → tags → Perspective web view →
browser/phone via Tailscale (private) or Funnel/reverse-proxy (public).

- **Host:** Ignition Gateway as a service on the always-on box (move off laptop).
- **Tags:** new Modbus TCP device; map the 13 coils + 5 HRs with ÷100 / ÷10 scaling.
- **View:** Perspective — gauges (DC bus, freq, current), indicators (DI/DO,
  e-stop, run state, vfd_comm_ok trust gate). Mobile-ready, zero client install.
- **Access:** `http://<tailscale-ip>:8088` private; Tailscale Funnel or
  reverse-proxy + TLS/auth for public.
- **Effort:** ~1–2 days. **Cost:** $0 (Ignition Maker Edition free for
  personal/non-commercial, or existing license).
- **Bonus:** historian, trending, alarms, and the Ignition-MCP AI tie-in
  (CRA-231/245) come for free; aligns with the "text your factory" demo.

## Path B — MQTT / Sparkplug B (lightweight edge → cloud)
**Flow:** PLC → Python edge publisher (reuses `live_monitor.py` segmented reads) →
MQTT broker on the VPS → Grafana (public HTTPS) / any subscriber.

- **Edge publisher:** Python service on the edge box; polls PLC, publishes
  Sparkplug B (or JSON) topics **outbound only** (nothing inbound to OT).
- **Broker:** Mosquitto (or EMQX) on `factorylm-prod` (always-on, public). Or
  HiveMQ Cloud free tier.
- **Dashboard:** Grafana on the VPS (+ InfluxDB for history) → polished, auth'd,
  public web dashboard. Optional tiny MQTT-WebSocket HTML page for pure live view.
- **Access:** Grafana public HTTPS + login, or Tailscale-only private.
- **Effort:** ~1–2 days. **Cost:** $0 (open-source on existing VPS).
- **Bonus:** decoupled, cloud-native, matches "phone → cloud → factory" narrative.

## Combined architecture (recommended end state)
One edge box, two consumers:
- **Ignition** = on-prem SCADA/HMI (local + Tailscale), the rich operator view.
- **Ignition MQTT Transmission** (Cirrus Link module) publishes tags as Sparkplug
  B → **broker on the VPS** → **Grafana** (or cloud Ignition) = always-on anywhere
  view.
This is the full modern stack: rich local HMI + lightweight cloud dashboard,
PLC still isolated, all data-out is outbound MQTT.

## Suggested build order (phased)
1. **Stand up the edge box** (shared prerequisite) on the PLC switch + tailnet.
2. **Path A MVP:** Ignition on the edge box, Modbus device + tags, one Perspective
   view, Tailscale access. → live HMI without the laptop.
3. **Path B MVP:** Mosquitto on VPS, Python edge publisher, Grafana dashboard. →
   public cloud view.
4. **Combine:** Ignition MQTT Transmission → VPS broker; dedupe so Grafana reads
   from the Ignition-published Sparkplug feed.

## Security notes
- OT network stays isolated; no inbound to `192.168.1.0/24`.
- Remote access via Tailscale ACLs; public exposure only through Funnel/reverse
  proxy with TLS + auth, or Grafana login.
- Read-only first. PLC write-back (the Phase B control story) is out of scope here.

## Open decision for the user
- Which always-on box (dedicated edge gateway vs. bravo + join PLC to home net).
- Public URL vs. Tailscale-private for the first cut.
- Build order: Ignition-first (recommended, aligns with active mission) or
  MQTT-first (faster public URL).
