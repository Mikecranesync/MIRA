# Runbook — Find & open the "Conv Simple Live" screen in Command Center (as a human)

**Audience:** Hermes / the dogfood crew (acting as a human maintenance user).
**Goal:** locate the live `ConvSimpleLive` Ignition Perspective screen from the
FactoryLM Command Center and open it — without being told the URL.
**Captured:** 2026-06-16, gateway live (Perspective Trial Mode, ~2 h window).

---

## 0. What you're looking for (so you know you found the right screen)

The screen is the **conveyor bench HMI**: "Conv_Simple Live", served by the
**PLC Laptop** Ignition gateway, bound to the Micro820 PLC over CIP (live OPC tags).
It has **two tabs**:

- **PMC STATION** — pilot lights (AMBER/SAFETY/GREEN/DRIVE/RED), START, OFF selector,
  a big red **E-STOP (ARMED/OK)**, a **GS10 VFD** panel (Hz / A / Vdc bus, RUN/STOP),
  and an **MLC1 main line contactor** (CLOSED · ENERGIZED).
- **CONVEYOR** — "GARAGE CONVEYOR", motor/VFD speed + amps + direction, PE-01
  photo-eye, and an **"Ask MIRA"** button.

Match against these captures (in `docs/promo-screenshots/`):
- `2026-06-16_convsimplelive_gateway-live_desktop.png` (PMC STATION, desktop)
- `2026-06-16_convsimplelive_gateway-live_mobile.png` (PMC STATION, phone)
- `2026-06-16_convsimplelive_conveyor-tab_desktop.png` (CONVEYOR tab)

If what you opened shows these elements with **live values** (e.g. the VFD DC-bus
voltage ticks, ~322–323 Vdc when idle), you found it.

---

## 1. Prerequisites (all three, or you won't see it)

1. **You must be on the FactoryLM Tailscale tailnet.** The gateway is
   **Tailscale-only** at `100.72.2.99:8088`. Command Center hands off by opening the
   screen in a **new browser tab**, and that tab loads from *your* machine — so your
   browser has to be able to reach `100.72.2.99`. Not on Tailscale → the tab won't load.
   (LAN `192.168.1.20:8088` only works if you're physically on the bench LAN; it was
   down at capture time — prefer the Tailscale address.)
2. **The gateway must be running with the Perspective trial active.** It runs
   Ignition **Standard trial**, good for ~2 hours per reset. If the tab shows
   "Trial Expired", the trial needs resetting on the laptop (gateway-side, not a Hub
   issue). At capture time it read **"Trial Mode Active"**.
3. **Be logged into** `https://app.factorylm.com` (the owner tenant).

---

## 2. Find it in Command Center (the human path)

Go to **`https://app.factorylm.com/command-center`**.

**Path A — it's already connected (a card exists):**
- Under **Live Views**, look for the conveyor card (label like "Conveyor Live" /
  "Conv Simple — Live"). Status reads **"open to view ↗"** (blue) — that is NOT an
  error; the cloud Hub can't probe a Tailscale gateway, but you can still open it.
- Click the card → **Open Live View** → the screen opens in a new tab.

**Path B — no card yet (connect it — no URLs to type):**
1. Click **Connect live screen**.
2. **1. Gateway** → **PLC Laptop**
3. **2. Live screen** → **Conveyor Live**  (Ignition Perspective)
4. **3. Machine** → pick the conveyor node in the namespace tree
5. **Connect live screen** → a Live View card appears → **Open Live View**.

> The picker fills the technical address for you. If you ever need the raw values
> (Advanced toggle, or a fallback): scheme `http`, host `100.72.2.99`, port `8088`,
> path `/data/perspective/client/ConvSimpleLive`.

**Fallback — direct (still must be on Tailscale):**
`http://100.72.2.99:8088/data/perspective/client/ConvSimpleLive`

---

## 3. If something blocks you (and who fixes it)

| Symptom | Cause | Fix (owner) |
|---|---|---|
| Connect modal's **Machine** dropdown has no conveyor node | prod tenant namespace lacks a conveyor node | add a conveyor node to the namespace, then retry |
| Register errors **"host is not in the configured display host allowlist"** | `COMMAND_CENTER_DISPLAY_HOST_ALLOWLIST` set without the gateway | add `100.72.2.99` to that var in Doppler `factorylm/prd`, restart Hub |
| **Open Live View** tab is blank / won't load | you're **not on Tailscale**, or the gateway/trial is down | join the tailnet; confirm the gateway is up + trial active |
| Tab shows **"Trial Expired"** | Ignition Perspective 2-h trial lapsed | reset the trial on the PLC laptop gateway |
| Card shows **"open to view ↗"** not green | expected — cloud can't probe a Tailscale gateway | none; click and open it anyway |

---

## 4. Gateway facts captured 2026-06-16 (evidence)

- **Reachable from the tailnet:** `GET http://100.72.2.99:8088/data/perspective/client/ConvSimpleLive` → **HTTP 200** (~0.1 s from Bravo).
- **Header:** `X-Frame-Options: SAMEORIGIN` — this is *why* the Hub opens the screen
  in a new tab instead of embedding it (an iframe would be blocked). Top-level
  navigation is unaffected.
- **Gateway host:** `Ignition-LAPTOP-0KA3C70H`, **Trial Mode Active**.
- **Project:** `ConvSimpleLive` (title "Conv_Simple Live"), tabs PMC STATION / CONVEYOR.
- **Live tags rendering:** GS10 VFD Hz/A/Vdc-bus, E-STOP ARMED/OK, MLC1 CLOSED·ENERGIZED,
  pilot lights — DC-bus voltage changed between captures (323→322 Vdc), confirming
  live OPC data, not a static page.
- **Caveat:** a headless browser briefly shows a "No Connection to Gateway" banner
  while the WebSocket settles; values still render. A real browser on Tailscale
  connects normally — ignore that banner if it flashes.

---

## 5. Notes

- The Command Center picker (gateway → screen → machine, "open to view ↗" status)
  shipped in **#2014 Phase 1** (PR #2018, live on prod 2026-06-16).
- VPS staging is **not** a usable target for this (see memory
  `project_staging_vps_not_ready` + issue #2021) — eval on prod.
- Phase 2/3 of #2014 will make gateways + screens **auto-discovered** (no static
  catalog), so eventually Path B becomes "pick from what MIRA already found."
