# NorthwindBottling — Discharge Conveyor CV-200 (Perspective)

**What this is (plain English):** an Ignition Perspective project that shows the **real**
Discharge Conveyor **CV-200** (Allen-Bradley Micro820 + AutomationDirect GS10 VFD) as a live asset
on the **Northwind Beverage** bottling demo — Riverside Plant / Packaging / Line 1. It is a faithful
**clone of `ConvSimpleLive`** (same live bindings to the real rig), re-branded and framed for Northwind,
shaped to mirror the **Prove It 2026** Area HMI pattern. Built as **Phase 1** of
`specs/NORTHWIND_BOTTLING_PROVEIT_MIRROR.md` (in the MIRA_PLC repo), stacked on **PR #2362**.

## The one hard rule honored (PR #2362 handoff §1)
This **ADDS** a Northwind surface; it does **NOT repoint** the garage `ConvSimpleLive` demo. Same
physical rig, same source tag paths — the Northwind identity lives in this project's labels + the
Ask-MIRA `asset_context`, and (cloud-side, follow-up) in per-tenant `approved_tags` / ingest / display
rows. The garage project is unchanged. **Read-only** — the view displays and asks; it never writes.

## Pages (config-as-files)
| Route | View | Purpose |
|---|---|---|
| `/` | `ConvSimpleLive` | CV-200 control & status (lamps, selector, e-stop, MLC, VFD card) |
| `/conveyor` | `Conveyor` | Live conveyor HMI (belt mimic, direction, GS10 drive telemetry) |
| `/maintenance` | `MaintenancePanel` | In-gateway anomaly feed (A0–A12) + live trends + Ask-MIRA |

`MiraAsk` is the embedded Ask-MIRA panel; `AnomalyCard` is the per-anomaly card template.

## Live bindings (preserved exactly from the real rig)
All `[default]` provider, `MIRA_IOCheck` tag tree — VFD (`vfd_frequency`, `vfd_current`, `vfd_dc_bus`,
`vfd_cmd_word`, `vfd_status_word`, `vfd_fault_code`, `vfd_comm_ok`, `pe_latched`, …), Inputs
(`DI_00 FWD`, `DI_01 REV`, `DI_02 e-stop`, `DI_04 start`, `DI_05 photo-eye`), Outputs
(`DO_00 green`, `DO_01 red`, `DO_02 drive/MLC`, `DO_03 amber`), plus `[default]Conveyor/*`.
These are the same paths the garage uses (one rig, two tenants) — see handoff §5a.

## Ask-MIRA (handoff §8)
`MiraAsk` now sends CV-200 `asset_context` (`equipment=discharge_conveyor_cv200`, `line1`,
`packaging`, `riverside`) + `asset_id=20000000-0002-0000-0000-000000000007`, so the turn is
**UNS-certified** (no chat-gate), tenant-scoped to Northwind (`…b1`).

> **Known follow-up (deploy/secret-gated, intentionally not done in this stage-only PR):** the panel
> still posts to the proven `http://100.68.120.99:8011/ask` transport. The production Northwind path is
> `POST /api/v1/ignition/chat` with **HMAC** (`MIRA_IGNITION_HMAC_KEY`) per handoff §8. Swap the
> transport when deploying (needs the key + reachability). The `asset_context`/`asset_id` body is
> already in place and forward-compatible.

## How Prove It is mirrored (and what's deferred)
- **Mirrored now:** ISA-95 Packaging/Line-1 framing + labels; multi-page Area nav (control / HMI /
  maintenance); same "muted-normal, color-for-state" visual language; one **live** asset.
- **Phase 2 (deferred):** author a `Conveyor` UDT in Prove It's MachineId/ProcessData/Metric shape;
  expose the CV-200 under a Prove-It-style namespace folder; switch the HMI to the parameterized
  `{view.params.path}/Metric` indirect-binding pattern (HMISelector-driven), and converge route names
  to Prove It's `/`, `/alarming`, `/trending`. See `specs/NORTHWIND_BOTTLING_PROVEIT_MIRROR.md`.
- **Phase 4 cloud wiring (handoff §4/§6/§7):** Northwind `approved_tags`, gateway ingest timer →
  `live_signal_cache` (tenant `…b1`), Command Center display registration. Out of scope here.

## Deploy (later — this PR is stage-in-repo only)
Config-as-files: this is a **new** project, so the brand-new-resource route applies — elevated copy of
`NorthwindBottling/` into the gateway `data/projects/` + restart (one UAC). Do **not** use the Gateway
web-UI Project Import (it has corrupted projects here). See the `ignition-dashboard` skill + the
`ConvSimpleLive` `APPLY.ps1`/`RECOVER_GATEWAY.ps1` patterns. Verify by rendering the page and confirming
live tag data (e.g. PE-01 toggling, a live freq/DC-bus value), per the skill's "never claim a deploy
without rendering it" rule.

## Provenance
Cloned from `plc/ignition-project/ConvSimpleLive/` on 2026-06-28. Relabeled identity strings only;
all component bindings preserved. JSON validated (26/26 files parse).
