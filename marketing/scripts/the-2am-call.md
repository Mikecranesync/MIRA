# The 2AM Call — MIRA Demo Video Script

**Total runtime:** ~44 seconds  
**Format:** 6-clip narrative sequence, no dialogue, music + VO  
**Tone:** Tense → resolved. Industrial realism → brand confidence.  
**Target:** LinkedIn feed (square crop optional), trade show loops, sales deck opener

---

## Voiceover Script

> *[Clip 1 — factory floor, 0:00–0:10]*  
> "It's 2AM. The line is down."

> *[Clip 2 — tired tech, 0:10–0:18]*  
> "Your best tech is staring at a fault code. No manual. No backup."

> *[Clip 3 — QR scan, 0:18–0:26]*  
> "He scans the QR code."

> *[Clip 4 — safety stop, 0:26–0:31]*  
> "MIRA flags a hazard before he touches anything."

> *[Clip 5 — fix motor, 0:31–0:39]*  
> "Then walks him through the fix — step by step."

> *[Clip 6 — logo reveal, 0:39–0:44]*  
> "MIRA. Your AI maintenance tech. On call 24/7."

---

## Shot List

| # | Scenario key | Duration | Description |
|---|---|---|---|
| 1 | `2am-factory-floor` | 10s | Wide: dark factory, strobing warning lights, tech enters |
| 2 | `2am-frustrated-tech` | 8s | Close-up: exhausted tech face, VFD fault LED blinking |
| 3 | `2am-qr-scan` | 8s | Macro: hands scan QR, MIRA chat UI fires up on screen |
| 4 | `2am-safety-stop` | 5s | Insert: phone screen red WARNING, hand freezes |
| 5 | `2am-fix-motor` | 8s | Medium: tech follows MIRA steps, fault LED goes green |
| 6 | `2am-logo-reveal` | 5s | Logo: MIRA wordmark fades in on dark background |

**Total:** 44 seconds

---

## Production Notes

### Music
- Sparse, low industrial drone in clips 1–2 (tension)
- Subtle UI sound design when QR scans in clip 3
- Resolve to clean, confident tone in clip 5
- Silence + single tone on logo reveal

### Edit rhythm
- Clips 1–2: slow cuts, held frames (establish dread)
- Clip 3: quick cut on scan → screen lights up
- Clip 4: hard cut to red screen (impact)
- Clip 5: steady pace as problem resolves
- Clip 6: 1-second fade from black

### Color grade
- Clips 1–4: desaturated, high-contrast, cool blue-grey with amber/red practical lights
- Clip 5: warm practical lamp, slight lift as tension breaks
- Clip 6: brand amber (#F59E0B) glow on dark charcoal

### Text overlays (optional for LinkedIn version)
- Clip 1: `2:17 AM` timestamp in corner (white, monospace)
- Clip 3: `"scanning..."` as subtitle
- Clip 4: echo the on-screen WARNING text as subtitle
- Clip 6: tagline as center subtitle under logo

### Output variants
| Variant | Crop | Notes |
|---|---|---|
| LinkedIn feed | 16:9 | Primary |
| LinkedIn story/reel | 9:16 vertical crop | Reframe clips 2–5 center |
| Trade show loop | 16:9, no VO | Music only, add captions |
| Sales deck GIF | Clip 3 only (QR scan) | 3s loop |

---

## Generation Commands

```bash
# Dry-run all 6 clips
for s in 2am-factory-floor 2am-frustrated-tech 2am-qr-scan 2am-safety-stop 2am-fix-motor 2am-logo-reveal; do
  BYTEPLUS_API_KEY=dryrun python3 tools/seedance-video-gen.py --scenario "$s" --dry-run
done

# Live generation (requires BYTEPLUS_API_KEY in Doppler)
doppler run --project factorylm --config prd -- python3 tools/seedance-video-gen.py --batch 2am-factory-floor,2am-frustrated-tech,2am-qr-scan,2am-safety-stop,2am-fix-motor,2am-logo-reveal
```

Output lands in `marketing/videos/`. Spend logged to `marketing/videos/spend.json`.

---

## Estimated Cost

| Clip | Resolution | Duration | Est. cost |
|---|---|---|---|
| 2am-factory-floor | 1080p | 10s | $0.18 |
| 2am-frustrated-tech | 1080p | 8s | $0.14 |
| 2am-qr-scan | 1080p | 8s | $0.14 |
| 2am-safety-stop | 1080p | 5s | $0.09 |
| 2am-fix-motor | 1080p | 8s | $0.14 |
| 2am-logo-reveal | 1080p | 5s | $0.09 |
| **Total** | | **44s** | **~$0.78** |
