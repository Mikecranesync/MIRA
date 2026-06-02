---
name: yt-content-pipeline
description: Operate, debug, or extend MIRA's autonomous YouTube content pipeline at `tools/yt-pipeline/` — the system that turns a rotating topic list into educational videos for the Industrial Skills Hub channel (Groq script → Seedance B-roll → screenshot slideshow → ffmpeg assembly → YouTube upload). USE THIS SKILL whenever the user mentions the YouTube pipeline, "the video pipeline", Industrial Skills Hub, generating/publishing a video, the content calendar, draft videos in `~/yt-pipeline-drafts/`, `publish-next.sh`, the launchd `com.factorylm.yt-pipeline` job, Seedance/BytePlus B-roll, the narration script/voiceover, or anything under `tools/yt-pipeline/` or `tests/yt_pipeline/` — even if they don't say "skill". It carries hard-won environment gotchas (python3.12, ffmpeg-without-drawtext, zoompan slowness, urllib 308, OpenAI/BytePlus payment blocks) so we never re-learn them the hard way.
---

# YouTube Content Pipeline

A self-contained autonomous pipeline (`tools/yt-pipeline/`) that publishes educational maintenance videos to the **Industrial Skills Hub** YouTube channel — designed to run unattended on the **Bravo** node via launchd. It is a standalone tool: it does **not** touch the engine / RAG / bot / VPS deploy path.

> **Authoritative design + full history:** `docs/superpowers/plans/2026-05-31-yt-pipeline.md` (read its "Plan Amendments A–E" — they record every course-correction). **Install:** `tools/yt-pipeline/INSTALL.md`. **Project memory:** `[[project_yt_pipeline]]`.

## Pipeline at a glance

```
main.py            orchestrator: 47h guard, pause sentinel, draft-vs-upload branch, --dry-run / --force
  └─ planner.py    Groq (llama-3.3-70b) picks next angle from topics.yaml (rotating index in calendar.json),
                   writes a tight ~60s script + HONEST reading-time chapter timestamps
  └─ producer.py   B-roll (Seedance, OPTIONAL) + screenshot selection (docs/promo-screenshots/) + narration (OpenAI TTS, OPTIONAL)
  └─ assembler.py  ffmpeg: PIL text cards + concat-FILTER normalize + mux → final.mp4
  └─ uploader.py   YouTube Data API v3 resumable upload (urllib, no-redirect opener)
```

Working files live in `/tmp/yt-pipeline/<run-id>/` (cleaned up after). State lives in `tools/yt-pipeline/calendar.json` (**gitignored** runtime file; `calendar.example.json` is the tracked template).

## How to operate it

All commands run from the repo root under Doppler. Use **`python3.12`** explicitly (see gotchas).

```bash
# Dry run — planner only, hits Groq, no production/upload. Needs only GROQ_API_KEY.
doppler run --project factorylm --config prd -- python3.12 -m tools.yt_pipeline.main --dry-run

# Produce the NEXT queued video now, bypassing the 47h guard (previews the angle first):
./tools/yt-pipeline/publish-next.sh            # produce (+ upload if voiced); --dry-run to plan only

# Install / remove the daily 2 AM launchd job on Bravo:
./tools/yt-pipeline/install.sh                 # install (see INSTALL.md for secret prereqs)
./tools/yt-pipeline/install.sh uninstall

# Pause / resume the scheduled job:
touch /tmp/yt-pipeline/PAUSED                  # pause
rm /tmp/yt-pipeline/PAUSED                      # resume

# Logs:
tail -f /tmp/yt-pipeline-stderr.log
```

**Force a specific topic:** the angle is `calendar.json["next_angle_index"] % len(angles)`. To regenerate a particular video, set `next_angle_index` (and `last_run_utc: null` to bypass the guard) in the gitignored `tools/yt-pipeline/calendar.json`, then run. `topics.yaml` holds 5 areas × 4 angles = 20 base angles.

## Operating modes — the pipeline auto-degrades, it does not crash

Each external dependency is **optional and gated**, so a blocked/absent API downgrades the output instead of failing the run. This is deliberate — the channel keeps producing.

| Dependency | Gate | When unavailable |
|---|---|---|
| **Seedance B-roll** (`BYTEPLUS_API_KEY`) | skipped if key falsy | video built from screenshots only |
| **Narration voiceover** (`OPENAI_API_KEY` → comic-pipeline TTS) | best-effort `try/except` | **silent video + `narration_script.txt`** saved for manual VO |
| **YouTube upload** (voiced only) | only if narration audio exists + creds present | silent runs save a **draft folder** instead of uploading |

**Draft output** (current default, both paid APIs blocked) lands in `~/yt-pipeline-drafts/<YYYYMMDD-HHMM>_<slug>/`:
- `final.mp4` — 1920×1080/30, silent
- `narration_script.txt` — the script for the user to record
- `meta.txt` — title + description (with honest chapters) + tags, ready for manual upload

> **Why best-effort, not key-presence:** gating narration on *whether the key exists* is NOT enough — the OpenAI key is present in Doppler but **out of quota** (429). `producer.synth_narration` is wrapped in `try/except` so ANY TTS failure (quota/billing/network) degrades to a silent draft and logs a warning. When the account is funded, voiced output resumes automatically with zero code change.

## Hard-won gotchas — READ BEFORE EDITING (this is the "don't relearn this" core)

1. **Use `python3.12`, never bare `python3`.** Bravo's `python3` is 3.14 and lacks `openai` (and breaks other deps). The launchd plist pins `/opt/homebrew/bin/python3.12`. Tests, dry-runs, everything → `python3.12`.

2. **This box's ffmpeg has NO `drawtext` (no libfreetype).** `ffmpeg -hide_banner -filters | grep drawtext` returns nothing. Title/outro cards are rendered as PNGs with **Pillow** (`assembler._render_card`, font `/System/Library/Fonts/Supplemental/Arial.ttf`) and fed to ffmpeg as image inputs. Do NOT reintroduce `drawtext` or the `subtitles`/`ass` filters.

3. **`zoompan` is catastrophically slow — keep it OUT.** The Ken Burns zoom did per-frame sub-pixel interpolation at 1080p; a ~100s slideshow took **15+ minutes** to encode (and hung the test suite). Static scaled/cropped frames render in seconds. The slideshow is intentionally motion-free.

4. **Always use the concat FILTER, never the concat demuxer, for mixed inputs.** Segments have mismatched resolution/fps (720p B-roll vs 1080p cards vs slideshow). The demuxer (`-f concat`) does not rescale → "Input link parameters do not match" / corrupt output. `assembler` normalizes every segment per-input (`scale→pad→setsar=1→fps=30→format=yuv420p`) inside a `concat=…` filter.

5. **urllib auto-follows HTTP 308 on Python 3.12** (`HTTPRedirectHandler.http_error_308` exists), which breaks YouTube's resumable-upload resume loop (it relies on catching `HTTPError(308)` to advance the byte offset). `uploader` uses a custom **no-redirect opener** so 3xx surfaces as `HTTPError` and the resume logic controls flow. Real (>5 MB, multi-chunk) uploads depend on this.

6. **TTS is reused, not reinvented.** `producer.synth_narration` imports `synth_beat` from `marketing/comic-pipeline/pipeline/v2/tts.py` (OpenAI `gpt-4o-mini-tts`, voice `onyx`) by adding the comic-pipeline root to `sys.path`. Don't write a new TTS path; don't use macOS `say` unless explicitly asked (the comic voice is the house voice).

7. **Video length is driven by narration, never fixed.** Voiced: `ffprobe` the narration mp3, size the slideshow to its duration. Silent: estimate from script word count (`max(30, words/150*60)` s). A fixed-length montage truncates narration — the early bug. `-shortest` was removed from the silent path so nothing is cut.

8. **Timestamps are computed from reading time, not invented.** `planner._chapter_timestamps` derives `0:00`-anchored, ≥10s-spaced, sub-runtime chapters from the script at ~150 wpm; `_polish_chapter_label` cleans the labels. The planner prompt explicitly forbids fabricated multi-minute markers (the old "0:00…4:30" on a 55s video bug).

9. **`calendar.json` is gitignored runtime state.** It mutates every run (index advance, `last_run_utc`, `drafts`/`published`). Never re-track it; ship changes via `calendar.example.json`.

10. **Secret-scanner false positives.** Mock tokens must not match real-credential regexes — e.g. a fake `ya29.test` (Google OAuth prefix) fails the Secrets Scan CI check. Use neutral placeholders like `fake-access-token` in fixtures.

## Current blockers (2026-06) and how it re-enables

Both paid APIs are payment-blocked, which is *why* draft mode exists:
- **BytePlus/Seedance:** payment rejected ("out of region"). Set `BYTEPLUS_API_KEY` (in a config the run uses) → B-roll bookends return.
- **OpenAI TTS:** out of quota (429 `insufficient_quota`, both dev+prd keys). Fund the account → narration becomes real voiceover.
- **Upload:** needs `BYTEPLUS_API_KEY` (only in `prd`) **and** `YOUTUBE_REFRESH_TOKEN_ISH` (only in `dev`) in the **same** config; the plist targets `prd`, so promote the `_ISH` token to prd (see INSTALL.md). `AUTO_PUBLISH` is absent → uploads default **private**; set `AUTO_PUBLISH=true` to go public.

No code changes are needed when the keys come back — the gates flip automatically.

## Extending

- **New topics/angles:** edit `tools/yt-pipeline/topics.yaml` (areas → angles list). The rotating index covers them automatically.
- **Cadence:** the 48h guard is `main._should_run` (`_MIN_INTERVAL_HOURS = 47`); launchd fires daily at 2 AM and the guard enforces every-other-day. `--force` bypasses the guard.
- **Pacing / look:** per-shot timing and normalization live in `assembler` (`_slideshow`, `_NORM`); screenshot selection + count in `producer.select_screenshots`.
- Before editing `engine.py`-adjacent shared code: this pipeline doesn't import it, so blast radius is contained to `tools/yt-pipeline/` + `tests/yt_pipeline/`.

## Testing

```bash
python3.12 -m pytest tests/yt_pipeline/ -q     # full suite (~20s; includes real-ffmpeg + silent-e2e)
ruff check tools/yt-pipeline/ tests/yt_pipeline/
```

The assembler tests run **real ffmpeg on tiny inputs** and assert the output has the expected streams (video, and audio only on the voiced path) — that's the gate that catches concat/normalization regressions. Keep them; mocked ffmpeg tests cannot catch a broken filtergraph.
