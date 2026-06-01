# tests/yt_pipeline/test_planner.py
import json
from unittest.mock import MagicMock, patch


def test_load_topics_returns_flat_angle_list(tmp_path):
    """load_topics() returns one dict per angle across all topic areas."""
    topics_yaml = tmp_path / "topics.yaml"
    topics_yaml.write_text("""
topics:
  vfd_troubleshooting:
    angles:
      - "Angle A"
      - "Angle B"
  plc_basics:
    angles:
      - "Angle C"
""")
    from tools.yt_pipeline.planner import load_topics
    angles = load_topics(topics_yaml)
    assert len(angles) == 3
    assert angles[0] == {"area": "vfd_troubleshooting", "angle": "Angle A"}
    assert angles[2] == {"area": "plc_basics", "angle": "Angle C"}


def test_plan_next_increments_index(tmp_path):
    """plan_next() selects angle at next_angle_index and the index wraps around."""
    cal_path = tmp_path / "calendar.json"
    cal_path.write_text(json.dumps({"next_angle_index": 1, "published": []}))

    topics_yaml = tmp_path / "topics.yaml"
    topics_yaml.write_text("""
topics:
  vfd_troubleshooting:
    angles:
      - "Angle A"
      - "Angle B"
""")
    mock_script = {
        "title": "Test Title",
        "description": "Test desc",
        "tags": ["tag1"],
        "scene1_prompt": "scene1",
        "scene2_narration": "narration",
        "scene3_prompt": "scene3",
        "scene3_screenshot_keywords": ["workorder"],
    }
    with patch("tools.yt_pipeline.planner.generate_script", return_value=mock_script):
        from tools.yt_pipeline.planner import plan_next
        result = plan_next("fake-key", topics_path=topics_yaml, calendar_path=cal_path)
    assert result["angle"] == "Angle B"
    assert result["angle_index"] == 1


def test_generate_script_parses_groq_response():
    """generate_script() returns parsed dict from Groq JSON response."""
    expected = {
        "title": "VFD Overcurrent Fix",
        "description": "How to fix it",
        "tags": ["vfd", "fault"],
        "scene1_prompt": "cinematic broll",
        "scene2_narration": "In this video...",
        "scene3_prompt": "mira demo",
        "scene3_screenshot_keywords": ["workorder", "hub"],
    }
    mock_resp = MagicMock()
    mock_resp.json.return_value = {
        "choices": [{"message": {"content": json.dumps(expected)}}]
    }
    mock_resp.raise_for_status = MagicMock()

    with patch("httpx.post", return_value=mock_resp):
        from tools.yt_pipeline.planner import generate_script
        result = generate_script("VFD overcurrent", "fake-groq-key")

    assert result["title"] == "VFD Overcurrent Fix"
    assert result["scene3_screenshot_keywords"] == ["workorder", "hub"]


def test_chapter_timestamps_are_short_and_honest():
    """_chapter_timestamps() builds 0:00-anchored, increasing, sub-2-min chapters."""
    from tools.yt_pipeline.planner import _chapter_timestamps

    script = (
        "Welcome to the Industrial Skills Hub. A VFD is a variable frequency drive. "
        "There are five common causes of overcurrent trips. "
        "Here is how to diagnose and fix each one. "
        "Thanks for watching — subscribe for more."
    )
    out = _chapter_timestamps(script)
    lines = out.splitlines()

    assert len(lines) >= 2
    assert lines[0].startswith("0:00 ")  # first chapter must be 0:00

    def secs(line: str) -> int:
        m, s = line.split(" ", 1)[0].split(":")
        return int(m) * 60 + int(s)

    times = [secs(line) for line in lines]
    assert times == sorted(times)  # monotonically increasing
    assert times[0] == 0
    assert all(t < 120 for t in times)  # honest for a ~1-min video, no fabricated 4:30 marks
    assert all(times[i + 1] - times[i] >= 10 for i in range(len(times) - 1))  # YouTube spacing


def test_chapter_timestamps_empty_for_trivial_script():
    """A one-sentence (or empty) script yields no chapters."""
    from tools.yt_pipeline.planner import _chapter_timestamps

    assert _chapter_timestamps("") == ""
    assert _chapter_timestamps("Just one sentence here.") == ""


def test_polish_strips_leading_filler():
    """_polish_chapter_label() removes leading filler words."""
    from tools.yt_pipeline.planner import _polish_chapter_label

    result = _polish_chapter_label("So you've got a fault code F0004", 1)
    assert result.lower().startswith("got")

    result = _polish_chapter_label("Now let's check the input power", 1)
    assert result.lower().startswith("check")

    result = _polish_chapter_label("You'll need to measure voltage", 1)
    assert result.lower().startswith("need")


def test_polish_strips_trailing_prepositions():
    """_polish_chapter_label() removes trailing prepositions/articles."""
    from tools.yt_pipeline.planner import _polish_chapter_label

    result = _polish_chapter_label("The first thing to check is the", 1)
    assert not result.lower().endswith("the")
    assert not result.lower().endswith("is")

    result = _polish_chapter_label("Decode the fault code in the", 1)
    assert not result.lower().endswith("the")


def test_polish_caps_at_50_chars_on_word_boundary():
    """_polish_chapter_label() caps at 50 chars on a word boundary."""
    from tools.yt_pipeline.planner import _polish_chapter_label

    long_text = "This is a very long chapter title that exceeds fifty characters significantly and should be truncated"
    result = _polish_chapter_label(long_text, 1)
    assert len(result) <= 50
    assert not result.endswith(" ")


def test_polish_uses_intro_for_generic_greeting():
    """_polish_chapter_label() returns 'Intro' for generic greetings in chapter 0."""
    from tools.yt_pipeline.planner import _polish_chapter_label

    assert _polish_chapter_label("Hi everyone", 0) == "Intro"
    assert _polish_chapter_label("Hello viewers", 0) == "Intro"
    assert _polish_chapter_label("Welcome to the channel", 0) == "Intro"

    result = _polish_chapter_label("Hi everyone", 1)
    assert result != "Intro"


def test_polish_falls_back_when_empty():
    """_polish_chapter_label() returns 'Chapter N' when the result is empty."""
    from tools.yt_pipeline.planner import _polish_chapter_label

    result = _polish_chapter_label("", 0)
    assert result == "Chapter 1"

    result = _polish_chapter_label("So.", 2)
    assert result == "Chapter 3"

    result = _polish_chapter_label("The a an", 1)
    assert result == "Chapter 2"


def test_polish_preserves_chapter_invariants():
    """Polished labels don't break _chapter_timestamps() invariants."""
    from tools.yt_pipeline.planner import _chapter_timestamps

    script = (
        "So you've got a fault code F0004 on your PowerFlex 525. "
        "The first thing to check is the input power to the drive. "
        "Measure the incoming three-phase voltage to confirm it's within spec. "
        "If power is good, we'll look at the parameter settings. "
        "Reset the drive and monitor the fault log. "
        "If the problem persists, contact the OEM for warranty service."
    )
    out = _chapter_timestamps(script)
    lines = out.splitlines()

    assert len(lines) >= 2
    assert lines[0].startswith("0:00 ")

    def secs(line: str) -> int:
        m, s = line.split(" ", 1)[0].split(":")
        return int(m) * 60 + int(s)

    times = [secs(line) for line in lines]
    assert times == sorted(times)
    assert times[0] == 0
    assert all(t < 120 for t in times)
    assert all(times[i + 1] - times[i] >= 10 for i in range(len(times) - 1))

    for line in lines:
        parts = line.split(" ", 1)
        label = parts[1]
        assert label[0].isupper() or label.startswith("Chapter")
