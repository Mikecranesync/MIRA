# MIRA Maintenance Copilot — Installation Guide

**Resource:** MIRA Maintenance Copilot (Ignition Exchange)
**Version:** 0.1.0
**Publisher:** FactoryLM — [factorylm.com](https://factorylm.com)
**Source:** [github.com/Mikecranesync/MIRA](https://github.com/Mikecranesync/MIRA) → `ignition/`
**License:** MIT (see `LICENSE`)

> **Companion listing notice.** This is the full secure-module listing
> (WebDev endpoints + gateway tag-stream + Perspective project). If you only
> want a lightweight embedded chat dock with no WebDev requirement, see
> `mira-ignition-exchange/` — a Perspective-widget-only option that runs off
> an iframe to the hosted FactoryLM backend.

---

## 1. Prerequisites

Before running the installer, confirm all four items:

| Requirement | Notes |
|---|---|
| **Ignition Gateway 8.1.20+** | Standard, Edge Panel, or Maker edition. Trial license works. |
| **WebDev module installed** | Free from inductiveautomation.com/downloads. Required for the `/api/*` endpoints. |
| **Perspective module installed** | Required for the ConveyorStatus, FaultLog, and NavBar views. |
| **Outbound HTTPS (443) to `*.factorylm.com`** | The only firewall change needed. No inbound ports. No VPN. |

**What you do NOT need:**
- An Anthropic API key
- A local GPU or model server
- A reverse tunnel or exposed Gateway port
- Any change to plant-LAN firewall rules other than the outbound 443 rule above

---

## 2. Install — 3 commands

Open PowerShell as Administrator on the Gateway host (Windows):

```powershell
# Step 1: Get the repo
git clone https://github.com/Mikecranesync/MIRA
cd MIRA

# Step 2: Pull latest (or skip on a fresh clone)
git pull origin main

# Step 3: Deploy
PowerShell -ExecutionPolicy Bypass -File ignition\deploy_ignition.ps1
```

The installer:
1. Verifies the Gateway is reachable at `http://localhost:8088`
2. Locates the Ignition `data/projects/` directory automatically
3. Copies `ignition/project/` → `ConveyorMIRA` project folder
4. Copies WebDev scripts to the project's WebDev resources path
5. Triggers a project rescan via the Gateway REST API
6. Imports 36 Conveyor tags via the Gateway REST API
7. Prints the Perspective URL

Re-running the installer is safe (idempotent — no duplicate tags or broken views).

To override the Gateway URL, credentials, or port:

```powershell
PowerShell -ExecutionPolicy Bypass -File ignition\deploy_ignition.ps1 `
  -GatewayUrl "http://192.168.1.50:8088" `
  -GatewayUser admin `
  -GatewayPass yourpassword
```

---

## 3. Configure `factorylm.properties`

All MIRA settings live in one file. Copy the template to the Gateway data directory:

```powershell
# Windows
copy ignition\config\factorylm.properties.template `
     "C:\Program Files\Inductive Automation\Ignition\data\factorylm\factorylm.properties"

# Linux
cp ignition/config/factorylm.properties.template \
   /usr/local/bin/ignition/data/factorylm/factorylm.properties
```

No Gateway restart required — scripts read the file fresh on every tick.

### Keys you must set after activation

Activation means registering your Gateway on the FactoryLM portal
(`factorylm.com/activate`), which assigns your tenant UUID and relay endpoint.

| Key | Where to get it | What it does |
|---|---|---|
| `RELAY_URL` | FactoryLM activation email / portal | HTTPS endpoint that receives your tag stream. Example: `https://relay.factorylm.com/ingest` |
| `TENANT_ID` | FactoryLM activation email / portal | Scopes all data to your account. Example: `00000000-0000-0000-0000-000000000000` |
| `STREAM_TAG_FOLDER` | Your choice (default `[default]Mira_Monitored`) | Tag folder MIRA streams. Put only approved tags in this folder (§4). |

Example (minimum viable config):

```properties
RELAY_URL=https://relay.factorylm.com/ingest
TENANT_ID=your-uuid-here
STREAM_TAG_FOLDER=[default]Mira_Monitored
STREAM_EQUIPMENT_ID=line-b-conveyor
```

### Keys you configure (tuning, optional)

| Key | Default | Purpose |
|---|---|---|
| `STREAM_EQUIPMENT_ID` | `ignition-gateway` | Label written into the relay payload. Use a descriptive name (e.g. `line-b-conveyor`). |
| `FSM_N_SIGMA` | `2.5` | Sigma threshold for timing-deviation alerts. Lower = more sensitive. |
| `STUCK_MULTIPLIER` | `3.0` | How many times a state's max_ms before a stuck-state alert fires. |
| `FSM_HISTORY_HOURS` | `168` (7 days) | Tag history fed to the FSM baseline builder. |
| `INGEST_MAX_FILE_MB` | `50` | Max manual/PDF size accepted by `/api/ingest`. |

### Roadmap keys (not yet available)

The following keys appear in the target architecture but are not active in the current release. Do not set them — the scripts will ignore unknown keys.

| Key | Status | What it will do |
|---|---|---|
| `MIRA_CLOUD_SIGNING_KEY` | Target (D4) | Per-tenant HMAC-SHA256 signing key for the tag-stream relay. Today authentication uses a shared bearer key. |
| `MIRA_CLOUD_CHAT_URL` | Target (D2/D3) | Cloud endpoint for the Perspective chat panel. The chat path is active on the roadmap but not yet wired to the cloud engine. |

---

## 4. Put tags on the allowlist

MIRA reads **only the tags you place in the `[default]Mira_Monitored` folder** (or whichever folder `STREAM_TAG_FOLDER` points to). This is the active boundary: nothing outside the folder is touched.

Steps:

1. In the Designer, create the folder: **Tags → New Tag → Folder** → name it `Mira_Monitored` under `[default]`.
2. Drag (or create references to) only the tags MIRA should see — typically 20–40: run/stop status, fault codes, speed, current, key sensor values.
3. Set `STREAM_TAG_FOLDER=[default]Mira_Monitored` in `factorylm.properties`.
4. Add the timer script (§5) and watch the Gateway log:
   ```
   [FactoryLM.Mira.TagStream] Streamed 24 tags to relay
   ```

**The folder IS the allowlist today.** Adding a tag to the folder means MIRA can see it. Review the folder contents the same way you would review a network ACL.

A formal `approved_tags.json` filter enforced at both the gateway WebDev endpoint and the relay is on the development roadmap (D1). Until that ships, folder membership is the enforcement boundary.

For a reference starting set, the 36 demo tags in `ignition/tags/mira_monitored_demo.json` cover:
- 20 Bool OPC tags (motor run/stop, fault latch, direction)
- 11 Int OPC tags (state, fault code, VFD speed raw, current raw)
- 5 Expression tags (Hz, amps, temperature — scaled from raw registers)

---

## 5. Add the Gateway scripts

Three scripts must be registered in the Gateway. They do not deploy automatically (Ignition's Gateway Event Scripts are not file-copyable via REST). Register them manually:

**Gateway → Config → Gateway Event Scripts**

| Script | File | Event type | Schedule |
|---|---|---|---|
| Tag streamer | `ignition/gateway-scripts/tag-stream.py` | Timer — Fixed Rate | 2000 ms |
| FSM state monitor | `ignition/gateway-scripts/tag-change-fsm-monitor.py` | Tag Change | Watch `[default]Mira_Monitored/*/State` |
| Stuck-state detector | `ignition/gateway-scripts/timer-stuck-state.py` | Timer — Fixed Rate | 10 000 ms |

Copy each script's contents into the Gateway web interface script editor and save.

**Log verification:** set `FactoryLM.Mira` to `TRACE` in **Config → Logging** during the first run. Success looks like:

```
[FactoryLM.Mira.TagStream] Streamed 24 tags to relay in 47 ms
[FactoryLM.Mira.FSMMonitor] State change: RUNNING → STOPPED (asset: conveyor_b)
```

---

## 6. First grounded answer in Perspective

This is the success check for the full install.

**Prerequisite note:** The Perspective chat panel (`/api/chat`) is configured but the cloud AI endpoint it posts to is on the development roadmap (D2/D3). Until that ships, the panel returns a status message rather than a grounded AI answer. Tag streaming (§4–5) and the ConveyorStatus view are fully operational today.

When D2/D3 are complete, the success check is:

1. Open Perspective: `http://<gateway-host>:8088/data/perspective/client/ConveyorMIRA`
2. The ConveyorStatus view should show live tag values (speed, current, state).
3. Ask in the chat panel: **"Why did the conveyor stop?"**
4. Within ~5 seconds you should see a grounded answer citing:
   - The live tag snapshot (fault code, speed, current)
   - The UNS-confirmed asset context (site / line / machine)
   - The relevant GS10 or Micro820 manual section (if ingested)
5. Open the FactoryLM Hub (`app.factorylm.com`) → **Audit** to confirm the prompt and cited sources were logged.

If you are testing before D2/D3 are available, confirm tag streaming works independently:

```powershell
# Check relay is receiving data (replace with your relay URL and tenant)
curl -H "Authorization: Bearer <RELAY_API_KEY>" \
     "https://relay.factorylm.com/status?tenant_id=<TENANT_ID>"
```

---

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| Tags show `Bad_NotFound` | Device connection `Micro820_Conveyor` not created, or name is wrong (case-sensitive). See `ignition/README.md` for device connection settings. |
| `Gateway not responding` during deploy | Ignition not running — check the tray icon. |
| Views missing in Designer | Config → Projects → Scan File System |
| `Relay returned 4xx` in Gateway log | Check `RELAY_URL` and `RELAY_API_KEY` in `factorylm.properties`. Verify outbound 443 to `*.factorylm.com` is open. |
| `Relay returned 401` | Bearer key mismatch — re-check `RELAY_API_KEY` matches the key in your FactoryLM portal. |
| Chat panel returns empty / error | D2/D3 cloud endpoint not yet active. Tag streaming still works. |
| `Sidecar not running` message | This references the legacy RAG sidecar (`localhost:5000`). It can be ignored once D2/D3 are active. |

---

## 8. Security checklist for IT

Hand this to the customer's IT team:

- **Outbound 443 to `*.factorylm.com`** — the only firewall rule needed.
- **No inbound ports opened.** The Gateway does not listen for connections from the cloud.
- **No VPN, no reverse tunnel, no NAT punch.** MIRA Cloud cannot initiate a connection into the plant.
- **Read-only tag access.** The MIRA scripts call `system.tag.readBlocking` only. There is no `system.tag.writeBlocking` in any MIRA script. (The `plc/live_monitor.py` script that writes VFD commands is a bench-development tool, never deployed with this Exchange resource.)
- **Tags controlled by you.** Only tags in the `[default]Mira_Monitored` folder are readable by MIRA. Nothing outside that folder is touched.
- **Authentication:** outbound calls are signed with a bearer key unique to your tenant, stored in `factorylm.properties` on the Gateway (not in source code, not in Ignition Designer). Per-tenant HMAC signing is on the roadmap.
- **PII sanitization:** before any LLM call, IP addresses, MAC addresses, and serial numbers in the tag-context payload are replaced with `[IP]`, `[MAC]`, `[SN]`.
- **Safety guardrails:** arc-flash, LOTO, and confined-space queries trigger a STOP escalation card — they never produce an AI-generated procedure.

Reference: `docs/mira-ignition-secure-architecture.md` §4 (full security model).

---

## 9. Reference: tag collector integration

For a deeper guide to the tag-stream script — batch interval tuning, log verification, relay SQLite queries, and the honest shipped/target status of each security control — see:

`docs/integrations/ignition-tag-collector.md`

---

## 10. Cross-references

- `docs/mira-ignition-secure-architecture.md` — full architecture + security model
- `docs/integrations/ignition-tag-collector.md` — tag collector install and configuration
- `ignition/README.md` — device connection setup + view index
- `ignition/config/factorylm.properties.template` — all config keys with inline documentation
- `ignition/deploy_ignition.ps1` — the installer
- `ignition/gateway-scripts/tag-stream.py` — the tag-stream script
- `mira-ignition-exchange/` — lightweight Perspective-widget listing (no WebDev required)
- `docs/promo-screenshots/` — screenshot archive (see `2026-05-31_ignition-gateway-*.png` for Gateway context)
