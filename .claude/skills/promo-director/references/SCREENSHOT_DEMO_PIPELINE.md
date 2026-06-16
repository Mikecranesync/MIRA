# Screenshot-Demo Render & Voice Runbook

Concrete, proven mechanics for turning a manifest of screenshots + narration into
a delivered MP4. This is the runnable companion to `SKILL.md`'s 6-step playbook —
the "how", verified end-to-end on CHARLIE 2026-06-01/02 (Phase 5 demos V13/V2/V16).

The renderer is `marketing/comic-pipeline/build_screenshot_demo.py`. It stitches
*existing* screenshots (no panel generation) + one concatenated voiceover into a
16:9 MP4 via `pipeline/multi_image_assembler.py`. Provider is manifest-driven.

---

## 1. Environment (CHARLIE / macOS)

- **Python:** `.venv/bin/python` (repo root). NOT `.venv/Scripts/python.exe` —
  that's the stale Windows path in old docs. Has `openai` + `pyyaml`.
- **ffmpeg / ffprobe:** `/opt/homebrew/bin` — prefix `PATH="/opt/homebrew/bin:$PATH"`
  (Homebrew is not on PATH by default here).
- **Secrets:** Doppler `factorylm/prd`. `GROQ_API_KEY` (TTS + Whisper) is there.
- A fresh-voice render needs network + Doppler. `--skip-tts` (image-only re-render)
  needs neither.

## 2. Voice / TTS — the provider ladder

**Use Groq Orpheus for production voice.** OpenAI TTS is DEAD on this org
(`429 insufficient_quota`) — do not depend on it. macOS `say` is the offline
rough-cut fallback only (never publish it).

| Tier | Provider | When |
|---|---|---|
| **Production** | Groq Orpheus | Real deliverable voice. Default. |
| Offline rough-cut | macOS `say` via `marketing/comic-pipeline/local_tts_say.py` | No network / terms not accepted / quick timing pass. Robotic — never ship. |
| ~~Dead~~ | OpenAI `gpt-4o-mini-tts` | 429 insufficient_quota. Don't reach for it. |

### Groq Orpheus specifics (memorize these — they cost us a round-trip)

- **Model:** `canopylabs/orpheus-v1-english`
- **Endpoint:** OpenAI-compatible `/audio/speech` at `https://api.groq.com/openai/v1`
  (the manifest-driven `tts_provider: groq` branch in `build_screenshot_demo.py`
  sets `base_url` to this and reads `GROQ_API_KEY`).
- **One-time gate:** the model requires **org-admin terms acceptance**. Until
  accepted, every call returns
  `{"error":{"code":"model_terms_required"}}`. Accept once at
  `https://console.groq.com/playground?model=canopylabs/orpheus-v1-english`.
  This is a human (org-admin) action — there is no API for it. **If a call returns
  `model_terms_required`, STOP and ask the user (org admin) to accept** — do not
  work around it. For a timing rough-cut while you wait, fall back to `say` (§8)
  and clearly label it not-for-publish.
- **Valid voices:** `autumn diana hannah` (female) · `austin daniel troy` (male).
  **NOT `leo`/`dan`** — those error with `voice must be one of …`. For the MIRA
  "senior field engineer, calm and direct" brief, `austin` (used in Phase 5) /
  `daniel` (slower) / `troy` (middle) are the male options.
- **Output format:** Orpheus emits **wav**, not mp3 → set `tts_format: wav` in the
  manifest. The script maps `response_format` to the output extension.
- **`voiceover_style` / `instructions`:** only applied when the model name contains
  `gpt-4o`. Orpheus ignores it — keep the style block for documentation / OpenAI
  fallback, but don't expect Orpheus to honor it.
- **Length:** the full 6-frame narration (~550–670 chars) renders in one call
  (≈35–55 s of audio). No chunking needed at demo length. If a future script is
  much longer and the audio comes back short, chunk per-frame and concatenate.

## 3. Manifest schema (production / Groq)

```yaml
slug: phase5-video-13-ask-conveyor
output_dir: marketing/videos/2026-05-31-phase5-demos/video-13-ask-conveyor
width: 1920
height: 1080
zoom_amount: 0.012        # ~1.4% Ken Burns over 5s — keeps UI text sharp
transition_duration: 0.4
fit_mode: letterbox       # preserve all source pixels
tts_provider: groq        # default "openai" (dead); use groq
tts_voice: austin         # autumn|diana|hannah|austin|daniel|troy
tts_model: canopylabs/orpheus-v1-english
tts_format: wav           # Orpheus emits wav, not mp3
voiceover_style: |        # ignored by Orpheus; kept for docs / gpt-4o fallback
  Adult male, 40s, calm and direct. Senior field engineer...
frames:
  - image: docs/promo-screenshots/<file>.png
    narration: "One line, plain English, treat product names as nouns."
  ...
```

## 4. Render command

```bash
cd /Users/charlienode/MIRA
PATH="/opt/homebrew/bin:$PATH"
doppler run --project factorylm --config prd -- \
  .venv/bin/python marketing/comic-pipeline/build_screenshot_demo.py \
  --manifest marketing/comic-pipeline/scripts/<slug>.yaml
```

- Output: `<output_dir>/<slug>.mp4` + `voiceover.{wav|mp3}`.
- **Re-render / existing manifest:** if a manifest already exists (e.g. a shipped
  demo at `marketing/comic-pipeline/scripts/<slug>.yaml`), edit it **in place** and
  re-run the same command — don't relocate it or make a new one. To change the
  voice on a finished demo: set `tts_provider/tts_voice/tts_model/tts_format`, then
  re-render (the old `voiceover.mp3` is orphaned — `rm` it; the new output is
  `voiceover.wav`).
- `--skip-tts` reuses an existing voiceover (image-only re-render — e.g. after a
  crop). Reuses by the manifest's `tts_format` extension, so a groq manifest
  reuses `voiceover.wav`.
- `marketing/videos/` is **gitignored** — MP4s/voiceovers are delivered directly,
  not committed. The **manifests** ARE tracked; commit those.

## 5. Hero-crop recipe (legibility for tall full-page screenshots)

A full-page capture (e.g. 1440×2200) letterboxed into 1920×1080 scales to height
→ width = `1440 × (1080/2200) ≈ 707px` — huge side-bars, tiny proof text. Crop to
the hero region so it fills by width instead:

```bash
PATH="/opt/homebrew/bin:$PATH"
# crop W:H:X:Y from top-left; pick H so the region is ~1.8:1 (fills 1920 wide)
ffmpeg -y -loglevel error -i in.png -vf "crop=1440:780:0:0" \
  docs/promo-screenshots/$(date +%F)_<feature>-hero-crop_desktop.png
```

- **Append-only** (Screenshot Rule): new dated filename; never overwrite/delete the
  original.
- Repoint the manifest frame at the crop, then **re-render** (use `--skip-tts` if
  the voice is already good) — a manifest edit alone does NOT change the delivered
  MP4.
- A 1440×780 crop fills 1920 wide with thin ~20px bars; proof text ≈ 2.7× larger.

## 6. Verification — MANDATORY before delivery

Evidence, not arithmetic (Cluster Law 1). Three checks:

**a. Streams + duration (every render):**
```bash
ffprobe -v error -show_entries format=duration:stream=codec_type,codec_name,width,height \
  -of default=noprint_wrappers=1 <slug>.mp4
# expect: video h264 1920x1080 + audio aac, duration ≈ audio length
```

**b. Audio completeness (catch truncated VO) — transcribe and compare:**
```bash
doppler run --project factorylm --config prd -- bash -c '
curl -sS -X POST "https://api.groq.com/openai/v1/audio/transcriptions" \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -F "model=whisper-large-v3" \
  -F "file=@<output_dir>/voiceover.wav" \
  -F "response_format=text"'
```
Compare the transcript tail to the manifest's last `narration` line. If the closing
line (usually the CTA) is present, the VO is complete. Do this whenever a render is
unexpectedly short. **Watch the CTA:** Whisper heard `factorylm.com` as
"FactoryL-E-M.com" — Orpheus may mispronounce `lm`. If it sounds wrong, spell it
phonetically in the narration ("factory L M dot com") and re-render.

**c. Legibility spot-check (after a crop or layout change):**
```bash
ffmpeg -y -loglevel error -ss <t> -i <slug>.mp4 -frames:v 1 /tmp/frame.png
# then Read /tmp/frame.png and confirm the proof text is readable at phone size
```

## 7. Deliver to the user's phone

Use `SendUserFile` with the MP4 path(s). Caption with voice + per-video lengths and
anything to listen for. The user watches in-thread on mobile — this is the standard
hand-off, not a Tailscale URL.

## 8. Offline fallback (`say`)

When Groq is unreachable or terms aren't accepted and you need a timing rough-cut:
`marketing/comic-pipeline/local_tts_say.py` wraps macOS `say`. It is robotic and
for internal review only — flag clearly that it is NOT the publish voice, and
re-render with Orpheus before any external use.

---

## Pitfalls (all hit this session)

- ❌ Reaching for OpenAI TTS — it's dead (429). Groq Orpheus is the voice.
- ❌ Using voice `leo`/`dan` — invalid. Use the six real Orpheus voices.
- ❌ Forgetting `tts_format: wav` for Orpheus → format/extension mismatch.
- ❌ Editing a manifest to point at a crop but not re-rendering — the MP4 is stale.
- ❌ Shipping a short render without a transcript check — silent truncation reads as
  "done" when the VO was cut.
- ❌ Treating arithmetic ("crop fills the frame") as verification — extract a frame
  and look.
- ❌ Committing `marketing/videos/*.mp4` — gitignored; commit the manifest instead.
