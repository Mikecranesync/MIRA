# Marketing Video Pipeline — Rollback & Tool Selection

**Date:** 2026-05-11
**Branch:** `claude/determined-maxwell-a934fd` (intent: `feat/marketing-hyperframes-v1`)

This document explains how to revert to the old pipeline, when to use which tool, and the version pinning strategy.

---

## TL;DR

Both pipelines live side-by-side in `marketing/`:

```
marketing/
├── comic-pipeline/        # OLD — unchanged, full rollback target
└── hyperframes/           # NEW — installed 2026-05-11, HyperFrames 0.5.7
    ├── VERSION.md
    ├── demo-project/      # scaffolded composition project
    └── output/            # rendered MP4s
```

**Nothing in `marketing/comic-pipeline/` has been touched.** The old pipeline still runs exactly as before — same Python entry point, same CLI flags, same outputs.

---

## How to revert to the old pipeline

### Option 1 — just use it (no revert needed)
The comic pipeline is untouched. To produce a video the old way:

```bash
cd marketing/comic-pipeline
doppler run --project factorylm --config prd -- \
  .venv/bin/python build_video_v2.py \
  --storyboard ../demo-videos/story-scripts.yaml \
  --story 60-second-setup
```

Output lands at `marketing/videos/demo-60-second-setup.mp4` per the story's `output:` key.

### Option 2 — delete HyperFrames entirely
If you decide HyperFrames isn't worth keeping in the repo:

```bash
git rm -rf marketing/hyperframes
git rm marketing/BENCHMARK.md marketing/ROLLBACK.md
git commit -m "revert: remove hyperframes evaluation"
```

The comic pipeline is unaffected.

### Option 3 — branch revert
Since this work is on branch `claude/determined-maxwell-a934fd` (intent: `feat/marketing-hyperframes-v1`), simply don't merge it. `main` continues with the comic pipeline only.

---

## When to use which tool

| Need | Tool | Why |
|---|---|---|
| LinkedIn / cold-email screenshot slideshow with TTS narration | **comic-pipeline** | OpenAI `gpt-4o-mini-tts` quality, synthesized music bed + sidechain duck, YAML story schema editable by non-devs, idempotent re-renders |
| Polished landing-page hero / ProductHunt launch reel | **hyperframes** | GSAP transitions, shader effects, multi-worker render, live preview studio, embeddable player |
| Quick proof / iteration on motion | **hyperframes** | `npm run dev` live preview vs full ffmpeg re-render |
| One-off "render this 8-screenshot story for cold email" | **comic-pipeline** | Story schema already exists in `marketing/demo-videos/story-scripts.yaml`; no porting cost |
| Visual regression / key-frame snapshots | **hyperframes** | `hyperframes snapshot` exports PNG key-frames |
| Anything requiring DOM animation, cursor trails, animated UI emphasis | **hyperframes** | HTML/CSS/JS-native; comic-pipeline is static-PNG slideshow only |
| Anything where Chrome cannot be installed on the renderer | **comic-pipeline** | HyperFrames requires headless Chrome; comic-pipeline only needs Python + ffmpeg |

### Default heuristic
- If the user says **"new marketing video"** with brand polish in mind → HyperFrames
- If the user says **"render the 60-second story I already have"** or **"build all 5 demo videos"** → comic-pipeline (porting cost not justified)
- If unsure → run both and diff. They live in separate trees; both can produce the same story side-by-side.

---

## Version pinning strategy

### Comic pipeline
- `marketing/comic-pipeline/VERSION` → plain text version (currently `1.0.0`)
- `marketing/comic-pipeline/requirements.txt` → Python deps, pinned
- Python version: 3.12 (per `.claude/rules/python-standards.md`)
- ffmpeg version: whatever brew installs (currently 8.1.1 on Charlie)
- Bumping the comic pipeline: increment `VERSION`, add `CHANGELOG.md` entry, no other ceremony

### HyperFrames
- **Exact patch pin** at the npx call site: `npx --yes hyperframes@0.5.7 ...` in `package.json` scripts
- `devDependencies` mirror in `marketing/hyperframes/demo-project/package.json` for `npm install` correctness
- **No `^` or `~` ranges anywhere**
- Bump procedure documented in `marketing/hyperframes/VERSION.md`:
  1. Render the POC composition on current version → save as `output/baseline-<old-version>.mp4`
  2. Bump version in `package.json` scripts + `devDependencies`
  3. Re-render → diff side-by-side
  4. Update `VERSION.md`
  5. Major version bumps require a new row in `BENCHMARK.md`

### System dependencies (both pipelines)
- ffmpeg: `brew install ffmpeg` — both pipelines need it
- Doppler: `factorylm/prd` config (comic-pipeline uses `OPENAI_API_KEY`)
- Chrome: HyperFrames bundles its own Chromium download on first run

---

## Decision log

- **2026-05-11** — Installed HyperFrames 0.5.7 on Charlie. POC render of `60-second-setup` story (no audio, 80.5s, 9.8 MB, 46.47s wall-clock with 4 workers). Both pipelines retained. Decision deferred on which to promote as default — pending audio path validation and a side-by-side render of all 5 demo stories.

---

## Open questions (not blocking rollback)

1. Audio pipeline for HyperFrames — wire up OpenAI gpt-4o-mini-tts (current pipeline's strength) instead of local Kokoro?
2. Should `marketing/comic-pipeline/` be moved to `marketing/legacy/comic-pipeline/` once HyperFrames covers all 5 stories?
3. CI: should HyperFrames `lint` + `validate` run on every push that touches `marketing/hyperframes/`?
