# Fuuz Video Index

> Catalog of Fuuz / Craig Scott YouTube videos identified during research. Last refreshed 2026-05-19 by claude-code. Search queries used: `"Fuuz" "Craig Scott" site:youtube.com`, `"Fuuz" "Claude Code" 2026`, `"Fuuz Industrial Intelligence" YouTube`, `"Fuuz ProveIt 2026"`.

## Tier 1 — Watch / analyze in full

| ID | Title | URL | Why it matters | Status |
|---|---|---|---|---|
| **xKuq5FDomkg** | **Episode 6 — AI on the Factory Floor: Inside Fuuz's 2026 ProveIt! Demo** | https://youtu.be/xKuq5FDomkg | Craig walks the full ProveIt! 2026 build live, shows Claude Code workflow, ML flow, screens, UNS publish, "mini UNS at screen level" pattern. **Foundational.** | **Analyzed** — see [fuuz-video-analysis.md](fuuz-video-analysis.md) + [transcript](fuuz-transcripts/fuuz-video-xKuq5FDomkg.md) |

## Tier 2 — High priority, queued for next pass

| ID | Title | URL | Why it matters | Status |
|---|---|---|---|---|
| F0oaVkVj2EQ | How Manufacturers Scale From Fragmented Data to AI-Native Intelligence | https://www.youtube.com/watch?v=F0oaVkVj2EQ | "AI-native intelligence" thesis from Fuuz — likely overlaps with the ProveIt! pitch | Not yet transcribed |
| uxk3NkUEHsA | Strategic Insights Ep 33 — From Shop Floor to Top Floor: The Fuuz Strategic Advantage | https://www.youtube.com/watch?v=uxk3NkUEHsA | Craig as a guest, customer/strategic framing | Not yet transcribed |
| i0lj8quQsDM | Webinar: Industry 4.0 for Manufacturers | https://www.youtube.com/watch?v=i0lj8quQsDM | Long-form webinar; may include UNS / IT-OT-bridge messaging useful to MIRA GTM | Not yet transcribed |

## Tier 3 — Likely useful, lower priority

| ID | Title | URL | Why it matters | Status |
|---|---|---|---|---|
| OaD5uQWDb7w | The Manufacturing Matrix Ep 1 — Kickstarting the Manufacturing Matrix: Inside FUUZ's Vision | https://www.youtube.com/watch?v=OaD5uQWDb7w | Series intro — Fuuz's overall vision | Not yet transcribed |
| hCyaHB1AdAI | Manufacturing Matrix Ep 9 — Data-Driven Manufacturing: The Fuuz Approach to MES | https://www.youtube.com/watch?v=hCyaHB1AdAI | MES module positioning — useful for competitive-positioning notes | Not yet transcribed |
| 8kbLLsEKj6c | Manufacturing Matrix Ep 11 — Build vs Buy: The MES Dilemma Solved | https://www.youtube.com/watch?v=8kbLLsEKj6c | Sales objection-handling content; Fuuz's frame of "build *and* buy on our platform" | Not yet transcribed |
| Ac-9DOBdLTw | Manufacturing Matrix Ep 10 — Revolutionizing Manufacturing with SaaS and iPaaS | https://www.youtube.com/watch?v=Ac-9DOBdLTw | "iPaaS + modules" framing (the UMP thesis) | Not yet transcribed |
| wedPOmXexKg | Manufacturing Matrix Ep 15 — Optimizing Warehouse Management | https://www.youtube.com/watch?v=wedPOmXexKg | WMS module — overlaps with Enterprise B ProveIt! app | Not yet transcribed |
| Ow5es1zVFLU | Manufacturing Matrix Ep 18 — From Chaos to Clarity: Smarter Scheduling | https://www.youtube.com/watch?v=Ow5es1zVFLU | APS / scheduling module — out of MIRA scope but useful for competitive map | Not yet transcribed |
| 1fyXcvGFef8 | Short — The Right Tools, The Right Partners: Fuuz's Approach to Innovation | https://www.youtube.com/shorts/1fyXcvGFef8 | Short-form positioning; useful as sales-style reference | Not yet transcribed |

## How to extract transcripts (reproducible)

```bash
python3 - <<'EOF'
from youtube_transcript_api import YouTubeTranscriptApi
VID = "xKuq5FDomkg"  # replace
t = YouTubeTranscriptApi().fetch(VID)
for seg in t.to_raw_data():
    print(f'[{int(seg["start"])//60:02d}:{int(seg["start"])%60:02d}] {seg["text"]}')
EOF
```

Output convention: save under `videos/fuuz-transcripts/fuuz-video-<VID>.md` with title/channel/duration metadata header, then write analysis in `videos/fuuz-video-<short-name>-analysis.md`.

## Notes

- **No explicit "Fuuz + Claude Code" deep-dive** found beyond Episode 6 as of 2026-05-19. The Claude-Code skills repo is the primary technical artifact; this video is the primary narrative artifact.
- Channel handle: `Fuuz` on YouTube. Several adjacent series (`Manufacturing Matrix`, `Fuuz Unplugged`, `Strategic Insights`) — Episode 6 is from `Fuuz Unplugged`.
- **Search broker:** Google web search via WebSearch tool (May 2026 index). Not exhaustive — re-run periodically.
