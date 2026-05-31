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
