# Slack-First Technician Workflow Specification

**Status:** Authoritative product spec
**Owner:** Mike Harper
**Updated:** 2026-05-14
**Related rule:** `.claude/rules/uns-confirmation-gate.md` (hard rule)

---

## 0. One-Line Summary

> **Slack is the front door. MIRA is the translator. UNS is the live factory language.**

MIRA is a **Slack-first, natural-language input surface** for industrial maintenance. Technicians work in Slack — talking, photographing, asking, flagging. MIRA listens, resolves ambiguous human input into the customer's UNS (Unified Namespace), confirms context, then troubleshoots, monitors, and remembers.

---

## 1. Product Position

### What MIRA is
- A **Slack-native** assistant that lives where technicians already work.
- A **translator** between human language ("the conveyor is jammed again") and the UNS / asset hierarchy (`Site/Area/Line/Asset/Component/Signal`).
- A **memory layer** for the plant: every confirmed troubleshooting session becomes durable graph context.
- A **read-only/advisory** participant on the OT side. MIRA proposes, the human verifies, the PLC stays untouched.

### What MIRA is NOT
- Not a control system. Never writes setpoints, never publishes control MQTT, never commands the PLC.
- Not a CMMS replacement (it integrates — MaintainX, Atlas, etc.).
- Not a "chat about anything" bot. It refuses asset-specific troubleshooting until context is confirmed.

### The product mantra
> **"The LLM proposes. The graph remembers. The human verifies. MIRA gets smarter."**

---

## 2. The UNS Location Confirmation Gate (HARD RULE)

> **"No confirmed namespace context, no troubleshooting."**

Before MIRA gives asset-specific troubleshooting guidance, live-signal interpretation, reset advice, wiring references, component recommendations, or fault reasoning, it **MUST** resolve and **confirm** the technician's current `Site/Area/Line/Asset/Component/Fault` context in the customer's UNS namespace.

This is enforced as a hard rule on par with "No Anthropic" — see `.claude/rules/uns-confirmation-gate.md`.

### 2.1 What triggers the gate (asset-specific intents)

- "Why is this conveyor stopped?"
- "Is the PLC seeing this sensor?"
- "How many times did I flag it?"
- "Can I reset this fault?"
- "Where is this sensor wired?"
- "What's the part number for the prox switch?"
- Any question referencing a specific asset, component, fault, PLC tag, or live signal.

### 2.2 What does NOT trigger the gate (general / educational)

- "What is MQTT?"
- "What is a proximity switch?"
- "What does PNP mean?"
- "How does a VFD work?"
- "Explain SCCR."

General/educational questions answer immediately without the gate.

### 2.3 Gate flow

```
1. Detect intent (asset-specific vs general)
2. If asset-specific:
   a. Resolve candidate context from signals:
      - QR scan (highest)
      - Slack channel topic / pinned asset
      - Thread parent's confirmed context
      - Message text ("PE-001", "the inverter", "line 3")
      - Attached photo (CV asset detection)
      - Fault code in conversation history
   b. Compute confidence (high / medium / low / none)
   c. Send confirmation card with proposed Site/Area/Line/Asset/Component
   d. Wait for technician confirmation (Approve / Edit / Different asset)
   e. On confirm: create Troubleshooting Session, then answer
3. Even at HIGH confidence, always confirm before troubleshooting.
```

### 2.4 Confidence levels

| Level | Trigger | Behavior |
|-------|---------|----------|
| `high` | QR scan, exact tag match, pinned channel asset, confirmed thread ancestor | Pre-fill confirmation card, single click to confirm |
| `medium` | Strong text match + plausible channel context | Confirmation card with top 1-3 candidates |
| `low` | Vague reference, photo-only, fault code without site | "Which asset are you on?" picker with browse |
| `none` | Pure pronoun / no signal | Ask user to scan QR or pick from list |

---

## 3. Troubleshooting Session Model

A **Troubleshooting Session** is the durable unit of work. Every asset-specific Slack conversation, once context is confirmed, becomes a session.

### 3.1 Lifecycle

```
proposed → confirmed → active → (paused) → resolved | expired | closed
```

- `proposed`: MIRA has a candidate context, awaiting tech confirmation.
- `confirmed`: Tech approved the asset/component context.
- `active`: Conversation in progress, signal watchlist live, monitoring on.
- `paused`: Tech left the channel/thread for >N minutes (configurable, default 30m).
- `resolved`: Tech reported fix worked (✅ button or "it works now" + confirm).
- `expired`: No activity for `session_ttl_minutes` (default 4 hours).
- `closed`: Tech explicitly ended ("/mira close" or button).

### 3.2 Why it matters

The session is what lets MIRA answer questions like:
- "How many times did I flag this fault in the last minute?"
- "What did we try last shift?"
- "Has this asset failed this way before?"

Without sessions, every message is amnesiac. With sessions, the graph remembers.

---

## 4. Data Model (NeonDB / Postgres)

All tables are tenant-scoped; `tenant_id UUID NOT NULL` on every row (omitted from snippets for readability).

### 4.1 `troubleshooting_sessions`

```sql
CREATE TABLE troubleshooting_sessions (
    session_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,
    slack_team_id       TEXT NOT NULL,
    slack_channel_id    TEXT NOT NULL,
    slack_thread_ts     TEXT,                              -- root message ts of the thread
    technician_user_id  TEXT NOT NULL,                     -- Slack user id
    state               TEXT NOT NULL,                     -- proposed|confirmed|active|paused|resolved|expired|closed
    asset_uns_path      TEXT,                              -- Site/Area/Line/Asset
    component_uns_path  TEXT,                              -- ...Component (nullable)
    fault_code          TEXT,                              -- nullable
    initial_message_ts  TEXT,                              -- the message that opened the session
    confidence_at_open  TEXT,                              -- high|medium|low|none
    opened_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at        TIMESTAMPTZ,
    last_activity_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at         TIMESTAMPTZ,
    resolution_summary  TEXT,                              -- LLM-summarized when resolved
    session_ttl_minutes INT NOT NULL DEFAULT 240,
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_ts_channel_thread ON troubleshooting_sessions(slack_channel_id, slack_thread_ts);
CREATE INDEX idx_ts_tenant_active  ON troubleshooting_sessions(tenant_id, state) WHERE state IN ('confirmed','active');
CREATE INDEX idx_ts_asset          ON troubleshooting_sessions(asset_uns_path);
```

### 4.2 `asset_context_resolutions`

Records every gate decision — proposal + outcome — so we can learn which resolution signals are accurate.

```sql
CREATE TABLE asset_context_resolutions (
    resolution_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,
    session_id          UUID REFERENCES troubleshooting_sessions(session_id) ON DELETE SET NULL,
    slack_channel_id    TEXT NOT NULL,
    slack_message_ts    TEXT NOT NULL,
    raw_user_text       TEXT,
    candidate_uns_path  TEXT,
    candidate_confidence TEXT,                             -- high|medium|low|none
    resolution_signals  JSONB NOT NULL DEFAULT '{}'::jsonb, -- {qr:bool, channel_topic:..., thread:..., text_match:..., photo:..., fault_code:...}
    proposed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    outcome             TEXT,                              -- approved|edited|rejected|timeout
    final_uns_path      TEXT,
    decided_at          TIMESTAMPTZ
);

CREATE INDEX idx_acr_session ON asset_context_resolutions(session_id);
CREATE INDEX idx_acr_outcome ON asset_context_resolutions(outcome, candidate_confidence);
```

### 4.3 `live_signal_cache`

Most-recent value of every watched UNS topic. Tiny, fast, overwritten on every MQTT message.

```sql
CREATE TABLE live_signal_cache (
    tenant_id    UUID NOT NULL,
    uns_topic    TEXT NOT NULL,             -- e.g. Site/Area/Line/Asset/Component/Signal
    value        JSONB NOT NULL,            -- {v:..., ts:..., quality:...}
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, uns_topic)
);

CREATE INDEX idx_lsc_recent ON live_signal_cache(tenant_id, last_seen_at DESC);
```

### 4.4 `live_signal_events`

Append-only event store. Used to answer "how many times did X happen in the last minute?"

```sql
CREATE TABLE live_signal_events (
    event_id     BIGSERIAL PRIMARY KEY,
    tenant_id    UUID NOT NULL,
    uns_topic    TEXT NOT NULL,
    value        JSONB NOT NULL,
    event_kind   TEXT NOT NULL,             -- rising_edge|falling_edge|change|sample|fault_set|fault_clear
    occurred_at  TIMESTAMPTZ NOT NULL,
    ingested_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lse_topic_time ON live_signal_events(tenant_id, uns_topic, occurred_at DESC);
CREATE INDEX idx_lse_recent     ON live_signal_events(tenant_id, occurred_at DESC);
```

Retention: rolling 30 days, configurable. Long-term aggregates land in a separate analytics rollup.

### 4.5 `signal_watchlists`

Reusable named groups of UNS topics — e.g. "Conveyor PE-001 health" = the prox sensor, the VFD current, the e-stop status, the fault word.

```sql
CREATE TABLE signal_watchlists (
    watchlist_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL,
    name           TEXT NOT NULL,
    asset_uns_path TEXT,                    -- nullable; can be cross-asset
    topics         JSONB NOT NULL,          -- ["Site/Area/.../Signal", ...]
    created_by     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_watchlist_name ON signal_watchlists(tenant_id, name);
```

### 4.6 `session_signal_watchlists`

Which watchlists are active *for this session right now*. When the session ends, watchlist drops out of "live monitoring" mode.

```sql
CREATE TABLE session_signal_watchlists (
    session_id   UUID NOT NULL REFERENCES troubleshooting_sessions(session_id) ON DELETE CASCADE,
    watchlist_id UUID NOT NULL REFERENCES signal_watchlists(watchlist_id) ON DELETE CASCADE,
    attached_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    detached_at  TIMESTAMPTZ,
    PRIMARY KEY (session_id, watchlist_id)
);
```

### 4.7 `chat_asset_links` (Slack thread ↔ asset binding)

```sql
CREATE TABLE chat_asset_links (
    link_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL,
    slack_team_id    TEXT NOT NULL,
    slack_channel_id TEXT NOT NULL,
    slack_thread_ts  TEXT NOT NULL,
    asset_uns_path   TEXT NOT NULL,
    confirmed_by     TEXT NOT NULL,
    confirmed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_chat_asset_link ON chat_asset_links(slack_channel_id, slack_thread_ts);
```

---

## 5. Context-Activated Monitoring

MIRA does not stream the whole plant. It **follows the technician into the namespace**.

### 5.1 Activation rule

When a Troubleshooting Session enters `confirmed`/`active`:
1. Resolve the asset's default watchlist (or build one from the asset's component graph).
2. Attach watchlist to session via `session_signal_watchlists`.
3. Subscribe MQTT bridge to those topics (or, if already streaming, mark them "interesting").
4. Begin writing matching events to `live_signal_events`.

### 5.2 Deactivation rule

When the session enters `resolved`/`expired`/`closed`:
1. Detach watchlist (`detached_at`).
2. If no other active session references those topics, MQTT bridge drops the subscription.
3. `live_signal_cache` remains; `live_signal_events` is retained per retention policy.

### 5.3 Why this matters

- Bandwidth: a customer with 50,000 tags doesn't need every one streaming into MIRA — only the ones the tech is actually working on.
- Privacy / cost: cloud egress is bounded by active sessions.
- Relevance: "How many times did I flag it?" only makes sense within a session window.

---

## 6. Live Signal Event Store

The event store is the answer to "How many times in the last minute?"

### 6.1 Example query

```sql
SELECT COUNT(*) FROM live_signal_events
WHERE tenant_id = $1
  AND uns_topic = $2
  AND event_kind IN ('rising_edge','fault_set')
  AND occurred_at >= now() - interval '1 minute';
```

### 6.2 Edge detection

The MQTT bridge classifies every incoming message:
- `rising_edge` / `falling_edge` for booleans
- `change` for analogs crossing a configurable delta
- `sample` for periodic samples (downsampled)
- `fault_set` / `fault_clear` for known fault bits

The classifier runs **before** insert so queries don't have to recompute deltas.

### 6.3 Answering "How many times did I flag it?"

The session knows its watchlist. The watchlist knows its topics. The event store knows the counts. The LLM only needs to ask the count, never raw signal data.

---

## 7. Safety Rules (MIRA is Read-Only on OT)

### 7.1 Hard rules

- MIRA **MUST NOT** publish to control MQTT topics.
- MIRA **MUST NOT** write setpoints, force bits, command PLCs, or execute MQTT writes against the OT bridge.
- MIRA **MUST NOT** suggest "I'll reset the fault for you" — it suggests, the human acts.
- Any MQTT publish path must be guarded by an allowlist of *non-control* topics (acknowledgement / annotation topics only, and only if the customer has opted in).

### 7.2 Safe MQTT publishes (opt-in only)

| Allowed | Why |
|---------|-----|
| `mira/annotations/{session_id}` | Tech notes / session metadata |
| `mira/heartbeat` | Bridge liveness |
| `mira/proposed_relationships/{id}` | Graph proposals for UI review |

### 7.3 Unsafe MQTT publishes (NEVER)

| Forbidden | Why |
|---------|-----|
| Any topic that maps to a PLC write tag | OT control surface |
| Any setpoint / command topic in the customer's UNS | OT control surface |
| Any "force" / "override" topic | OT control surface |
| Any vendor command topic (Ignition tag write, etc.) | OT control surface |

The MQTT bridge enforces this allowlist; a publish to a non-allowlisted topic is dropped + logged + alerted.

### 7.4 Safety language in responses

MIRA explicitly tells the technician what to do, not what it will do:
- ✅ "Try resetting the fault from the HMI E-stop reset."
- ❌ "I'll reset the fault for you."
- ✅ "Verify lockout/tagout before opening the panel."
- ❌ "I've isolated the circuit."

---

## 8. Slack as Interface AND Ingestion Pipeline

Slack is not just chat. Every Slack interaction is an ingestion event.

### 8.1 What gets ingested

| Slack event | Ingestion outcome |
|-------------|-------------------|
| Uploaded PDF (manual, schematic, datasheet) | Document chunking → KB → linked to asset if session confirmed |
| Uploaded photo (asset, fault display, wiring) | CV asset detection → asset link proposal → KB attachment |
| Fault discussion in thread | Technician note → session memory → KG fact proposals |
| Fix confirmation ("that worked" + button) | Resolution pattern → fault→fix edge added to KG (pending verification) |
| Relationship approvals via interactive buttons | Verified KG edge written to `kg_relationships` |
| `/mira note ...` slash command | Free-form note attached to session |
| Channel topic mentioning asset | Channel-asset binding proposal |

### 8.2 Slack is the front door

Mike's framing — to be preserved verbatim in onboarding docs:

> **"Slack is the front door. MIRA is the translator. UNS is the live factory language."**

A technician should never have to leave Slack to do their job with MIRA. Photos, voice memos (transcribed), PDFs, "is this the right part?" — all flow through Slack and out into the graph.

---

## 9. Technician Flow Examples

### 9.1 Happy path — known asset

```
[#line-3-conveyor, thread]
Tech: "PE-001 won't run. Fault light is flashing."

MIRA (gate fires, high confidence — channel pinned to Line 3 Conveyor PE-001):
  > I think this is about:
  > Site: NorthPlant / Area: Packaging / Line: 3 / Asset: PE-001 (Conveyor) / Component: drive
  > [Approve] [Edit asset] [Different asset]

Tech: clicks [Approve]

MIRA: Session opened. Pulling live signals...
  > Right now I see:
  >  - drive_fault: TRUE (set 2 min ago)
  >  - motor_run_cmd: FALSE
  >  - e_stop_ok: TRUE
  > Last fix on this fault (3 weeks ago): cleared an overload trip via HMI reset.
  > Want to try that first?

Tech: "yeah it cleared. running again."

MIRA: Mark resolved? [✅ Resolved] [Still working]
Tech: clicks [✅ Resolved]
MIRA: Session closed. Resolution logged. KG updated: fault drive_fault on PE-001 → fix "HMI reset" (occurrence 2).
```

### 9.2 Ambiguous path — pronoun reference

```
[#maintenance-general, no thread]
Tech: "the conveyor is stopped"

MIRA (gate fires, low confidence — no channel binding, multiple conveyors exist):
  > Which conveyor? I see 4 on your site:
  > [ ] PE-001 — Line 3 Packaging
  > [ ] PE-104 — Line 1 Mixing
  > [ ] PE-220 — Receiving
  > [ ] Other / scan QR

Tech: picks PE-001
MIRA: confirms, opens session, proceeds.
```

### 9.3 General question — no gate

```
Tech: "what does PNP mean for a prox switch?"
MIRA: answers immediately. No gate, no session.
```

### 9.4 "How many times did I flag it?"

```
Tech (inside an active session for PE-001 drive_fault):
  "how many times has this fault hit in the last minute?"

MIRA:
  > In the last 60 seconds:
  >  - drive_fault rising edges: 7
  >  - last clear was 3 seconds ago
  > Looks like it's cycling — likely an overload that's re-tripping. Check
  > motor current or jam at the discharge.
```

---

## 10. Session Expiration Logic

```
On every Slack event in a thread:
  if session exists for (channel, thread):
    if state in (confirmed, active, paused):
      last_activity_at = now()
      if state == paused: state = active

Periodic sweep (every 5 min):
  for session where state in (confirmed, active):
    if now() - last_activity_at > 30 min: state = paused
  for session where state in (proposed, confirmed, active, paused):
    if now() - last_activity_at > session_ttl_minutes: state = expired
                                                       detach watchlists
                                                       drop MQTT subs if orphaned
```

Tech can always reopen an expired session ("/mira reopen") within 72 hours; after that it's archived and must be restarted.

---

## 11. MVP Path (May 2026)

The minimum cut that proves the whole loop:

1. **Demo Conveyor + PE-001** as the single confirmed asset.
2. **UNS namespace** populated for one site/area/line/asset/component tree.
3. **Slack app** with:
   - Events API receiving messages + file uploads
   - Interactive message buttons for confirmation cards
   - One slash command: `/mira` (status / close / reopen / note)
4. **Gate enforcement** — asset-specific intents always confirm first.
5. **Troubleshooting Session model** — open, confirm, close, expire.
6. **Live signal event store** — populated from a single MQTT bridge subscribing only to PE-001 topics when the session is active.
7. **"How many times did I flag it?" query** — wired end-to-end.
8. **No control writes** — MQTT bridge is publish-disabled on OT topics.

Out of scope for MVP (defer):
- Multi-tenant Slack workspace management UI
- Photo CV asset detection (manual confirmation only)
- Voice memo transcription
- CMMS work order auto-creation from sessions
- Cross-session pattern mining

---

## 12. Slogans (Preserve Verbatim)

These go in product copy, onboarding, and internal docs:

- **"Slack is the front door. MIRA is the translator. UNS is the live factory language."**
- **"No confirmed namespace context, no troubleshooting."**
- **"The LLM proposes. The graph remembers. The human verifies. MIRA gets smarter."**

---

## 13. Implementation Phases (cross-ref GitHub issues)

| Phase | What | Issue |
|-------|------|-------|
| 1 | Slack app discovery + existing code audit | `feat(slack): Phase 1` |
| 2 | Slack event/message handler MVP | `feat(slack): Phase 2` |
| 3 | UNS Location Confirmation Gate | `feat(slack): Phase 3` |
| 4 | Troubleshooting Session model | `feat(slack): Phase 4` |
| 5 | Slack thread to asset linking | `feat(slack): Phase 5` |
| 6 | Live signal cache + event store | `feat(slack): Phase 6` |
| 7 | Slack ingestion pipeline | `feat(slack): Phase 7` |
| 8 | Relationship approval cards in Slack | `feat(slack): Phase 8` |

---

## 14. Non-Goals

- Replacing the CMMS (we integrate, not replace).
- Replacing the SCADA/HMI (we observe, we never command).
- Becoming a general-purpose Slack chatbot (we refuse asset-specific work without the gate; we keep scope tight).
- Running on-prem PLC control logic (we read; we don't write).
