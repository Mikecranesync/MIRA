# Runbook: Move the Micro820 from point-to-point onto the garage LAN

**Owner:** Mike (physical steps) + agent (verification)
**Time:** ~20 min including verification
**Risk:** LOW — full rollback is "re-plug one cable"
**Plan this executes:** `docs/plans/2026-07-13-plc-lan-migration-and-bench-services.md`

## Why

Today the Micro820 (`192.168.1.100`) hangs off a **point-to-point Ethernet cable to the
PLC laptop** (laptop NIC `192.168.1.50`). Same numbering as the garage LAN, different wire —
which is why CHARLIE cannot reach the PLC (verified 2026-07-13: 100 % ping loss, :502 closed
from CHARLIE while the laptop's gateway polls it fine). Consequence: every PLC-data service
(Ignition gateway, trend historian, live-plc-bridge) is pinned to the laptop — a single point
of failure. The 2026-07-13 TRENDS-tab outage was this architecture failing, not one script.

**This migration puts the PLC on the LAN — NEVER on the internet.** Modbus TCP has zero
authentication; anyone who can reach :502 can write coils. The PLC gets LAN reachability
only; remote access stays Tailscale-into-a-trusted-host (ADR-0021: no cloud→plant reach).

## Target topology

```
Internet ── router ── garage switch ──┬── CHARLIE     192.168.1.12   (tailnet 100.70.49.126)
                                      ├── BRAVO       192.168.1.11
                                      ├── PLC laptop  192.168.1.50   (tailnet 100.72.2.99)
                                      └── Micro820    192.168.1.100  (NO default gateway)
```

## Phase 0 — pre-checks (agent, from CHARLIE, BEFORE touching cables)

```bash
# 1. Nothing on the LAN already answers at the PLC's static IP (must FAIL):
ping -c 2 -t 3 192.168.1.100        # expect 100% loss today
# 2. Nothing already claims the laptop NIC's IP either (should fail while it's on the p2p wire):
ping -c 2 -t 3 192.168.1.50
# 3. Note the router's DHCP pool (Mike: router admin page) — .100 and .50 must be OUTSIDE
#    the pool or reserved. If the pool covers them, add reservations before Phase 1.
```

If step 1 or 2 gets a reply, STOP — something on the LAN already uses that address; resolve
the collision first.

## Phase 1 — physical move (Mike, ~5 min)

1. Unplug the PLC↔laptop Ethernet cable at the **laptop** end.
2. Plug the PLC's cable into the **garage switch**.
3. Plug the **laptop's** Ethernet NIC into the same switch (its static `192.168.1.50` carries over).
4. **PLC IP config stays untouched** — static `192.168.1.100` and, critically, **default
   gateway blank / 0.0.0.0** (check in CCW → Controller → Ethernet if unsure). With no
   gateway the PLC physically cannot route to or from the internet even though it's on the LAN.

## Phase 2 — verification (agent, from CHARLIE)

```bash
ping -c 3 192.168.1.100                    # now expect replies
nc -z -G 5 192.168.1.100 502 && echo OK    # Modbus TCP reachable
curl -s -o /dev/null -w '%{http_code}\n' http://100.72.2.99:8088/   # gateway still up (302)
```

Then confirm **existing consumers survived the move**:
- Ignition gateway device status: Micro820 device still Connected (laptop, gateway web UI).
- Command Center → Open Live View → live values still ticking.
- If the PR #2675 scheduled task is installed: `curl http://100.72.2.99:8766/health` still OK.

## Phase 3 — hardening (Mike, router admin page, ~5 min)

- [ ] DHCP reservation / pool exclusion for `192.168.1.100` and `192.168.1.50`.
- [ ] Confirm **no port-forward** rules exist (or ever get added) for 502 / 8088 / 8766.
- [ ] PLC default gateway confirmed blank (Phase 1 step 4).
- [ ] Optional: if the router supports it, put the PLC in an isolated/IoT VLAN that can talk
      to CHARLIE/BRAVO/laptop but not the internet. Nice-to-have, not required for the bench.

## Rollback

Re-plug the cable point-to-point (PLC ↔ laptop NIC). Everything returns to today's topology;
no config was changed on the PLC.

## After this runbook

Phase 2 of the plan (`docs/plans/2026-07-13-plc-lan-migration-and-bench-services.md`)
moves the trend historian to CHARLIE under launchd and retires the laptop scheduled task.
Do not run two historians — the bench sole-Modbus-poller discipline still applies.
