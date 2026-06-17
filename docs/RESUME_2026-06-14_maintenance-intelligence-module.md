# RESUME — MIRA Maintenance Intelligence Module (bench → installable SCADA module)

**Date:** 2026-06-14 · **Branch:** docs/plc-1668-feed-resume · **Status:** Phase 1 DONE, Phase 2 next.

Paste-to-resume context for a fresh session. Read this, then the approved plan, then continue at Phase 2.

---

## What we're building (the unique product)

**A self-onboarding Maintenance Intelligence module** for Ignition (then any SCADA): install it,
it **auto-detects the connection, reads whatever tags exist, AI-classifies them into equipment,
you approve, and then trends + live fault detection + grounded Ask-MIRA light up on every machine.**
The moat = the self-sorting install (MIRA's UNS namespace-builder pointed at live SCADA tags).
The hook = a panel that **detects a fault AND explains it from the customer's own manuals**
(anomaly card → one-tap grounded Ask MIRA). No Ignition Exchange module does this.

**Approved plan (full):** `C:/Users/hharp/.claude/plans/yes-map-the-path-warm-wadler.md`
**Toward-GTM proving plan:** `docs/plans/2026-06-14-proving-test-case-plan.md`

**Locked decisions:** (1) auto-classify-then-approve onboarding; (2) Ignition-first, OPC-UA later,
auto-detect the source; (3) **free** = detection + trends (in-gateway, offline); **paid** = grounded
Ask MIRA (cloud RAG over the customer's manuals).

---

## How we got here (one paragraph)

The GS10 conveyor bench got `Conv_Simple_2.1` flashed (program baked into the project; no manual
paste) — torque/rpm/power/fault telemetry is now LIVE and validated (rpm 878 = keypad 880; freq cmd
vs output 1:1). Built bench tooling (`live_capture.py`, `verify_v2_telemetry.py`, fixed `live_check.py`
to read the V2.1 status block + tolerate the unmapped di05 coil), the anomaly runbook PDFs, the
`plc-ccw-deploy` skill, and the proving-test-case plan. Then Mike asked to turn the Ignition panel
(which already has Ask MIRA + a trend tab) into an installable, sellable, any-SCADA module → the plan
above → Phase 1 built.

---

## Phase 1 — DONE (commit `83ea8e81`): in-gateway anomaly diagnose seam

The A0–A12 rules now run **inside Ignition on a live tag snapshot** — offline, no cloud, no API key.
- `plc/conv_simple_anomaly/rules_core.py` — the 12 rules as a **dual Python 2.7 + 3.12-clean core**
  (no f-strings/annotations/dataclass; plain `Anomaly` w/ `to_dict()`; ASCII-only). `rules.py` is now
  a thin shim → bench unchanged (existing `test_rules.py`: 27 pass).
- `ignition/webdev/FactoryLM/api/diagnose/` — `doGet.py` (Jython `GET /api/diagnose?asset=` reads
  allowlisted tags, maps→snap, runs the rules, returns anomaly cards JSON; read-only, fail-closed),
  `tag_topic_map.py` (real `[default]Conveyor/` + `MIRA_IOCheck/VFD/` names + scaling),
  `diagnose_core.py` (rules_core vendored **byte-identical** — gateway can't reach plc/).
- `tests/regime7_ignition/{test_diagnose_parity,test_diagnose_endpoint}.py` — 23 new tests
  (per-rule goldens + healthy-silent + **byte-identity drift guard** + endpoint plumbing). All green;
  full regime7 = 41 pass.

Stateless endpoint covers the **non-temporal** rules (A0,A1,A2,A3,A4,A5,A8,A9,A12) = exactly the
bench runbook faults. Time-based A6/A7/A10 await a **stateful poller** (Phase 4).

---

## ⚠️ Key infra findings (read before deploying anything)

- **The Ignition WebDev module is NOT installed on this gateway** (modules present: Perspective,
  OPC-UA, Modbus, Micro800, Historian, … — no WebDev). So `/system/webdev/FactoryLM/api/diagnose`
  (and the existing chat/mira endpoints) return **404**. The HTTP endpoint can't be curl'd until the
  WebDev module is installed (open Linear `CRA-245`). The endpoint is built + tested, ready for then.
- **Perspective IS installed** → **Phase 2 does NOT need WebDev.** Run `diagnose_core` as a Perspective
  **project script** (project script libraries need only Perspective) and bind the panel to it directly
  (no HTTP hop). This is the design's R1/R2 fallback and it unblocks the whole panel on this gateway.
- **Engine identity proven:** `live_check.py` runs the SAME `rules_core` the endpoint serves. Verify
  Phase 1 LIVE today (no WebDev): `python plc/conv_simple_anomaly/live_check.py --host 192.168.1.100
  --secs 6` while inducing a runbook fault (pull e-stop→A3, both dirs→A4, unplug RS-485→A1).
- Gateway projects on disk: `ConvSimpleLive` (the live one), `ConveyorMIRA`, etc.
  Historian: `plc/conv_simple_anomaly/trend_historian.py` on :8766 (bench; restart after any
  Ethernet/Modbus unplug — does NOT auto-reconnect; watch for duplicate pollers). PLC: 192.168.1.100:502.

---

## Phase 2 — BUILT (file-only; awaits bench deploy + screenshot)

The panel is built in the **live `ConvSimpleLive` project** (`plc/ignition-project/ConvSimpleLive/`):
- Views: `MaintenancePanel/` (state header + Flex Repeater of `AnomalyCard` + trend iframe), `AnomalyCard/`
  (severity + cause + next check + **Ask MIRA about this** → `openPopup`), `MiraAsk/` (seeded popup → the
  same `:8011/ask` contract as the live native `AskMira`). Page route `/maintenance` added.
- Diagnose source (NO WebDev): project script lib `ignition/script-python/{mira_diagnose_core,mira_tag_map,
  mira_diagnose}/` — `runScript("mira_diagnose.cards_json"/"header_*", pollMs, tagFolders)`. `mira_diagnose_core`
  + `mira_tag_map` are **byte-identical vendored copies** (parity-guarded; regime7 41→44 green). Reads are
  bounded to `LEAF_MAP` leaves, read-only.
- **Deploy + screenshot = manual bench step:** `plc/ignition-project/ConvSimpleLive/DEPLOY_MAINTENANCE_PANEL.md`.
- Adaptations from the original sketch below (forced by live reality): WebDev is absent → project-script path;
  the live `AskMira` is Perspective-native (no `?asset&alarm` iframe seam) → a param-seeded `MiraAsk` popup.

Original Phase-2 design sketch (still the intent):
Build a `MaintenancePanel` Perspective view (params: tagFolder, assetId, archetype, pollMs):
- **State header** (3-second test: running/faulted/stopped + why).
- **Anomaly feed** — Flex Repeater of `AnomalyCard` sub-views from the diagnose script; each card =
  severity + cause + next check + **"Ask MIRA about this"** button.
- **Embedded trend** — reuse `Trends/TrendPanel`.
- **Ask MIRA** — reuse `Mira/MiraPanel`; the button rewrites the iframe `source` to
  `mira?asset=<asset>&alarm=<fault>` (doGet.py already accepts `?asset`+`?alarm` — confirmed).
- **Diagnose source:** a Perspective project-library script (`scripts/mira_diagnose.py` style) that
  imports the rule logic + tag map and runs `evaluate` on a live `system.tag.readBlocking` snapshot —
  NO WebDev needed. Keep it byte-synced with `rules_core.py` (extend the parity test).
- **Proof:** drop the panel on the Conv_Simple Perspective, induce a fault, tap "Ask MIRA about this".
  Screenshot → `docs/promo-screenshots/`.

Then Phase 3 (auto-classify self-onboarding — the moat), Phase 4 (stateful poller for A6/A7/A10 +
trend `ignitionAdapter.js` to cut the bench-historian dep), Phase 5 (package `mira-ignition-exchange/`).

---

## Reuse map (don't rebuild)
- Rules: `plc/conv_simple_anomaly/rules_core.py` (+ vendored `…/api/diagnose/diagnose_core.py`)
- Ask MIRA deep-link: `ignition/webdev/FactoryLM/mira/doGet.py` (`?asset`+`?alarm`)
- Allowlist + dual-importable pattern: `ignition/webdev/FactoryLM/api/tags/allowlist.py`
- Trend viewer + adapters: `mira-trend-viewer/`
- Cloud brain: `mira-pipeline/ignition_chat.py` · tag ingest: `mira-relay/tag_ingest.py`
- Classifier DNA (Phase 3): `mira-bots/shared/uns_resolver.py`, `mira-crawler/ingest/uns.py`,
  `docs/specs/maintenance-namespace-builder-spec.md`, simlab archetype baselines
- Approval gate: train-before-deploy (`asset_agent_status`), Hub `/proposals`

## Verify regression any time
`python -m pytest tests/regime7_ignition/ -q` (41) · `cd plc/conv_simple_anomaly && python -m pytest test_rules.py -q` (27)
