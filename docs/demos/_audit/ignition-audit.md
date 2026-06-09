# Ignition Demo Readiness Audit
**Date:** 2026-06-05  
**Branch:** feat/simlab-machine-behavior  
**Auditor:** Claude Code (Sonnet 4.6) — CHARLIE node

---

## Two-Column Verdict

| | Cloud Chat Endpoint (`POST /api/v1/ignition/chat`) | Perspective "Ask MIRA" Panel |
|---|---|---|
| **Status** | BLOCKED — HMAC key not set in prod | BLOCKED — WebDev module not deployed on gateway |
| **What's working** | Container up, engine healthy, route mounted, auth guard active | Gateway reachable (Tailscale `100.72.2.99:8088`), Perspective page renders, `MiraPanel` view file present in repo |
| **Blocking defect** | `MIRA_IGNITION_HMAC_KEY` not in Doppler `factorylm/prd`. Endpoint returns `503 {"detail":"Ignition HMAC key not configured"}` on any POST — including the Ignition WebDev caller. | Ignition WebDev module (`FactoryLM` resource) returns `404 No servlet "webdev" found`. The `ignition/webdev/` folder has NOT been deployed to the gateway via `deploy_ignition.ps1`. The tag-read and HMAC-signing path in `doPost.py` can never be reached. |
| **Evidence** | `ssh prod 'curl -s -X POST http://localhost:9099/api/v1/ignition/chat -d "{}"'` → `HTTP 503 {"detail":"Ignition HMAC key not configured"}`. `doppler secrets get MIRA_IGNITION_HMAC_KEY --project factorylm --config prd` → `Could not find requested secret`. | `curl http://100.72.2.99:8088/system/webdev/FactoryLM/mira?asset=conveyor_demo` → `HTTP 404 No servlet "webdev" found`. The Perspective client HTML renders (`http://100.72.2.99:8088/data/perspective/client/ConveyorMIRA/mira`) but the iframe it loads (`/system/webdev/FactoryLM/mira?asset=conveyor_demo`) 404s. |

---

## Cloud Endpoint Deep-Dive

**File:** `mira-pipeline/ignition_chat.py`  
**Mount point:** `mira-pipeline/main.py:286-293` — `app.include_router(_build_ignition_chat_router(lambda: engine))`  
**Auth bypass wiring:** `main.py:309-310` — `/api/v1/ignition/chat` and `/api/v1/audit` are excluded from the bearer middleware; HMAC is enforced inside the route itself.

**Route:** `POST /api/v1/ignition/chat` (`ignition_chat.py:163`)

**Expected request shape:**
```json
{
  "query": "Why is the conveyor stopped?",
  "asset_id": "conveyor_demo",
  "tag_snapshot": {
    "[default]Conveyor/Conv_State": {"value": "3", "quality": "Good"}
  },
  "context": "",
  "tenant_id": "<uuid>"
}
```
Required HMAC headers (built by `ignition/webdev/FactoryLM/api/chat/signing.py`):
- `X-MIRA-Tenant` — tenant UUID
- `X-MIRA-Nonce` — 32-char hex UUID
- `X-MIRA-Timestamp` — Unix epoch seconds (±5 min window)
- `X-MIRA-Signature` — HMAC-SHA256 over `{tenant}\n{nonce}\n{ts}\n{sha256(body)}`

**UNS certification path** (`ignition_chat.py:208`):
```python
uns_source = "direct_connection" if (asset_id or req.asset_context) else None
```
When `asset_id` is present, `uns_source="direct_connection"` is passed to `engine.process()` as `uns_source=`. This skips the chat-gate confirmation question per `.claude/rules/direct-connection-uns-certified.md`.

**Response shape:**
```json
{
  "answer": "...",
  "sources": [],
  "citations": [],
  "evidence": [],
  "confidence": null,
  "suggested_actions": [],
  "tenant_id": "...",
  "asset_id": "conveyor_demo",
  "latency_ms": 1234
}
```

**Engine health:** `ssh prod 'curl http://localhost:9099/health'` → `{"status":"ok","engine":true,"version":"0.5.3"}`. Engine is live and initialized.

---

## Perspective Panel Deep-Dive

**File:** `ignition/project/com.inductiveautomation.perspective/views/Mira/MiraPanel/resource.json`

The MiraPanel is a Flex container with three children:
1. **Header** — "MIRA CO-PILOT" label + AlertBadge bound to `[default]Mira_Alerts/conveyor_demo/Latest`
2. **ChatArea** — an `ia.display.webBrowser` component (`resource.json:90`) with `source = "/system/webdev/FactoryLM/mira?asset=conveyor_demo"`. The `assetId` param is hardcoded to `conveyor_demo` via `params.assetId` (`resource.json:4-7`).
3. **Footer** — status label "Mira HMI Co-Pilot — FactoryLM"

**What the embedded browser does** (`ignition/webdev/FactoryLM/mira/doGet.py`):
- Jython `doGet` returns a self-contained HTML page with a chat UI (textarea, send button, typing indicator, alert sidebar).
- `window.MIRA_CONFIG = { assetId: 'conveyor_demo', alarmMsg: '' }` is injected at load.
- The JS `sendMessage()` function (`doGet.py:1055`) POSTs to `/system/webdev/FactoryLM/api/chat` (same-origin, relative path), body: `{ query, asset_id: currentAsset }`.
- Alerts are polled every 10 s from `/system/webdev/FactoryLM/api/alerts`.

**WebDev doPost flow** (`ignition/webdev/FactoryLM/api/chat/doPost.py`):
1. Reads `MIRA_IGNITION_HMAC_KEY`, `MIRA_TENANT_ID`, `MIRA_CLOUD_URL` from `factorylm.properties`.
2. Browses `[default]Mira_Monitored/conveyor_demo/*` tags and reads a live snapshot.
3. Applies allowlist filter via `allowlist.py` (maps to `ignition/project/approved_tags.json`).
4. Signs the payload with `signing.build_headers(hmac_key, tenant_id, body_bytes)`.
5. `urllib2.urlopen` POSTs to `https://api.factorylm.com/api/v1/ignition/chat` (30 s timeout).
6. Persists result to `mira_chat_history` (Ignition DB, non-critical).
7. Returns `{"json": result}` to the browser.

---

## End-to-End Flow (Text Diagram)

```
Tech taps MiraPanel in Perspective browser
         │
         ▼
Perspective view (ConveyorMIRA/mira page)
  └─ ia.display.webBrowser
       source = /system/webdev/FactoryLM/mira?asset=conveyor_demo
         │
         ▼  (HTTP GET, same-origin to gateway)
Gateway Ignition 8.3.4 — WebDev module
  └─ FactoryLM/mira/doGet.py  (Jython 2.7)
       Returns full-page chat HTML with JS
         │
         ▼  (rendered in Perspective embedded browser)
MIRA Chat UI
  [Tech types question, hits Send]
         │
         ▼  (fetch POST /system/webdev/FactoryLM/api/chat)
FactoryLM/api/chat/doPost.py  (Jython 2.7)
  1. Read live tags from [default]Mira_Monitored/conveyor_demo/*
  2. Apply approved_tags.json allowlist filter
  3. HMAC-sign payload (signing.py → X-MIRA-Tenant/Nonce/Timestamp/Signature)
  4. POST https://api.factorylm.com/api/v1/ignition/chat  (30s timeout)
         │
         ▼  (HTTPS → VPS → nginx → pipeline container port 9099)
mira-pipeline/ignition_chat.py
  POST /api/v1/ignition/chat
  1. Verify HMAC headers (_verify_hmac) — 401 if missing/bad/replayed
  2. Parse IgnitionChatRequest (asset_id, tag_snapshot, query)
  3. Build tag preamble + prepend to question
  4. Set uns_source = "direct_connection" (asset_id present → UNS-certified)
  5. await engine.process(chat_id="ignition:{tenant}:conveyor_demo",
                          message=preamble+question,
                          platform="ignition",
                          uns_source="direct_connection")
  6. write_audit_row (fire-and-forget, NeonDB)
  7. Return {answer, sources, citations, latency_ms, ...}
         │
         ▼  (JSON response up the chain)
doPost.py persists to mira_chat_history → returns {"json": result}
Browser renders answer bubble in MIRA Chat UI
```

---

## Dependency Checklist

| # | Dependency | Current State | Notes |
|---|---|---|---|
| 1 | **PLC laptop Ignition gateway** | UP — `http://100.72.2.99:8088/StatusPing` → `{"state":"RUNNING"}` | Reachable via CHARLIE's Tailscale |
| 2 | **ConveyorMIRA project deployed + pages accessible** | PARTIAL — Perspective client HTML renders; Mira page route `/mira` works | page-config.json committed 2026-06-01; needs last redeploy run |
| 3 | **WebDev module (`FactoryLM`) deployed on gateway** | DOWN — `404 No servlet "webdev" found` | The `ignition/webdev/` folder was NOT deployed. `deploy_ignition.ps1` includes this step but has not been run recently (confirmed by PAGE_CONFIG_NOTES.md note). |
| 4 | **Ignition tags (`Conveyor/*`, `Mira_Monitored/conveyor_demo/*`)** | UNKNOWN — gateway running, project there, but tag import not verified live today | Tags live in `tags.json` + `mira_monitored_demo.json`; needs `deploy_ignition.ps1` run or manual Designer import |
| 5 | **`factorylm.properties` with MIRA_CLOUD_URL / MIRA_TENANT_ID / MIRA_IGNITION_HMAC_KEY** | NOT SET — properties file not confirmed on gateway | Must be created at `C:/Program Files/.../data/factorylm/factorylm.properties` on PLC laptop |
| 6 | **Modbus device connection `Micro820_Conveyor`** | UNKNOWN — not verified today | PLC at `192.168.1.100:502`; may be disconnected if PLC not powered |
| 7 | **Cloud pipeline container** | UP — `{"status":"ok","engine":true,"version":"0.5.3"}` via `ssh prod` | `mira-pipeline-saas` running on `127.0.0.1:9099` |
| 8 | **`MIRA_IGNITION_HMAC_KEY` in Doppler `factorylm/prd`** | MISSING — `doppler secrets get MIRA_IGNITION_HMAC_KEY --project factorylm --config prd` → `Could not find requested secret` | Container gets empty string → endpoint returns `503` on every request |
| 9 | **`MIRA_IGNITION_HMAC_KEY` injected into pipeline container** | MISSING — compose wires `${MIRA_IGNITION_HMAC_KEY:-}` (empty fallback) from prod env | Secret must be in Doppler prd first, then container restarted |
| 10 | **`MIRA_TENANT_ID` + `MIRA_CLOUD_URL` in `factorylm.properties`** | UNKNOWN — not verified on PLC laptop | WebDev doPost reads from this file via `getMiraConfig()` |
| 11 | **UNS asset_context certification** | CORRECT in code — `asset_id = "conveyor_demo"` → `uns_source = "direct_connection"` automatically | No code change needed; works once secret + WebDev are up |
| 12 | **nginx routing `api.factorylm.com` → pipeline 9099** | UNKNOWN from CHARLIE — `api.factorylm.com` DNS does not resolve from this network | 503 on public URL from CHARLIE; pipeline healthy from prod localhost; nginx likely fine |

---

## Blockers and Issues

### DEMO_BLOCKER

**B1 — `MIRA_IGNITION_HMAC_KEY` missing from Doppler `factorylm/prd`**  
Evidence: `doppler secrets get MIRA_IGNITION_HMAC_KEY --project factorylm --config prd` → `Could not find requested secret`. The pipeline endpoint checks this at request time (`ignition_chat.py:165-167`) and returns `503` when empty. Every Ignition turn currently fails with `{"detail":"Ignition HMAC key not configured"}`.  
Fix: Generate a random secret, add to Doppler prd as `MIRA_IGNITION_HMAC_KEY`, then restart `mira-pipeline-saas` to pick it up. Then write the same value to `C:/Program Files/.../data/factorylm/factorylm.properties` on the PLC laptop as `MIRA_IGNITION_HMAC_KEY=<value>` (and set `MIRA_TENANT_ID` and `MIRA_CLOUD_URL` if not already there).

**B2 — WebDev module (`FactoryLM`) not deployed on gateway**  
Evidence: `curl http://100.72.2.99:8088/system/webdev/FactoryLM/mira?asset=conveyor_demo` → `404 No servlet "webdev" found`. Without this, the MiraPanel's embedded chat is a blank/error iframe. The `deploy_ignition.ps1` script deploys WebDev (step 3, line 94-100) but the last run was not recent.  
Fix: On PLC laptop, run `git pull origin main` then `PowerShell -ExecutionPolicy Bypass -File ignition\deploy_ignition.ps1`. This copies `ignition/webdev/` to the Ignition data directory and triggers rescan.

**B3 — `factorylm.properties` not confirmed on gateway**  
The WebDev `doPost.py` reads HMAC key, tenant ID, and cloud URL from `factorylm.properties` via `getMiraConfig()`. If this file doesn't exist, `doPost` refuses all requests with `503 {"error": "MIRA HMAC key not configured"}`.  
Fix: Create the file on the PLC laptop at the expected path. Same step as B1 above.

### NICE_TO_HAVE

**N1 — Perspective view layout may be wrong format for Ignition 8.3**  
`PAGE_CONFIG_NOTES.md` documents that the current `views/<Name>/resource.json` is the content file, but Ignition 8.1+ expects a split: `resource.json` (metadata) + `view.json` (content). The Perspective HTML renders, suggesting the pages load, but if views show "View Not Found" inside the client, the layout format is the culprit.

**N2 — AlertBadge bound to `Mira_Alerts/conveyor_demo/Latest` tag (not in approved_tags.json)**  
The MiraPanel header `AlertBadge` component binds to `[default]Mira_Alerts/conveyor_demo/Latest` (`resource.json:39`). This tag path does not appear in `approved_tags.json` and depends on the `mira_alerts_template.json` tag import. Not fatal to chat, but the alert indicator will be blank or show an error.

**N3 — `mira_chat_history` DB table may not exist**  
`doPost.py` runs a `system.db.runPrepUpdate` to log each exchange. If the schema from `ignition/db/schema.sql` was never executed in the Ignition Designer, this will log a warning but not break chat (the error is caught and marked non-fatal).

**N4 — `api.factorylm.com` not resolvable from CHARLIE's network**  
CHARLIE cannot reach `api.factorylm.com` directly (DNS resolution fails, exit code 6). The domain works from the VPS via localhost. For a live demo from CHARLIE, access to the gateway or VPS must be via Tailscale or a direct IP the local network can reach.

### FUTURE

**F1 — `hmac.new()` typo in `ignition_chat.py:93`**  
`hmac.new(...)` is not a valid Python function — the correct call is `hmac.new(...)` is wrong; the stdlib is `hmac.new(key, msg, digestmod)`. In Python 3 this is `hmac.new`. Actually `hmac.new` IS the Python 3 API — but the argument order at line 93 uses positional args matching `hmac.new(key, msg, digestmod)` which is correct. However the alias at line 93 reads `hmac.new(key.encode("utf-8"), signed_string.encode("utf-8"), hashlib.sha256)` — this is actually `hmac.new` which IS valid. No bug; note for future reviewer.

**F2 — Turn-level reject contract for turns without UNS identifier not fully enforced**  
`ignition_chat.py:208` comment notes that the "reject-on-missing-identifier" contract is a "Phase-6 gate-bypass work." Today, if `asset_id` and `asset_context` are both empty, `uns_source` is `None` — the turn is processed as plain chat (not rejected with `{"error":"uns_required"}`). Per `.claude/rules/direct-connection-uns-certified.md`, a direct-connection surface without a UNS identifier must be rejected, not downgraded. This is acknowledged as in-progress.

**F3 — `doGet.py` sends query to `/system/webdev/FactoryLM/api/chat` (no `asset_context` dict)**  
The JS only sends `{ query, asset_id }` (`doGet.py:1056-1062`). The `doPost.py` does not build and forward an `asset_context` dict to the cloud endpoint — it sends `asset_id` only. The cloud endpoint can set `uns_source="direct_connection"` from `asset_id` alone (`ignition_chat.py:208`), so this works. But the richer `asset_context` object (site/area/line/equipment fields) is never populated. For a more informative UNS path, the WebDev handler should forward `asset_context`.

---

## What a Working Demo Looks Like

1. Tech opens `http://100.72.2.99:8088/data/perspective/client/ConveyorMIRA/mira` on phone/laptop.
2. Perspective loads the `Mira/MiraPanel` view — dark header "MIRA CO-PILOT", chat iframe fills the center.
3. The embedded iframe loads from `/system/webdev/FactoryLM/mira?asset=conveyor_demo` — MIRA's chat UI with the teal send button and "ALERTS" sidebar.
4. The asset badge shows `conveyor_demo`. The MIRA welcome message appears.
5. Tech types: "Why did the conveyor stop?"
6. JS POSTs to `/system/webdev/FactoryLM/api/chat` with `{ query, asset_id: "conveyor_demo" }`.
7. Ignition `doPost.py` reads 44 live Conveyor/* tags (plus Mira_Monitored snapshot), applies allowlist, HMAC-signs, POSTs to `https://api.factorylm.com/api/v1/ignition/chat`.
8. Pipeline verifies HMAC, stamps `uns_source="direct_connection"` (skips chat-gate), calls Supervisor engine with live tag preamble prepended to the question.
9. Engine reasons over live data + OEM manuals + work-order history → returns grounded answer.
10. Answer renders in the chat bubble with source citations. Latency typically 3-8 s.
