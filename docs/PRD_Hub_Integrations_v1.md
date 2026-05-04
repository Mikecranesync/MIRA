# PRD: Hub Integrations v1
**MIRA as the Intelligence Layer — "Bring Your Own Stack"**

**Version:** 1.0  
**Date:** 2026-04-28  
**Owner:** Mike Harper  
**Status:** Draft → Review

---

## 1. Problem Statement

Industrial maintenance teams don't abandon their existing tools when they adopt MIRA. They have Slack for alerts, Teams for enterprise comms, MaintainX or Upkeep for work orders, Google Drive full of manuals, and PLC data in a historian. MIRA's value is being the intelligence layer that sits across all of it — not another silo to manage.

Today, MIRA is deployed as a Telegram-first diagnostic bot. The Hub exists but integrations are either mock data or hardcoded. The opportunity is to turn the Hub into an integration marketplace: connect your comms, your CMMS, your docs, your IoT data, and MIRA threads through all of them.

**"Twilio for maintenance intelligence" — MIRA is the plug-in, not the delivery system.**

---

## 2. Current State (grounded)

### What actually works today
| Integration | Status | Where |
|---|---|---|
| Telegram | ✅ Live — adapter + polling bot + Hub card | `mira-bots/telegram/` |
| Atlas CMMS | ✅ Live — MCP adapter, dual-write to Hub NeonDB | `mira-mcp/cmms/atlas.py` |
| Open WebUI | ✅ Live — Hub card with URL config modal | Hub channels page |
| Google OAuth | ✅ OAuth flow exists | `/api/auth/google` |
| Microsoft OAuth | ✅ OAuth flow exists | `/api/auth/microsoft` |
| Dropbox OAuth | ✅ OAuth flow exists | `/api/auth/dropbox` |
| Confluence OAuth | ✅ OAuth flow exists | `/api/auth/confluence` |
| Slack adapter | ✅ Adapter built + Hub OAuth card | `mira-bots/slack/` — needs container deploy |
| Teams adapter | ✅ Adapter built + Hub OAuth card | `mira-bots/teams/` — needs Azure creds |
| GChat adapter | ✅ Adapter built | `mira-bots/gchat/` — not on Hub yet |
| Email adapter | ✅ Adapter built | `mira-bots/email/` — shown as infoOnly |
| WhatsApp adapter | 🔄 Just migrated to ChatAdapter pattern | PR #805 |
| WebChat adapter | 🔄 Just built — needs bot.py + Dockerfile | PR #805 |

### What's mock/stub (Hub UI shows it, backend doesn't exist)
| Integration | Hub location | Reality |
|---|---|---|
| Limble CMMS | Integrations → CMMS tab | `viaMcp: true` static object |
| MaintainX | Integrations → CMMS tab | `viaMcp: true` static object |
| UpKeep | Integrations → CMMS tab | `viaMcp: true` static object |
| Fiix/Rockwell | Integrations → CMMS tab | `viaMcp: true` static object |
| Webhooks (Slack, Teams, Email) | Integrations → Webhooks tab | Hardcoded mock array |
| API key + events | Integrations → API tab | Hardcoded mock key |

### What doesn't exist anywhere
IoT (MQTT, OPC-UA), PagerDuty, ServiceNow, Jira, Zapier/Make, Power BI, SAP PM, IBM Maximo, SMS/Twilio, Google Chat card on Hub.

---

## 3. Vision

Every industrial maintenance operation has 3 layers of tools:

```
COMMS LAYER          |  WORKFLOW LAYER         |  DATA LAYER
─────────────────────|─────────────────────────|──────────────────
Telegram             |  Atlas / FactoryLM Works|  Equipment manuals
Slack                |  MaintainX              |  OEM PDFs
Teams                |  UpKeep                 |  PLC historians
WhatsApp             |  Limble / Fiix          |  MQTT broker
Email                |  SAP PM / IBM Maximo    |  OPC-UA tags
Web widget           |  ServiceNow / Jira      |  IoT sensors
                     |  PagerDuty              |
```

MIRA connects to all three layers. Techs interact through any comms channel. Diagnosis and work orders flow into the CMMS. Alerts push to PagerDuty. Evidence pulls from IoT data. Documents pull from Drive, SharePoint, Confluence.

---

## 3.5 Priority 0: CSV Import — The Universal On-Ramp

> **"No API key. No IT department. No integration project. Just upload your spreadsheet."**

Every industrial business can export their CMMS, ERP, or maintenance database to CSV. This is the zero-friction entry point — it works before any OAuth is wired, before any API key is issued, before any integration partner is approved.

### What CSV Import Covers

| Column Category | Field Examples |
|---|---|
| Asset identity | Equipment name, asset tag, manufacturer, model, serial number |
| Location | Site, area, line, machine group |
| Fault history | Fault description, date, resolution, downtime hours |
| PM schedules | Task name, interval (days/hours), last completed, next due |
| Parts inventory | Part number, description, quantity on hand, reorder point |
| Work orders | WO number, status, priority, assigned tech, open date, close date |

### Smart Column Mapping

Auto-detect common column names and let users confirm or override before import:

```
Uploaded columns          → MIRA fields
─────────────────────────────────────────
"Equipment"               → asset.name (auto-matched, high confidence)
"Asset #" / "Asset No."   → asset.tag (auto-matched)
"S/N" / "Serial"          → asset.serial (auto-matched)
"Last PM" / "PM Date"     → pm_schedule.last_completed (auto-matched)
"Description"             → [ambiguous — prompt: fault_history or asset.description?]
"Custom_Field_47"         → [unmatched — skip or assign manually]
```

Rules:
- Fuzzy-match column headers (edit distance ≤ 2, case-insensitive)
- High-confidence matches auto-assign; low-confidence shown in yellow for user confirmation
- Unmatched columns can be: (a) mapped manually, (b) imported as custom fields, (c) skipped
- Preview first 10 rows before committing import
- Dry-run mode: show what would be created/updated without writing

### What Happens After Import

1. Assets land in Atlas CMMS (or the tenant's connected CMMS)
2. Fault history is chunked and indexed in the MIRA knowledge graph — MIRA immediately knows this asset's failure patterns
3. PM schedules are loaded into the PM calendar
4. Parts inventory loads into the parts module
5. Work orders are imported as historical records (closed) or active tickets (open)

### Import Formats Accepted

- `.csv` (UTF-8 or UTF-16, comma or semicolon delimited)
- `.xlsx` / `.xls` (first sheet imported, sheet selector coming)
- `.tsv` (tab-delimited)
- Column order does not matter — header row required

### Recurring Imports

After the initial import, customers can schedule recurring CSV drops:
- Manual re-upload (always available)
- SFTP polling (Enterprise tier) — drop files to a dedicated SFTP path, MIRA polls hourly
- Email attachment ingestion (Pro tier) — forward the export email to `import@factorylm.com`

### Priority and Location in Hub

This feature lives at **Hub → Import** (new tab, alongside Channels / Integrations). It appears as the first card on the Integrations page for tenants with no connected CMMS, with the headline: *"Start here — no API key needed."*

**Priority:** P0 — ships before any other integration. This is how the first 10 customers onboard before native CMMS connectors are live.  
**Effort:** 3 days (UI: column mapper component + preview table; backend: Papa Parse / SheetJS → upsert assets + fault_history rows)

---

## 4. Section 1: Communication Channels

*Bring your team — they stay in the channel they already use.*

### 4.1 Telegram ✅ LIVE

**Flow:** Tech sends message/photo → Telegram polling bot → Supervisor engine → diagnostic reply  
**Auth:** Bot token (already in Doppler `TELEGRAM_BOT_TOKEN`)  
**Hub card:** Present, functional — shows bot username when configured  
**What's missing:** Nothing for MVP. Post-launch: thread management for group chats, voice note transcription.

---

### 4.2 Slack

**Current state:** `mira-bots/slack/chat_adapter.py` built (97 lines). Hub shows OAuth card with `/api/auth/slack`. No deployed container.

**Flow:**  
- Inbound: Slack Events API → `POST /webhook` → `SlackChatAdapter.normalize_incoming()` → dispatcher → engine → `render_outgoing()` → Block Kit message  
- Outbound push: MIRA posts alerts to configured Slack channels via Incoming Webhooks  

**Auth:** Slack OAuth 2.0 — `SLACK_BOT_TOKEN` + `SLACK_SIGNING_SECRET` (request verification)  
**Hub:** ConnectorCard present, disabled flag if creds not configured  
**Implementation:** Deploy `mira-bot-slack` container + wire `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` to Doppler  
**Effort:** 3 hours (container + secrets + Slack app creation in dashboard)  
**Priority:** Ship now — adapter done, just needs deploy

**Data flow:**
| Direction | What | Format |
|---|---|---|
| In | Tech message (text, thread reply, file) | Slack Events API JSON |
| In | `/mira` slash command | Slash command payload |
| Out | Diagnostic reply | Block Kit (formatted with headers, bullets) |
| Out | Safety alert | Block Kit `warning` block, @here mention |
| Out | WO created notification | Block Kit card with WO number, asset, priority |

---

### 4.3 Microsoft Teams

**Current state:** `mira-bots/teams/chat_adapter.py` built (154 lines). Hub shows OAuth card. No deployed container.

**Flow:** Bot Framework Activity → `POST /webhook` → `TeamsChatAdapter.normalize_incoming()` → dispatcher → engine → Adaptive Card reply

**Auth:** Azure AD app registration — `TEAMS_APP_ID` + `TEAMS_APP_PASSWORD` + `TEAMS_TENANT_ID`  
**Hub:** ConnectorCard present, disabled if Azure creds not configured  
**Implementation:** Azure App Registration + Bot Framework channel registration + deploy `mira-bot-teams`  
**Effort:** 6 hours (Azure setup is the friction; adapter is done)  
**Priority:** Ship this sprint — high enterprise value

**Data flow:**
| Direction | What | Format |
|---|---|---|
| In | Message (1:1 or channel mention) | Bot Framework Activity JSON |
| In | File attachment (image, PDF) | Graph API download |
| Out | Diagnostic reply | Adaptive Card (rich formatted) |
| Out | Safety alert | Adaptive Card with red accent + escalation action |
| Out | WO created | Adaptive Card with status, asset, WO# |

---

### 4.4 WhatsApp / Twilio

**Current state:** `WhatsAppChatAdapter` built (PR #805). `whatsapp/bot.py` uses legacy adapter — needs wiring to new ChatAdapter. Hub shows `comingSoon`.

**Flow:** Twilio webhook → `POST /webhook` → `WhatsAppChatAdapter.normalize_incoming()` → dispatcher → engine → Twilio Messages API reply

**Auth:** `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_WHATSAPP_FROM` + Twilio signature validation  
**Hub:** Update Hub card from `comingSoon` → functional connect flow (enter phone number sandbox config)  
**Implementation:** Wire `whatsapp/bot.py` to new `WhatsAppChatAdapter`, deploy container, connect Twilio dashboard webhook  
**Effort:** 4 hours  
**Priority:** Next sprint (post-Slack/Teams)

**Data flow:**
| Direction | What | Format |
|---|---|---|
| In | Text message | Twilio webhook form POST |
| In | Image (MMS) | Twilio media URL → download with Basic auth |
| In | Voice note | Twilio media URL → (transcription TBD) |
| Out | Diagnostic reply (≤1600 chars) | TwiML `<Response><Message>` or Twilio Messages API |
| Out | Safety alert | Plain text (no formatting — WhatsApp strips it otherwise) |

---

### 4.5 Google Chat

**Current state:** `mira-bots/gchat/chat_adapter.py` built (146 lines). Not on Hub channels page.

**Flow:** Google Chat Event → HTTP push webhook → `GoogleChatAdapter.normalize_incoming()` → dispatcher → engine → Google Chat Cards v2 reply

**Auth:** Google Cloud project + Chat API enabled + webhook URL registered  
**Hub:** Add ConnectorCard to channels page  
**Effort:** 3 hours (adapter done, needs Hub card + container deploy)  
**Priority:** Next sprint

---

### 4.6 Email

**Current state:** `mira-bots/email/chat_adapter.py` built (204 lines). Hub shows `infoOnly` card — enabled via Google or Microsoft connection.

**Flow:** Inbound email → SES/SNS → `POST /webhook` → `EmailChatAdapter.normalize_incoming()` → dispatcher → engine → reply via SES/Resend

**Auth:** AWS SES receiving + Resend for outbound (`RESEND_API_KEY` in Doppler, pending Resend domain verification per `docs/known-issues.md`)  
**Hub:** Keep `infoOnly` pattern — email works when Google or Microsoft is connected  
**Effort:** 2 hours (unblock after Resend domain verification)  
**Priority:** Unblock now — just needs Resend domain verified

---

### 4.7 Web Widget

**Current state:** `WebChatAdapter` built (PR #805). `webchat/bot.py` not yet built.

**Flow:** Widget JS → `POST /chat` to webchat bot → `WebChatAdapter.normalize_incoming()` → dispatcher → engine → JSON reply → widget renders HTML

**Auth:** Per-tenant widget key (`MIRA_WIDGET_KEY`) in Authorization header or query param  
**Embed:** `<script src="https://app.factorylm.com/widget.js" data-tenant="..." data-key="..."></script>`  
**Hub:** Add ConnectorCard to channels page with embed snippet modal + API key display  
**Effort:** 6 hours (bot.py + Dockerfile + widget JS + Hub card)  
**Priority:** Next sprint — high PLG value for web signups

---

### 4.8 SMS / Twilio

**Current state:** Nothing built. WhatsApp adapter reuses ~80% of the Twilio pattern.

**Flow:** Twilio SMS webhook → FastAPI → engine → TwiML reply  
**Auth:** Same Twilio credentials as WhatsApp  
**Constraint:** 1600-char limit, no media, no formatting — pure plain text  
**Effort:** 2 hours (fork WhatsApp adapter, strip image/formatting handling)  
**Priority:** Q2 — after WhatsApp ships

---

### 4.9 Open WebUI

**Current state:** ✅ Live. Hub card functional with URL config modal.  
**No implementation work needed for MVP.**

---

## 5. Section 2: Productivity Suites

*Bring your tools — MIRA reads from and writes to your existing workflows.*

### 5.1 Microsoft 365

#### Outlook / Email alerts
**Direction:** MIRA → Outlook  
**Use case:** Send WO creation, PM reminders, and safety alert summaries to maintenance supervisors via email  
**Auth:** Microsoft Graph API with `Mail.Send` scope — OAuth token already captured via existing Microsoft OAuth flow  
**Implementation:** `POST /v1.0/me/sendMail` via Graph API using stored access token  
**Effort:** 2 hours  
**Priority:** Ship now — auth already done

#### Calendar / PM sync
**Direction:** MIRA → Outlook Calendar  
**Use case:** When a PM schedule is created in MIRA, create a recurring Outlook Calendar event for the responsible tech  
**Auth:** `Calendars.ReadWrite` scope (add to existing OAuth)  
**API:** `POST /v1.0/me/events` or `POST /v1.0/users/{id}/events`  
**Effort:** 4 hours  
**Priority:** Next sprint

#### SharePoint / Document storage
**Direction:** SharePoint → MIRA (ingest)  
**Use case:** MIRA crawls a SharePoint site/library for OEM manuals and maintenance procedures, indexes to Open WebUI KB  
**Auth:** `Sites.Read.All` scope (add to existing OAuth)  
**API:** Graph API `GET /v1.0/sites/{site-id}/drive/items/{item-id}/content`  
**Effort:** 4 hours (use existing mira-crawler pipeline)  
**Priority:** Next sprint

#### OneNote
**Direction:** MIRA → OneNote  
**Use case:** MIRA appends diagnostic summaries and repair logs to a maintenance OneNote notebook  
**Auth:** `Notes.ReadWrite` scope  
**Effort:** 3 hours  
**Priority:** Q2

---

### 5.2 Google Workspace

#### Gmail / Email alerts
**Direction:** MIRA → Gmail  
**Use case:** WO notifications, PM reminders, safety summaries via email  
**Auth:** `gmail.send` scope — OAuth already captured  
**API:** Gmail API `POST /gmail/v1/users/me/messages/send`  
**Effort:** 2 hours  
**Priority:** Ship now (same timing as Outlook — auth done)

#### Google Calendar / PM sync
**Direction:** MIRA → Google Calendar  
**Use case:** Create recurring calendar events for PM schedules  
**Auth:** `calendar.events` scope (add to existing OAuth)  
**API:** Calendar API `POST /calendars/{calendarId}/events`  
**Effort:** 3 hours  
**Priority:** Next sprint

#### Google Drive / Document ingest
**Direction:** Drive → MIRA (ingest)  
**Use case:** Crawl Drive folder for OEM manuals, index to Open WebUI KB  
**Auth:** `drive.readonly` scope — OAuth already captured  
**API:** Drive API `GET /files/{fileId}?alt=media`  
**Effort:** 2 hours (mira-crawler already has Google Drive ingest)  
**Priority:** Ship now — ingest pipeline exists, just needs OAuth token wiring

---

## 6. Section 3: CMMS Connectors

*Bring your system of record — MIRA writes work orders where they already live.*

### Architecture: MCP adapter pattern

Every CMMS connector follows the same pattern as Atlas:
1. Extend `CMMSAdapter` base class in `mira-mcp/cmms/`
2. Set `CMMS_PROVIDER={name}` in Doppler
3. MIRA MCP server routes work order creation to the active provider
4. Hub Integrations page shows connected/available status

### 6.1 Atlas / FactoryLM Works ✅ LIVE

**Auth:** JWT (`/auth/signin` with `type: "CLIENT"`)  
**Operations:** `list_work_orders`, `create_work_order`, `complete_work_order`, `list_assets`, `get_asset`, `create_asset`, `list_pm_schedules`, `invite_users`  
**Effort:** Done

---

### 6.2 MaintainX

**API:** REST v2 — `https://api.getmaintainx.com/v2`  
**Auth:** API key in `Authorization: Bearer {key}` header  
**Operations needed:**
- `POST /workorders` — create work order
- `GET /workorders` — list with status filter
- `PATCH /workorders/{id}` — update/complete
- `GET /assets` — list assets for asset picker
- `POST /assets` — create asset from nameplate scan

**Mapping:**
| MIRA field | MaintainX field |
|---|---|
| `title` | `title` |
| `description` | `description` |
| `priority` | `priority` (NONE/LOW/MEDIUM/HIGH) |
| `asset` | `asset.id` |
| `status` | `status` (OPEN/IN_PROGRESS/DONE) |

**Effort:** 4 hours  
**Priority:** Next sprint (highest install base in target ICP)

---

### 6.3 UpKeep

**API:** REST v2 — `https://api.upkeep.com/api/v2`  
**Auth:** API key in header `x-api-key: {key}`  
**Operations needed:**
- `POST /work-orders` — create
- `GET /work-orders` — list
- `PATCH /work-orders/{id}` — update/complete
- `GET /assets` — list
- `POST /assets` — create

**Mapping:**
| MIRA field | UpKeep field |
|---|---|
| `title` | `title` |
| `description` | `description` |
| `priority` | `priority` (1=Low, 2=Medium, 3=High, 4=Critical) |
| `asset` | `asset_id` |
| `status` | `status` (open/in_progress/complete) |

**Effort:** 4 hours  
**Priority:** Next sprint

---

### 6.4 Limble CMMS

**API:** REST — `https://api.limblecmms.com/v1` (requires paid plan for API access)  
**Auth:** API key header `Authorization: Bearer {key}`  
**Operations needed:** Same CRUD pattern as MaintainX/UpKeep  
**Effort:** 4 hours  
**Priority:** Q2 (requires customer to have Limble API access)

---

### 6.5 Fiix / Rockwell Automation

**API:** REST/JSON-RPC hybrid — `https://fiixsoftware.com/api/v3/cmmses/1`  
**Auth:** API key + company ID — complex signature requirement  
**Operations needed:** Work order CRUD + asset lookup  
**Effort:** 8 hours (non-standard auth signature is the friction)  
**Priority:** Q2 (Rockwell shops = high value but low volume for now)

---

### 6.6 IBM Maximo

**API:** Maximo Application Framework REST API (OSLC) — `https://{host}/maximo/oslc/os/mxwo`  
**Auth:** HTTP Basic or API key token  
**Operations needed:** WO creation + asset lookup  
**Notes:** Self-hosted installations vary wildly in version and config; need customer to provide base URL + credentials  
**Effort:** 10 hours (OSLC is verbose; field mapping is complex)  
**Priority:** Q3 — enterprise deal requirement

---

### 6.7 SAP Plant Maintenance (PM)

**API:** SAP OData API or RFC calls (via SAP API Business Hub or direct)  
**Auth:** OAuth 2.0 (SAP BTP) or basic auth with SAP API key  
**Operations needed:** `POST /MaintenanceOrder`, `GET /FunctionalLocation`  
**Notes:** Customer-specific config (S/4HANA vs ECC vs BTP); almost always requires SI partner  
**Effort:** 20+ hours + SAP license/environment  
**Priority:** Q3 — enterprise tier only; never ship without a live customer requirement

---

## 7. Section 4: Operational Tools

*Bring your workflow — MIRA fires into your existing escalation and ticketing systems.*

### 7.1 Outbound Webhooks (exists as mock → make real)

**Current:** Hub Integrations → Webhooks tab shows hardcoded mock array  
**Target:** Real webhook registry per tenant in NeonDB  
**Events to support:**
- `safety_alert` — immediate push (< 5 seconds)
- `wo_created` — with WO number, asset, priority, diagnosis summary
- `pm_overdue` — daily digest at 6 AM local
- `diagnostic_complete` — with confidence score and citations
- `asset_created` — from nameplate scan

**Implementation:**
1. NeonDB table: `webhooks(id, tenant_id, url, events[], secret, enabled, last_called_at, healthy)`
2. `mira-mcp` fires webhooks on key events (Supervisor calls `fire_webhook()`)
3. Hub UI: real CRUD for webhook targets (url, events, test ping)

**Effort:** 6 hours  
**Priority:** Ship now — powers all outbound integrations

---

### 7.2 PagerDuty

**Direction:** MIRA → PagerDuty  
**Trigger:** `safety_alert` event  
**Use case:** Arc flash, LOTO, confined space, exposed energized wire → immediately page the on-call supervisor  
**Auth:** PagerDuty Events API v2 — integration key (routing key)  
**API:** `POST https://events.pagerduty.com/v2/enqueue`  
**Payload:**
```json
{
  "routing_key": "{integration_key}",
  "event_action": "trigger",
  "payload": {
    "summary": "SAFETY ALERT: Arc flash reported on Panel P-3 — Line 2",
    "severity": "critical",
    "source": "MIRA",
    "custom_details": {
      "asset": "Panel P-3", "technician": "chat_id", "raw_message": "..."
    }
  }
}
```
**Effort:** 3 hours  
**Priority:** Next sprint — safety is table stakes for enterprise

---

### 7.3 Jira Service Management

**Direction:** MIRA → Jira  
**Use case:** Create Jira issues for work orders when the customer uses Jira as their ticketing system (no CMMS)  
**Auth:** API token — `Authorization: Basic base64(email:token)`  
**API:** `POST /rest/api/3/issue`  
**Field mapping:**
| MIRA field | Jira field |
|---|---|
| `title` | `summary` |
| `description` | `description` (Atlassian Document Format) |
| `priority` | `priority.name` (Low/Medium/High/Critical) |
| `asset` | Custom field or labels |

**Effort:** 5 hours  
**Priority:** Q2

---

### 7.4 ServiceNow

**Direction:** MIRA → ServiceNow  
**Use case:** Create ServiceNow `incident` or `change_request` records from MIRA diagnoses  
**Auth:** OAuth 2.0 or Basic auth  
**API:** `POST /api/now/table/incident`  
**Effort:** 6 hours  
**Priority:** Q3 — enterprise deal requirement

---

### 7.5 Zapier / Make

**Direction:** MIRA → Zapier webhook trigger → customer-defined automation  
**Use case:** Customers who can't afford direct integrations use Zapier to bridge MIRA events to any other tool  
**Implementation:** Expose the outbound webhook system (Section 7.1) — Zapier/Make both accept any webhook. No MIRA-specific work needed beyond real webhooks.  
**Effort:** 0 hours (webhooks cover this)  
**Priority:** Document in Hub as "works via webhooks"

---

### 7.6 Power BI

**Direction:** MIRA NeonDB → Power BI  
**Use case:** Maintenance KPI dashboards for operations managers  
**Implementation:** Power BI DirectQuery or Import from NeonDB PostgreSQL. Customer uses Power BI Desktop to connect to NeonDB connection string.  
**Effort:** 0 hours for MIRA (NeonDB is already standard PostgreSQL)  
**Priority:** Document in Hub as self-service

---

## 8. Section 5: IoT / Sensor Data

*Bring your data — MIRA reads real-time signals and reasons about them.*

### 8.1 MQTT Broker

**Direction:** MQTT → MIRA  
**Use case:** Subscribe to equipment topics, detect anomalies, trigger diagnostic when a threshold is exceeded  
**Protocol:** MQTT 3.1.1 / 5.0 via `paho-mqtt` or `aiomqtt`  
**Flow:**
```
MQTT broker (e.g. EMQX, Mosquitto, HiveMQ)
  → mira-bridge (Node-RED) subscribes to topics
  → threshold exceeded → HTTP POST to mira-pipeline
  → engine processes event with sensor context
  → creates work order if confidence high
```
**Integration point:** `mira-bridge` (Node-RED) is already running — extend with MQTT in node  
**Effort:** 4 hours (Node-RED MQTT node + threshold rules + mira-pipeline endpoint)  
**Priority:** Next sprint — `mira-bridge` is purpose-built for this

**Hub UI:** Add "MQTT Broker" section to Integrations page — enter broker host, port, username/password, and topic subscriptions

---

### 8.2 OPC-UA

**Direction:** OPC-UA server → MIRA  
**Use case:** Read live tag values from PLCs (SCADA-connected systems), attach to diagnostic context  
**Protocol:** OPC-UA over TCP (`opc.tcp://`) via `asyncua` Python library  
**Flow:**
```
OPC-UA server (PLC / SCADA)
  → mira-connect (deferred "Config 4" module)
  → poll tags at configurable interval
  → anomaly detection → trigger diagnostic
```
**Current state:** `mira-connect` exists as a deferred module  
**Effort:** 16 hours (deferred Config 4)  
**Priority:** Q3 — needs `mira-connect` to ship first

---

### 8.3 REST Sensor APIs

**Direction:** REST sensor API → MIRA  
**Use case:** Periodic polling of sensor APIs (vibration monitors, temperature loggers, etc.) — trigger diagnostics when values breach thresholds  
**Flow:** Cron job → `GET {sensor_api}/readings/latest` → compare to baseline → POST to mira-pipeline if anomaly  
**Effort:** 3 hours per sensor API (generic polling client)  
**Priority:** Q2

---

### 8.4 Unified Namespace (UNS)

**Current state:** UNS work order schema (`UNSWorkOrder`) already defined in `mira-bots/shared/models/work_order.py`. `log_uns_event()` called on every WO creation. UNS topic format: `mira/{tenant}/{site}/{area}/{asset}/workorder`.

**Direction:** MIRA → UNS (publish) + UNS → MIRA (subscribe to asset health events)  
**Hub:** Add UNS namespace config to Integrations page — enter MQTT broker + topic prefix  
**Effort:** 2 hours (schema exists; just need Hub config + broker wiring)  
**Priority:** Next sprint — UNS events already firing, just need a real broker endpoint

---

## 9. Connection Storage Architecture

**Current problem:** Connection state is stored in `localStorage` (`mira_connections_v2` key). This means:
- State is lost when the user clears browser storage
- Multi-device access doesn't work
- No server-side visibility into which tenants have what connected

**Target:** Server-side connection registry in NeonDB

```sql
CREATE TABLE tenant_connections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  provider    TEXT NOT NULL,               -- "telegram" | "slack" | "teams" | ...
  connected   BOOLEAN NOT NULL DEFAULT true,
  config      JSONB NOT NULL DEFAULT '{}', -- provider-specific: bot_token, workspace, etc.
  oauth_token TEXT,                        -- encrypted at rest
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active  TIMESTAMPTZ,
  created_by  UUID,
  UNIQUE(tenant_id, provider)
);
```

**Migration path:**
1. Add `tenant_connections` table to Hub NeonDB schema
2. Move `/api/connections/` routes from localStorage sync → DB reads/writes
3. Add `provider` to the existing `Provider` type (already typed in `src/lib/connections.ts`)
4. Encrypt OAuth tokens at rest using `PLG_JWT_SECRET` key

**Effort:** 4 hours  
**Priority:** Ship before any OAuth integrations go to production

---

## 10. Hub UI Requirements

### ConnectorCard states
Every connector needs four visible states:
1. **Not configured** — provider creds missing in Doppler; `disabled` with explanation
2. **Available** — creds configured, not connected by this tenant
3. **Connected** — green dot, shows connected label (username, email, workspace)
4. **Error** — red dot + error message, reconnect CTA

### Integrations page upgrade
The Integrations page (`/integrations`) needs:
- **CMMS tab:** Replace mock `CMMS_SYSTEMS` array with real DB-backed list. Add "Connect" flow per system (API key input modal).
- **Webhooks tab:** Replace mock array with real CRUD backed by `webhooks` NeonDB table.
- **IoT tab:** New tab — MQTT broker config, OPC-UA endpoint, UNS namespace
- **API tab:** Real API key generation/rotation (not mock `mlm_sk_prod_...`)

---

## 11. Prioritization Summary

### Ship now (this sprint)
| Item | Effort | Blocker |
|---|---|---|
| Slack container deploy | 3 hrs | Doppler secrets + Slack app |
| Google Drive ingest wiring | 2 hrs | OAuth token already captured |
| Gmail/Outlook email alerts | 2 hrs each | OAuth done; just call Graph/Gmail API |
| Outbound webhook system (real) | 6 hrs | NeonDB table |
| Server-side connection storage | 4 hrs | Schema migration |
| Resend domain verification (email unblock) | 0 hrs dev | Mike action item |

### Next sprint (May)
| Item | Effort |
|---|---|
| Teams container deploy + Azure setup | 6 hrs |
| WhatsApp bot.py wiring + container | 4 hrs |
| MaintainX MCP adapter | 4 hrs |
| UpKeep MCP adapter | 4 hrs |
| PagerDuty safety alert integration | 3 hrs |
| Google Calendar PM sync | 3 hrs |
| Outlook Calendar PM sync | 4 hrs |
| MQTT → mira-bridge integration | 4 hrs |
| UNS broker wiring | 2 hrs |
| Google Chat Hub card + container | 3 hrs |
| WebChat bot.py + widget JS | 6 hrs |

### Q2
| Item | Effort |
|---|---|
| Limble MCP adapter | 4 hrs |
| Fiix MCP adapter | 8 hrs |
| Jira Service Management | 5 hrs |
| SMS/Twilio | 2 hrs |
| SharePoint manual ingest | 4 hrs |
| REST sensor API polling | 3 hrs/connector |

### Q3
| Item | Effort |
|---|---|
| IBM Maximo | 10 hrs + customer env |
| SAP PM | 20+ hrs + SI partner |
| ServiceNow | 6 hrs + customer env |
| OPC-UA via mira-connect | 16 hrs |

---

## 12. Success Metrics

| Metric | Now | 30-day target | 90-day target |
|---|---|---|---|
| Communication channels live | 1 (Telegram) | 4 (+ Slack, Teams, WhatsApp) | 7 (+ GChat, Email, WebChat) |
| CMMS connectors live | 1 (Atlas) | 3 (+ MaintainX, UpKeep) | 6 |
| Tenants with ≥2 channels connected | 0 | 3 | 10 |
| Work orders via non-Telegram channel | 0 | 10/week | 50/week |
| Webhook events fired | 0 (mock) | 100/week | 500/week |
| CSV imports completed by new tenants | 0 | 5 | 20 |
| Assets onboarded via CSV | 0 | 200 | 1,000 |

---

## 13. Data Portability Guarantee

> **FactoryLM never holds your data hostage. Every byte you put in can come back out.**

### The Policy

1. **Export anytime, no penalty.** Any tenant on any tier can download a full export of their data at any time — no support ticket required, no offboarding fee, no waiting period.

2. **Open formats.** Exports are delivered as:
   - CSV (assets, work orders, PM schedules, parts, fault history)
   - JSON (full structured export including relationships and metadata)
   - Via API (GET endpoints for all first-party data objects — see API reference)

3. **The only proprietary element is the intelligence.** The knowledge graph reasoning, AI diagnostics, fault pattern models — that's FactoryLM's IP. The *data* that goes into it is yours.

4. **Formats are documented.** Export schemas are versioned and published at `docs/export-schema/`. Any tool that reads CSV or JSON can ingest a FactoryLM export.

5. **You can take your data to a competitor.** The export format is intentionally compatible with all major CMMS import formats (MaintainX, UpKeep, Limble, IBM Maximo). We will document the mapping.

### What Is and Isn't Exported

| Data type | Exported | Format |
|---|---|---|
| Assets (name, tag, serial, location) | ✅ | CSV + JSON |
| Work order history | ✅ | CSV + JSON |
| PM schedules | ✅ | CSV + JSON |
| Parts inventory | ✅ | CSV + JSON |
| Fault history records | ✅ | CSV + JSON |
| Channel connection tokens | ❌ | Security — re-authenticate after migration |
| AI-generated knowledge graph | ❌ | FactoryLM IP — not exported |
| Diagnostic conversation history | ✅ (anonymized) | JSON |

### Export Endpoint (API)

```
GET /api/v1/export/full          → ZIP archive: all data as CSV + manifest.json
GET /api/v1/export/assets        → assets.csv
GET /api/v1/export/work-orders   → work_orders.csv
GET /api/v1/export/pm-schedules  → pm_schedules.csv
GET /api/v1/export/parts         → parts.csv
GET /api/v1/export/fault-history → fault_history.csv
```

All export endpoints:
- Require tenant JWT (same as rest of API)
- Return 202 for large datasets with a `job_id` for async polling
- Include a `schema_version` header matching the published schema docs
- Available to all tiers (Starter, Professional, Enterprise)

### Legal Commitment

This guarantee is written into the Terms of Service: *"Customer retains full ownership of all Customer Data. FactoryLM grants no rights to Customer Data beyond what is necessary to operate the service. Customer may export all Customer Data at any time."*

---

## 14. Data Sensitivity Options

Different customers have different risk tolerances. We meet them where they are.

### Tier-by-Tier Controls

| Control | Starter | Professional | Enterprise |
|---|---|---|---|
| Knowledge Cooperative participation | ✅ On (anonymous, opt-out available) | Opt-out available | Off by default |
| Live CMMS API connection | ✅ Available | ✅ Available | ✅ Available |
| CSV-only mode (no live connection) | ✅ Available | ✅ Available | ✅ Available |
| On-premises deployment | ❌ | ❌ | ✅ Available |
| Data residency choice (US / EU / AU) | ❌ | ❌ | ✅ Available |
| Private knowledge base (no federation) | ❌ | ✅ | ✅ |
| Audit log export | ❌ | ✅ | ✅ |
| SOC 2 Type II report | ❌ | On request | ✅ Included |

### CSV-Only Mode

For customers whose IT policy prohibits live API connections to their CMMS:

- Turn off all live CMMS API polling (no API credentials required or stored)
- MIRA operates from imported CSV data only
- Manual re-import triggers a sync (scheduled or on-demand)
- The Hub shows a "CSV mode" badge on the CMMS card instead of a "Connected" badge
- Full diagnostic capability is preserved — only the real-time sync is disabled

Enabled via Hub → Integrations → CMMS → [provider] → "Use CSV import only".

### Knowledge Cooperative Opt-Out

The Knowledge Cooperative pools anonymized fault patterns across the tenant base to improve MIRA's diagnostic accuracy. Opt-out means:
- MIRA diagnostics are limited to that tenant's own KB + the public domain OEM corpus
- No anonymized data from this tenant is included in shared training sets
- Diagnostic accuracy may be lower on novel faults not in the tenant's own history
- Opt-out is reversible — re-enabling retroactively includes the tenant's anonymized history

Enabled via Hub → Settings → Privacy → "Opt out of Knowledge Cooperative".

### On-Premises Deployment (Enterprise)

Full MIRA stack deployable to customer infrastructure:
- Docker Compose or Kubernetes (Helm chart, `mira-ops/helm/`)
- No data leaves the customer's network
- Customer manages all updates (or FactoryLM managed via VPN access — customer choice)
- Air-gapped mode: local LLM inference via Ollama (Groq/Cerebras fallback disabled)
- Pricing: Enterprise contract, minimum 12-month term

### Data Residency (Enterprise)

For customers with regulatory requirements (GDPR, Australian Privacy Act, etc.):
- **US (default):** NeonDB us-east-2, Vercel US regions
- **EU:** NeonDB eu-central-1 (Frankfurt), Vercel EU regions
- **AU:** NeonDB ap-southeast-2 (Sydney), Vercel AU regions
- Residency is set at tenant creation and cannot be changed post-onboarding (data migration on request)

### What We Never Do

- We never sell, license, or share customer data with third parties
- We never train public-facing models on identifiable customer data
- We never store CMMS credentials in plaintext — tokens are AES-256 encrypted at rest
- We never retain data after account deletion (30-day grace period, then permanent deletion)
