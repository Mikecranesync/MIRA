# Plan: PLC → LAN migration + bench-service consolidation onto CHARLIE

**Date:** 2026-07-13
**Trigger:** the TRENDS-tab outage (root cause in PR #2675) exposed the deeper problem: the
Micro820 is point-to-point wired to the PLC laptop, so every PLC-data service is pinned to
the single flakiest machine in the fleet.
**Goal:** PLC reachable on the garage LAN (never the internet); always-on bench services
(historian, bridge) on CHARLIE under launchd; the laptop reduced to what genuinely needs
Windows (CCW, Designer, Factory IO).
**Doctrine that binds this plan:** ADR-0021 (no cloud→plant reach — services move to
CHARLIE, never the VPS) · `.claude/rules/fieldbus-readonly.md` (bench tools stay read-only,
BENCH-ONLY banners; no MIRA *container* opens a fieldbus socket — launchd bare scripts on
CHARLIE for the bench are the same class as today's laptop scripts) · bench
**sole-Modbus-poller** discipline (one historian instance, ever).

---

## Phase 0 — interim stabilization (DONE pending merge — PR #2675)

Boot-scoped Scheduled Task on the laptop + `--bind 0.0.0.0` + Designer `trendUrl` repoint to
`http://100.72.2.99:8766/…`. This fixes the outage **in today's topology** and is worth
doing even though Phase 2 later supersedes it — the laptop remains the only Modbus-capable
host until Phase 1 lands.

**Acceptance:** `curl http://100.72.2.99:8766/health` OK from CHARLIE; TRENDS renders on a
phone/Hub browser; survives a laptop reboot + logoff.

## Phase 1 — PLC onto the LAN (Mike, ~20 min)

Execute `docs/runbooks/plc-lan-migration.md` (pre-checks → re-plug → verify → harden).
Zero re-addressing by design: the p2p link already used `192.168.1.x`.

**Acceptance (evidence-only):** from CHARLIE, `nc -z 192.168.1.100 502` connects; Ignition
device still Connected; Live View still live; router shows reservations for `.100`/`.50`;
no port-forwards.

## Phase 2 — trend historian moves to CHARLIE (agent, ~1 h, after Phase 1)

The always-on Mac mini replaces the laptop as historian host. Outage class disappears
(launchd `KeepAlive` + a machine that is never rebooted casually).

1. Venv: `python3.12 -m venv ~/venvs/trend-historian && pip install -r plc/conv_simple_anomaly/requirements_trend.txt`
   (CHARLIE system python is 3.9 — do not use it).
2. LaunchAgent `com.factorylm.trend-historian` (pattern: existing
   `com.factorylm.mira-drop-watcher`): runs
   `trend_historian.py --host 192.168.1.100 --bind 0.0.0.0 --http-port 8766`,
   `KeepAlive=true`, log to `~/Library/Logs/mira-trend-historian.log`.
   Deliverable: `plc/conv_simple_anomaly/launchd/com.factorylm.trend-historian.plist`
   + install script (new PR).
3. **Retire the laptop task first** (`Unregister-ScheduledTask "MIRA Trend Historian"`) —
   sole-poller: never two historians. Order: stop laptop task → start CHARLIE agent.
4. Designer: `trendUrl` → `http://100.70.49.126:8766/viewer/index.html?source=historian`
   (CHARLIE's tailnet IP — reachable from every tailnet client AND from the laptop).
5. `TREND_DB_PATH` → a CHARLIE-local path; the SQLite trend history restarts fresh
   (24 h retention — acceptable loss, note it when executing).

**Acceptance:** `/health` OK on `100.70.49.126:8766` from a phone on the tailnet; TRENDS tab
renders remotely; laptop task unregistered; exactly one poller in `netstat` on the PLC side
besides the gateway.

## Phase 3 — live-plc-bridge moves to CHARLIE (agent, ~30 min)

Same treatment: `com.factorylm.live-plc-bridge` LaunchAgent replacing
`run_bridge_laptop.bat`'s scheduled task (bridge → VPS MQTT at `100.68.120.99:1883` is
outbound-only, ADR-0021-clean). BENCH-ONLY banner stays. Retire the laptop task on cutover.
Check first whether bridge + historian polling concurrently is tolerated (gateway makes 3
Modbus clients total) — if the Micro820 objects, fold bridge publishing INTO the historian
process (one poller, two outputs) as a follow-up.

**Acceptance:** VPS anomaly engine still receives tags (check `tag_events` freshness probe in
`db-inspect.yml`); laptop task gone.

## Phase 4 — Ignition gateway host-swap laptop → CHARLIE (deferred, biggest win)

The pre-existing deferred plan (PR #1631, `project_ignition_edge_host_swap`) becomes
executable once the PLC is on the LAN. Gateway on CHARLIE = Live View, Ask MIRA panel, and
diagnose endpoints stop depending on the laptop entirely. Scope it separately: license
re-activation, gateway backup/restore (.gwbk), Designer still runs on the laptop pointing at
CHARLIE. **Not in this plan's execution window — revisit after Phases 1–3 are proven.**

## Phase 5 — remote management for the laptop (small, anytime)

Install the Jarvis agent (`:8765`, tailnet-only, bearer-token — the fleet pattern already
live on CHARLIE) on the PLC laptop. Even after Phases 2–4 the laptop still runs CCW/Designer/
Factory IO; today's incident took ~an hour of investigation that Jarvis would have made a
30-second remote restart.

**Acceptance:** `curl http://100.72.2.99:8765/health` from CHARLIE returns OK.

---

## Constraints & risks

| Risk | Mitigation |
|---|---|
| PLC exposed to internet | Runbook Phase 1 step 4 (no default gateway) + Phase 3 hardening (no port-forwards). The PLC never gets a route out. |
| IP collision on the LAN | Runbook Phase 0 pre-checks + DHCP reservations before re-plugging. |
| Two Modbus pollers fighting | Hard order in Phase 2/3: retire the laptop task BEFORE starting the CHARLIE agent. Sole-poller doctrine in `TREND_HISTORIAN.md`. |
| Micro820 connection-count limit (gateway + historian + bridge) | Phase 3 checks tolerance; fallback = fold bridge into the historian (one poller, two outputs). |
| CHARLIE rule "no fieldbus sockets in MIRA containers" | Services run as **bare launchd scripts** (bench-tool class, BENCH-ONLY banners), not containers; consistent with `fieldbus-readonly.md`'s bench carve-out. |
| Laptop still needed | Yes — CCW, Designer, Factory IO are Windows-only. Phases 2–4 shrink its blast radius; they don't retire it. |

## Sequencing summary

```
NOW:      Phase 0 (PR #2675, laptop task)            — outage fixed in current topology
NEXT:     Phase 1 (re-plug, runbook)                  — Mike, 20 min in the garage
THEN:     Phase 2 (historian → CHARLIE launchd)       — agent PR + Designer repoint
          Phase 3 (bridge → CHARLIE launchd)          — agent PR
LATER:    Phase 4 (gateway host-swap, PR #1631 plan)  — separate scoped effort
ANYTIME:  Phase 5 (Jarvis on the laptop)              — 10-min quality-of-life
```
