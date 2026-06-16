---
name: YouTube OAuth Secrets — Setup Complete
description: YouTube Data API v3 auth is configured and stored in Doppler
type: project
---

YouTube API auth completed 2026-04-07. All 4 secrets in Doppler `factorylm/prd`:

- `YOUTUBE_CLIENT_ID` — OAuth client ID (project: factorylm-youtube)
- `YOUTUBE_CLIENT_SECRET` — OAuth client secret
- `YOUTUBE_CLIENT_SECRET_JSON` — Full OAuth JSON blob for file-based auth flows
- `YOUTUBE_REFRESH_TOKEN` — Long-lived refresh token (scopes: upload, readonly, yt-analytics)

Original client_secret JSON was in ~/Downloads — deleted after storing in Doppler.
Auth flow used `google-auth-oauthlib` InstalledAppFlow on port 8080.

**Why:** Powers `youtube_uploader.py` in the GTM content pipeline. Quota: 10K units/day,
upload costs 1,600 units (~6 uploads/day max). Quota guard required in uploader.
