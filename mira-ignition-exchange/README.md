# MIRA for Ignition Perspective

**Free Perspective resources for the [Ignition Exchange](https://inductiveautomation.com/exchange) — bring AI maintenance assistance and nameplate scanning into any plant.** Powered by [FactoryLM](https://factorylm.com).

This bundle ships two ready-to-import Perspective views:

| View | What it does |
|---|---|
| `MIRA/ChatDock` | A 400 px right-side dock that embeds the MIRA chat assistant. Talks plant equipment, troubleshooting, and OEM manuals. After 10 questions, surfaces a soft upsell to a full FactoryLM workspace. |
| `MIRA/ScanWidget` | A camera-driven nameplate scanner. Take a photo → MIRA's vision pipeline extracts make / model / serial / voltage / HP. If the asset is already in the FactoryLM knowledge base, it opens chat scoped to that asset. If not, it offers a one-click "Add to FactoryLM" CTA. |

---

## Prerequisites

- **Ignition 8.1.20+** (Perspective module installed and licensed)
- **Outbound HTTPS** to `app.factorylm.com` from the Gateway (for the Scan API) and from Perspective sessions (for the Chat Dock iframe)
- **Camera-capable session device** for the Scan Widget — any modern phone, tablet, or laptop. The widget uses Perspective's standard `File Upload` component with `capture="environment"`, so it works with the OS camera roll on desktop and the rear camera on mobile.

No Anthropic key, no model server, no GPU — the heavy lifting runs in FactoryLM's hosted MIRA cascade.

---

## Install (5 minutes)

### 1. Import the project

In the Gateway Webpage:

1. **Config → Projects → Create new project**
2. Name it `mira_exchange` (or merge into an existing project — see *Merge into existing project* below)
3. Restore the export: copy `ignition-project/` into `<gateway>/data/projects/mira_exchange/`, then **Restart Gateway** (or use **Config → Projects → Import** with a zipped copy of `ignition-project/`).

The two views appear under **Perspective → Views → MIRA/** in the Designer.

### 2. Create the configuration tags

The views read three Memory tags under `[default]MIRA/`. Pick one:

**Option A — Gateway startup script (recommended)**

Copy `ignition-project/gateway-events/startup.py` into:

> Gateway Webpage → **Config → Gateway Event Scripts → Startup**

The script is idempotent — it creates the tags only if they don't already exist.

**Option B — Tag JSON import**

Designer → **Tag Browser → ⋮ → Import tags from JSON…** → choose `ignition-project/tags/MIRA_tags.json`.

**Option C — One-shot install from the Script Console**

Designer → **Tools → Script Console** → run `scripts/install_tags.py`.

After install you'll see:

```
[default]
└── MIRA/
    ├── endpoint_url            (String) https://app.factorylm.com
    ├── scan_api_url            (String) https://app.factorylm.com/api/scanbe
    └── factorylm_onboard_url   (String) https://factorylm.com/onboard
```

Override any of these per-gateway — for example, if you self-host MIRA on `mira.your-plant.local`, set `endpoint_url` to that.

### 3. Wire up the Chat Dock (optional, takes 30 seconds)

To dock the chat panel on the right side of every page in your project:

1. In Designer, open **Perspective → Page Configuration**
2. **Edit the page** you want MIRA on (or **Default** for all pages)
3. **Add Right Dock** → set **View** to `MIRA/ChatDock`, **Width** to `400`, **Display** to `pinned`

Alternatively embed `MIRA/ChatDock` inside any view as a 400 px column.

### 4. Drop the Scan Widget anywhere

Drag-and-drop **MIRA/ScanWidget** into any Perspective view. It self-contains all its capture, API, and result rendering logic. No params required.

---

## Configuration

| Tag | Default | Purpose |
|---|---|---|
| `[default]MIRA/endpoint_url` | `https://app.factorylm.com` | URL loaded into the Chat Dock's `WebBrowser` component. |
| `[default]MIRA/scan_api_url` | `https://app.factorylm.com/api/scanbe` | Base URL for the scan backend. The widget POSTs to `<scan_api_url>/scan/extract`. |
| `[default]MIRA/factorylm_onboard_url` | `https://factorylm.com/onboard` | Opened from the upsell banner and the "Add to FactoryLM" CTA. The widget appends extracted nameplate fields as URL params so the onboarding flow can prefill them. |

To **self-host** the MIRA backend, point all three tags at your own domain.

---

## What MIRA does

MIRA is a vision + language pipeline tuned for industrial maintenance:

- **Nameplate OCR** — reads make, model, serial, voltage, horsepower, frame size from photos of motor / drive / pump nameplates, even at oblique angles or with grease and rust.
- **Knowledge-base lookup** — if the scanned asset has been ingested into FactoryLM (manuals, prior work orders, vendor notes), MIRA returns `kb_matched: true` and the Chat Dock can scope queries to that asset's knowledge.
- **Cascade inference** — runs through Groq → Cerebras → Gemini for low-latency, high-availability completions. No single-vendor dependency.
- **Safety-first guardrails** — arc flash, LOTO, and confined-space queries trigger STOP escalations rather than auto-generated procedures.

The chat dock is the same MIRA you'd hit from a phone or laptop, just embedded next to your HMI.

---

## Endpoints

The Scan Widget speaks one endpoint:

```
POST <scan_api_url>/scan/extract
Content-Type: application/json

{
  "image_b64": "<base64 image>",
  "filename":  "capture.jpg",
  "source":   "ignition-perspective"
}
```

Response shape:

```jsonc
{
  "make":       "Baldor",
  "model":      "VEM3554T",
  "serial":     "F1804291234",
  "voltage":    "230/460V",
  "hp":         "1.5",
  "asset_id":   "fluid-handling-pump-12",
  "kb_matched": true,
  "raw_text":   "..."
}
```

`kb_matched=true` triggers the **Open in MIRA Chat** button. `kb_matched=false` triggers the **Add to FactoryLM** CTA.

---

## Screenshots

> Replace these placeholders with real captures before publishing the Exchange listing. Recommended viewports: 1440×900 (desktop) and 412×915 (mobile).

- `assets/screenshot-chatdock-desktop.png` — Chat Dock pinned right of an HMI page
- `assets/screenshot-chatdock-mobile.png` — Chat Dock in a phone-sized session
- `assets/screenshot-scanwidget-capture.png` — Scan Widget with capture button visible
- `assets/screenshot-scanwidget-result-matched.png` — Result card with **Open in MIRA Chat** button
- `assets/screenshot-scanwidget-result-unmatched.png` — Result card with **Add to FactoryLM** CTA
- `assets/screenshot-upsell-banner.png` — Upsell banner after 10 questions

---

## Troubleshooting

**Chat Dock shows a blank panel**
The `WebBrowser` component requires Perspective 8.1.20+ and outbound HTTPS to `endpoint_url`. Check `system.util.getLogger("perspective.web-browser")` for CSP / mixed-content errors.

**Scan returns HTTP 401 / 403**
The default backend at `app.factorylm.com/api/scanbe` accepts unauthenticated requests for MVP. If you self-host, add an Authorization header in the script transform inside `ScanWidget/view.json` → `events.component.onFileReceived`.

**Camera doesn't open on mobile**
Mobile Chrome / Safari respect `<input capture="environment">`. If you're testing inside an iframe (e.g. embedded in a portal), the parent must set `allow="camera"` on the iframe.

**Tags don't appear after running startup.py**
The script logs to `MIRA` logger — check **Status → Diagnostics → Logs** filtered on `MIRA`. The most common failure is project tag scope: confirm the tags were created in the `default` provider, not a project-scoped provider.

---

## License

Apache 2.0. See `LICENSE`. Free for commercial use; attribution to FactoryLM is appreciated but not required.

## Source

Maintained at [github.com/Mikecranesync/MIRA](https://github.com/Mikecranesync/MIRA) → `mira-ignition-exchange/`. PRs welcome.
