---
name: FactoryLM GTM Strategy — YouTube + LinkedIn
description: Active GTM plan — platform priority, content series, pipeline to build
type: project
---

Full GTM ultraplan approved 2026-04-07. Plan file: `~/.claude/plans/transient-conjuring-sky.md`

**Platform priority (LinkedIn-first, NOT Shorts-first):**
1. LinkedIn native video (ICP = plant managers, maintenance directors live here)
2. YouTube long-form 5–15 min (high-intent search: "Allen-Bradley VFD fault codes")
3. YouTube Shorts (top-of-funnel seeding)
4. TikTok/Reels (awareness only)

**Why:** ICP (50–500 person manufacturers, Allen-Bradley users) is B2B, not consumer scroll.

**6 content series:** "Before It Breaks", "$500K vs $30", "Inside the Machine",
"Live Diagnosis", "Tech Stories", "Off the Grid"

**Code to build** (in ~/factorylm/tools/):
- `shorts_pipeline.py` — vertical 9:16 producer, extends story_pipeline.py, Whisper captions baked in
- `thumbnail_generator.py` — per-series branded thumbnails (Pillow)
- `youtube_uploader.py` — YouTube Data API v3, quota guard (10K units/day)
- `cross_post.py` — one render → LinkedIn, Shorts, TikTok, Reels, Twitter
- `analytics_reporter.py` — weekly report + `generate_next_week_calendar()` self-improvement loop

**GTM docs to write** (~/factorylm/docs/gtm/):
- `YOUTUBE_SHORTS_GTM.md`, `CONTENT_CALENDAR_4W.md` (FAC-18), `REVIEW_CHECKLIST.md` (FAC-19)

**Funnel:** LinkedIn video → YouTube long-form → factorylm.com → Calendly mike-cranesync/30min → $600/mo pilot

**Why:** Pipeline infrastructure already exists (story_pipeline.py, video_pipeline.py,
content_capture_tasks.py, demo_content_spec.py). Only need strategy wrapper + platform layer.
