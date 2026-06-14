# Live-test runbook — VFD Analyzer auto-map Slice 1 (Mike runs this)

**Branch:** `feat/vfd-analyzer-auto-map` (PR #1974) · **Spec:** `docs/specs/vfd-analyzer-auto-map-spec.md`
**What you're proving:** the analyzer now reads a per-asset **tag→role map** instead of hardcoded tags —
configured visually in a **click-to-map** page — and the live conveyor still behaves identically.

> **Why you have to run it:** every gateway deploy stops/starts the Ignition service and needs admin.
> The Claude session is non-elevated and blocked from triggering UAC, so the elevated steps are yours.

## Safety — the live project is NOT touched
- `DEPLOY_TESTING.ps1` rebuilds only the **`testing`** sandbox project and pulls the script libs into
  **testing** (not ConvSimpleLive). The live `ConvSimpleLive` project on the gateway keeps its current
  `mira_diagnose` until you separately `PROMOTE`. So this test cannot change the live panel.
- The config tag is new and global; only the **new** (sandbox) code reads it. The live panel passes no
  `asset`, so it stays on the legacy `LEAF_MAP` path — byte-identical behaviour.
- Save point still in place: tag `convsimplelive-known-good-2026-06-14`.

## 0. Get the branch (non-elevated shell is fine)
```bash
cd C:\Users\hharp\Documents\GitHub\MIRA
git fetch origin
git checkout feat/vfd-analyzer-auto-map
```

## 1. Deploy the sandbox  (Administrator PowerShell)
```powershell
C:\Users\hharp\Documents\GitHub\MIRA\plc\ignition-project\testing\DEPLOY_TESTING.ps1
```
This pulls the new `mira_diagnose` + `mira_asset_config` + `mira_signal_roles` + `mira_setup` libs and the
`TagMapper` / `MaintenanceConfig` views into the sandbox, then restarts the service (~30 s).

## 2. Click-to-map the conveyor  →  open the setup page
`http://localhost:8088/data/perspective/client/testing/setup`

For each **required** role (the gate pill turns green when all 3 are mapped), and any recommended ones:

| Role | Browse folder | Pick tag | Scale | Live preview should read |
|---|---|---|---|---|
| Output frequency | `[default]MIRA_IOCheck/VFD` | `vfd_frequency` | 100 | `= <Hz> Hz (good)` |
| Output current | `[default]MIRA_IOCheck/VFD` | `vfd_current` | 100 | `= <A> A (good)` |
| Fault code | `[default]MIRA_IOCheck/VFD` | `vfd_fault_code` | (ignored) | `= 0 (good)` |
| DC-bus voltage *(rec)* | `[default]MIRA_IOCheck/VFD` | `vfd_dc_bus` | 10 | `= ~320 V (good)` |
| Freq setpoint *(rec)* | `[default]MIRA_IOCheck/VFD` | `vfd_freq_cmd` | 100 | `= <Hz> Hz (good)` |
| Drive comm OK *(rec)* | `[default]MIRA_IOCheck/VFD` | `vfd_comm_ok` | (ignored) | `= True (good)` |
| Command word *(rec)* | `[default]MIRA_IOCheck/VFD` | `vfd_cmd_word` | (ignored) | `= <int> (good)` |

For each: pick role → set folder → pick tag → set scale → **watch the live preview** → **Set this role**.
The status line confirms each save; the **map table** below updates live. The gate pill should reach
**"3 of 3 required roles mapped — ready"** (green).

> **Faster alternative (skip hand-mapping):** in the Designer Tag Browser, right-click the `default`
> provider → **Import Tags** → choose `ignition/tags/mira_config_conveyor.json`. That drops in the
> pre-built `conveyor` map (the 8 VFD roles). Then go straight to step 3.

## 3. Confirm the config-driven panel  →  open the maintenance page
`http://localhost:8088/data/perspective/client/testing/maintenance`

- It should show the **same state** (RUNNING / STOPPED / FAULT + the same anomaly cards) as the live
  ConvSimpleLive Maintenance panel for the same conveyor condition.
- **Induce a fault** from the bench runbook (e.g. pull the e-stop, or a GS10 fault) → the card should
  appear here just like on the live panel. Tap **Ask MIRA about the active fault** → the popup seeds with
  the fault context.

## 4. Prove the moat (optional, the real differentiator)
Map a role to a **different** tag (e.g. point Output frequency at `vfd_freq_sp` or any other live numeric
tag) on `/setup`, Set it, and watch `/maintenance` + the preview follow the new tag — **no code edit**.
That's "runs on any drive's tags." Put it back to `vfd_frequency` when done.

## 5. Report back
- ✅ / ❌ gate reaches "ready" after mapping the 3 required roles.
- ✅ / ❌ `/maintenance` matches the live panel state (and a fault shows on both).
- ✅ / ❌ live previews show good quality + sane scaled values.
- Any console errors (F12) or `FactoryLM.Mira.Setup` / `FactoryLM.Mira.MaintConfig` warnings in
  `logs/wrapper.log`.

**Do NOT `PROMOTE` yet** — promotion to the live ConvSimpleLive project happens only after this passes.

## Known limits (expected, not bugs)
- The **trend** chart (`/`) is still the hardcoded sandbox version — generalizing its binding to the
  config map is the next change in this phase (spec §5), intentionally not in this PR.
- `TagMapper` editing + `mira_setup`/`mira_diagnose` config path are **new gateway code that can't run in
  CI** — this live test is their first real execution. The pure logic (`asset_config`/`signal_roles`) and
  the no-regression guard are CI-green; the system.* I/O + view bindings are what you're validating here.
