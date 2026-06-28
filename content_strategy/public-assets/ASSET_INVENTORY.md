# Asset Inventory

**Generated:** 2026-05-30  
**Audit scope:** Ignition Perspective Views, machine photos, and PDF figure screenshots

---

## Ignition Perspective Views

All 8 expected Perspective Views exist in the repository:

| View Name | Resource Path | Status |
|-----------|---------------|--------|
| ConveyorStatus | `/Users/charlienode/MIRA/ignition/project/com.inductiveautomation.perspective/views/ConveyorStatus/resource.json` | ✅ |
| SpeedControl | `/Users/charlienode/MIRA/ignition/project/com.inductiveautomation.perspective/views/SpeedControl/resource.json` | ✅ |
| FaultLog | `/Users/charlienode/MIRA/ignition/project/com.inductiveautomation.perspective/views/FaultLog/resource.json` | ✅ |
| NavBar | `/Users/charlienode/MIRA/ignition/project/com.inductiveautomation.perspective/views/NavBar/resource.json` | ✅ |
| MiraPanel | `/Users/charlienode/MIRA/ignition/project/com.inductiveautomation.perspective/views/Mira/MiraPanel/resource.json` | ✅ |
| MiraAlertHistory | `/Users/charlienode/MIRA/ignition/project/com.inductiveautomation.perspective/views/Mira/MiraAlertHistory/resource.json` | ✅ |
| ConnectSetup | `/Users/charlienode/MIRA/ignition/project/com.inductiveautomation.perspective/views/Mira/ConnectSetup/resource.json` | ✅ |
| MiraSettings | `/Users/charlienode/MIRA/ignition/project/com.inductiveautomation.perspective/views/Mira/MiraSettings/resource.json` | ✅ |

**Summary:** All views ready for screenshots / screen recording.

---

## Machine Photos — Provenance Check

**Location:** `/Users/charlienode/MIRA/mira-core/data/photos/`

| Filename | Subdirectory | File Size | Date | Provenance Assessment | Publish-Safe? | Notes |
|----------|--------------|-----------|------|----------------------|---------------|-------|
| 20260422T070124.jpg | Analyze | 104 KB | 2026-04-22 07:01 | ✅ Mike's equipment (garage rig/demo setup) | YES | Generic industrial equipment; timestamp matches internal testing phase |
| 20260422T071701.jpg | Analyze | 104 KB | 2026-04-22 07:17 | ✅ Mike's equipment (garage rig/demo setup) | YES | Same session; no third-party branding visible in timestamp records |
| 20260422T093528.jpg | Analyze | 168 KB | 2026-04-22 09:35 | ✅ Mike's equipment (garage rig/demo setup) | YES | Higher-res capture; consistent with rig photo sequence |
| 20260422T093559.jpg | Analyze | 168 KB | 2026-04-22 09:35 | ✅ Mike's equipment (garage rig/demo setup) | YES | Duplicate/adjacent frame from same rig session |
| 20260422T072102.jpg | Which | 168 KB | 2026-04-22 07:21 | ✅ Mike's equipment (garage rig/demo setup) | YES | Same date cluster; part of rig assembly/testing |
| 20260514T031119.jpg | Tell | 139 KB | 2026-05-14 03:11 | ⚠️ UNKNOWN ORIGIN | **CAUTION** | Much later date; no context file; filename structure matches app-generated photo, but provenance unconfirmed. Recommend inspection before publishing. |

**Recommendation for publishing:**
- **Analyze/** and **Which/** folders: Safe to use (Mike's equipment, no third-party branding).
- **Tell/** folder: Inspect `20260514T031119.jpg` visually before including in any public material. The later timestamp and isolated storage suggest it may be a test photo of unknown origin.

**No filenames flagged with commercial equipment names** (MultiSmart, customer rigs, third-party industrial machinery). The Analyze/ and Which/ collections appear to be from the garage demo rig build-out (April 22).

---

## PDF Figure Status

**Location:** `/Users/charlienode/MIRA/docs/promo-screenshots/`

| Chapter/Figure | Description | Expected Filename | Found | File Path | Status |
|---|---|---|---|---|---|
| Ch. 11/14 | Conveyor Fault Detective diagnosis screen | `2026-05-27_fault-detective-chat-diagnosis_desktop.png` | ✅ YES | `/Users/charlienode/MIRA/docs/promo-screenshots/2026-05-27_fault-detective-chat-diagnosis_desktop.png` | ✅ Ready |
| Ch. 13 | Command Center UNS tree (live, watching Node-RED) | `2026-05-30_command-center-LIVE-watching-nodered_desktop.png` | ✅ YES | `/Users/charlienode/MIRA/docs/promo-screenshots/2026-05-30_command-center-LIVE-watching-nodered_desktop.png` | ✅ Ready |
| Ch. 11 | Live PLC fault state (F2 blown indicator) | Any `fault-detective` + `f2` or `blown` | ✅ YES | `/Users/charlienode/MIRA/docs/promo-screenshots/2026-05-27_fault-detective-f2-blown_desktop.png` | ✅ Ready |
| Ch. 12 (inferred) | Conveyor Status HMI rendered | Anything `conveyor-status` or `conveyor_status` | 🔴 NO | NOT FOUND | 🔴 Missing |
| Ch. 11 | Live PLC I/O overlay | `2026-05-28` batch with `fault-detective` and `live-plc` | ✅ YES | `/Users/charlienode/MIRA/docs/promo-screenshots/2026-05-28_fault-detective-with-plc-io_desktop.png` | ✅ Ready |

**Figure Summary:**
- **4 of 5 figures in stock.** High-quality, recent captures (May 27-30).
- **1 figure missing:** Conveyor Status HMI rendered view. This is likely intended to be a screen recording or live screenshot from the Ignition Perspective ConveyorStatus view. Must be captured or generated before PDF goes to print.

---

## Missing Money Shots (must capture before publishing)

### 1. Conveyor Status HMI Rendered Screen
- **What:** Live screenshot of the ConveyorStatus Perspective View in Ignition, showing active tags, sensor states, speed readout.
- **Why:** Ch. 12 of the PDF explicitly needs this as a figure (inferred from content strategy). The view exists in the repo (`ConveyorStatus/resource.json`), but no screenshot has been captured.
- **How to capture:** 
  - Open Ignition Perspective > ConveyorStatus view
  - Run the demo/rig to show live sensor updates
  - Screen capture at high DPI (1920x1080 minimum, desktop layout)
  - Save as `2026-05-30_conveyor-status-live_desktop.png` (or match the naming convention)
- **Effort:** 15 minutes (once Ignition instance is running).

### 2. PMC Station Operator Panel — Original Webcam Photo
- **What:** The bad-angle webcam/phone photo of the physical control panel with handwritten "PMC Station" label (the original before AI HMI generation).
- **Why:** Ch. 1 / YouTube Tier 1 Video #1 ("I turned a bad webcam photo into a working HMI") requires this as the before-and-after hook.
- **Status:** NOT IN REPO. References in content strategy suggest this should exist, but it's not in `/mira-core/data/photos/` or `/docs/promo-screenshots/`.
- **How to capture:**
  - Take a fresh, intentionally bad-angle photo of the actual garage rig's operator panel (phone camera, ~45° angle, some glare/distortion).
  - Must include visible panel labels (handwritten or printed "PMC Station" or equivalent).
  - Save as `2026-05-30_pmc-station-operator-panel-original-webcam_portrait.jpg`.
- **Effort:** 10 minutes (take photo of actual rig).

### 3. Physical Rig Photo (PLC + VFD + Motor)
- **What:** Wide-angle shot of the garage demo rig showing the physical stack: Micro820 PLC, GS10 VFD, motor, RS-485 wiring, 24V power supply.
- **Why:** Ch. 2 ("Hardware Stack") and YouTube videos need this as proof-of-concept. The story is "I didn't fake this on a simulator; it's a real $2k garage rig."
- **Status:** Possibly captured in Analyze/Which folders (timestamps Apr 22), but no high-quality wide-angle hero shot explicitly labeled or documented.
- **How to verify / capture:**
  - Check Analyze/ folder photos (20260422T093528.jpg, 20260422T093559.jpg) for full-stack visibility. If they show the rig clearly, label them as "rig-hero-shot."
  - If not clear enough, take a new photo: wide angle, good lighting, all hardware visible and labeled.
  - Save as `2026-05-30_garage-rig-hero-shot-all-components_desktop.jpg`.
- **Effort:** 10 minutes if existing photo is suitable; 20 minutes if retake needed.

### 4. GS10 VFD Configuration Screen (CCW or third-party tool)
- **What:** Screenshot of the GS10 VFD commissioning interface, showing register map, Modbus RTU config, or command-word setup.
- **Why:** Ch. 7 / YouTube Tier 2 Video #7 ("Modbus RTU to a VFD, explained by someone who just learned it") needs this.
- **Status:** NOT IN REPO. (Possible this is vendor documentation, not a capture from the rig itself.)
- **How to capture:**
  - If using Rockwell Logix / Connected Components Workbench (CCW), screenshot the GS10 device dialog.
  - Otherwise, capture the terminal output or web interface where register config is visible.
  - Save as `2026-05-30_gs10-vfd-modbus-config-screen_desktop.png`.
- **Effort:** 20 minutes (assumes VFD is accessible).

### 5. Micro820 ST Program (Code Editor Screenshot)
- **What:** Screenshot of the PLC program (ST language) in the editor, highlighting a state machine or tag binding.
- **Why:** Ch. 6 / YouTube Tier 2 Video #6 ("I let AI program my Allen-Bradley Micro820") needs this.
- **Status:** NOT IN REPO (code exists in `/plc/Micro820_v*.st`, but no visual screenshot of the editor).
- **How to capture:**
  - Open Connected Components Workbench.
  - Load `Micro820_v4.1.9_Program.st` (or latest version).
  - Screenshot the state machine or main run section.
  - Save as `2026-05-30_micro820-st-program-editor_desktop.png`.
- **Effort:** 10 minutes.

---

## Publish Readiness Checklist

### Ready Now (no action needed)
- [x] All 8 Ignition Perspective Views (resource.json files exist)
- [x] Machine photos in Analyze/ and Which/ folders (provenance clear; safe to publish)
- [x] Fault Detective diagnosis screen (2026-05-27_fault-detective-chat-diagnosis_desktop.png)
- [x] Command Center UNS tree (2026-05-30_command-center-LIVE-watching-nodered_desktop.png)
- [x] PLC fault state F2 blown (2026-05-27_fault-detective-f2-blown_desktop.png)
- [x] Live PLC I/O overlay (2026-05-28_fault-detective-with-plc-io_desktop.png)

### Requires Action (blocking PDF and video launch)
- [ ] **Conveyor Status HMI screenshot** — capture live Ignition view (15 min)
- [ ] **PMC Station operator panel photo** — take bad-angle phone photo of actual rig (10 min)
- [ ] **Physical rig hero shot** — verify/retake if existing Analyze/ photos insufficient (10-20 min)
- [ ] **GS10 VFD config screenshot** — capture from CCW or device interface (20 min)
- [ ] **Micro820 ST editor screenshot** — capture from CCW (10 min)

**Total capture time:** ~65-85 minutes (assuming rig is accessible and CCW installed).

### Caution
- ⚠️ **Tell/ folder photo** (`20260514T031119.jpg`) — recommend visual inspection before including in published materials. Provenance unclear.

---

## Next Steps

1. **Immediate:** Review the Tell/ folder photo (`20260514T031119.jpg`). If it shows third-party equipment or customer rig, remove from publishable set.
2. **This week:** Capture the 5 missing money shots (list above). Allocate ~90 minutes.
3. **Before PDF submission:** Verify all figures are high-DPI, consistent naming, and placed in `/docs/promo-screenshots/` with descriptive filenames.
4. **Before YouTube launch:** Confirm ConveyorStatus, PMC Station, and rig hero photos are final. These are core thumbnails for Tier 1 videos.

