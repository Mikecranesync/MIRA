# Page-Config Bootstrap (2026-06-01)

## What this is

Adds URL-routable Perspective pages to the `ConveyorMIRA` Ignition project so
each view in `com.inductiveautomation.perspective/views/` is reachable via a
direct URL on the gateway, instead of returning "View Not Found".

## Before this commit

`http://<gateway>:8088/data/perspective/client/ConveyorMIRA` returned:

> **View Not Found** — No view configured for this page

Reason: the repo deployed 8 Perspective views (NavBar, SpeedControl, FaultLog,
ConveyorStatus, Mira/MiraPanel, Mira/MiraAlertHistory, Mira/MiraSettings,
Mira/ConnectSetup) but no `page-config/config.json` mapping URLs → views.

Discovered 2026-06-01 from CHARLIE while capturing live screenshots during a
2-hour Ignition trial window. Confirmed via `http://100.72.2.99:8088/StatusPing`
RUNNING + Playwright snapshots.

## URL routes added

| URL | View | Notes |
|-----|------|-------|
| `/` | `ConveyorStatus` | Default page — root of the project |
| `/status` | `ConveyorStatus` | Explicit alias |
| `/speed` | `SpeedControl` | VFD speed setpoint |
| `/faults` | `FaultLog` | Active + historical faults |
| `/mira` | `Mira/MiraPanel` | Chat assistant — `assetId=conveyor_demo` |
| `/mira/alerts` | `Mira/MiraAlertHistory` | Alert history |
| `/mira/settings` | `Mira/MiraSettings` | Mira configuration |
| `/mira/connect` | `Mira/ConnectSetup` | MIRA Connect onboarding |

`NavBar` is intentionally not exposed as a top-level URL — it's an embedded
header/dock view, not a standalone page.

## How to deploy

The gateway lives on the Windows PLC laptop. From CHARLIE we can ship into
the repo and let the existing PowerShell deploy push the files. On the PLC
laptop:

```powershell
cd C:\Users\hharp\Documents\GitHub\MIRA
git pull origin <branch>
PowerShell -ExecutionPolicy Bypass -File ignition\deploy_ignition.ps1
```

`deploy_ignition.ps1` does:

1. Copies `ignition/project/` → `<IgnitionDataDir>/projects/ConveyorMIRA/` —
   includes the new `com.inductiveautomation.perspective/page-config/` dir.
2. POSTs `/data/projects/scan` (Basic Auth admin:password) — triggers gateway
   rescan; pages register within ~15 s.

## Verify

After redeploy, from CHARLIE:

```bash
python3 /tmp/capture_perspective2.py
# Should now capture LIVE-rendered views at:
#   http://100.72.2.99:8088/data/perspective/client/ConveyorMIRA/
#   .../status .../speed .../faults .../mira  etc.
```

Screenshots land in `docs/promo-screenshots/2026-05-31_conveyor-mira-*-LIVE_*.png`.

## Known follow-up: view-resource layout

The main repo's view directories (`views/<Name>/resource.json`) contain view
CONTENT (custom/params/props/root) under the filename `resource.json`. Modern
Ignition 8.1.x stores views as:

```
views/<Name>/
├── resource.json   # metadata: {"scope":"G","version":1,"files":["view.json"]}
└── view.json       # actual view content
```

The `mira-ignition-exchange/` directory uses the modern layout correctly. If
the views still show "View Not Found" *after* this page-config lands, the
view-resource layout is also broken and needs a layout-fix follow-up
(rename `resource.json` → `view.json`, add a fresh metadata `resource.json`).
We did NOT preemptively fix this because the malformed layout may currently
be what the deployed gateway expects.

## What this does NOT fix

- **Mira_tags** and **ConvSimpleLive** — not in this repo. Mike built those
  in Designer on the PLC laptop. To programmatically add page-config for them
  too, we'd need to either get the projects into this repo or have remote
  file/Designer access to the gateway box.
- **WebDev `FactoryLM/api/*` endpoints** — return 404 on the gateway today,
  meaning that whole `ignition/webdev/` folder was never deployed. The PowerShell
  deploy DOES include this step; it just hasn't been run recently. Same redeploy
  command above lights up both.
