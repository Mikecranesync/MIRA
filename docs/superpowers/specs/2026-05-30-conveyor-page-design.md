# Garage Conveyor page — design

**Date:** 2026-05-30
**Status:** Approved (design); pending implementation
**Target:** new `Conveyor` view in the `ConvSimpleLive` Perspective project on the
laptop gateway (`localhost:8088`)
**Reference image:** `C:\Users\hharp\Downloads\Conveyor example.PNG` (placeholder,
swappable later for a real garage photo)

## What this accomplishes (plain English)

A second screen in the dashboard that shows a **picture of the conveyor** with
**live readings laid over it** — running/stopped, speed (Hz), current (A),
direction, and badges for E-STOP, contactor, and PLC comm. One animated touch: an
**arrow on the belt that slides along while running** (reversed in REV). Two links
at the top let you flip between the existing **PMC Station** panel and this
**Conveyor** screen. Reuses the same live tags as the VFD/MLC cards.

## Scope

In scope:
- New `Conveyor` Perspective view + a page URL for it.
- Deploy the example PNG as a swappable background asset.
- Live status overlays + one CSS-animated direction arrow.
- A two-link nav header on both views.

Out of scope:
- Any control/write path — read-only, like everything else here.
- Real garage photo (placeholder now; single-file swap later).
- Maker license / always-on (separate items).

## Data sources (reuse existing tags)

| Element | Tag | Logic |
|---|---|---|
| Running | `MIRA_IOCheck/VFD/vfd_frequency`, `vfd_cmd_word` | `freq/100 > 0.1` OR `cmd ∈ {18,20}` |
| Speed | `MIRA_IOCheck/VFD/vfd_frequency` | `/100` → "xx.x Hz" |
| Current | `MIRA_IOCheck/VFD/vfd_current` | `/100` → "x.x A" |
| Direction | `MIRA_IOCheck/Inputs/DI_00` (FWD), `DI_01` (REV) | FWD / REV / OFF |
| E-STOP | `MIRA_IOCheck/Inputs/DI_02` | ARMED (true) / TRIPPED |
| Contactor (MLC) | `MIRA_IOCheck/Outputs/DO_02` | CLOSED / OPEN |
| Comm | `MIRA_IOCheck/Diagnostics/plc_alive` | OK / bad |

No new tags required. Scaling stays in the bindings (mirrors the VFD card).

## View changes

### New view: `Conveyor`
- Coordinate container, dark background (`#10141a`), default size ~960×620.
- **Background image:** an Image (or background-image) sized to the working area,
  source `/system/images/Conveyor/garage_conveyor.png`. Sits behind the overlays.
- **Top status strip** (labels): RUNNING/STOPPED pill (green/grey), `xx.x Hz`,
  `x.x A`, direction `→ FWD / ← REV / — OFF`, and small chips E-STOP / MLC / COMM.
- **On-image indicators:** motor/drive status dot (green when energized = running)
  positioned near the motor; an E-STOP badge; the animated direction arrow over the
  belt.

### Direction arrow (the one animated element)
- A horizontal arrow element over the belt region.
- A Perspective **project stylesheet** defines `@keyframes conveyor-flow`
  (translate X loop). The arrow's inline style binds:
  - `animationName`: `conveyor-flow` when running, else `none`.
  - `animationPlayState`: `running` / `paused` by run state.
  - `animationDirection`: `normal` (FWD) / `reverse` (REV).
- Stop → arrow static; FWD → slides one way; REV → slides the other.

### Nav header (both views)
- A thin header band at the top of `Conveyor` and the existing `ConvSimpleLive`
  view with two link/label elements: **PMC Station** and **Conveyor**.
- Each navigates to the other page via Perspective navigation
  (`system.perspective.navigate` action or a link component to the page URL).
- The current page's link is highlighted.

### Pages
- Register a page URL `/conveyor` → `Conveyor` view in the project's page-config.
- Existing panel page URL unchanged.

## Asset deployment (swappable image)

- Copy `Conveyor example.PNG` into the gateway image store as
  `Conveyor/garage_conveyor.png`. **Implementation checkpoint:** confirm the exact
  Image-Management resource layout on this 8.3.4 gateway (folder-per-image +
  manifest, under `data/config/resources/core/ignition/images/`) and replicate it;
  verify the served URL `/system/images/Conveyor/garage_conveyor.png` resolves.
- Versioned in the repo under `plc/ignition-project/assets/` so the source is
  tracked; `install.ps1` copies it to the gateway image store. Swapping the file
  (same name) later replaces the picture with no view edits.

## Deployment

Extend `install.ps1` to also copy: the new `Conveyor` view, the page-config update,
the project stylesheet, and the image asset. Then stop → copy → start (one elevated
run, as before). Verify the page at
`http://localhost:8088/data/perspective/client/ConvSimpleLive` → `/conveyor`.

## Verification

With the PLC live (and trial/license active so Perspective renders):
- Page loads; conveyor image shows; nav links switch between panel and conveyor.
- Status strip reads plausible live values (0.0 Hz / 0.0 A idle, COMM OK).
- Toggling `DO_02` / e-stop / selector updates the chips and direction.
- If the drive runs: RUNNING lights, Hz/A climb, and the arrow slides (reverses in
  REV). Confirm with a headless screenshot.

## Risks / checkpoints

- **Image resource format** — get the Image-Management folder/manifest right
  (checkpoint above); fallback is a static path under the gateway webserver.
- **Stylesheet animation** — `@keyframes` must live in the project stylesheet
  resource; inline `animation*` props reference it. Confirm the 8.3 project
  stylesheet resource path.
- **Page-config / nav resource format** — replicate the existing page-config schema
  so the gateway accepts the new page without a Designer.
- **Trial/UAC** — deploy needs one accepted elevation; rendering needs the trial
  reset or Maker (unchanged from prior work).
