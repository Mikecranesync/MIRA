# Runbook: swap the Ignition gateway host — PLC laptop → CHARLIE (edge)

**Status:** DEFERRED — ready to execute when the slot opens. **Created:** 2026-06-01.
**Trigger:** when active Ignition-side code/dashboard changes settle (today the laptop
stays — it's easier to iterate on).
**Owner:** Mike. **Decision record:** [ADR-0021](../adr/0021-ignition-module-first-edge.md).

> One-line: move the Ignition gateway off the flaky Windows **PLC laptop** onto
> **CHARLIE** (the always-on Mac Mini already on the PLC's LAN). Retire the laptop as
> the Ignition host. **Stay at the edge — do NOT host Ignition on the VPS.**

## Why CHARLIE (edge), explicitly NOT the VPS

It's tempting to "host it properly" by putting Ignition on the VPS. **That is the
anti-pattern [ADR-0021](../adr/0021-ignition-module-first-edge.md) rejects:** the
customer-deployable architecture is *edge-hosted Ignition, plant I/O stays inside
Ignition, outbound HTTPS only — no cloud→plant reach, no reverse tunnel / VPN /
Tailscale into the plant.* A cloud-resident Ignition polling the garage PLC over
Tailscale is exactly the rejected shape (`❌ Cloud-initiated reverse tunnel / VPN /
Tailscale`).

The PLC (Micro820, `192.168.1.100:502` Modbus TCP) is a **local device** with no
internet presence. Something always-on **on the plant LAN** must own the Modbus I/O.
Today that's the laptop. **CHARLIE is the better edge host:** Mac Mini M4, always-on,
`192.168.1.12` on the **same LAN as the PLC**, already the MIRA KB host. So plant I/O
stays local (no tunnel), and the laptop's flakiness + 2h trial restarts go away.

**Bonus:** the Command Center origin-root proxy already runs on CHARLIE
(`mira-proxy/gateway-origin/`). With Ignition local on CHARLIE, proxy + gateway are
same-box — the `display_endpoints` row just repoints from the laptop's Tailscale IP to
CHARLIE-local Ignition.

```
BEFORE                              AFTER (this swap)
  PLC ─LAN─ laptop:8088 (Ignition)    PLC ─LAN─ CHARLIE:8088 (Ignition)   ← edge, local
            │ Tailscale                         │ (same box)
  CHARLIE proxy ─┘                      CHARLIE proxy ─┘
            │                                   │
  app.factorylm.com (frames it)       app.factorylm.com (frames it)
```

## Readiness checks (do these before flipping)

1. **CHARLIE RAM headroom.** CHARLIE already runs Qdrant + Nautobot + the SCADA stack +
   MIRA Hub via Colima. Ignition's JVM wants ~1–2 GB heap. Confirm free RAM (`vm_stat`,
   Activity Monitor) before adding the gateway. If tight, trim idle Docker stacks first.
2. **Install mode.** Ignition on macOS: native gateway install (`.dmg`/tarball) is
   simplest and survives reboots via launchd. (Docker-Linux Ignition is possible but
   adds a Modbus-reachability hop — native macOS keeps it on the LAN directly.)
3. **License.** The laptop runs Ignition Standard *trial* (the 2h "Trial Expired"
   restarts). For a stable demo host, use Ignition **Maker** (free, non-commercial) or
   a real license / **Edge**. Decide before cutover.

## Steps (ordered, idempotent where possible)

1. **Install Ignition on CHARLIE.** Native macOS gateway, default `:8088`. Verify
   `curl -s http://192.168.1.12:8088/StatusPing` → `{"state":"RUNNING"}`.
2. **Create the Modbus device.** Config → OPC-UA → Device Connections → Modbus TCP,
   name `Micro820_Conveyor`, host `192.168.1.100`, port `502`, unit `1`. Wait for
   **Connected** (no tunnel — CHARLIE is on the LAN).
3. **Import the project + tags.** Bring over `ConvSimpleLive` (and `ConveyorMIRA` if
   still wanted) + the 36 tags. Source of truth is the laptop gateway's
   `data/projects/ConvSimpleLive/` and the tag export. Verify the Perspective client:
   `http://192.168.1.12:8088/data/perspective/client/ConvSimpleLive` → 200, live tag
   values render.
4. **Repoint the origin-root proxy** (`mira-proxy/gateway-origin/docker-compose.yml`):
   set `IGNITION_GATEWAY_IP=192.168.1.12` (or `127.0.0.1` via host networking) instead
   of the laptop's `100.72.2.99`. Restart the proxy.
5. **Repoint the Command Center display row.** Update the `display_endpoints` row
   (dev/staging, then prod via `apply-seeds`) for `…conveyor_lab.conveyor_1` so
   `host` → CHARLIE-reachable Ignition (or keep pointing at the proxy origin, which now
   fronts CHARLIE-local Ignition). Per env doctrine: dev → staging → prod.
6. **Verify** with the live gate: `cd mira-hub && doppler run -p factorylm -c dev --
   npx playwright test --config playwright.command-center-ignition.config.ts` (QA-B —
   asserts the frame renders through the proxy). Plus QA-A
   (`mira-proxy/gateway-origin/test/run_test.sh`).
7. **Retire the laptop** as Ignition host once CHARLIE serves the live frame end-to-end
   off-LAN. Keep the laptop available as a fallback until a full demo cycle passes.

## Rollback

Point `IGNITION_GATEWAY_IP` + the `display_endpoints` row back at the laptop
(`100.72.2.99:8088`) and restart the proxy. The laptop gateway is unchanged by this
runbook (we copy *from* it, never delete), so rollback is instant.

## Cross-references

- [ADR-0021](../adr/0021-ignition-module-first-edge.md) — edge-host doctrine (why not VPS).
- [`mira-proxy/gateway-origin/README.md`](../../mira-proxy/gateway-origin/README.md) — the origin-root proxy + QA-A.
- [`docs/command-center-ignition-display.md`](../command-center-ignition-display.md) — the Command Center → Ignition feature + QA-B.
- Memory: `project_ignition_edge_host_swap`, `project_command_center`.
