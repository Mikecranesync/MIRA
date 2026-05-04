---
name: promo-director
description: Use this skill when the user asks to create, draft, render, or iterate a promo or product-demo video for MIRA / FactoryLM — landing-page hero, YouTube demo, ProductHunt launch reel, sales-enablement walkthrough, internal feature recap. Codifies the gold-standard director playbook (6-step Hook → Pain → Reveal → Demo → Proof → CTA, with industrial-buyer + direct-response overrides) into a runnable pipeline that emits manifest YAMLs and renders MP4s in parallel via the existing comic-pipeline. Mirrors Tyler Germain's 6-step Claude Code skill pattern, adapted for video. Trigger on phrases like "make a promo video", "render a demo", "draft a homepage hero", "produce a video for X feature", "stitch screenshots into a video", "iterate the demo", "generate a launch reel".
---

# promo-director

Turns a one-line brief into 1–3 ready-to-watch product-demo MP4s in <5 minutes. Reads `marketing/comic-pipeline/PROMO_DIRECTOR_PLAYBOOK.md` as canon. Calls `marketing/comic-pipeline/build_screenshot_demo.py` as the renderer. Mirrors Tyler Germain's 6-step Meta-ad skill structure (https://youtu.be/2jQEEJxJxPQ), adapted to industrial product video.

## When this skill is in play

User wants a promo/demo video. Could be:
- Existing screenshots → stitched demo (default path)
- Mix of screenshots + generated hero/card frames (gpt-image-1 path; opt-in)
- Pure text-card walkthrough (no screenshots; rare)

If the user already has a manifest YAML and just wants it rendered, run `build_screenshot_demo.py` directly — don't invoke this skill.

## Pre-flight

- `OPENAI_API_KEY` in Doppler `factorylm/prd` (verified — used for TTS and optional gpt-image-1)
- `ffmpeg` + `ffprobe` on PATH
- Python venv at `.venv/Scripts/python.exe` (Windows) or `.venv/bin/python` (mac/linux) with `openai` + `pyyaml` installed
- Playbook present at `marketing/comic-pipeline/PROMO_DIRECTOR_PLAYBOOK.md`

If any of these fail, abort and surface the missing piece — never silently degrade.

## The 6 steps (Tyler's pattern, our parameters)

```
brief → ICP → competitor lookup → creative briefs → reference images → manifests + render → iterate
  1        2          3                  4                 5                    6              7
```

Per-run workspace lands at `.claude/skills/promo-director/workspace/<YYYY-MM-DD>-<gen-id>/`.
Final renders land at `marketing/videos/<YYYY-MM-DD>-<gen-id>/`.

### Step 1 — Capture the brief

Take the user's one-liner and parse into structured fields. If anything is missing, ask once.

Required fields:
- `slug` — kebab-case run identifier (e.g., `fault-diagnosis-homepage-hero`)
- `length_bracket` — `under-30s` / `30-60s` / `60-120s` / `2-4min` (defaults to `60-120s`)
- `audience` — `tech` / `manager` / `mixed` (defaults to `tech` for MIRA)
- `core_proof` — one specific verifiable fact you can stand behind. Without this, abort. Example: "MIRA pulled the wiring diagram for a PowerFlex 525 fault in 11 seconds."
- `cta_url` — the single URL that closes the video (default `factorylm.com/demo`)

Optional:
- `screenshots_dir` — path containing PNGs. Defaults to `tools/audit/app-screenshots/` for product demos
- `screenshot_pattern` — glob to filter (default `ux-*.png`)
- `variants` — `1`–`3`, default `2` (videos cost real time/money to render; don't generate 4 like Tyler's static ads)
- `voice` — overrides playbook default `onyx`
- `playbook_overrides` — explicit list of rules being broken with reasons (rare)

Save: `workspace/<gen-id>/01-brief.md`

### Step 2 — Product identity brief (Tyler step 2)

Pull MIRA's customer voice, ICP, pain points, and tone — but **don't re-invent every run**. Cache an evergreen brief at `references/PRODUCT_IDENTITY_BRIEF.md` (you maintain it). Per-run, read it and patch with anything specific to this brief's feature focus.

Read these for context (in order, fastest first):
1. `references/PRODUCT_IDENTITY_BRIEF.md` (cached, evergreen)
2. `wiki/hot.md` for current state
3. `marketing/comic-pipeline/PROMO_DIRECTOR_PLAYBOOK.md` (vocabulary register + banned phrases — non-negotiable)
4. The 4 psychological pillars in the cached identity brief (re-state only if the user asks)

Save: `workspace/<gen-id>/02-product-brief.md` (often just a one-line patch on top of the evergreen brief — that's fine)

### Step 3 — Competitor analysis (Tyler step 3, adapted)

We do **not** scrape the Facebook Ads Library — industrial buyers don't see CMMS ads there. Instead, we cache YouTube competitor analysis at `references/COMPETITOR_ANALYSIS.md` and refresh it weekly via `superpowers:research` or the `compound-engineering:research:ce-web-researcher` agent.

Per run: read the cached file. Look up gaps relevant to the current brief's feature focus. Don't re-run the full scan unless `--refresh-competitors` is passed.

Refresh trigger:
```bash
# Weekly cron candidate; manual until then
/researcher "Refresh COMPETITOR_ANALYSIS.md — UpKeep, MaintainX, Fiix,
Tractian, Augury, Inductive Automation, Fluke. Top promo videos uploaded
since <last refresh date>. Pull title, hook, length, claims. Diff against
the prior cache."
```

Save: `workspace/<gen-id>/03-competitor-analysis.md` (delta only, not the full cache)

### Step 4 — Creative briefs (Tyler step 4, adapted to 2–3 variants)

Generate `variants` distinct briefs. Each must:
- Pick a different angle: `icp-pain-led` (open on the tech's frustration), `proof-led` (open on the verifiable fact from step 1), `walkthrough-led` (open mid-product use)
- Hit the same 6-step structure (Hook → Pain → Reveal → Demo → Proof → CTA)
- Pull from a different shot subset where possible — variants must visibly differ, not just rephrase
- Use the same locked voice prompt and ffmpeg defaults

Each brief includes:
- Angle name + 1-line summary
- Per-step copy (verbatim narration, not bullet points)
- Per-step screenshot mapping
- Estimated total length

Validate against the playbook before proceeding to step 5:
- ✗ Caption >8 words anywhere
- ✗ Banned phrase ("AI-powered", "game-changing", etc. — full list in playbook)
- ✗ "Hi, I'm…" / "We're excited to announce" / logo before second 3
- ✗ Multiple CTAs
- ✗ Outcome without a number in Proof
- ✗ Caption duplicates VO word-for-word

If any check fails, regenerate that brief once. If it fails twice, surface to user.

Save: `workspace/<gen-id>/04-creative-briefs.md` (one block per variant)

### Step 5 — Reference images (Tyler step 5, mostly skipped)

For most MIRA demos, screenshots are already in hand at `tools/audit/app-screenshots/`. Skip Tavily / gpt-image-1 unless:
- A brief explicitly calls for a hero/title card with branded copy → use gpt-image-1 (`marketing/comic-pipeline/pipeline/v2/panels.py` already wires this; PR #608 path)
- A brief calls for industrial b-roll we don't have (e.g., a real plant control panel as the opening shot) → Tavily search; only enable if `TAVILY_API_KEY` is in Doppler

If used, validate: image is 1920×1080 or larger, license is acceptable, content matches the brief's angle.

Save: `workspace/<gen-id>/05-reference-images/<variant-id>/` (only if any were generated/fetched)

### Step 6 — Manifests + render in parallel (Tyler step 6)

For each variant, produce a manifest YAML at `workspace/<gen-id>/06-manifests/variant-<a|b|c>.yaml`. The manifest schema is the same `build_screenshot_demo.py` reads today (see `marketing/comic-pipeline/scripts/ux_demo_full.yaml` for a working example).

Required fields per manifest:
```yaml
slug: <run-id>-<variant>
output_dir: marketing/videos/<YYYY-MM-DD>-<gen-id>/<variant>
width: 1920
height: 1080
zoom_amount: 0.012   # playbook default — about 1.4% over 5s
transition_duration: 0.4
fit_mode: letterbox
tts_voice: onyx
tts_model: gpt-4o-mini-tts
voiceover_style: |
  <verbatim from playbook — see PROMO_DIRECTOR_PLAYBOOK.md "Voiceover prompt">
frames:
  - image: <path>
    narration: <one line, ≤25 words, plain English>
  ...
```

Render in parallel — kick off N background `doppler run` jobs, one per variant, watch via `BashOutput` until each finishes:

```bash
doppler run --project factorylm --config prd -- \
  .venv/Scripts/python.exe marketing/comic-pipeline/build_screenshot_demo.py \
  --manifest <path>
```

When all renders finish, gather the outputs:

```
marketing/videos/<YYYY-MM-DD>-<gen-id>/
├── variant-a-icp-pain-led/
│   ├── variant-a-icp-pain-led.mp4
│   └── voiceover.mp3
├── variant-b-proof-led/
│   ├── variant-b-proof-led.mp4
│   └── voiceover.mp3
└── README.md   # the run summary
```

Run summary (`README.md` per gen-id):
- Brief recap (1 paragraph)
- Variant table: angle, length, file path, key narration line, playbook violations (should be zero)
- Render times + spend
- "Next moves" section: how to share (Tailscale HTTP server URL pattern from prior runs), how to iterate (step 7), how to upload (`upload_youtube.py` if Google Cloud OAuth set up)

### Step 7 — Iteration (Tyler's "make these more creative" loop)

Accept follow-up prompts and surgically regenerate:
- "Cut the hook in half on variant B" → regenerate brief B's Hook line + the manifest's first frame's narration; re-render only variant B
- "Drop the music" / "Different voice" → patch playbook overrides in manifest; re-render
- "Variant A is the keeper, kill the others" → mark A as the canonical one in run README; archive B and C

Iteration costs are dominated by TTS regeneration (~$0.01/iteration) + ffmpeg time (~30s for 60s of video).

## Calling the skill

```
/promo-director "60-second homepage hero on the fault-diagnosis flow.
Core proof: a tech got the PowerFlex 525 F012 wiring diagram in 11 seconds.
Two variants. Default voice."
```

The skill should answer in one of two ways:
1. **Brief is complete.** Echo the parsed brief, run all 6 steps, deliver MP4 paths + run README path.
2. **Brief is missing something critical.** Ask exactly one targeted question (don't enumerate everything missing — pick the most important gap).

Default to action over questioning when the brief has all required fields. Tyler's tool runs in under a minute on autopilot — match that energy.

## What this skill does NOT do

- ❌ Upload to YouTube (use `upload_youtube.py` separately, gated on Google Cloud OAuth setup)
- ❌ Post to social channels (no auto-posting; user reviews, then ships manually)
- ❌ Touch the live marketing site (no factorylm.com mutations from this skill)
- ❌ Generate Meta paid ads in the static-image variant-grid sense — fork a sibling skill for that
- ❌ Re-render existing v1 demos without an explicit `--rerender` flag

## Anti-patterns (don't let the skill produce these)

- Voice prompt concatenated into TTS input text (gets read aloud — happened in v1 of pipeline)
- Style instruction visible to viewers (any style brief in narration field)
- Variants that differ only in word-rephrasing — they must visibly differ
- Manifests that violate playbook rules without a `playbook_overrides` block
- More than 3 variants (videos cost time, this isn't a static-ad variant grid)
- Rendering before the brief validates against the playbook checklist

## Files this skill touches

**Reads:**
- `marketing/comic-pipeline/PROMO_DIRECTOR_PLAYBOOK.md`
- `.claude/skills/promo-director/references/*.md`
- `tools/audit/app-screenshots/*.png` (or whichever dir the brief specifies)
- Cached competitor analysis, product identity brief

**Writes:**
- `.claude/skills/promo-director/workspace/<gen-id>/*` (per-run scratch)
- `marketing/comic-pipeline/scripts/<slug>.yaml` (final manifests, per variant)
- `marketing/videos/<YYYY-MM-DD>-<gen-id>/*` (renders + run README)

**Calls:**
- `marketing/comic-pipeline/build_screenshot_demo.py` (the renderer — already shipped)
- OpenAI TTS via `OPENAI_API_KEY` from Doppler

## Provenance

This skill mirrors the structure Tyler Germain demonstrates in his "Claude Can Make Meta Ads Now?" video (https://youtu.be/2jQEEJxJxPQ) — the 6-step product-brief → competitor-analysis → creative-briefs → reference-images → parallel-generation pattern. We adapt for video instead of static images, drop the FB Ads scrape (wrong audience), and end at a rendered MP4 instead of a PNG ad.
