# Reset: Ignition Perspective 2-Hour Trial Window (PLC Laptop)

**Updated:** 2026-06-06
**Scope:** PLC Laptop (Windows) — Ignition Gateway 8.3.4
**Gateway:** `http://100.72.2.99:8088` (Tailscale IP from CHARLIE)
**Gateway (local on PLC laptop):** `http://localhost:8088`
**Cross-links:** [`provision-ignition-hmac.md`](provision-ignition-hmac.md) · [`ignition/README.md`](../../ignition/README.md) · [`docs/demos/_audit/ignition-audit.md`](../demos/_audit/ignition-audit.md)

---

## Background

The PLC laptop runs **Ignition 8.3.4 Standard trial**. In trial mode the gateway runs fully
featured for 2 hours, then enters a degraded state (Perspective views continue to serve but
some features throttle or disable). For demos, the trial window must be active.

**Architecture constraint:** CHARLIE has HTTP-only reach to the gateway — no SSH, no
remote desktop, no SMB, no file access. Any action that requires a UI click or file edit
**must be performed on the PLC laptop directly**.
Source: `docs/mira-ignition-secure-architecture.md` §1.

**Confirmed facts about this gateway (verified):**
- Tailscale IP: `100.72.2.99:8088`
- StatusPing: `http://100.72.2.99:8088/StatusPing` → `{"state":"RUNNING"}` when active
- Gateway Admin UI: `http://localhost:8088` (or `http://100.72.2.99:8088` from CHARLIE)
- Deploy script: `ignition/deploy_ignition.ps1` — copies project files and triggers rescan
- Source: `ignition/PAGE_CONFIG_NOTES.md` (confirmed via 2026-06-01 Playwright captures)

---

## Prerequisites

- Physical or remote-desktop access to the PLC laptop (Windows)
- Admin credentials for Ignition gateway (default: admin / password — ⚠️ VERIFY actual creds on the laptop)
- The gateway must be running (`StatusPing` returns `RUNNING`)
- Tailscale connected on PLC laptop (for Tailscale IP `100.72.2.99` to be reachable)

---

## Step 1 — Confirm Gateway Is Running

From CHARLIE (or any Tailscale-connected machine):

```bash
curl -s http://100.72.2.99:8088/StatusPing
```

**Expected output:** `{"state":"RUNNING"}`

If you get no response or connection refused:
- Ignition may not be running → go to PLC laptop, check the system tray for the Ignition icon
- Tailscale may be disconnected on the PLC laptop → reconnect Tailscale on that machine
- `ignition/README.md` notes an alternative PLC IP at `169.254.32.93:8088` if Tailscale is down

---

## Step 2 — Check Trial Status

⚠️ **UNVERIFIED — confirm on the PLC laptop.** The exact UI path below is based on
standard Ignition 8.x trial mechanics, not verified from a live session.

On the PLC laptop, open a browser to `http://localhost:8088`:

1. Log in with gateway admin credentials
2. Go to **Config** → **Gateway Settings** → **Licensing** (or **About**)
3. Look for the trial timer display — shows remaining time in the current 2-hour window

Alternatively, the gateway home page at `http://localhost:8088` typically shows the trial
status banner at the top when the trial is active or has lapsed.

---

## Step 3 — Reset the Trial (restart the gateway)

⚠️ **UNVERIFIED — exact UI path not in repo.** Standard Ignition 8.x trial reset
is achieved by restarting the gateway service. After restart, the 2-hour timer resets.

**Option A — Via gateway web UI (preferred):**

On the PLC laptop browser at `http://localhost:8088`:
1. Go to **Config** → **Gateway Control** → **Restart Gateway**
2. Click **Restart** and confirm
3. Wait ~30–60 s for the gateway to come back up
4. Verify: `curl -s http://100.72.2.99:8088/StatusPing` → `{"state":"RUNNING"}`

**Option B — Via Windows services (if gateway web UI is unresponsive):**

On the PLC laptop, open **Services** (Win+R → `services.msc`):
1. Find `Inductive Automation Ignition Gateway` (or similar)
2. Right-click → **Restart**
3. Wait for the service to return to **Running** state
4. Verify: `curl -s http://100.72.2.99:8088/StatusPing` → `{"state":"RUNNING"}`

**Option C — Via command line on PLC laptop (PowerShell as Administrator):**

⚠️ UNVERIFIED — service name may differ:

```powershell
Restart-Service -Name "Ignition*" -Force
```

Or with a Stop/Start cycle:
```powershell
Stop-Service -Name "Ignition*" -Force
Start-Service -Name "Ignition*"
```

---

## Step 4 — Redeploy the Ignition Project (after gateway restart)

After a gateway restart, the project files should already be in place, but a rescan
is recommended to confirm pages are registered. On the PLC laptop:

```powershell
cd C:\Users\hharp\Documents\GitHub\MIRA
git pull origin main
PowerShell -ExecutionPolicy Bypass -File ignition\deploy_ignition.ps1
```

What `deploy_ignition.ps1` does (source: `ignition/PAGE_CONFIG_NOTES.md:51-54`):
1. Copies `ignition/project/` → `<IgnitionDataDir>/projects/ConveyorMIRA/` (includes `page-config/`)
2. POSTs `/data/projects/scan` (Basic Auth admin:password) — triggers gateway rescan; pages register within ~15 s

---

## Step 5 — Verify Perspective Is Serving

From CHARLIE (after gateway restart and project rescan):

```bash
curl -sv http://100.72.2.99:8088/data/perspective/client/ConveyorMIRA/mira 2>&1 | grep -E "< HTTP|200|404"
```

**Expected:** `< HTTP/1.1 200 OK`

Verify the WebDev module is back (it reloads after gateway restart):

```bash
curl -s http://100.72.2.99:8088/system/webdev/FactoryLM/mira?asset=conveyor_demo | head -5
```

**Expected:** HTML content (the MIRA chat UI)
If 404: run `deploy_ignition.ps1` on the PLC laptop — the WebDev folder needs to be deployed.
Source: `docs/demos/_audit/ignition-audit.md` — WebDev `FactoryLM` returns 404 if deploy hasn't been run.

---

## Step 6 — Confirm `factorylm.properties` Survived the Restart

The WebDev `doPost.py` reads `MIRA_IGNITION_HMAC_KEY`, `MIRA_TENANT_ID`, and `MIRA_CLOUD_URL`
from `factorylm.properties`. This file persists across gateway restarts (it's in the data
directory, not in-memory). However, confirm it's still in place:

⚠️ **UNVERIFIED — confirm on PLC laptop.**

Expected path (Windows):
`C:\Program Files\Inductive Automation\Ignition\data\factorylm\factorylm.properties`

Verify via gateway script console (Ignition Designer → Tools → Script Console):
```python
import system.file
content = system.file.readFileAsString("C:/Program Files/Inductive Automation/Ignition/data/factorylm/factorylm.properties")
print(content)
```

If missing or empty, re-create it — see [`provision-ignition-hmac.md`](provision-ignition-hmac.md) Part B.

---

## Full Demo Flow Check (after reset)

From CHARLIE, run the sequence from `docs/demos/_audit/ignition-audit.md` § "What a Working Demo Looks Like":

1. StatusPing:
   ```bash
   curl -s http://100.72.2.99:8088/StatusPing
   ```
   Expected: `{"state":"RUNNING"}`

2. Perspective renders:
   ```bash
   curl -s http://100.72.2.99:8088/data/perspective/client/ConveyorMIRA/mira | head -3
   ```
   Expected: HTML with `<!DOCTYPE html>`

3. WebDev responds (chat endpoint):
   ```bash
   curl -s http://100.72.2.99:8088/system/webdev/FactoryLM/mira?asset=conveyor_demo | head -3
   ```
   Expected: HTML (the MIRA chat UI page)

4. Cloud endpoint live:
   ```bash
   curl -s https://api.factorylm.com/api/v1/ignition/chat \
     -X POST -H "Content-Type: application/json" \
     -d '{"query":"test","asset_id":"conveyor_demo","tenant_id":"test"}' 2>&1 | grep -E "HTTP|401|200|503"
   ```
   Expected: `401` (HMAC required, not 503). 503 = HMAC key not in pipeline — see [`provision-ignition-hmac.md`](provision-ignition-hmac.md).

---

## What Can Go Wrong

| Symptom | Cause | Action |
|---------|-------|--------|
| `StatusPing` → connection refused | Ignition gateway not running | Start the service on PLC laptop |
| `StatusPing` → unreachable from CHARLIE | Tailscale disconnected on PLC laptop | Reconnect Tailscale on that machine |
| Perspective returns 404 after restart | Project rescan not triggered | Run `deploy_ignition.ps1` on PLC laptop |
| WebDev returns `404 No servlet "webdev" found` | WebDev module not deployed | Run `deploy_ignition.ps1` on PLC laptop — the script includes WebDev deployment |
| `doPost.py` returns `503 {"error": "MIRA HMAC key not configured"}` | `factorylm.properties` missing or key empty | Re-create the file — see `provision-ignition-hmac.md` Part B |
| Gateway trial expired mid-demo | 2-hour window elapsed | Restart gateway (Steps 2-4 above) |
| Tags show `Bad_NotFound` or `Bad_NotConnected` | Device connection `Micro820_Conveyor` dropped after restart | In Ignition gateway Config → OPC-UA → Device Connections — verify `Micro820_Conveyor` is Connected at `192.168.1.100:502` |

---

## ⚠️ UNVERIFIED Items in This Runbook

The following were not found in the repo and are based on standard Ignition 8.x behavior — verify on the PLC laptop before relying on them in a live demo:

1. **Exact gateway admin credentials** — "admin / password" is the Ignition default. Actual credentials may differ. Verify before the demo.
2. **Gateway trial timer UI path** — `Config → Gateway Settings → Licensing`. Exact menu path for Ignition 8.3.4 may vary.
3. **Windows service name** — `Inductive Automation Ignition Gateway`. Verify in `services.msc` before using the PowerShell commands.
4. **Whether a service restart vs. a full trial reset is needed** — Ignition 8.x trial resets on gateway restart; confirm this behavior is still true for 8.3.4.
5. **`factorylm.properties` persistence across restart** — Standard behavior for files in the Ignition `data/` directory; verify it's not wiped by any custom Ignition data-dir cleanup script on this machine.
