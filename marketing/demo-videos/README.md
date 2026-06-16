# MIRA Demo Videos — Recording & Assembly Guide

Five story scripts. You record the voice. The pipeline assembles the video.

## Stories

| ID | Title | Duration | Audience |
|----|-------|----------|----------|
| `60-second-setup` | The 60-Second Setup | ~75s | Plant managers |
| `fault-code-30-seconds` | Fault Code in 30 Seconds | ~60s | Technicians |
| `qr-scan-to-diagnose` | Scan to Diagnose | ~70s | Trade show demos |
| `pm-scheduling-autopilot` | PM Scheduling on Autopilot | ~80s | Maintenance managers |
| `your-team-your-manuals` | Your Team. Your Manuals. Your AI. | ~90s | YouTube / brand |

Full scripts (narration text, camera notes, screenshot assignments): `story-scripts.yaml`

---

## Step 1 — Capture Missing Screenshots

Some shots still need authenticated screenshots (marked `screenshot_needed: true` in the YAML).

```bash
# Automated capture (requires login)
doppler run --project factorylm --config prd -- \
  python tools/capture-screenshots.py --base-url https://app.factorylm.com
```

Or log in manually at app.factorylm.com and take screenshots with your browser.

Save to `docs/promo-screenshots/` with descriptive filenames, then update the `file:` path in `story-scripts.yaml`.

---

## Step 2 — Record Your Voice

One audio file per beat. Name them sequentially.

**Folder structure:**
```
marketing/demo-videos/recordings/
  60-second-setup/
    beat-01.mp3   ← "Your team knows the fault codes..."
    beat-02.mp3   ← "FactoryLM is an AI workspace..."
    ...
  fault-code-30-seconds/
    beat-01.mp3
    ...
```

**Recording tips:**
- 85% of normal speaking speed. Slow is confident.
- Pause 1 full second at the end of each sentence before stopping the recording.
- Quiet room. No AC hum. (Factory ambience gets added in post.)
- Any mic works — phone memo app, Quicktime, Audacity.
- Export as MP3, 128 kbps minimum.

**The narration text for each beat is in `story-scripts.yaml` under `narration:`.**

---

## Step 3 — Assemble the Video

`build_video_v2.py` has been extended and supports all three modes:

### Option A — TTS voice (no recording required, fastest)

The pipeline generates AI voice from your narration text automatically.

```bash
cd marketing/comic-pipeline
doppler run --project factorylm --config prd -- \
    .venv/bin/python build_video_v2.py \
    --storyboard ../demo-videos/story-scripts.yaml \
    --story 60-second-setup \
    --skip-verify
```

Output: `marketing/videos/demo-60-second-setup.mp4`

### Option B — Your recorded voice

Record your lines (one MP3 per beat, named `beat-01.mp3` onward), then:

```bash
cd marketing/comic-pipeline
.venv/bin/python build_video_v2.py \
    --storyboard ../demo-videos/story-scripts.yaml \
    --story 60-second-setup \
    --recordings ../demo-videos/recordings/60-second-setup/ \
    --skip-verify
```

### Dry run (check all screenshots exist before building)

```bash
.venv/bin/python build_video_v2.py \
    --storyboard ../demo-videos/story-scripts.yaml \
    --story your-team-your-manuals \
    --dry-run
```

All 5 stories have been validated — every screenshot resolves `✓`.

---

## Step 4 — Review

```bash
open marketing/videos/demo-60-second-setup.mp4
```

Tweak: adjust beat `duration:` values in `story-scripts.yaml` if the camera feels rushed or slow relative to your voice recording.

---

## Pipeline Dependencies

- `ffmpeg` + `ffprobe` — `brew install ffmpeg`
- `python 3.12` via `uv`
- `openai` Python SDK (for any TTS fallback if you want AI voice for a beat)
- `OPENAI_API_KEY` in Doppler (only needed if using TTS — not required for user recordings)

---

## File Map

```
marketing/demo-videos/
  README.md                    ← this file
  story-scripts.yaml           ← 5 story scripts with narration + camera notes

marketing/demo-videos/recordings/
  <story-id>/
    beat-01.mp3 … beat-NN.mp3  ← your voice recordings (create this folder)

docs/promo-screenshots/        ← all screenshots (existing + newly captured)

marketing/videos/              ← assembled MP4 output
  demo-60-second-setup.mp4
  demo-fault-code-30s.mp4
  demo-qr-scan.mp4
  demo-pm-scheduling.mp4
  demo-brand-story.mp4
```
