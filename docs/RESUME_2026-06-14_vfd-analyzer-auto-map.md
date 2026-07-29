# RESUME — VFD Analyzer product + NEXT PHASE: auto-map (tag auto-classification)

**Date:** 2026-06-14 · **Branch:** `docs/plc-1668-feed-resume` (pushed to origin) · **Next phase:** AUTO-MAP

Paste-to-resume context after a context clear. Read this, then the linked plan/specs, then start the
auto-map phase.

---

## Where we are (one paragraph)

The **Maintenance Intelligence panel** is LIVE on the bench Ignition gateway (project `ConvSimpleLive`):
a markdown **anomaly feed** (A0–A12 rules running in-gateway via the `mira_diagnose` project script) +
an **Ask MIRA** popup (→ `:8011/ask`) + an embedded **`:8766` Python-historian trend iframe**. A
**native** Ignition Tag-Historian trend + shared nav bar was tried and **rolled back** ("blank chart +
folder-name header"); it's now being redone correctly (engineering-scaled, multi-plot) in an **isolated
`testing` sandbox project** and is awaiting Mike's live-test. The product framing crystallized: package
this as a sellable **"MIRA VFD Analyzer"** Ignition **Exchange resource** (not a .modl). ~80% of it
exists; the missing ~20% — and the **next phase** — is **AUTO-MAP**: the layer that decouples the
analyzer from the hardcoded `MIRA_IOCheck` tags so it works on ANY drive.

---

## NEXT PHASE — AUTO-MAP (start here)

**Goal:** make the analyzer (trend + decode + anomaly) run on a customer's VFD without hand-editing code.

**The moat:** on install, browse the customer's tags + sample values/datatypes → **AI-classify each tag
into a VFD signal role** (frequency / current / dc_bus / fault_code / comm_ok / run_cmd / estop / …) →
group into a drive archetype → **propose a tag→role map** → user approves → trend + diagnose read from
the approved map. Start **manual** (a Setup mapping page) then **automate** (the AI proposal).

**Two slices (ship the manual one first):**
1. **Setup / tag-mapping view (manual).** A Perspective config page: for each analyzer signal, the
   installer picks their tag + scale + drive family (GS10 / generic). Save to a config tag/dataset.
   **Generalize `mira_diagnose` + `TrendChart` to read the mapped paths** instead of the hardcoded
   `[default]MIRA_IOCheck/VFD/*`. This is the concrete "what makes it standalone" piece.
2. **Auto-classifier (cloud, the moat).** Browse tag set + sample values → classify into signal roles →
   propose the map (high-confidence only; unknowns stay `unknown`, never guessed). Reuses the
   namespace-builder DNA.

**Reuse for auto-map (don't rebuild):**
- Classifier DNA: `mira-bots/shared/uns_resolver.py`, `mira-crawler/ingest/uns.py`,
  `docs/specs/maintenance-namespace-builder-spec.md`, simlab archetype baselines.
- Proposal + approve plumbing: `ai_suggestions` / `relationship_proposals`, Hub `/proposals`,
  train-before-deploy (`asset_agent_status='approved'`).
- The thing being mapped onto: `plc/conv_simple_anomaly/rules_core.py` topic constants (`T_FREQ`,
  `T_CUR`, `T_DCBUS`, `T_FAULT`, `T_COMM`, …) = the canonical signal roles; the current hand map is
  `ignition/webdev/FactoryLM/api/diagnose/tag_topic_map.py` (`LEAF_MAP`). Auto-map GENERATES a per-asset
  version of that map.

**Build it in the `testing` sandbox first** (see Safety below), then PROMOTE.

---

## Product framing (decided 2026-06-14)

- **MIRA VFD Analyzer = Ignition Exchange resource** (no Java/.modl; fast to market). The embedded
  ConvSimpleLive panel is the reference/demo; the Exchange product is the generalized, config-driven
  extraction. Skeleton: `mira-ignition-exchange/` (+ `EXCHANGE_LISTING.md`).
- **Scope v1 = the analyzer BUNDLE** (the differentiator vs Ignition's free Power Chart): scaled trend +
  VFD **fault-code decode** + **anomaly detection**. A bare trend tool would NOT sell (Power Chart is free).
- **Freemium seam:** free/in-gateway/offline = trend + decode + anomaly; **paid (license-gated)** = Ask
  MIRA explanation + more drive families + longer history. Gated by a license-key tag → FactoryLM check.
- **"Module" clarified:** Exchange resource (zip of views+scripts+tags, import-and-go) vs true `.modl`
  (compiled Java, gateway Modules list, platform licensing). We chose Exchange first; `.modl` is a later
  graduation if hard license enforcement is needed.

---

## What's LIVE vs SANDBOX vs ROLLED BACK

- **LIVE (`ConvSimpleLive`, untouched/good):** views `MaintenancePanel` (markdown anomaly feed + `:8766`
  iframe trend), `MiraAsk`, `AnomalyCard` (unused), `Conveyor`, `ConvSimpleLive` home, `AskMira`, `Trends`
  (`:8766` iframe). Routes `/ /conveyor /maintenance /trends /AskMira`. Script lib `mira_diagnose`.
- **SANDBOX (`testing`, standalone project, at `/data/perspective/client/testing`):** scaled native
  `TrendChart` (`ia.chart.timeseries` + binding **script transform** scaling raw→Hz/A/V, 3 auto-scaling
  plots: Setpoint/Output Hz, Current A, DC Bus V). **Awaiting Mike's live-test.** If approved → PROMOTE
  to ConvSimpleLive.
- **ROLLED BACK (in git history `59a5d240`, reverted `077e257c`):** the live native-trend + nav-bar deploy.
  Cherry-pick-able if revisited; fix the scaling/header issues first (now done in the sandbox version).

---

## Safety / workflow (FOLLOW THIS)

- **GitHub:** branch pushed. **Save-point tag: `convsimplelive-known-good-2026-06-14`** (the live good
  state). Repo rollback: `git checkout <tag> -- plc/ignition-project/ConvSimpleLive`.
- **Sandbox-first rule** (Mike, 2026-06-14, memory `feedback_ignition_sandbox_workflow`): new Perspective
  views go to the standalone **`testing`** project first, live-test, then promote. Docs:
  `plc/ignition-project/testing/SANDBOX_WORKFLOW.md`. Deploy `testing/DEPLOY_TESTING.ps1`; promote
  `testing/PROMOTE.ps1 -View <Name>`; live rollback `…/ConvSimpleLive/rollback/ROLLBACK.ps1`.
- **⚠️ Elevation:** all gateway deploys stop/start the Ignition service and need admin. The Claude session
  shell is non-elevated, and a permission rule now **BLOCKS triggering elevated PowerShell from Bash** —
  so **Mike must run the deploy scripts himself** in an Administrator PowerShell. Hand him the exact
  command; don't try to auto-fire UAC.

---

## Key gateway facts (verified)

- Ignition **8.3.4**, system name `Ignition-LAPTOP-0KA3C70H`, bench laptop. Projects at
  `C:\Program Files\Inductive Automation\Ignition\data\projects\`. Live tags `[default]MIRA_IOCheck/…`.
- **WebDev module NOT installed** → use Perspective project scripts (`runScript`), not the
  `/api/diagnose` WebDev endpoint (404). Modules present: Perspective, OPC-UA, Modbus, Micro800, Historian.
- **Native Tag History IS configured** (datasource+provider `Sample_SQLite_Database`, SqlHistorian,
  actively recording). Enable per-tag via `historyEnabled/historyProvider` in the tag-definition
  `tags.json` (file-deployable). Only the 4 ANALOG tags exist live: `vfd_frequency, vfd_freq_sp,
  vfd_current, vfd_dc_bus` (NO torque/rpm/power — that was repo drift). Power Chart history path:
  `histprov:Sample_SQLite_Database:/drv:Ignition-LAPTOP-0KA3C70H:default`. Chart types:
  `ia.chart.timeseries`, `ia.chart.powerchart`.
- Bench Python historian `trend_historian.py` on `:8766` (does NOT auto-reconnect; restart after a PLC
  unplug). Ask MIRA cloud `:8011/ask` over Tailscale.

## Reuse map (don't rebuild)
- Rules + GS10 decode: `plc/conv_simple_anomaly/rules_core.py` (A0–A12, `GS10_FAULT_CODES`); vendored to
  `ignition/webdev/FactoryLM/api/diagnose/diagnose_core.py` + the script libs (parity-guarded by
  `tests/regime7_ignition/test_diagnose_parity.py`, 44 green).
- Diagnose seam (live): `plc/ignition-project/ConvSimpleLive/ignition/script-python/mira_diagnose/`.
- Scaled native trend (sandbox): `plc/ignition-project/testing/…/views/TrendChart/view.json`.
- Exchange skeleton + listing: `mira-ignition-exchange/`.
- Ask MIRA chat view: `mira-ignition-exchange/…/MIRA/ChatDock` and live `ConvSimpleLive/…/AskMira`.
- Plans: `~/.claude/plans/yes-map-the-path-warm-wadler.md` (Phase 3 = auto-classify = this phase),
  `docs/RESUME_2026-06-14_maintenance-intelligence-module.md` (prior phase).

## Verify regression any time
`python -m pytest tests/regime7_ignition/ -q` (44) · `cd plc/conv_simple_anomaly && python -m pytest test_rules.py -q` (27)
