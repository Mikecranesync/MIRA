# Phase 5 — Ignition / HMI / PLC Reuse Plan

**Goal:** reuse the existing Ask-MIRA HMI work for ProveIt; identify the one rewire and what to defer. Grounded to the Ignition deep dive (file:line). 2026-06-23.

**Headline:** the Ask-MIRA HMI demo is **mostly built**. A Perspective panel with an Ask-MIRA button, an in-gateway diagnose engine, and the integrated cloud-chat endpoint all exist. The one gap that matters is **wiring**: the panel's Ask button POSTs to the **bench** `/ask`, not the integrated `/api/v1/ignition/chat`.

## What already exists (reuse, don't rebuild)

| Asset | file | Status |
|---|---|---|
| **MaintenancePanel** (state header + anomaly feed + **Ask MIRA button** → `openPopup(MiraAsk, seedQuestion)`) | `plc/ignition-project/ConvSimpleLive/.../views/MaintenancePanel/view.json:132` | **BUILT** |
| **MiraAsk** popup (Ask-MIRA chat UI, markdown answer) | `.../views/MiraAsk/view.json` | **PARTIAL** (UI built; **onAction POSTs bench `http://100.68.120.99:8011/ask` at `:67`**) |
| **AnomalyCard** (severity + cause + next-check) | `.../views/AnomalyCard/view.json` | **BUILT** |
| **Conveyor** live mimic (bound to `MIRA_IOCheck` tags) | `.../views/Conveyor/view.json` | **BUILT** |
| **In-gateway diagnose** (A0–A12 rules, dual Py2.7/3.12) | `plc/conv_simple_anomaly/rules_core.py`; project-script `mira_diagnose/code.py` (**no WebDev**) | **BUILT** |
| **`/api/v1/ignition/chat`** (integrated engine door — HMAC, direct-connection UNS cert, tag-evidence, audit, train-before-deploy gate default-off) | `mira-pipeline/ignition_chat.py:511,521,527,548` | **BUILT** |
| **WebDev `/api/chat` → cloud** (HMAC-signs, POSTs to `/api/v1/ignition/chat`) | `ignition/webdev/FactoryLM/api/chat/doPost.py:54,157` | **PARTIAL** (404 on bench — WebDev not installed) |
| **Command Center** (UNS tree + freshness + `display_endpoints`) | `mira-hub/(hub)/command-center/page.tsx:37` | **BUILT** |
| **Demo conveyor** + **`/api/mira/ask`** (parallel Hub-side Ask MIRA, `[C1]` citations) | `mira-hub/demo/conveyor/[tag]`, `api/mira/ask/route.ts:289` | **BUILT** |

## The one rewire (the Ask-MIRA button → integrated MIRA)

```
MaintenancePanel  (Ask MIRA → openPopup MiraAsk, seedQuestion = mira_diagnose.top_ask_text)
      ↓
MiraAsk onAction  (read live tags → snapshot)
      ↓  ⚠️ REWIRE: today → bench http://…:8011/ask  (unsigned, mira-bots/ask_api)
                    should → HMAC-sign → POST /api/v1/ignition/chat
      ↓
ignition_chat.py  (verify HMAC, uns_source="direct_connection", tag_evidence)
      ↓
engine.process(platform="ignition", uns_source="direct_connection", tag_evidence=…)
      ↓  ← the new explain_cause layer plugs in HERE, inside the engine (NOT the HMI surface)
      → UNS gate (certified→skipped), RAG citations from the asset's manual, cascade LLM,
        citation_compliance, decision-trace (+ explanation), answer-card envelope populated
```

- **On a gateway without WebDev** (the bench): the MiraAsk view script can call `system.net.httpClient` directly — but it must **HMAC-sign the contract and target `/api/v1/ignition/chat`**, not the unsigned bench `/ask`. That is the minimal demo-viable rewire (no WebDev install needed).
- The **answer-card** the technician sees = in-gateway anomaly card (live tag evidence, from `mira_diagnose`) **+** the cloud answer's citations + the new `explanation` (from `ignition_chat` → engine). Today those live in separate views (AnomalyCard vs MiraAsk markdown); the integration merges them.

## Defer (NOT ready)

| Item | Why defer |
|---|---|
| Ignition **WebDev module install** (CRA-245) | 404s on bench; the **project-script path** (`mira_diagnose`) + a direct signed `httpClient` sidestep it. Prefer those for the demo. |
| **Live PLC / direct Modbus** (`live-plc-bridge`, `live_monitor`) | BENCH-ONLY banners; the customer/demo reads tags through Ignition, never a MIRA Modbus socket. |
| **Sparkplug B / MQTT foreign-UNS** | bench-proven, not generalized (runbook prereq #4 🟡); code exists but not for a foreign UNS. Defer to the post-Hub transport phase. |
| **OPC-UA** | no production ingest; defer. |
| Time-based rules **A6/A7/A10** | need a stateful gateway poller (Phase 4 gateway work). |
| **Write-to-VFD removal** (runbook prereq #9 🔴) | `ignition/README.md:71-82` + legacy SpeedControl/MiraPanel imply VFD writes. **Fence them** before the demo (the read-only trust beat) — a removal task, schedule it, don't block reuse. |
| **Train-before-deploy gate enforcement** (`ENFORCE_ASSET_AGENT_GATE`, default-off, `ignition_chat.py:50`) | keep off for the demo unless an asset's identifier shape is proven. |

## Relationship to Phase 5 priority

Ignition is a **deployment/consumption surface** (train-before-deploy doctrine). It should be wired **after** the Hub+MIRA integration (PR-1/PR-2/PR-3), because the Ask-MIRA button's value is only as good as the integrated engine behind it. The HMI itself needs ~no new build — just the button rewire + the VFD-write fence — so it is cheap to light up once the engine carries the `explanation`. **Do not start it as Phase 5's first move** (the prompt's deferral of Ignition stands).
