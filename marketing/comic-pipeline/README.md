# MIRA Comic Video Pipeline

Comic-strip-style explainer videos from text scripts. Generates panels with
OpenAI `gpt-image-1`, voiceover with `tts-1-hd`, and stitches a
YouTube-ready MP4 via ffmpeg.

Sibling of `~/mira/tools/seedance-video-gen.py` (text-to-video). Uses the
same `marketing/references/` and `marketing/videos/spend.json` conventions.

## Prereqs

- Python 3.12 via `uv` (mira repo standard)
- `ffmpeg` — install with `brew install ffmpeg`
- Doppler CLI with access to `factorylm/prd` (provides `OPENAI_API_KEY`)

## Install

```bash
cd ~/mira/marketing/comic-pipeline
uv venv --python 3.12
uv pip install -r requirements.txt
```

## Quick start

Dry run — cost estimate only, no API calls:

```bash
doppler run --project factorylm --config prd -- \
  python run_pipeline.py --dry-run --quality high
```

Proof one scene at medium quality (cheap, ~$0.20):

```bash
doppler run --project factorylm --config prd -- \
  python run_pipeline.py --scene 2 --quality medium
```

Full production run:

```bash
doppler run --project factorylm --config prd -- \
  python run_pipeline.py --scene all --quality high
```

## Re-running a single scene without redoing others

Idempotent — each step skips artefacts that already exist:

```bash
doppler run --project factorylm --config prd -- \
  python run_pipeline.py --scene 3
```

To force regeneration, delete the scene's artefacts first:

```bash
rm -rf output/panels/scene_3 output/audio/scene_3.mp3 output/scenes/scene_3.mp4
```

## Skip stages (debugging)

```bash
# Stitch-only (assumes panels + audio exist):
python run_pipeline.py --skip-images --skip-audio

# Regenerate final (keeps scene clips):
python run_pipeline.py --skip-images --skip-audio --skip-video   # (no-op, then final)
```

## Outputs

| Path | Contents |
|---|---|
| `output/panels/scene_{id}/panel_{n}.png` | Raw gpt-image-1 panels |
| `output/audio/scene_{id}.mp3` | Per-scene voiceover |
| `output/scenes/scene_{id}.mp4` | Per-scene stitched clip |
| `~/mira/marketing/videos/comic-v1/mira_explainer_v1.mp4` | **Final YouTube MP4** |
| `~/mira/marketing/videos/spend.json` | Cost pointer (shared with seedance) |

## YouTube upload specs (produced)

- 1920×1080, 24 fps, h264 high profile, yuv420p
- AAC 192 kbps stereo, 48 kHz
- `-movflags +faststart` for streaming

## Configuration

See `config.yaml`. Commonly tweaked:

| Key | Effect |
|---|---|
| `image_quality` | `low` / `medium` / `high` — dominates cost |
| `tts_voice` | Default `onyx`; also try `echo`, `sage`, `alloy` |
| `ken_burns_zoom_amount` | `0.03` = subtle, `0.08` = noticeable |
| `transition_duration` | Crossfade seconds between panels |
| `ambient_volume_db` | Background hum; `-25` ≈ barely audible |

## Character consistency (reference images)

When you have ChatGPT-generated reference comics of Rico / Deb / etc., drop
them in `~/mira/marketing/references/` and list them per scene in
`scripts/scene_scripts.yaml`:

```yaml
scenes:
  "1":
    reference_images:
      - comic-rico-reference.png
      - comic-deb-reference.png
```

When `reference_images` is non-empty, `generate_panels.py` routes to the
`images.edit()` endpoint — which conditions generation on the supplied
visuals, giving much tighter character consistency than text-only prompts.

## Provenance

`pipeline/multi_image_assembler.py` was lifted from
`~/factorylm/services/media/multi_image_assembler.py` on 2026-04-24. The
ffmpeg filter graph (Ken Burns + chained xfades with cumulative offset
math) is the non-trivial piece of that file. Modify in-place here — the
factorylm copy is the historical original, not a shared library.
