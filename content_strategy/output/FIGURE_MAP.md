# Figure Map — PDF Learning Guide

**Generated:** 2026-05-30  
**Audit scope:** Mapping PDF figure requirements to repository assets and capture instructions

---

## Missing Money Shots (Must Capture Before Publishing)

### 1. PMC Station BEFORE photo (Ch.10) — 🔴 NOT IN REPO
**Capture instructions:** Take a fresh, intentionally poor-quality photo of the physical garage rig's operator panel. Key attributes:
- Phone camera (not professional): ~45° angle, some glare/distortion acceptable
- Off-center framing, slightly blurry (simulates "bad webcam photo" narrative)
- Must include visible panel labels: handwritten or printed "PMC Station" or equivalent tag
- Landscape or portrait orientation (portrait preferred for web)
- File: `2026-05-30_pmc-station-operator-panel-original-webcam_portrait.jpg`
- Effort: 10 minutes (photograph existing rig panel)

**Note:** This is the critical BEFORE shot for Ch. 10's transformation story ("I turned a bad webcam photo into a working HMI"). Recreating this live on camera is actually BETTER than a historical photo — it proves the pipeline is repeatable and demonstrates the exact phone-camera-to-HMI workflow.

---

### 2. PMC Station AFTER photo (Ch.10) — 🔴 NOT IN REPO
**Capture instructions:** After capturing the BEFORE photo, run the AI image-to-HMI pipeline against it (or use an existing reference image). Generate an Ignition Perspective View and capture the final rendered result:
- Run image through the photo→HMI generation pipeline
- Screenshot the resulting rendered view in Ignition Designer preview pane or live session
- Include labeled buttons, status indicators, and any dynamic updates from the PLC
- High DPI (1920x1080 minimum)
- File: `2026-05-30_pmc-station-ignition-hmi-rendered_desktop.png`
- Effort: 15 minutes (assuming pipeline is ready and Ignition is running)

**Note:** This is the money shot — the final product that demonstrates the full transformation. The before/after pairing is the core visual argument of Ch. 10.

---

### 3. Stock conveyor reference image (Ch.11) — 🔴 NOT IN REPO
**Capture instructions:** Locate and save a clean, stock photograph of an industrial conveyor system:
- Source: Google Images, Unsplash, or similar ("conveyor belt 3D", "industrial conveyor system")
- Criteria: Clear perspective view of a conveyor, no branded logos, generic/educational quality
- Use case: This is the source image shown to the AI in the photo→diagram pipeline example
- Resolution: 1200x800 or larger
- File: `2026-05-30_stock-conveyor-reference_desktop.jpg`
- Effort: 5 minutes (download and save)

**Note:** This image represents the input to the diagram generation pipeline in Ch. 11. It's a teaching figure, not a proprietary asset.

---

### 4. ConveyorStatus Perspective View screenshot (Ch.12) — 🟡 MISSING
**Capture instructions:** Screenshot the live ConveyorStatus Ignition Perspective View while running with active sensor data:
- View exists at: `/Users/charlienode/MIRA/ignition/project/com.inductiveautomation.perspective/views/ConveyorStatus/resource.json`
- Prerequisites: Ignition instance running, ConveyorStatus view loaded, demo/rig PLC connected and live
- Capture: Full desktop screenshot showing dashboard controls, sensor readouts, speed display, status indicators
- Must show LIVE data (not static mockup): running conveyor speed, motor state, fault indicators if any
- High DPI (1920x1080 minimum, desktop layout preferred)
- File: `2026-05-30_conveyor-status-live_desktop.png`
- Effort: 15 minutes (requires Ignition instance and live PLC connection)

**Note:** Ch. 12 explicitly requires a visual of the ConveyorStatus HMI in action. This is currently the only "4 of 5 figures ready" gap identified in ASSET_INVENTORY.md.

---

### 5. RS-485 wiring diagram (Ch.6) — 🔴 NOT IN REPO
**Capture instructions:** Create or capture a clean technical diagram of RS-485 serial wiring pinout:
- Input: ASCII or handdrawn RS-485 pinout diagram (exists elsewhere in repo docs?)
- Output: Clean, readable wiring diagram showing:
  - DE/RE (Driver Enable / Receiver Enable pins)
  - D+/D- (differential data lines)
  - GND (ground)
  - Termination resistors (if applicable)
  - Example: Micro820 PLC pins → GS10 VFD pins
- Format: PNG or high-quality JPG, vector preferred (not photo of whiteboard)
- File: `2026-05-30_rs485-pinout-diagram-clean_desktop.png`
- Effort: 20 minutes (clean up existing ASCII or redraw in Visio/Lucidchart)

**Note:** This is a reference diagram for Ch. 6 ("RS-485 wiring explained"). Check if an existing diagram exists in `/plc/docs/` or `/content_strategy/` folders before recreating.

---

## Ready Screenshots

All figures marked 🟢 or available 🟡 items are in the repository and ready to use:

| Priority | Chapter | Figure | File Path | Status | Notes |
|----------|---------|--------|-----------|--------|-------|
| 🟢 7 | Ch.11/14 | Conveyor Fault Detective diagnosis chat screenshot | `/Users/charlienode/MIRA/docs/promo-screenshots/2026-05-27_fault-detective-chat-diagnosis_desktop.png` | ✅ Ready | High-quality desktop screenshot, recent capture (2026-05-27) |
| 🟢 8 | Ch.13 | Command Center UNS tree (enterprise → Home Garage → Conveyor Lab) | `/Users/charlienode/MIRA/docs/promo-screenshots/2026-05-30_command-center-LIVE-watching-nodered_desktop.png` | ✅ Ready | Live namespace tree watching Node-RED, latest capture (2026-05-30) |
| 🟢 9 | Ch.11 | Conveyor HMI with live PLC fault state (F2 blown indicator) | `/Users/charlienode/MIRA/docs/promo-screenshots/2026-05-27_fault-detective-f2-blown_desktop.png` | ✅ Ready | Demonstrates PLC fault state integration (2026-05-27) |
| 🟢 10 | Ch.14 | MIRA confirmation gate in action (fault named + confidence shown) | `/Users/charlienode/MIRA/docs/promo-screenshots/2026-05-27_fault-detective-chat-confirmation_desktop.png` | ✅ Ready | Shows AI diagnosis confidence and fault naming (2026-05-27) |

---

## Physical Rig Photo (Ch.2)

**Status:** ✅ READY — Multiple captures available

**Available files:**
- `/Users/charlienode/MIRA/mira-core/data/photos/Analyze/20260422T093528.jpg` (168 KB, 2026-04-22 09:35)
- `/Users/charlienode/MIRA/mira-core/data/photos/Analyze/20260422T093559.jpg` (168 KB, 2026-04-22 09:35, similar angle)
- `/Users/charlienode/MIRA/mira-core/data/photos/Which/20260422T072102.jpg` (168 KB, 2026-04-22 07:21)
- `/Users/charlienode/MIRA/mira-core/data/photos/Analyze/20260422T070124.jpg` (104 KB, 2026-04-22 07:01)
- `/Users/charlienode/MIRA/mira-core/data/photos/Analyze/20260422T071701.jpg` (104 KB, 2026-04-22 07:17)

**Recommendation:**
Use **20260422T093528.jpg** or **20260422T093559.jpg** for Ch. 2 ("Hardware Stack"). These are the highest resolution (168 KB) and from the same session, showing the complete garage rig setup. Provenance verified as Mike's equipment (garage rig/demo setup), safe to publish.

**Provenance:** All Analyze/ and Which/ folder photos verified as Mike's garage rig, no third-party branding. Safe for public PDF.

**Caution:** The Tell/ folder contains `20260514T031119.jpg` (2026-05-14) with unknown provenance — recommend inspection before publishing.

---

## Summary: Capture Checklist

| # | Figure | Priority | Status | Effort | Blockers |
|---|--------|----------|--------|--------|----------|
| 1 | PMC Station BEFORE | 🔴 Critical | NOT IN REPO | 10 min | Requires fresh photo of physical rig |
| 2 | PMC Station AFTER | 🔴 Critical | NOT IN REPO | 15 min | Requires BEFORE photo + pipeline + Ignition |
| 3 | Stock conveyor reference | 🔴 Critical | NOT IN REPO | 5 min | Download/find stock image |
| 4 | ConveyorStatus HMI | 🟡 High | NOT IN REPO | 15 min | Requires Ignition + live PLC connection |
| 5 | RS-485 diagram | 🟡 High | NOT IN REPO | 20 min | Check if existing diagram can be reused |
| 6 | Physical rig photo (Ch.2) | 🟡 High | ✅ READY | — | Use 20260422T093528.jpg |
| 7 | Fault Detective diagnosis | 🟢 Ready | ✅ READY | — | No action needed |
| 8 | Command Center UNS tree | 🟢 Ready | ✅ READY | — | No action needed |
| 9 | Conveyor HMI (PLC fault) | 🟢 Ready | ✅ READY | — | No action needed |
| 10 | MIRA confirmation gate | 🟢 Ready | ✅ READY | — | No action needed |

**Total capture time for missing items:** ~65 minutes (assuming rig and Ignition instance accessible).

---

## Next Steps

1. **Immediate:** Review Tell/ folder photo (`20260514T031119.jpg`) for provenance. If unknown origin or third-party equipment visible, remove from publishable set.
2. **This week:** Capture the 5 missing figures (🔴 and 🟡 items). Allocate ~90 minutes total.
3. **Before PDF submission:** Verify all 10 figures meet publishing standards:
   - High DPI (1920x1080 minimum for screenshots, 1200x800 for images)
   - Consistent naming convention: `2026-05-30_figure-description_desktop.{png|jpg}`
   - All figures placed in `/docs/promo-screenshots/` for centralized management
   - Watermarks or branding removed (for educational figures)
4. **Before YouTube launch:** Confirm PMC Station before/after and rig hero photos are final — these are core thumbnails for Tier 1 videos.

---

## Naming Convention

All new figures should follow the established pattern:
```
YYYY-MM-DD_figure-description_layout.format

Examples:
2026-05-30_pmc-station-operator-panel-original-webcam_portrait.jpg
2026-05-30_conveyor-status-live_desktop.png
2026-05-30_rs485-pinout-diagram-clean_desktop.png

Layouts: desktop, mobile, tablet, portrait, landscape, full
Formats: .png (preferred for screenshots), .jpg (photos/diagrams)
```

---

## File Locations

- **PDF figure directory:** `/Users/charlienode/MIRA/docs/promo-screenshots/`
- **Physical rig photos:** `/Users/charlienode/MIRA/mira-core/data/photos/`
- **Ignition Perspective Views:** `/Users/charlienode/MIRA/ignition/project/com.inductiveautomation.perspective/views/`
- **Content strategy:** `/Users/charlienode/MIRA/content_strategy/`

