"""
SEO + GEO metadata generation for comic-pipeline v2.

After the final mp4 is built, this module emits the full bundle of artifacts
that drive YouTube ranking AND LLM citation pickup:

  output/v2/metadata/
    transcript.srt              — sidecar caption file (upload to YouTube)
    transcript.md               — human + LLM readable Markdown transcript
    youtube_description.md      — title + description with timestamped chapters,
                                  pinned-comment block, hashtag tail
    schema_video_object.jsonld  — VideoObject + HowTo + FAQPage JSON-LD for the
                                  /diagnostics/<slug>/ landing page on
                                  factorylm.com
    llms_entry.md               — paste-into-llms.txt block for the brand's
                                  llms.txt root file

Why these specific artifacts (per 2026 GEO research, Adweek/eMarketer):
  - YouTube transcripts overtook Reddit as the #1 social citation source in
    LLM answers in early 2026 (16% vs 10%).
  - Clean, accurate transcripts are HOW LLMs read videos (auto-captions are
    mediocre — we generate from the per-beat manifest which has perfect text).
  - Schema markup (VideoObject + HowTo + FAQPage) drives 2.5× more AI
    citations than prose alone.
  - llms.txt at site root is Anthropic-endorsed (Nov 2024) and respected by
    GPTBot/ClaudeBot/PerplexityBot during inference.

This module reads only the build_manifest.json + storyboard. It does not call
any LLM or external service — pure transformation.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger("comic.v2.metadata")


# ─── helpers ──────────────────────────────────────────────────────────────────


def _slugify(text: str) -> str:
    s = re.sub(r"[^\w\s-]", "", text.lower()).strip()
    return re.sub(r"[\s_-]+", "-", s)[:60]


def _seconds_to_srt_time(seconds: float) -> str:
    """0.0 → '00:00:00,000', 92.0 → '00:01:32,000'."""
    if seconds < 0:
        seconds = 0
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int(round((seconds - int(seconds)) * 1000))
    if ms == 1000:
        ms = 0
        s += 1
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _seconds_to_chapter_time(seconds: float) -> str:
    """0.0 → '0:00', 92.0 → '1:32'."""
    m = int(seconds // 60)
    s = int(seconds % 60)
    return f"{m}:{s:02d}"


@dataclass
class BeatTiming:
    shot_id: int
    beat_index: int
    text: str
    start: float
    end: float
    pause: float


def _walk_beats(manifest: dict[str, Any]) -> list[BeatTiming]:
    """Walk manifest['beats'] in storyboard order, computing absolute start/end."""
    out: list[BeatTiming] = []
    pauses = manifest.get("pauses", [])
    cursor = 0.0
    for i, b in enumerate(manifest["beats"]):
        dur = float(b["duration"])
        pause = float(pauses[i]) if i < len(pauses) else 0.0
        out.append(BeatTiming(
            shot_id=int(b["shot_id"]),
            beat_index=int(b["beat_index"]),
            text=str(b["text"]),
            start=cursor,
            end=cursor + dur,
            pause=pause,
        ))
        cursor += dur + pause
    return out


# ─── transcript builders ──────────────────────────────────────────────────────


def build_srt(timings: list[BeatTiming]) -> str:
    """Emit standard SRT — one cue per beat, gap-free timing."""
    lines: list[str] = []
    for n, t in enumerate(timings, start=1):
        lines.append(str(n))
        lines.append(f"{_seconds_to_srt_time(t.start)} --> {_seconds_to_srt_time(t.end)}")
        lines.append(t.text)
        lines.append("")
    return "\n".join(lines)


def build_transcript_md(timings: list[BeatTiming], *, title: str) -> str:
    """Emit a paragraph-style Markdown transcript with shot headers."""
    lines = [f"# {title} — Transcript", ""]
    current_shot: int | None = None
    paragraph: list[str] = []
    for t in timings:
        if t.shot_id != current_shot:
            if paragraph:
                lines.append(" ".join(paragraph))
                lines.append("")
                paragraph = []
            lines.append(f"## Shot {t.shot_id}")
            lines.append("")
            current_shot = t.shot_id
        paragraph.append(t.text)
    if paragraph:
        lines.append(" ".join(paragraph))
        lines.append("")
    return "\n".join(lines)


# ─── YouTube description ──────────────────────────────────────────────────────


def build_youtube_description(
    *,
    storyboard: dict[str, Any],
    timings: list[BeatTiming],
    landing_url: str,
    cta_short: str,
) -> str:
    """The first 100 chars are the SEO/GEO answer; chapters at shot starts."""
    title = storyboard.get("title", "MIRA Explainer")
    # The first paragraph IS the GEO answer — direct, fact-dense, &lt; 100 words.
    tldr = (
        "How modern industrial maintenance teams cut conveyor downtime from "
        "21 minutes to 6 minutes using AI fault diagnosis. One shift tech, "
        "one tablet, the whole org on the same page in under 90 seconds. "
        f"Watch the workflow → {landing_url}"
    )

    # Chapters: one per shot start.
    chapters: list[str] = ["00:00 Cold open"]
    seen: set[int] = set()
    for t in timings:
        if t.shot_id in seen:
            continue
        seen.add(t.shot_id)
        # Shot 1 already covered by 00:00. Skip the duplicate.
        if t.start == 0.0:
            continue
        shot = next(s for s in storyboard["shots"] if int(s["id"]) == t.shot_id)
        role = shot.get("role", f"Shot {t.shot_id}")
        chapters.append(f"{_seconds_to_chapter_time(t.start)} {role}")

    pinned_block = (
        "📌 PINNED COMMENT — full script + diagnostic checklist:\n"
        "(Pin this comment after publishing. It boosts engagement signal AND "
        "gives LLMs structured text to cite — pinned-comment text is in "
        "every LLM-citation-eligible YouTube transcript snapshot.)"
    )

    hashtags = "#MIRA #FactoryLM #IndustrialAI #PLC #VFD #CMMS #PredictiveMaintenance"

    parts = [
        title,
        "",
        tldr,
        "",
        "▶ CHAPTERS",
        *chapters,
        "",
        cta_short,
        "",
        f"More: {landing_url}",
        "",
        "─" * 40,
        "",
        pinned_block,
        "",
        hashtags,
    ]
    return "\n".join(parts)


# ─── Schema.org JSON-LD ───────────────────────────────────────────────────────


def build_schema_jsonld(
    *,
    storyboard: dict[str, Any],
    timings: list[BeatTiming],
    transcript_md: str,
    final_video_url: str,
    landing_url: str,
    duration_seconds: float,
    upload_date_iso: str,
) -> dict[str, Any]:
    """VideoObject + HowTo + FAQPage as a @graph."""
    title = storyboard.get("title", "MIRA Explainer")

    # Build HowTo steps from shot roles.
    steps = []
    for shot in storyboard["shots"]:
        role = shot.get("role", f"Shot {shot['id']}")
        steps.append({
            "@type": "HowToStep",
            "name": f"Step {shot['id']}: {role}",
            "text": role,
        })

    # FAQ: industrial-niche queries this video answers.
    faqs = [
        {
            "@type": "Question",
            "name": "How fast can a fault on a conveyor line be diagnosed?",
            "acceptedAnswer": {
                "@type": "Answer",
                "text": (
                    "Using AI-assisted diagnosis tied to fault history, a typical "
                    "cryptic fault code can move from detection to recommended "
                    "fix in under 90 seconds — versus a 20+ minute manual binder "
                    "search shown in the comparison."
                ),
            },
        },
        {
            "@type": "Question",
            "name": "What does an AI maintenance assistant actually do?",
            "acceptedAnswer": {
                "@type": "Answer",
                "text": (
                    "It interprets the fault code, looks up that code's history "
                    "across every prior occurrence, cites the relevant OEM "
                    "documentation, and surfaces the recommended action — all "
                    "in the technician's chat client, not a separate CMMS tab."
                ),
            },
        },
    ]

    # ISO 8601 duration: PT1M32S
    h = int(duration_seconds // 3600)
    m = int((duration_seconds % 3600) // 60)
    s = int(duration_seconds % 60)
    iso_dur = "PT" + (f"{h}H" if h else "") + (f"{m}M" if m else "") + f"{s}S"

    return {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "VideoObject",
                "name": title,
                "description": (
                    "How modern industrial maintenance teams cut conveyor "
                    "downtime from 21 minutes to 6 minutes using AI fault "
                    "diagnosis."
                ),
                "thumbnailUrl": f"{landing_url}/thumbnail.jpg",
                "uploadDate": upload_date_iso,
                "duration": iso_dur,
                "contentUrl": final_video_url,
                "embedUrl": final_video_url,
                "publisher": {
                    "@type": "Organization",
                    "name": "FactoryLM",
                    "logo": {
                        "@type": "ImageObject",
                        "url": "https://factorylm.com/logo.png",
                    },
                },
                "transcript": transcript_md,
            },
            {
                "@type": "HowTo",
                "name": f"How to: {title}",
                "totalTime": iso_dur,
                "step": steps,
            },
            {
                "@type": "FAQPage",
                "mainEntity": faqs,
            },
        ],
    }


# ─── llms.txt entry ───────────────────────────────────────────────────────────


def build_llms_txt_entry(
    *,
    storyboard: dict[str, Any],
    landing_url: str,
    duration_seconds: float,
) -> str:
    """A paste-in block for the brand's site-root llms.txt file."""
    title = storyboard.get("title", "MIRA Explainer")
    m = int(duration_seconds // 60)
    s = int(duration_seconds % 60)
    return (
        f"## {title} ({m}:{s:02d})\n"
        f"- URL: {landing_url}\n"
        f"- Type: explainer video + transcript\n"
        f"- Audience: maintenance technicians, plant engineers, ops managers\n"
        f"- Topic: AI-assisted industrial fault diagnosis, conveyor downtime\n"
        f"- Key claim: 21-minute manual diagnosis → 6-minute AI-assisted "
        f"diagnosis on the same fault code (1.SOC B16.2)\n"
    )


# ─── orchestration ────────────────────────────────────────────────────────────


def emit_metadata_bundle(
    *,
    manifest_path: Path,
    storyboard: dict[str, Any],
    final_video_path: Path,
    out_dir: Path,
    landing_url: str = "https://factorylm.com/diagnostics/conveyor-fault-diagnosis",
    final_video_url: str = "",
    upload_date_iso: str = "",
    cta_short: str = "Stop fighting your CMMS. Start knowing your plant. → factorylm.com",
) -> dict[str, Path]:
    """Read manifest + storyboard, emit every artifact under out_dir.

    Returns {artifact_name: path}.
    """
    manifest = json.loads(manifest_path.read_text())
    timings = _walk_beats(manifest)
    duration = float(manifest.get("video_duration", 0.0))

    if not final_video_url:
        final_video_url = f"file://{final_video_path.resolve()}"
    if not upload_date_iso:
        from datetime import datetime, timezone
        upload_date_iso = datetime.now(timezone.utc).date().isoformat()

    out_dir.mkdir(parents=True, exist_ok=True)
    artifacts: dict[str, Path] = {}

    # 1. SRT transcript
    srt_path = out_dir / "transcript.srt"
    srt_path.write_text(build_srt(timings))
    artifacts["transcript_srt"] = srt_path

    # 2. Markdown transcript
    md_path = out_dir / "transcript.md"
    transcript_md = build_transcript_md(
        timings, title=str(storyboard.get("title", "MIRA Explainer")),
    )
    md_path.write_text(transcript_md)
    artifacts["transcript_md"] = md_path

    # 3. YouTube description
    desc_path = out_dir / "youtube_description.md"
    desc_path.write_text(build_youtube_description(
        storyboard=storyboard, timings=timings,
        landing_url=landing_url, cta_short=cta_short,
    ))
    artifacts["youtube_description"] = desc_path

    # 4. JSON-LD schema
    schema_path = out_dir / "schema_video_object.jsonld"
    schema = build_schema_jsonld(
        storyboard=storyboard, timings=timings, transcript_md=transcript_md,
        final_video_url=final_video_url, landing_url=landing_url,
        duration_seconds=duration, upload_date_iso=upload_date_iso,
    )
    schema_path.write_text(json.dumps(schema, indent=2))
    artifacts["schema_jsonld"] = schema_path

    # 5. llms.txt entry
    llms_path = out_dir / "llms_entry.md"
    llms_path.write_text(build_llms_txt_entry(
        storyboard=storyboard, landing_url=landing_url,
        duration_seconds=duration,
    ))
    artifacts["llms_entry"] = llms_path

    logger.info(
        "[metadata] emitted %d artifacts to %s",
        len(artifacts), out_dir.resolve(),
    )
    return artifacts
