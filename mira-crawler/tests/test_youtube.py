"""Tests for YouTube transcript ingest — pure functions only, no network required.

Covers VTT parsing, visual cue detection, text block generation, and
module-level sanity checks (channel list length, task registration).

All external dependencies (yt-dlp, ffmpeg, Redis, Ollama, NeonDB) are either
not exercised or patched out.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Sample VTT fixture
# ---------------------------------------------------------------------------

SAMPLE_VTT = """WEBVTT

00:00:05.000 --> 00:00:10.000
Welcome to this VFD troubleshooting guide.

00:00:10.000 --> 00:00:15.000
Today we'll look at common fault codes.

00:00:15.000 --> 00:00:22.000
Look at this display - you can see fault code F004.

00:00:22.000 --> 00:00:30.000
The meter reads 185 volts on the DC bus.

00:00:30.000 --> 00:00:35.000
That's below the expected 325 volts for a 230V drive.
"""

# A VTT with cue identifiers (numeric sequence numbers before each cue)
SAMPLE_VTT_WITH_IDS = """WEBVTT

1
00:00:01.000 --> 00:00:04.000
First segment with cue id.

2
00:00:04.000 --> 00:00:08.000
Second segment with cue id.

3
00:00:08.000 --> 00:00:12.000
Third segment with cue id.
"""

# VTT with inline timing tags (common in YouTube auto-captions)
SAMPLE_VTT_WITH_TAGS = """WEBVTT

00:00:01.000 --> 00:00:05.000
<00:00:01.500><c>Hello</c> <00:00:02.000><c>world</c>

00:00:05.000 --> 00:00:09.000
<c>Check</c> the nameplate data.
"""


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def _import_youtube():
    """Import tasks.youtube, trying local path first (matches conftest pattern)."""
    try:
        import tasks.youtube as yt
    except ImportError:
        import mira_crawler.tasks.youtube as yt  # type: ignore[no-redef]
    return yt


# ---------------------------------------------------------------------------
# _parse_vtt
# ---------------------------------------------------------------------------


class TestParseVtt:
    def test_parse_vtt_returns_five_segments(self):
        yt = _import_youtube()
        segments = yt._parse_vtt(SAMPLE_VTT)
        assert len(segments) == 5

    def test_parse_vtt_first_segment_start(self):
        yt = _import_youtube()
        segments = yt._parse_vtt(SAMPLE_VTT)
        assert segments[0]["start_seconds"] == 5.0

    def test_parse_vtt_first_segment_end(self):
        yt = _import_youtube()
        segments = yt._parse_vtt(SAMPLE_VTT)
        assert segments[0]["end_seconds"] == 10.0

    def test_parse_vtt_first_segment_text(self):
        yt = _import_youtube()
        segments = yt._parse_vtt(SAMPLE_VTT)
        assert "VFD troubleshooting" in segments[0]["text"]

    def test_parse_vtt_third_segment_timestamp(self):
        yt = _import_youtube()
        segments = yt._parse_vtt(SAMPLE_VTT)
        assert segments[2]["start_seconds"] == 15.0
        assert segments[2]["end_seconds"] == 22.0

    def test_parse_vtt_third_segment_contains_fault_code(self):
        yt = _import_youtube()
        segments = yt._parse_vtt(SAMPLE_VTT)
        assert "F004" in segments[2]["text"]

    def test_parse_vtt_empty_returns_empty_list(self):
        yt = _import_youtube()
        result = yt._parse_vtt("")
        assert result == []

    def test_parse_vtt_whitespace_only_returns_empty_list(self):
        yt = _import_youtube()
        result = yt._parse_vtt("   \n\n   ")
        assert result == []

    def test_parse_vtt_segment_keys(self):
        yt = _import_youtube()
        segments = yt._parse_vtt(SAMPLE_VTT)
        assert all("start_seconds" in s for s in segments)
        assert all("end_seconds" in s for s in segments)
        assert all("text" in s for s in segments)

    def test_parse_vtt_with_cue_ids(self):
        yt = _import_youtube()
        segments = yt._parse_vtt(SAMPLE_VTT_WITH_IDS)
        # Should still get 3 segments despite numeric cue IDs
        assert len(segments) == 3
        assert segments[0]["start_seconds"] == 1.0
        assert "First segment" in segments[0]["text"]

    def test_parse_vtt_strips_inline_tags(self):
        yt = _import_youtube()
        segments = yt._parse_vtt(SAMPLE_VTT_WITH_TAGS)
        assert "<c>" not in segments[0]["text"]
        assert "<" not in segments[0]["text"]
        # Text content should be present
        assert "Hello" in segments[0]["text"] or "world" in segments[0]["text"]

    def test_parse_vtt_nameplate_tag_stripped(self):
        yt = _import_youtube()
        segments = yt._parse_vtt(SAMPLE_VTT_WITH_TAGS)
        assert "nameplate" in segments[1]["text"]

    def test_parse_vtt_last_segment_text(self):
        yt = _import_youtube()
        segments = yt._parse_vtt(SAMPLE_VTT)
        assert "325 volts" in segments[4]["text"]

    def test_parse_vtt_float_timestamps(self):
        """Timestamps with non-zero milliseconds parse correctly."""
        vtt = "WEBVTT\n\n00:01:23.456 --> 00:01:28.789\nTest content.\n"
        yt = _import_youtube()
        segments = yt._parse_vtt(vtt)
        assert len(segments) == 1
        assert abs(segments[0]["start_seconds"] - (60 + 23 + 0.456)) < 0.001
        assert abs(segments[0]["end_seconds"] - (60 + 28 + 0.789)) < 0.001

    def test_parse_vtt_hours_in_timestamp(self):
        """Hour component in timestamps is handled."""
        vtt = "WEBVTT\n\n01:00:00.000 --> 01:00:05.000\nHour-long video content.\n"
        yt = _import_youtube()
        segments = yt._parse_vtt(vtt)
        assert len(segments) == 1
        assert segments[0]["start_seconds"] == 3600.0


# ---------------------------------------------------------------------------
# _detect_visual_cues
# ---------------------------------------------------------------------------


class TestDetectVisualCues:
    def test_detects_look_at(self):
        yt = _import_youtube()
        segments = yt._parse_vtt(SAMPLE_VTT)
        cues = yt._detect_visual_cues(segments)
        # "Look at this display" is in segment 2 (index 2)
        cue_texts = [c["text"] for c in cues]
        assert any("Look at" in t or "look at" in t.lower() for t in cue_texts)

    def test_detects_meter_reads(self):
        yt = _import_youtube()
        segments = yt._parse_vtt(SAMPLE_VTT)
        cues = yt._detect_visual_cues(segments)
        cue_texts = [c["text"] for c in cues]
        assert any("meter reads" in t.lower() for t in cue_texts)

    def test_cue_has_cue_keyword_field(self):
        yt = _import_youtube()
        segments = yt._parse_vtt(SAMPLE_VTT)
        cues = yt._detect_visual_cues(segments)
        for cue in cues:
            assert "cue_keyword" in cue

    def test_non_cue_segment_excluded(self):
        yt = _import_youtube()
        segments = yt._parse_vtt(SAMPLE_VTT)
        cues = yt._detect_visual_cues(segments)
        # "Welcome to this VFD troubleshooting guide." has no cue keyword
        cue_texts = [c["text"] for c in cues]
        assert not any("Welcome to" in t for t in cue_texts)

    def test_empty_segments_returns_empty(self):
        yt = _import_youtube()
        result = yt._detect_visual_cues([])
        assert result == []

    def test_case_insensitive_matching(self):
        yt = _import_youtube()
        seg = {"start_seconds": 0.0, "end_seconds": 5.0, "text": "LOOK AT THE DISPLAY"}
        cues = yt._detect_visual_cues([seg])
        assert len(cues) == 1
        assert cues[0]["cue_keyword"] == "look at"

    def test_fault_code_keyword_detected(self):
        yt = _import_youtube()
        seg = {"start_seconds": 10.0, "end_seconds": 15.0, "text": "This shows fault code E003."}
        cues = yt._detect_visual_cues([seg])
        assert len(cues) == 1
        assert "fault code" in cues[0]["cue_keyword"]

    def test_only_first_keyword_tagged_per_segment(self):
        """A segment matching multiple keywords only gets one cue_keyword."""
        yt = _import_youtube()
        seg = {
            "start_seconds": 0.0,
            "end_seconds": 5.0,
            "text": "Look at this fault code on the display.",
        }
        cues = yt._detect_visual_cues([seg])
        assert len(cues) == 1

    def test_preserves_original_fields(self):
        yt = _import_youtube()
        seg = {"start_seconds": 1.0, "end_seconds": 3.0, "text": "You can see the nameplate."}
        cues = yt._detect_visual_cues([seg])
        assert cues[0]["start_seconds"] == 1.0
        assert cues[0]["end_seconds"] == 3.0
        assert cues[0]["text"] == seg["text"]


# ---------------------------------------------------------------------------
# _segments_to_text_blocks
# ---------------------------------------------------------------------------


class TestSegmentsToTextBlocks:
    def _make_segments(self, n: int) -> list[dict]:
        return [
            {
                "start_seconds": float(i * 5),
                "end_seconds": float(i * 5 + 4),
                "text": f"Segment {i} describes VFD fault detection.",
            }
            for i in range(n)
        ]

    def test_five_segments_make_one_block(self):
        yt = _import_youtube()
        segs = self._make_segments(5)
        blocks = yt._segments_to_text_blocks(segs, "https://youtu.be/test")
        assert len(blocks) == 1

    def test_six_segments_make_two_blocks(self):
        yt = _import_youtube()
        segs = self._make_segments(6)
        blocks = yt._segments_to_text_blocks(segs, "https://youtu.be/test")
        assert len(blocks) == 2

    def test_block_contains_expected_content(self):
        yt = _import_youtube()
        segs = self._make_segments(5)
        blocks = yt._segments_to_text_blocks(segs, "https://youtu.be/test")
        assert "VFD fault detection" in blocks[0]["text"]

    def test_block_has_source_url(self):
        yt = _import_youtube()
        segs = self._make_segments(3)
        url = "https://youtu.be/abc123"
        blocks = yt._segments_to_text_blocks(segs, url)
        assert all(b["source_url"] == url for b in blocks)

    def test_block_has_section_timestamp(self):
        yt = _import_youtube()
        segs = self._make_segments(5)
        blocks = yt._segments_to_text_blocks(segs, "https://youtu.be/test")
        # Section should contain time range like "0.0s–24.0s"
        assert "s–" in blocks[0]["section"]

    def test_block_has_required_keys(self):
        yt = _import_youtube()
        segs = self._make_segments(5)
        blocks = yt._segments_to_text_blocks(segs, "https://youtu.be/test")
        for b in blocks:
            assert "text" in b
            assert "page_num" in b
            assert "section" in b
            assert "source_url" in b

    def test_page_num_is_none(self):
        yt = _import_youtube()
        segs = self._make_segments(5)
        blocks = yt._segments_to_text_blocks(segs, "https://youtu.be/test")
        assert all(b["page_num"] is None for b in blocks)

    def test_empty_segments_returns_empty(self):
        yt = _import_youtube()
        result = yt._segments_to_text_blocks([], "https://youtu.be/test")
        assert result == []

    def test_merged_text_from_sample_vtt(self):
        """Full integration: parse SAMPLE_VTT → blocks contain transcript content."""
        yt = _import_youtube()
        segments = yt._parse_vtt(SAMPLE_VTT)
        blocks = yt._segments_to_text_blocks(segments, "https://youtu.be/vfd-guide")
        # All 5 segments merge into 1 block (5 ≤ SEGMENTS_PER_BLOCK=5)
        assert len(blocks) == 1
        assert "VFD troubleshooting" in blocks[0]["text"]
        assert "F004" in blocks[0]["text"]
        assert "325 volts" in blocks[0]["text"]


# ---------------------------------------------------------------------------
# Module-level sanity
# ---------------------------------------------------------------------------


class TestYouTubeChannelsList:
    def test_at_least_five_channels_configured(self):
        yt = _import_youtube()
        assert len(yt.YOUTUBE_CHANNELS) >= 5

    def test_all_channels_are_valid_urls(self):
        yt = _import_youtube()
        for ch in yt.YOUTUBE_CHANNELS:
            assert ch.startswith("https://"), f"Invalid channel URL: {ch}"

    def test_channels_use_youtube_domain(self):
        yt = _import_youtube()
        for ch in yt.YOUTUBE_CHANNELS:
            assert "youtube.com" in ch, f"Non-YouTube URL: {ch}"

    def test_no_duplicate_channels(self):
        yt = _import_youtube()
        assert len(yt.YOUTUBE_CHANNELS) == len(set(yt.YOUTUBE_CHANNELS))

    def test_fluke_channel_present(self):
        yt = _import_youtube()
        assert any("Fluke" in ch for ch in yt.YOUTUBE_CHANNELS)

    def test_visual_cue_keywords_populated(self):
        yt = _import_youtube()
        assert len(yt.VISUAL_CUE_KEYWORDS) >= 10

    def test_fault_code_in_visual_cue_keywords(self):
        yt = _import_youtube()
        assert "fault code" in yt.VISUAL_CUE_KEYWORDS

    def test_meter_reads_in_visual_cue_keywords(self):
        yt = _import_youtube()
        assert "the meter reads" in yt.VISUAL_CUE_KEYWORDS


# ---------------------------------------------------------------------------
# Timestamp helper (_ts_to_seconds)
# ---------------------------------------------------------------------------


class TestTsToSeconds:
    def test_zero(self):
        yt = _import_youtube()
        assert yt._ts_to_seconds(None, "0", "0", "0") == 0.0  # type: ignore[arg-type]

    def test_minutes_and_seconds(self):
        yt = _import_youtube()
        # 1:30.500 = 90.5
        assert abs(yt._ts_to_seconds(None, "1", "30", "500") - 90.5) < 0.001  # type: ignore[arg-type]

    def test_hours_minutes_seconds(self):
        yt = _import_youtube()
        # 1:01:01.100 = 3661.1
        assert abs(yt._ts_to_seconds("1", "1", "1", "100") - 3661.1) < 0.001
