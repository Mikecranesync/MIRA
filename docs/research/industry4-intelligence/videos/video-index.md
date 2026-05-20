# Fuuz Video Index

> Catalog of Fuuz / Craig Scott YouTube videos identified during research. Last refreshed 2026-05-20 by claude-code. Search queries used: `"Fuuz" "Craig Scott" site:youtube.com`, `"Fuuz" "Claude Code" 2026`, `"Fuuz Industrial Intelligence" YouTube`, `"Fuuz ProveIt 2026"`.
>
> **2026-05-20 update:** All 11 catalogued videos now have full transcripts saved. Episode 6 has full per-section analysis; Tier-2 videos mined for onboarding / connector / gateway signal (see [mira-twilio-of-industry4-analysis.md](../mira-lessons/mira-twilio-of-industry4-analysis.md)).

## Tier 1 — Watch / analyze in full

| ID | Title | URL | Why it matters | Status |
|---|---|---|---|---|
| **xKuq5FDomkg** | **Episode 6 — AI on the Factory Floor: Inside Fuuz's 2026 ProveIt! Demo** | https://youtu.be/xKuq5FDomkg | Craig walks the full ProveIt! 2026 build live, shows Claude Code workflow, ML flow, screens, UNS publish, "mini UNS at screen level" pattern. **Foundational.** | **Analyzed** — see [fuuz-video-analysis.md](fuuz-video-analysis.md) + [transcript](fuuz-transcripts/fuuz-video-xKuq5FDomkg.md) |

## Tier 2 — Transcribed + mined for onboarding/connector signal (2026-05-20)

| ID | Title | URL | Key signal extracted | Transcript |
|---|---|---|---|---|
| F0oaVkVj2EQ | How Manufacturers Scale from Fragmented Data to AI-Native Intelligence | https://youtu.be/F0oaVkVj2EQ | **Critical**: explicit Fuuz Gateway architecture (`[50:30]–[52:00]`) — dozens of industrial driver protocols, Ignition module, OPC-UA, store-and-forward built-in, Windows/Linux, hybrid mode for offline. Build/QA/Prod environments. "we have connectors for everything" (~44 pre-built, extensible). | `fuuz-transcripts/fuuz-video-F0oaVkVj2EQ-ai-native-fragmented-to-intelligent.md` |
| i0lj8quQsDM | Webinar: Industry 4.0 for Manufacturers | https://youtu.be/i0lj8quQsDM | **Critical**: customer story (MPI / Mark Wenzel). "8-10 week implementation," "in minutes not days" after platform learned. Implementation-vs-installation framing. Plex integration. Multi-company holding-co. | `fuuz-transcripts/fuuz-video-i0lj8quQsDM-webinar-industry4-for-manufacturers.md` |
| uxk3NkUEHsA | Strategic Insights Ep 33 — Fuuz Strategic Advantage | https://youtu.be/uxk3NkUEHsA | "Batteries included so there's no infrastructure." Templated apps + last-mile customization. "Months not years." | `fuuz-transcripts/fuuz-video-uxk3NkUEHsA-strategic-insights-ep33-shop-to-top.md` |

## Tier 3 — Transcribed + mined for context (2026-05-20)

| ID | Title | URL | Key signal extracted | Transcript |
|---|---|---|---|---|
| OaD5uQWDb7w | Matrix Ep 1 — Kickstarting the Vision | https://youtu.be/OaD5uQWDb7w | Vision episode. Partner-first growth: PWC, Razor Leaf, Strategic Information Group. "Months, sometimes 6 months" — explicit time-to-value. | `fuuz-transcripts/fuuz-video-OaD5uQWDb7w-matrix-ep1-kickstarting-vision.md` |
| hCyaHB1AdAI | Matrix Ep 9 — Data-Driven MES | https://youtu.be/hCyaHB1AdAI | Deep change-management discussion. "Change management is grossly understated in 9 of 10 deployments." Implicit: partner-led deployments dominate. | `fuuz-transcripts/fuuz-video-hCyaHB1AdAI-matrix-ep9-data-driven-mes.md` |
| 8kbLLsEKj6c | Matrix Ep 11 — Build vs Buy MES | https://youtu.be/8kbLLsEKj6c | "We've already taken care of a lot of the heavy lift." Pre-built AI tool connectors. Cites Ignition + Kepware + HighByte + Litmus as competing point solutions. | `fuuz-transcripts/fuuz-video-8kbLLsEKj6c-matrix-ep11-build-vs-buy-mes.md` |
| Ac-9DOBdLTw | Matrix Ep 10 — SaaS / iPaaS | https://youtu.be/Ac-9DOBdLTw | Multi-tenant arguments. Single-binary vs sprawl. "Kubernetes" mentioned for platform deploy. Hybrid Gateway cited. Build vs Buy economics. | `fuuz-transcripts/fuuz-video-Ac-9DOBdLTw-matrix-ep10-saas-ipaas.md` |
| wedPOmXexKg | Matrix Ep 15 — WMS | https://youtu.be/wedPOmXexKg | WMS module specifics (Enterprise B in ProveIt!). | `fuuz-transcripts/fuuz-video-wedPOmXexKg-matrix-ep15-warehouse.md` |
| Ow5es1zVFLU | Matrix Ep 18 — Smarter Scheduling | https://youtu.be/Ow5es1zVFLU | APS / scheduling specifics (out of MIRA scope but in competitive map). | `fuuz-transcripts/fuuz-video-Ow5es1zVFLU-matrix-ep18-scheduling.md` |
| 1fyXcvGFef8 | Short — Right Tools, Right Partners | https://youtube.com/shorts/1fyXcvGFef8 | 24-segment short; positioning sound bite. | `fuuz-transcripts/fuuz-video-1fyXcvGFef8-short-right-tools-partners.md` |

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
