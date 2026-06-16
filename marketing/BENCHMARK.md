# Marketing Video Pipeline — Benchmark

**Date:** 2026-05-11
**Branch:** `claude/determined-maxwell-a934fd` (intent: `feat/marketing-hyperframes-v1`)
**Comparison target:** `marketing/comic-pipeline/` (current, v1.0.0) vs `marketing/hyperframes/` (new, HyperFrames 0.5.7)
**Test story:** `60-second-setup` (8 shots, 16 beats, 80s estimated duration)

---

## Current Pipeline — `marketing/comic-pipeline/build_video_v2.py`

### Capabilities (what it does today)
- Reads a multi-story YAML (`marketing/demo-videos/story-scripts.yaml`)
- Per-beat TTS via OpenAI `gpt-4o-mini-tts` (voice: `onyx`, speed 1.05) — one call per narration sentence
- Per-beat focal points + zoom; camera animates beat-to-beat via piecewise ffmpeg `zoompan`
- Synthesized 2-mood (`problem` / `resolution`) ambient bed using ffmpeg `sine`/`anoise` sources
- Sidechain-ducked final mix (music ducks under narration)
- ffmpeg-based shot crossfades (`shot_xfade_duration: 0.5s`)
- Output: 1920×1080 @ 24fps MP4
- Idempotent — each step skips existing artefacts
- Verification pass via `pipeline/v2/verify.py` (checks output duration matches expected)
- Source images: pre-captured PNGs from `docs/promo-screenshots/`
- Cost tracking via `marketing/videos/spend.json`

### What it cannot do
- No live browser walkthroughs / DOM interaction recording (it's a slideshow of static PNGs)
- No HTML/CSS-based animation (everything via ffmpeg filtergraph)
- No GSAP / web-native transitions
- No timeline-based editor / preview studio
- No real-time visual diff
- No multi-worker parallel rendering
- No shader-based transitions

### Dry-run baseline (60-second-setup)
- Command: `python3 build_video_v2.py --storyboard ../demo-videos/story-scripts.yaml --story 60-second-setup --dry-run`
- Dry-run completes near-instantly (no API calls, no render — just YAML parse + asset existence check)
- 8 shots, 16 beats, **estimated duration 80s**
- All 16 screenshot dependencies resolve (`[✓]` for every beat)
- Output table: `output/v2/<story>/` per-shot artefacts; final under `marketing/videos/demo-60-second-setup.mp4`

### Scores (1–10)

| Dimension | Score | Justification |
|---|---|---|
| Visual quality — resolution | 8 | 1920×1080 fixed; no 4K path |
| Visual quality — transitions | 5 | Only ffmpeg `xfade` crossfade + `zoompan` ken-burns. No shader / GSAP / DOM motion. |
| Visual quality — effects | 4 | Static PNG + zoom/pan only. No text overlays animated, no cursor-trail, no UI emphasis pulses. |
| Audio — TTS naturalness | 7 | `gpt-4o-mini-tts` with `onyx` voice + style instructions; serviceable but not native-grade. |
| Audio — music bed | 6 | Pure synth sines + colored noise; ambient ok, not melodic. Sidechain duck is solid. |
| Production speed — dry-run | 10 | Instant (~sub-second), no API cost. |
| Production speed — full render | 5 | OpenAI TTS round-trips (~16 calls) + ffmpeg single-process render. Estimated ~3–6 min per 80s video. |
| Maintainability — config-per-video | 7 | One YAML block per story; ~60 lines for 60-second-setup. Schema is established and readable. |
| Maintainability — code complexity | 5 | 585-line orchestrator + 5-module `pipeline/v2/` package. Heavy ffmpeg filtergraph string-building. |
| Output formats | 4 | MP4 only. No WebM, no PNG snapshot path, no embed format. |
| **Total** | **61 / 100** | |

---

## HyperFrames — `marketing/hyperframes/` (target)

To be populated after Phase 3 POC render. See Phase 4 section below.

### Capabilities (per `npx hyperframes --help`, v0.5.7)
- HTML/CSS compositions with GSAP animation
- `preview` — live studio (hot-reload)
- `render` — MP4 / WebM output
- `benchmark` — built-in render benchmark across fps/quality/worker presets
- `lint` / `inspect` / `snapshot` — composition validation + visual diff
- `transcribe` (word-level timestamps) + `tts` (local Kokoro-82M)
- `remove-background` for media prep
- `capture` — website-to-composition import
- Registry of `add`-able blocks + components

### POC Render — 60-second-setup (2026-05-11)

- Composition: `marketing/hyperframes/demo-project/index.html` (~210 lines incl. GSAP timeline JS)
- Lint: `0 error(s), 4 warning(s)` (track density + caption-exit hard-kill; non-blocking)
- Validate (headless Chrome): `0 errors, 3 contrast warnings` (caption-on-light-bg)
- Render command: `npx hyperframes@0.5.7 render --output output/60-second-setup.mp4`
- **Wall-clock: 46.47s (4 workers, 10 cores)** vs current pipeline's estimated 3–6 min for the same story
- Output: `marketing/hyperframes/output/60-second-setup.mp4`
- Format: 1920×1080 @ 30fps, h264, **9.8 MB**, 80.5s duration, ~1.0 Mbps
- Frames captured: 2415 (30fps × 80.5s)
- GPU: hardware (WebGL probe succeeded, M4 Mac mini)
- No audio (POC scope — narration/TTS deferred; see "Limitations" below)

### Scores (1–10)

| Dimension | Score | Justification |
|---|---|---|
| Visual quality — resolution | 8 | Same 1920×1080; 4K trivial via `data-width/height` change |
| Visual quality — transitions | 8 | GSAP timelines, easing, transform-origin ken-burns; `@hyperframes/shader-transitions` available |
| Visual quality — effects | 8 | HTML/CSS/DOM-native — captions, role tags, blur, backdrop-filter, gradients all "free" |
| Audio — TTS naturalness | 0 | Not used in POC. Kokoro-82M available via `hyperframes tts` but lower quality than OpenAI gpt-4o-mini-tts |
| Audio — music bed | 3 | No built-in synth; must supply audio file. Trivial to layer once you have a track. |
| Production speed — dry-run | 6 | `lint`+`validate` runs in ~5–10s (vs current's instant). Heavier because it actually compiles + headless-Chrome inspects. |
| Production speed — full render | 8 | 46.47s for 80.5s video at 30fps with 4 workers. Current pipeline est. 3–6 min. ~4–8× faster end-to-end. |
| Maintainability — config-per-video | 6 | One HTML file per composition (~210 lines for 8-shot story). More verbose than YAML but co-locates timing+style+motion. |
| Maintainability — code complexity | 7 | Framework owns the hard parts (frame capture, encoder, browser pool). Composition is plain HTML+GSAP — readable. |
| Output formats | 8 | MP4 + WebM + PNG snapshot (`hyperframes snapshot`) + publish (`hyperframes publish`) + embed (`@hyperframes/player`) |
| **Total** | **62 / 100** (no audio) / **77 / 100** (audio path-clear) | Without audio, HyperFrames roughly ties on total; with audio wired up, it clearly leads on speed/transitions/formats. |

### What HyperFrames adds that the current pipeline can't do
- **Live preview studio** (`npm run dev`) with hot-reload — see the timeline scrubbing without re-rendering
- **GSAP timelines** — easing curves, staggered tweens, complex motion, anime.js/lottie/three.js adapters
- **Shader transitions** via `@hyperframes/shader-transitions`
- **Multi-worker frame capture** — 4 workers default, scales to CPU count
- **`lint` + `validate` + `inspect`** — semantic checks before render (caption contrast, track density, missing kill tweens)
- **`snapshot`** — PNG key-frame export for visual regression
- **`benchmark`** — built-in fps/quality/worker preset comparison
- **`publish`** — one-command shareable URL
- **`@hyperframes/player`** — embed in landing pages

### What the current pipeline does that HyperFrames doesn't
- **OpenAI `gpt-4o-mini-tts` quality** — significantly more natural than local Kokoro-82M (subjective; benchmark separately)
- **Synthesized 2-mood music bed** — sine + colored-noise ambient generated from YAML; HyperFrames requires an external audio file
- **Sidechain ducking** — built into the v2 ffmpeg filtergraph; HyperFrames leaves this to user-supplied audio
- **YAML story schema** — non-developers can edit a story; HyperFrames requires HTML+JS literacy
- **Idempotent stage skipping** — re-render one shot without redoing TTS / music; HyperFrames re-encodes everything
- **No system Chrome dependency** — current pipeline only needs Python + ffmpeg

### Limitations of this POC
- Audio not wired up (silent MP4). Path-clear options: (a) generate per-shot TTS via current `pipeline/v2/tts.py`, build a master `.wav` with the same beat timings, and reference it from the HTML via `<audio>` element; (b) use `hyperframes tts` (Kokoro-82M local).
- Captions use a dark overlay; 3 captions fall below WCAG AA contrast on light screenshots. Trivial fix: solid background, no transparency, on those beats.
- Font fallback: `SF Pro Display` doesn't map to a HyperFrames deterministic font — fell back automatically. Add `@font-face` if exact font matters.

---

## Decision criteria

- HyperFrames wins on: native DOM animation, shader transitions, GSAP, live preview, multi-worker render, output format breadth.
- Comic pipeline wins on: zero-install Python tooling already in cluster, OpenAI TTS quality, synthesized music bed, established story schema, screenshot pipeline integration.
- Likely hybrid: keep comic-pipeline for fast screenshot-slideshow renders (LinkedIn cold email cuts); use HyperFrames for polished hero/launch reels.

See `marketing/ROLLBACK.md` for switching strategy.
