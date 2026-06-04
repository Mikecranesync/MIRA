# MIRA × Ignition 8.3 — Alignment Plan

**Status:** ACTIVE (living document) · **Authored:** 2026-06-04 · **Owner:** Mike Harper

This is the canonical decision record for bringing MIRA into alignment with the Ignition 8.3
advanced development model, so the platform becomes a strong base for agent-assisted development
of Ignition modules, Perspective views, Gateway resources, and maintenance-intelligence workflows.

It pairs with [`docs/architecture/mira-ignition-module-architecture.md`](./architecture/mira-ignition-module-architecture.md)
(target architecture) and [`docs/agent-workflows/ignition-resource-development.md`](./agent-workflows/ignition-resource-development.md)
(how agents develop + PR Ignition resources). The full 9-sub-agent assessment with per-file evidence
lives in the PLC repo at `MIRA_PLC/specs/IGNITION_8.3_ALIGNMENT.md` (+ `_REVIEW.md`).

> **Mental model** (see [`docs/THEORY_OF_OPERATIONS.md`](./THEORY_OF_OPERATIONS.md)):
> Slack/Telegram = front door · MIRA engine = brain · UNS/MQTT = nervous system ·
> KG + component templates = memory · **Ignition 8.3 = the industrial integration surface.**

---

## What this accomplishes (plain English)

The PLC-bench side of MIRA already manages Ignition as version-controlled files and deploys them
safely. The product/monorepo side has strong CI, a hardened backend "confirm-before-troubleshoot"
gate, and a knowledge graph — **but the Ignition integration surface is thin**: no reusable
Perspective widgets, the confirmation gate is invisible in the HMI, and there is no repeatable
(containerized) Ignition environment for CI or training. This plan closes those gaps in eight
incremental phases, reusing what already works rather than rewriting it.

---

## Current-state scorecard (0 = absent · 5 = excellent / agent-ready)

| # | Area | Score | Where the repo sits today |
|---|------|:----:|---------------------------|
| 1 | File-based Gateway config in Git | **4** | `MIRA_PLC/ignition/ConvSimpleLive/` (views/tags/rollbacks + deploy scripts), monorepo `ignition/{project,webdev,gateway-scripts,tags,config,db}` |
| 2 | Agent-friendly Git/CI | **4** | 7 workflows, PR template, dependabot; **gaps:** no CODEOWNERS, no JSON-lint gate for `view.json`/`tags.json` |
| 3 | Deployment modes | **3** | 10 `docker-compose*.yml`; **gaps:** no sim/expo/training modes, no containerized Ignition, doppler defaults to `prd` |
| 4 | Ignition REST / OpenAPI integration | **3** | `ignition/webdev/FactoryLM/api/**`, `mira-mcp`, `mira-pipeline/ignition_chat.py`; **gap:** no `IgnitionGatewayClient`, no resource-sync |
| 5 | Containers / repeatable Ignition env | **3** | All services Dockerized + Trivy-scanned; **gap:** no containerized Ignition gateway for QA/training |
| 6 | SVG / HMI visualization | **2** | Raster PNG + pixel-positioned label overlays only; **gap:** no SVG mimic, no reusable widget kit |
| 7 | UNS confirmation gate **in Perspective** | **2** | Backend gate is live (`mira-bots/shared/engine.py`); **gap:** invisible in AskMira (renders as raw markdown) |
| 8 | Event-driven design / Event Streams | **2** | Gateway scripts + `tag_events`/`tag_event_diffs`; **gap:** no native 8.3 Event Streams, no alarm→MIRA binding |
| 9 | Secrets management | **3** | Doppler + `.env.template`; **gaps:** empty `X-Mira-Key` committed in AskMira, weak demo passwords in template |
| 10 | Ignition SDK / custom module | **2** | Jython WebDev + Exchange views; **no Java/Gradle module** (intentional — ADR-0021 = Jython-first, JAR-later) |
| 11 | Offline / mobile technician | **1** | Viewport meta only; **gap:** no offline capture, no QR entry, silent failure on disconnect |
| 12 | OPC-UA roles / read-only safety | **3** | Read-only VFD tags + fail-closed allowlist; **gap:** un-gated `system.tag.writeBlocking` in SpeedControl/FaultLog |
| 13 | Historian / time-series troubleshooting | **3** | Diff logger + anomaly rules exist; **gap:** historian not enabled on VFD tags, no running scheduler |

**Strongest:** file-based config (1) + agent-friendly CI (2). **Weakest:** offline/mobile (1),
Perspective viz (6), UNS-gate-in-Perspective (7), event streams (8), module SDK (10).

### Verified corrections to the raw audit (checked against real files 2026-06-04)
The sub-agent report contained a few stale claims; ground-truth:
- ✅ `ignition/project/approved_tags.json` **EXISTS** and is populated (the audit's "biggest gap:
  file absent → allowlist 503" was **wrong**). `allowlist.py`'s repo-dev fallback resolves to
  `ignition/project/approved_tags.json` — confirmed.
- ✅ `ignition/README.md` and `docs/THEORY_OF_OPERATIONS.md` **already exist** (audit said create them).
- ✅ VFD tag-definition has **10** tags (not 9): adds `vfd_run_permit`.
- ⚠️ **Real residual gap:** `MIRA_PLC/ignition/ConvSimpleLive/views/AskMira/view.json` hard-codes
  12 `[default]MIRA_IOCheck/...` reads that **bypass the allowlist**, and the script's provider/folder
  `MIRA_IOCheck` differs from the tag-definition's `[MIRA_PLC]` provider → silent null-quality reads
  if folder names drift. This PR extends the allowlist to cover those paths; fixing the AskMira
  script to call the allowlisted endpoint is Phase 3.

---

## Phased plan (summary — full tasks/files/acceptance in the architecture doc + PLC specs)

| Phase | Goal | Headline acceptance |
|-------|------|---------------------|
| 1 | Repo alignment + starter project + this doc set | All `view.json` JSON-lint clean; starter project + deployment-modes scaffold exist; this doc merged |
| 2 | Agent-friendly Git/CI + resource validation | CODEOWNERS on `ignition/**`; a malformed `view.json` is caught in CI before merge |
| 3 | Perspective UI kit + conveyor widgets + **UNS gate panel** | Reusable VFD/sensor/status widgets; AskMira renders the gate as a Yes/No confirmation panel, not raw text |
| 4 | Event-driven Gateway integration | An Ignition alarm produces an `agent_events` row; `uns_context_confirmed` emitted on confirm |
| 5 | OpenAPI resource sync + approval gates | `IgnitionGatewayClient` reads resources; proposed view diffs route through `mira-hub` queue; writes gated off by default |
| 6 | Custom module foundation | `system.mira.ask()` callable via a project script library (no JAR yet, per ADR-0021) |
| 7 | Historian / anomaly / fault reasoning | VFD historian enabled; diagnosis prompt includes time-series fault evidence |
| 8 | Marketplace / customer deployment packaging | Clean machine runs the Ignition demo without the physical PLC laptop |

**Sequencing guardrail (from review):** ship Phase 2's JSON-lint CI gate **before** Phase 3 edits
any `view.json` against a live gateway, so a broken view can't reach the bench without a CI catch.

---

## Hard rules (non-negotiable)

1. **Confirm-before-troubleshoot.** MIRA must resolve + confirm the technician's UNS/asset context
   before troubleshooting. The backend gate already enforces this (`engine.py` `_should_fire_uns_gate`,
   `AWAITING_UNS_CONFIRMATION`, `MIRA_UNS_GATE_ENABLED`, plus a direct-connection carve-out). **Do not
   rebuild it** — Phase 3 only *surfaces* it in Perspective.
2. **Read-only first.** MIRA starts read-only and only *proposes* writes; control-tag writes require an
   explicit approval gate (Phase 5) and a Security Level. Never widen write access by default.
3. **No secrets in resources.** Never commit a literal or empty credential into a `view.json`, Perspective
   script, gateway script, doc, or module. Secrets come from Doppler → `system.secret.get()` → tag fallback.
4. **Config-as-files only.** Deploy by stopping the service, writing files, restarting — **never** the
   Gateway web-UI Project Import (it corrupts 8.3.x projects: files become directories).
