---
name: youtube-transcript
description: Fetch the full transcript from any YouTube video URL or ID so Claude can read and analyze the video content. Use whenever the user pastes a YouTube link and asks you to review, research, summarize, analyze, or extract information from it.
---

# YouTube Transcript Researcher

## When to trigger
- User pastes a YouTube URL (`youtu.be/...`, `youtube.com/watch?v=...`, `youtube.com/shorts/...`)
- User asks you to "look at", "watch", "review", "summarize", or "research" a YouTube video
- Any time you'd otherwise attempt a WebFetch on a YouTube URL (which will fail)

## How to fetch

```bash
uv run --with youtube-transcript-api python /Users/charlienode/MIRA/tools/youtube_transcript.py "<url_or_video_id>"
```

Non-English video — add a BCP-47 language code as the second argument:
```bash
uv run --with youtube-transcript-api python /Users/charlienode/MIRA/tools/youtube_transcript.py "<url>" es
```

## Reading the output

The script prints:
1. `Video ID`, `Language`, `Segments` header lines
2. A `--- TRANSCRIPT ---` divider
3. The full plain-text transcript

Read all of it. Use it to answer the user's question directly — summarize, quote, extract key points, compare to other content, etc.

## Fallback

If the script exits with an error (transcripts disabled, private video, network block):
1. Tell the user you can't access the transcript
2. Ask them to paste the video description, chapter timestamps, or key quotes
3. Do NOT attempt a WebFetch or Exa fetch on the YouTube URL — they will also fail

## Supported URL formats
- `https://youtu.be/VIDEO_ID`
- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://www.youtube.com/shorts/VIDEO_ID`
- `https://www.youtube.com/embed/VIDEO_ID`
- Raw 11-character video ID
