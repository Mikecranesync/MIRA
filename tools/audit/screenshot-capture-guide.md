# Screenshot capture guide — feature pages

Follow this guide to capture real product screenshots that replace the placeholder slides and populate the hero images on `/feature/fault-diagnosis`, `/feature/cmms-integration`, and `/feature/voice-vision`.

Total time: **~45 minutes** if all systems are running. Longer if Atlas CMMS needs data.

---

## Before you start — prerequisites

### Systems that need to be running

| System | Where | Purpose | Verify |
|---|---|---|---|
| Mira chat (Open WebUI) | `factorylm.com:3010` or Bravo `:3000` | Fault diagnosis slides | open in browser, can chat |
| Atlas CMMS | Bravo `:3100` or `cmms.factorylm.ai` | CMMS integration slides | log in, see kanban |
| Mira web chat widget | `factorylm.com/cmms` (FAB bubble) | Alternative fault diagnosis | click "Ask Mira" bubble |
| Telegram bot | `@MiraAssistantBot` on your phone | Voice + vision slides | send a test message |
| iPhone/Android with Chrome/Safari | Personal phone | Voice + vision mobile caps | load `factorylm.com/cmms` |

### Equipment

- Laptop (your Windows dev box is fine)
- Phone (iPhone preferred for consistency; Android works)
- Screenshot tool: **Windows built-in Snipping Tool** (`Win+Shift+S`) OR **ShareX** for higher quality PNGs
- Image editor for quick crops and redaction: **Paint.NET** or **Figma**

### Pre-flight checks — run these 3 commands

```bash
# 1. Mira chat reachable
curl -sI https://factorylm.com/cmms | head -1

# 2. Atlas CMMS reachable (from inside network)
ssh bravo "curl -sI http://localhost:3100/ | head -1"

# 3. Telegram bot alive
ssh bravo "docker ps --filter name=mira-bot-telegram --format '{{.Status}}'"
```

All three should return healthy/200/Up statuses. If anything is down, start it before proceeding.

---

## Capture targets

You're capturing **3 screenshots per feature** (one per representative slide) plus **1 hero image per feature** (the "money shot" for the top of the feature page). That's **12 screenshots total**.

File naming convention — put everything in `mira-web/public/images/features/`:

```
mira-web/public/images/features/
├── fault-diagnosis-hero.png
├── fault-diagnosis-01-chat.png
├── fault-diagnosis-02-citation.png
├── fault-diagnosis-03-workorder.png
├── cmms-integration-hero.png
├── cmms-integration-01-kanban.png
├── cmms-integration-02-workorder.png
├── cmms-integration-03-atlas-dashboard.png
├── voice-vision-hero.png
├── voice-vision-01-voice-input.png
├── voice-vision-02-photo-upload.png
└── voice-vision-03-identified.png
```

Resolution targets:
- **Desktop/web captures:** 1600×1000 minimum, @2x retina if possible → save as PNG
- **Mobile captures:** 750×1624 (iPhone 15 Pro portrait) → save as PNG, don't resize
- **Hero images:** 1920×1080 (16:9) — will be displayed in the video frame slot

Keep file sizes under **400 KB each** — compress with tinypng.com or `oxipng -o max` after capture.

---

## FEATURE 1 — Fault Diagnosis (4 images)

### Capture 1: `fault-diagnosis-hero.png` — Mira chat answering a real fault

**What it shows:** Mira answering "F-012 on PowerFlex 753" with a cited answer visible, including the manual page reference.

**How:**

1. Open `https://factorylm.com/cmms` in Chrome (or Open WebUI at `bravo:3010` if you prefer that UI)
2. Click the **Ask Mira** bubble (bottom right) or navigate to the chat pane
3. Type **exactly**: `F-012 on PowerFlex 753 — what's the root cause and fix?`
4. Wait for the full response (should include citation `§6.2 PF753 Manual p.81`)
5. **Zoom your browser to 110%** (Ctrl++ once) so the text is readable in thumbnails
6. Resize the window to **1600×1000**
7. **Capture just the chat panel** — NOT the full browser window, NOT your taskbar
8. Redact anything sensitive: your email in the topbar, any real tenant IDs, API keys visible in DevTools (close DevTools)
9. Save as `fault-diagnosis-hero.png` at full resolution

### Capture 2: `fault-diagnosis-01-chat.png` — The input moment

**What it shows:** A technician typing a fault code mid-query, with the chat showing previous conversation context.

**How:**

1. Same chat window as #1
2. Scroll up to show previous exchanges (if any) — gives context that this is a real session
3. Click in the text input, type the fault code but **don't hit send yet**: `E-731 on axis 2`
4. Capture the window showing the typing cursor + previous context
5. Save as `fault-diagnosis-01-chat.png`

### Capture 3: `fault-diagnosis-02-citation.png` — The cited source

**What it shows:** A close-up of the citation hover/expand — showing the actual page reference from the manual.

**How:**

1. After Mira answers, hover over the `[§6.2 PF753 Manual p.81]` citation link (if it has a hover state)
2. Or click to expand/preview the source
3. Capture the citation + any hover card showing the section text
4. If your UI doesn't have a citation hover state, just capture the answer with the citation highlighted (use a yellow highlight bar in your image editor after the fact)
5. Save as `fault-diagnosis-02-citation.png`

### Capture 4: `fault-diagnosis-03-workorder.png` — The auto-generated work order

**What it shows:** The work order that Mira created from the chat answer, open in Atlas CMMS.

**How:**

1. Open Atlas CMMS in a second browser tab: `http://bravo:3100` or `https://cmms.factorylm.ai`
2. Log in
3. Go to the kanban board or work order list
4. Find a work order with **"Created by Mira AI"** or similar indicator (create one manually if none exist — see section below)
5. Click to open the detail view
6. Capture the full work order detail pane showing: asset, description, parts, priority, AI attribution
7. Save as `fault-diagnosis-03-workorder.png`

**If no Mira-created work orders exist:** open the Atlas API directly and POST one via curl with `source: "mira"` metadata, or manually create one in the UI with the description `Replace J2 encoder cable — CN2 pinch damage` and the note "Created from Mira chat session". Good enough for a demo screenshot.

---

## FEATURE 2 — CMMS Integration (4 images)

### Capture 1: `cmms-integration-hero.png` — Atlas kanban board

**What it shows:** The Atlas CMMS kanban with several work orders in different statuses (open, in progress, done), ideally at least 2 with "Mira AI" attribution.

**How:**

1. Atlas CMMS → **Work Orders** → **Kanban view**
2. Populate it if empty: create 6-8 work orders across statuses using the Atlas UI or API
3. At least 2 should have `source: mira` or "Created by Mira" tag
4. Window size: **1600×1000**
5. Capture the full kanban board
6. **Redact any real customer names** — use Figma/Paint.NET to replace with generic names like "Line 3 Motor", "Conveyor Drive #2"
7. Save as `cmms-integration-hero.png`

### Capture 2: `cmms-integration-01-kanban.png` — Zoomed kanban detail

**What it shows:** A close-up of 2-3 work order cards on the kanban, showing priority badges, asset names, and the Mira attribution.

**How:**

1. Zoom browser to 130% so cards are large and readable
2. Crop to a 1600×900 region showing 2-3 cards
3. Save as `cmms-integration-01-kanban.png`

### Capture 3: `cmms-integration-02-workorder.png` — Work order detail modal

**What it shows:** One work order opened to its full detail view, showing: asset, description, parts list, estimated time, priority, assigned technician, and the "Created by Mira" metadata.

**How:**

1. Click any Mira-created work order from the kanban
2. The detail modal/page opens
3. Capture the full detail view
4. Save as `cmms-integration-02-workorder.png`

### Capture 4: `cmms-integration-03-atlas-dashboard.png` — Atlas overview / metrics

**What it shows:** The Atlas CMMS main dashboard with uptime stats, open WO count, PM schedule, etc.

**How:**

1. Atlas CMMS → **Dashboard** or **Overview**
2. Capture the full page with all metric widgets visible
3. Save as `cmms-integration-03-atlas-dashboard.png`

---

## FEATURE 3 — Voice + Vision (4 images — **mobile only**)

These need to come from your actual phone because the voice/photo UX only exists on mobile.

### Capture 1: `voice-vision-hero.png` — Phone showing Mira voice interaction

**What it shows:** An iPhone held at a slight angle showing the Mira web app with a voice input indicator active (red pulse dot, waveform, or "listening" state).

**How:**

1. On your iPhone, open Safari and go to `https://factorylm.com/cmms`
2. Click the **Ask Mira** bubble
3. Tap the microphone button to start voice input
4. Say "E-731 on axis 2"
5. **BEFORE** the transcription completes, take an iPhone screenshot (Power + Volume Up)
6. This captures the listening state
7. Save to your Photos, AirDrop to your laptop, rename to `voice-vision-hero.png`

**Alternative if voice input isn't yet wired:** use the chat input in "listening" state from DevTools by manually adding a CSS class that simulates the pulse, or use a stock mockup.

### Capture 2: `voice-vision-01-voice-input.png` — Transcript moment

**What it shows:** Phone showing the transcribed voice input text appearing in the chat.

**How:**

1. Same session as #1
2. After voice recognition completes, the transcribed text appears as a user message
3. Screenshot (Power + Volume Up)
4. Rename to `voice-vision-01-voice-input.png`

### Capture 3: `voice-vision-02-photo-upload.png` — Photo being uploaded

**What it shows:** Phone showing a photo upload flow — either the camera picker with a recent photo selected, or the upload progress bar.

**How:**

1. Same chat window
2. Tap the paperclip/attachment icon
3. Pick **Take Photo** or **Photo Library**
4. Take a photo of anything realistic (a random cable, a motor, a PLC, or a real photo from your phone's camera roll)
5. As the photo uploads and shows in the chat bubble, screenshot
6. Rename to `voice-vision-02-photo-upload.png`

**Note:** Make sure your own photo doesn't show anything confidential (customer site, NDA equipment, license plates, etc.). The `tools/` directory under MIRA has a photo pipeline with 3,694 equipment photos — you can use one of those as a stand-in if you don't want to take a new photo.

### Capture 4: `voice-vision-03-identified.png` — Mira's identification response

**What it shows:** Phone showing Mira's response after analyzing the photo — identifying the component, the issue, and the fix.

**How:**

1. Wait for Mira's response to the photo
2. Scroll so the full response is visible
3. Screenshot
4. Rename to `voice-vision-03-identified.png`

---

## Post-capture processing — 10 minutes

Once you have all 12 files:

### 1. Redact sensitive info

Open each in Paint.NET or Figma and blur/cover:
- Real customer names → replace with "Acme Manufacturing", "Line 3", "Facility A"
- Real email addresses → replace with `you@yourplant.com`
- Real tenant IDs, API keys, webhook secrets → blur or remove
- Real asset tag numbers → replace with generic like `ASSET-001`
- Any NDA equipment → crop it out

### 2. Compress

```bash
cd mira-web/public/images/features/
# If you have oxipng installed
oxipng -o max --strip safe *.png

# Otherwise, upload to tinypng.com and download compressed versions
```

Target: **under 400 KB per file**. Hero images can be slightly larger (up to 600 KB) since they're displayed bigger.

### 3. Verify dimensions

```bash
# macOS / Linux
identify mira-web/public/images/features/*.png

# Windows PowerShell
Get-ChildItem *.png | ForEach-Object { (New-Object -ComObject Shell.Application).Namespace($_.DirectoryName).GetDetailsOf((Get-Item $_.FullName), 31) }
```

Desktop captures should be ≥1600 wide. Mobile ≥750 wide. Heroes ≥1920 wide.

### 4. Place in `mira-web/public/images/features/`

The directory doesn't exist yet — create it first:

```bash
mkdir -p mira-web/public/images/features
```

Then copy all 12 PNGs in.

### 5. Commit and deploy

```bash
cd mira-web
git add public/images/features/
git commit -m "feat(mira-web): add feature page screenshots"
git push origin staging
ssh vps "cd /opt/mira && git pull origin staging && cd mira-web && \
  doppler run --project factorylm --config prd -- \
  docker compose up -d --build --force-recreate mira-web"
```

---

## Wiring screenshots into the pages

After you commit the PNGs, tell me and I'll:

1. Update `feature-renderer.ts` to accept optional image URLs in the `Feature` data structure
2. Swap the "placeholder" slide rendering for the home-page slideshows to use the real screenshots instead of the text cards (keep the text cards as a progressive enhancement / noscript fallback)
3. Add the hero image to the top of each feature page (above or instead of the Loom video slot)
4. Re-deploy and re-crawl

**Alternative:** if you want the text data cards to remain on the home slideshow (they're actually pretty effective as HMI-aesthetic content) and only want the screenshots on the feature deep-dive pages, say so and I'll only wire the hero images without touching the home slides.

---

## If you run into trouble

| Problem | Fix |
|---|---|
| Mira chat not loading on phone | Hard refresh (long-press reload), check cell signal, try `factorylm.com/cmms` instead of `app.factorylm.com` |
| Voice input not working | Chrome on iOS doesn't expose voice to web apps — use Safari |
| Atlas CMMS empty | SSH to Bravo, run `docker exec atlas-api ...` to seed demo data, OR create WOs manually via UI |
| Screenshot blurry | Use 2x retina capture, don't save as JPG (use PNG), don't zoom in post-capture |
| Real customer info visible | Redact with Paint.NET before committing. **NEVER commit unredacted screenshots — they go to a public-ish staging repo.** |

---

## Quick checklist to print

- [ ] Mira chat running, can send a query
- [ ] Atlas CMMS running, has at least 3 work orders
- [ ] Phone unlocked with Mira web app loaded on Safari
- [ ] `mira-web/public/images/features/` directory created
- [ ] **Fault Diagnosis:** hero + 3 slides captured (4 files)
- [ ] **CMMS Integration:** hero + 3 slides captured (4 files)
- [ ] **Voice + Vision:** hero + 3 slides captured on phone (4 files)
- [ ] All files redacted for sensitive info
- [ ] All files compressed under 400 KB (600 KB for heroes)
- [ ] All files in correct location with correct naming
- [ ] Committed + pushed + deployed
- [ ] Notified Claude to wire them into the renderer

---

_Guide generated 2026-04-10. Matches the `feature-renderer.ts` + home slideshow implementation from commit `a540ef8`._
