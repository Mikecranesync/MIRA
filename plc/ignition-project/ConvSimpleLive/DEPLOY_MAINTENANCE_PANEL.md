# Deploy — Maintenance Intelligence Panel (Phase 2)

The self-onboarding module's **detect → explain** panel for Conv_Simple. Runs the A0–A12 anomaly
rules **in-gateway via a Perspective project script** (no WebDev module needed) and one-taps a
grounded **Ask MIRA** per fault. Free wedge = detection + trends (offline); paid = Ask MIRA (cloud).

> Built file-only on branch `docs/plc-1668-feed-resume`. This runbook is the manual bench step:
> deploy to the live `ConvSimpleLive` gateway, induce a fault, screenshot.

## What ships

| Repo path (under `plc/ignition-project/ConvSimpleLive/`) | Gateway path (under `…/data/projects/ConvSimpleLive/`) |
|---|---|
| `ignition/script-python/mira_diagnose_core/` | same — vendored rule core (== `plc/conv_simple_anomaly/rules_core.py`) |
| `ignition/script-python/mira_tag_map/` | same — vendored tag→topic map (== WebDev `tag_topic_map.py`) |
| `ignition/script-python/mira_diagnose/` | same — Jython glue: read→snap→evaluate→cards+state (TTL-cached) |
| `com.inductiveautomation.perspective/views/MaintenancePanel/` | same — state header + anomaly feed (Flex Repeater) + trend iframe |
| `com.inductiveautomation.perspective/views/AnomalyCard/` | same — one card: severity + cause + next check + **Ask MIRA about this** |
| `com.inductiveautomation.perspective/views/MiraAsk/` | same — seeded Ask-MIRA popup → `:8011/ask` (same contract as live `AskMira`) |
| `com.inductiveautomation.perspective/page-config/config.json` | **merge** the `/maintenance` route into the live config (which also has `/AskMira`, `/trends`) |

Reads are **bounded + read-only**: the script only reads `<folder>/<leaf>` for leaves in
`mira_tag_map.LEAF_MAP` (the map IS the allowlist) via `system.tag.readBlocking` — never browses,
never writes (`.claude/rules/fieldbus-readonly.md`).

## Deploy (stop-service → write files → start-service — NEVER web-UI Project Import)

```powershell
# Reference: docs/agent-workflows/ignition-resource-development.md "golden rules"
$GW = "C:\Program Files\Inductive Automation\Ignition\data\projects\ConvSimpleLive"
$REPO = "C:\Users\hharp\Documents\GitHub\MIRA\plc\ignition-project\ConvSimpleLive"

Stop-Service Ignition
# 1) project script library (3 modules)
Copy-Item "$REPO\ignition\script-python\*" "$GW\ignition\script-python\" -Recurse -Force
# 2) the three Perspective views
Copy-Item "$REPO\com.inductiveautomation.perspective\views\MaintenancePanel" "$GW\com.inductiveautomation.perspective\views\" -Recurse -Force
Copy-Item "$REPO\com.inductiveautomation.perspective\views\AnomalyCard"      "$GW\com.inductiveautomation.perspective\views\" -Recurse -Force
Copy-Item "$REPO\com.inductiveautomation.perspective\views\MiraAsk"          "$GW\com.inductiveautomation.perspective\views\" -Recurse -Force
# 3) page route — MERGE the /maintenance entry into the live config.json (don't clobber /AskMira, /trends)
#    edit $GW\com.inductiveautomation.perspective\page-config\config.json by hand, add:
#      "/maintenance": { "title": "Maintenance Intelligence", "viewPath": "MaintenancePanel", "docks": {} }
Start-Service Ignition
```

## Verify (3-minute bench proof)

1. Open `http://localhost:8088/data/perspective/client/ConvSimpleLive/maintenance` (adjust host/port).
2. **Idle:** header shows **RUNNING** (green) or **STOPPED** (gray); feed shows "✓ No active anomalies".
3. **Induce a runbook fault** (see `plc/conv_simple_anomaly/` next-5 runbook):
   - Pull the e-stop → **A3_ESTOP_WIRING** card (and/or A5).
   - Command both directions → **A4_DIRECTION_FAULT**.
   - Unplug RS-485 → **A1_COMM_STALE** / **COMMS LOST**.
   - Trigger a GS10 trip → **A2_VFD_FAULT** with the decoded code.
4. Header flips to **FAULT** (red) with the top fault; the matching **AnomalyCard** appears (severity +
   cause + next check).
5. Tap **Ask MIRA about this** → the `MiraAsk` popup opens pre-seeded with the fault question and posts
   to `:8011/ask`; confirm a grounded GS10-manual answer.
6. **Screenshot** the panel mid-fault + the Ask-MIRA answer → save BOTH to `docs/promo-screenshots/`
   (`2026-06-14_maintenance-panel_detect-explain_desktop.png`, mobile variant). Screenshot Rule.

## Notes / gotchas
- **WebDev not installed** on this gateway → the `/api/diagnose` endpoint 404s; the panel deliberately
  uses the project-script path instead. When CRA-245 installs WebDev, the endpoint and panel agree
  (same rule core, parity-guarded).
- **Trend iframe** points at the bench historian `http://127.0.0.1:8766/viewer/index.html?source=historian`
  (override via the `trendUrl` param). If the historian is stopped it renders blank — detection still works.
- **Ask MIRA** needs the cloud `:8011/ask` reachable over Tailscale; detection + trends work offline
  without it (the free wedge).
- Drift guard: editing `rules_core.py` or the WebDev `tag_topic_map.py` without re-copying the script
  modules fails `tests/regime7_ignition/test_diagnose_parity.py`. Re-sync per the failure message.
