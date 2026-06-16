# Ladder Editor ↔ MIRA Integration Spec

**Status:** Draft → in implementation (2026-05-11)
**Owner:** Mike Harper
**Editor fork:** `Mikecranesync/ladder-logic-editor` branch `feat/mira-integration`
**MIRA touch points:** `mira-mcp` (read), `mira-crawler` (write KB), `mira-hub` (iframe host at `/plc/`)

## Why this exists

The ladder-logic-editor is a high-quality IEC 61131-3 ST → ladder transformer with live simulation. Today it stands alone: ST in, ladder + PDF out. MIRA has the opposite asset — a knowledge graph of equipment, fault codes, OEM manuals, and (via the Jarvis bridge) live PLC values from the Micro 820. The flywheel below is what we want to close:

```
┌─────────────────────────┐    1. ST source           ┌──────────────────────────┐
│  Technician (phone /    │  ───────────────────────► │   ladder-logic-editor    │
│  CCW export / GitHub)   │                            │   (iframe @ /plc/)       │
└─────────────────────────┘                            └──────────────────────────┘
        ▲                                                       │ 2. ladder IR
        │                                                       │    + IL export
        │ 6. answer cites                                       ▼
        │    instruction line                            ┌──────────────────────┐
        │    + rung context                              │  IL / CCW guide      │
        │                                                │  files               │
┌─────────────────────────┐                              └──────────────────────┘
│  MIRA diagnostic engine │                                       │
│  (mira-pipeline, RAG)   │                                       │ 3. ingest
│                         │ ◄─────────────────────────────────────┘
│                         │                              4. equipment context + tags
│                         │ ─────────────────────────────┐
└─────────────────────────┘                              │
        ▲                                                 ▼
        │ 5. live values                          ┌────────────────────┐
        │    (read-only)                          │   editor live      │
        └─────────────────────────────────────────┤   bridge panel     │
                                                  └────────────────────┘
```

Numbered steps map to the API contracts below.

## API Contracts

### Endpoint 1: `GET /api/plc/manifest?asset_tag={tag}`

**Direction:** editor → MIRA
**Implemented by:** `mira-mcp` REST surface (`:8001`), reuses existing tenant-scoped auth (`MCP_REST_API_KEY`)
**Purpose:** when a user opens the editor from MIRA Hub for a specific asset (e.g. Conveyor-04), preload the variable manifest from the MIRA KB instead of asking them to upload JSON.

**Response shape (matches editor's existing `loadManifest()` argument):**

```json
{
  "asset_tag": "CONV-04",
  "asset_name": "Sorting Conveyor #4",
  "generatedAt": "2026-05-11T14:30:00Z",
  "variables": [
    {
      "name": "MOTOR_RUN_CMD",
      "alias": "Conveyor motor run command",
      "address": "%QX0.0",
      "modbusAddress": "COIL:0",
      "direction": "OUT",
      "dataType": "BOOL",
      "comment": "Drives VFD Run input via TB1-7"
    },
    {
      "name": "MOTOR_SPEED_FB",
      "alias": "VFD speed feedback",
      "modbusAddress": "HR:101",
      "direction": "IN",
      "dataType": "INT",
      "comment": "GS10 register 101 — actual Hz × 10"
    }
  ],
  "wiringNotes": ["E-stop wired in series with VFD enable per drawing E-103 rev B."],
  "gaps": []
}
```

The shape is **already what the editor's `loadManifest()` consumes** (see `src/store/project-store.ts`) — no editor-side schema change.

### Endpoint 2: `GET /api/plc/equipment-context?asset_tag={tag}`

**Direction:** editor → MIRA
**Implemented by:** `mira-mcp` (reuses the same NeonDB `assets` / `fault_codes` tables as the diagnostic engine)
**Purpose:** populate a side-panel in the editor with OEM model, last 5 fault codes, and PM history so the technician writing the ladder change has plant context one panel away.

```json
{
  "asset_tag": "CONV-04",
  "make": "Allen-Bradley",
  "model": "Micro 820 2080-LC20-20QWB",
  "oem_manual_urls": ["…"],
  "recent_faults": [
    {"code": "F32", "description": "Motor overcurrent", "occurred_at": "2026-05-08T08:14:00Z"}
  ],
  "open_work_orders": [
    {"id": "WO-1042", "summary": "Replace TB1-3 terminal block", "status": "open"}
  ]
}
```

### Endpoint 3: `POST /api/plc/ingest-instruction-list`

**Direction:** editor → MIRA
**Implemented by:** `mira-crawler` ingest endpoint (existing tenant-scoped path, MIME allowlist updated to accept `text/x-plc-il`)
**Purpose:** when the technician clicks **Export → IL to MIRA KB** in the editor, the instruction list is POSTed straight into the KB and indexed so future diagnostic queries can cite *"in rung 12 you XIC E_STOP_NC → OTE MOTOR_RUN"*.

```json
{
  "asset_tag": "CONV-04",
  "program_name": "sorting_conveyor",
  "format": "ab-instruction-list",
  "content": "RUNG 0 (* Run / Stop seal-in *)\nXIC START_PB\nXIO STOP_PB\nXIC E_STOP_NC\nOTE MOTOR_RUN\nRUNG 1 ...",
  "metadata": {
    "variable_count": 14,
    "rung_count": 8,
    "generated_by": "ladder-logic-editor@95a3e91"
  }
}
```

The IL format is defined fully in this PR's `src/services/instruction-list-export.ts` (editor side) — one mnemonic per line, RUNG headers, comments in `(* *)`, drop-in for ingestion into MIRA's existing chunker.

### Endpoint 4 (already shipped): Jarvis `/shell` live polling

No change. Editor already polls `http://100.72.2.99:8765/shell` through the Vite dev proxy `/jarvis/*`. For production deploy at `factorylm.com/plc/`, MIRA Hub will proxy this same path through `mira-relay` so the iframe doesn't make cross-origin requests. **Read-only Modbus addresses only** — the editor MUST NOT write back to coils/HR registers; that's reserved for the PLC program itself.

## Data flows — direction & permission

| Flow | Direction | Auth | Frequency | Notes |
|---|---|---|---|---|
| Manifest fetch | Editor → MIRA | Bearer (`MCP_REST_API_KEY`) | Once on open | Per-asset_tag |
| Equipment context | Editor → MIRA | Same | Once on open | |
| IL ingest | Editor → MIRA | Same + `tenant_id` | Per-export | Append-only, tier-limited |
| Live values (read) | Editor → Jarvis (via MIRA proxy) | Network-level (Tailscale + relay) | 1 Hz | IN-direction only |
| Live writes | NOT IMPLEMENTED | n/a | n/a | Explicitly out of scope |
| KB recall during chat | Tech → MIRA → KB(IL) | Existing diagnostic engine path | Per-question | New: IL chunks join the same RAG corpus as PDFs |

## How this closes the loop

1. Tech imports OEM ST or hand-builds in editor.
2. Editor renders ladder, runs simulation.
3. Tech clicks **Export → IL to MIRA**.
4. MIRA ingests the IL → chunks land in the KB tagged with `asset_tag`, `rung_index`, mnemonic.
5. Later, tech asks Mira on Telegram *"why doesn't the conveyor start?"*.
6. RAG retrieves the IL chunk for `CONV-04`, sees `XIC E_STOP_NC` on the rung that drives `MOTOR_RUN`, cross-refs the live value from Jarvis: `E_STOP_NC = FALSE`. Mira answers: *"E-stop loop is open — check TB1-3."*

That's the loop. The editor stops being a pretty visualizer and becomes part of the diagnostic pipeline.

## Live PLC data flow (Ignition path, when deployed)

For factory deployments without direct Modbus access, the same `useLiveBridge` hook can swap targets:

- Dev / Lake Wales: Jarvis → pymodbus → Micro 820 (current).
- Customer site: Ignition WebDev module → `mira-relay` endpoint → editor.

The editor only needs `{name, value}` pairs at 1 Hz — the transport behind the proxy doesn't matter. **Defer Ignition WebDev wiring** until first paying CMMS customer asks for it; Jarvis path is sufficient for demo + Lake Wales pilot.

## Out of scope (deferred)

- L5X import/export (RSLogix 5000 file round-trip)
- Writes back to PLC (anything beyond read-only polling)
- Editor authoring ST changes that auto-deploy to PLC (massive safety surface)
- Multi-user collaborative editing
- Anything that requires Anthropic (per CLAUDE.md hard constraint)

## Implementation status

| Item | Status | Where |
|---|---|---|
| Benchmark vs AB | ✅ shipped | `docs/evals/ladder-editor-benchmark.md` |
| Spec (this doc) | ✅ shipped | `docs/specs/ladder-editor-mira-integration-spec.md` |
| Editor: `mira-bridge.ts` service | ✅ shipped on `feat/mira-integration` | `src/services/mira-bridge.ts` |
| Editor: IL export | ✅ shipped on `feat/mira-integration` | `src/services/instruction-list-export.ts` |
| Editor: toolbar "Load from MIRA" button | ✅ shipped on `feat/mira-integration` | `OpenMenu.tsx` |
| MIRA: `GET /api/plc/manifest` | ⏳ next — needs route added to `mira-mcp` |
| MIRA: `GET /api/plc/equipment-context` | ⏳ next |
| MIRA: `POST /api/plc/ingest-instruction-list` | ⏳ next — extend MIME allowlist |
| `mira-relay` proxy for Jarvis path | ⏳ deferred until customer deploy |

Editor PR ships first because it can be tested against a stub server. MIRA endpoints land behind a feature flag once the editor PR merges to Mike's `main`.

## Backward compatibility

- The editor is iframe-embedded at MIRA Hub `/plc/`. All new code is **additive** — no existing button, route, or simulation path changes.
- If MIRA endpoints return 404 (e.g. asset_tag unknown, dev mode), the editor falls back silently to "no manifest loaded" state, identical to today's first-open experience.
- IL export is a new menu item; existing PDF / CCW guide exports unchanged.
- GitHub Pages deployment at `lle.dilger.dev` continues to work without MIRA — bridge URL is configurable, defaults to `''` (disabled).

## Open questions for Mike

1. Should the IL export include rung comments inline (`(* ... *)`) or as a separate metadata block? (Default in PR: inline.)
2. Should equipment-context auto-refresh while editor is open, or fetch-once-on-open? (Default: fetch-once. Cheaper, stable.)
3. Is `factorylm.com/plc/` the final production URL for the iframe, or do we want a sub-path on the customer-specific tenant URL?
