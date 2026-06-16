---
name: YouTube Transcript Skill
description: How to fetch any YouTube video transcript for research — script location and usage
type: reference
originSessionId: 36a07d89-95d7-487f-aef0-a08965ff479a
---
## Script
`/Users/charlienode/MIRA/tools/youtube_transcript.py`

## Run command (no install needed)
```bash
uv run --with youtube-transcript-api python /Users/charlienode/MIRA/tools/youtube_transcript.py "<url_or_video_id>"
```

## Skill files
- Project skill: `/Users/charlienode/MIRA/.claude/skills/youtube-transcript.md`
- **Global skill**: `~/.claude/skills/youtube-transcript.md` (active in ALL sessions on CHARLIE)

## How it works
- Uses `youtube-transcript-api` (MIT, v1.2.4) — no API key
- Tries manual transcript first → auto-generated → any available language
- Outputs plain text to stdout; errors to stderr with exit 1
- Handles `youtu.be/`, `youtube.com/watch?v=`, `youtube.com/shorts/`, raw 11-char IDs

## When to use
Whenever a YouTube URL is pasted and the user asks to review/analyze/research the video. WebFetch and Exa both fail on YouTube — this is the only reliable path.
