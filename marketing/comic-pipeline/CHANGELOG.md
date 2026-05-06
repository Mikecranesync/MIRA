# Comic Pipeline / Promo Director Changelog

## comic-pipeline/v1.0.0 — 2026-04-27

First versioned release. Establishes the gold-standard director playbook
and the runnable skill that produces conformant manifests.

### Added
- `PROMO_DIRECTOR_PLAYBOOK.md` — canonical 6-step formula
  (Hook → Pain → Reveal → Demo → Proof → CTA), grounded in 30+ cited videos
  across B2B SaaS, industrial / blue-collar, and direct-response. Locks in
  voice prompt, ffmpeg defaults, length brackets, banned vocabulary,
  industrial overrides.
- `build_screenshot_demo.py` — entry script that stitches existing
  screenshots + TTS voiceover into a 1920×1080 MP4 via the existing
  multi_image_assembler. Mirrors comic-pipeline patterns; no OpenAI image
  generation required.
- `scripts/make_text_card.py` — generates 1920×1080 dark-bg text cards
  (Pain / CTA / Proof) via PIL with Segoe UI Bold or Arial Bold fallback.
- `scripts/ux_demo_pilot.yaml` — 3-frame pilot manifest for path validation.
- `scripts/ux_demo_full.yaml` — 19-frame v1 demo (sequential narration,
  retained for A/B against v2).
- `scripts/ux_demo_v2_2026-04-27.yaml` — 9-frame v2 demo, first manifest
  produced under the playbook (Hook → Pain → Reveal → Demo → Proof → CTA).
- `assets/cards/pain-cost-of-downtime.png` and `cta-factorylm-demo.png` —
  text cards used by v2.
- `.claude/skills/promo-director/` — runnable Claude Code skill mirroring
  Tyler Germain's 6-step Meta-ad pattern (https://youtu.be/2jQEEJxJxPQ),
  adapted from static ads × 4 variants to product-demo videos × 2-3 variants.
  Includes: SKILL.md, PRODUCT_IDENTITY_BRIEF.md (cached), COMPETITOR_ANALYSIS.md
  (cached, refreshed weekly), CREATIVE_BRIEF_TEMPLATE.md, workspace/.gitignore.

### Bug fixes (vs unreleased pipeline state)
- TTS voice prompt no longer concatenated into `input` text. Previous
  pipeline path used `tts-1-hd` and prepended the style instruction, which
  got read aloud (~6 extra spoken seconds of voice-direction text). Now
  uses `gpt-4o-mini-tts` with the proper `instructions` parameter.

### Notes
- comic-pipeline is internal tooling; not part of the customer-facing
  package set (mira-hub, mira-web, mira-cmms, factorylm-landing). Versioned
  here so future renders have a reproducible director-playbook revision
  pointer.
- Rendered MP4s and TTS MP3s are gitignored via `marketing/videos/.gitignore`.
  Manifests + scripts are tracked. Reproduce locally with
  `doppler run -- .venv/Scripts/python.exe marketing/comic-pipeline/build_screenshot_demo.py --manifest <path>`.
