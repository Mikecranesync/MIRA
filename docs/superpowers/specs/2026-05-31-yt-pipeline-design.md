# Industrial Skills Hub — Autonomous YouTube Content Pipeline
**Date:** 2026-05-31
**Status:** Approved for implementation

## Overview

A fully autonomous pipeline that generates and publishes industrial education videos to the Industrial Skills Hub YouTube channel every other day. Content is hybrid: AI-generated B-roll (Seedance) + screen recording segments + MIRA product demos. Videos rotate through five topic areas.

**Channel:** Industrial Skills Hub (`UClcnAZ_z4jzzivifBVbLc3Q`)
**Cadence:** Every other day at 2:00 AM (APScheduler CronTrigger on Bravo)
**Target length:** 3–5 minutes per video
**Estimated cost:** ~$0.40/video in Seedance API calls (~$6/month)

---

## Architecture

```
tools/yt-pipeline/
├── main.py              # APScheduler entry point + launchd service
├── planner.py           # Topic rotation + LLM script generation
├── producer.py          # Seedance B-roll + screenshot selection
├── assembler.py         # ffmpeg assembly → final.mp4
├── uploader.py          # YouTube Data API v3 upload + metadata
├── topics.yaml          # Topic tree with angles per subject
└── calendar.json        # Runtime state — published videos, next topic index
```

Working directory per run: `/tmp/yt-pipeline/<run-id>/` — cleaned up after successful upload.

---

## Stage 1: Planner (`planner.py`)

Selects the next angle from `topics.yaml` using round-robin index stored in `calendar.json`. Calls the Groq → Cerebras → Gemini cascade (existing `shared/inference/router.py` pattern) to generate:

- **Title** — keyword-optimized, specific (e.g. "Why Your VFD Keeps Tripping on Overcurrent — 5 Causes and How to Fix Them")
- **Description** — 150–200 words with timestamps
- **Tags** — 8–12 keyword tags
- **3-scene script:**
  - Scene 1: B-roll hook prompt (Seedance)
  - Scene 2: Screen recording narration script (educational content)
  - Scene 3: MIRA demo prompt + screenshot keywords

### Topic tree (topics.yaml)

Five topic areas, each with 4+ angles — enough for ~20 unique videos before repeating:

| Area | Example angles |
|---|---|
| `vfd_troubleshooting` | Overcurrent fault causes, Modbus parameter setup, VFD sizing, parameter backup |
| `plc_basics` | Ladder logic for beginners, Micro820 I/O map, Factory I/O simulation, stuck output debug |
| `preventive_maintenance` | Inspection checklists, PM scheduling in MIRA, bearing replacement intervals, lubrication charts |
| `nameplates_manuals` | Reading motor nameplates, uploading OEM manuals to MIRA, extracting specs with AI |
| `mira_demos` | Work order from fault code, live VFD diagnosis, manual Q&A, QR scan to asset context |

---

## Stage 2: Producer (`producer.py`)

Given the 3-scene script from planner:

**B-roll generation:**
- Calls `tools/seedance-video-gen.py` with Scene 1 and Scene 3 prompts
- Resolution: 720p, duration: 8s per clip
- 2 clips per video (~$0.28 total)
- Saves to `/tmp/yt-pipeline/<run-id>/broll/`

**Screenshot selection:**
- Scans `docs/promo-screenshots/` for filenames matching Scene 3 keywords
- Selects up to 4 screenshots for the MIRA demo segment
- Falls back to most recent screenshots if no keyword match

**Screen recording placeholder:**
- Writes narration script to `/tmp/yt-pipeline/<run-id>/narration.txt`
- If no screen recording is provided, assembler inserts a 3-second title card: `"[SCREEN RECORDING: <topic>]"` — replaced manually or by a future automation pass

---

## Stage 3: Assembler (`assembler.py`)

Uses ffmpeg to stitch assets into a final 1080p/30fps MP4:

```
[Scene 1 B-roll 8s]
→ [Title card fade-in: video title, 3s]
→ [Screen recording OR placeholder title card]
→ [Scene 3 B-roll 8s]
→ [Screenshot slideshow: 4 screenshots × 5s each, Ken Burns effect]
→ [Outro card: "Try MIRA free at factorylm.com", 5s]
```

Total assembled length: ~3–5 min with screen recording, ~1 min without (placeholder mode).

All ffmpeg operations run locally on Bravo. No external dependencies beyond ffmpeg binary (already present in the Docker stack).

---

## Stage 4: Uploader (`uploader.py`)

Credentials from Doppler (`factorylm/dev`):
- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `YOUTUBE_REFRESH_TOKEN_ISH`

Upload flow:
1. Refresh access token via OAuth2 refresh grant
2. Initiate resumable upload (`POST /upload/youtube/v3/videos?uploadType=resumable`)
3. Stream `final.mp4` in 5MB chunks with retry on 5xx
4. Set metadata: title, description, tags, `categoryId=28` (Science & Technology)
5. Default visibility: **`private`** — pipeline logs video ID; a separate `publish.py --approve-all` command flips pending videos to public. Set `AUTO_PUBLISH=true` in Doppler to skip the review window and go straight to public.
6. Write result to `calendar.json`:

```json
{
  "video_id": "abc123",
  "title": "Why Your VFD Keeps Tripping...",
  "topic": "vfd_troubleshooting",
  "angle_index": 0,
  "status": "private",
  "uploaded_at": "2026-05-31T02:04:11Z"
}
```

---

## Stage 5: Scheduler (`main.py`)

APScheduler `CronTrigger(day='*/2', hour=2, minute=0)` — fires every other day at 2 AM Bravo local time.

Installed as a launchd plist on Bravo: `com.factorylm.yt-pipeline` (same pattern as existing KB ingest launchd services).

**Error handling:**
- Any stage failure: log full traceback to `/tmp/yt-pipeline/errors.log`, skip this run, increment retry counter in `calendar.json`
- After 3 consecutive failures: write a sentinel file `/tmp/yt-pipeline/PAUSED` — scheduler skips until sentinel is deleted manually
- No partial uploads: uploader only fires after assembler exits 0

---

## Credentials (Doppler `factorylm/dev`)

| Key | Value |
|---|---|
| `YOUTUBE_CLIENT_ID` | `807312245362-...apps.googleusercontent.com` |
| `YOUTUBE_CLIENT_SECRET` | `GOCSPX-...` |
| `YOUTUBE_REFRESH_TOKEN_ISH` | `1//05mCEp7Tk...` (Industrial Skills Hub) |
| `BYTEPLUS_API_KEY` | Required for Seedance — must be set |
| `AUTO_PUBLISH` | `false` (default) — set `true` for fully hands-off |

---

## Out of Scope

- Audio/voiceover generation (TTS) — future phase
- Custom thumbnail generation — future phase
- Analytics reporting / performance feedback loop — future phase
- Shorts format (vertical video) — future phase
- The CraneSync channel — separate OAuth token, separate pipeline instance if needed

---

## Success Criteria

1. Pipeline runs unattended every other day on Bravo
2. Each run produces a valid MP4 uploaded to ISH channel as private (or public if `AUTO_PUBLISH=true`)
3. `calendar.json` correctly tracks all published videos and prevents angle repetition
4. Seedance spend stays under $10/month
5. Pipeline self-pauses after 3 consecutive failures and logs a clear error
