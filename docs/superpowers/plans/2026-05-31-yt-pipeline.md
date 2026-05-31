# YouTube Content Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully autonomous pipeline in `tools/yt-pipeline/` that generates and uploads industrial education videos to Industrial Skills Hub every other day.

**Architecture:** Launchd fires `main.py` daily at 2 AM; `main.py` checks `calendar.json` and exits early if <48h since last run, otherwise runs planner → producer → assembler → uploader in sequence. Each stage is an independent Python module. Working files land in `/tmp/yt-pipeline/<run-id>/` and are cleaned up after upload.

**Tech Stack:** Python 3.12, httpx, pyyaml, ffmpeg (subprocess), YouTube Data API v3 (urllib.request), Groq API (httpx), BytePlus Seedance API (httpx), launchd for scheduling.

**Spec:** `docs/superpowers/specs/2026-05-31-yt-pipeline-design.md`

---

## File Map

| File | Responsibility |
|---|---|
| `tools/yt-pipeline/__init__.py` | Package marker |
| `tools/yt-pipeline/topics.yaml` | Topic tree — 5 areas × 4+ angles |
| `tools/yt-pipeline/planner.py` | Round-robin angle selection + Groq script generation |
| `tools/yt-pipeline/producer.py` | Seedance B-roll generation + screenshot selection |
| `tools/yt-pipeline/assembler.py` | ffmpeg: stitch clips + screenshots → final.mp4 |
| `tools/yt-pipeline/uploader.py` | YouTube resumable upload + metadata |
| `tools/yt-pipeline/main.py` | Orchestrator: 48h guard + stage sequencing + error/pause logic |
| `tools/yt-pipeline/com.factorylm.yt-pipeline.plist` | Launchd daily trigger for Bravo |
| `tests/yt_pipeline/test_planner.py` | Tests for topic rotation + LLM output parsing |
| `tests/yt_pipeline/test_producer.py` | Tests for screenshot selection + Seedance polling |
| `tests/yt_pipeline/test_assembler.py` | Tests for ffmpeg command construction |
| `tests/yt_pipeline/test_uploader.py` | Tests for token refresh + chunked upload |

---

## Task 1: Scaffold + topics.yaml

**Files:**
- Create: `tools/yt-pipeline/__init__.py`
- Create: `tools/yt-pipeline/topics.yaml`
- Create: `tools/yt-pipeline/calendar.json` (initial state)
- Create: `tests/yt_pipeline/__init__.py`

- [ ] **Step 1: Create package files**

```bash
mkdir -p tools/yt-pipeline tests/yt_pipeline
touch tools/yt-pipeline/__init__.py tests/yt_pipeline/__init__.py
```

- [ ] **Step 2: Write topics.yaml**

```yaml
# tools/yt-pipeline/topics.yaml
topics:
  vfd_troubleshooting:
    angles:
      - "Why your VFD keeps tripping on overcurrent — 5 causes and how to fix them"
      - "How to set Modbus RTU parameters on a GS10 variable frequency drive"
      - "VFD parameter backup and restore — never lose your settings after a drive replacement"
      - "How to size a VFD for your motor — nameplate math that saves drives"

  plc_basics:
    angles:
      - "Ladder logic rungs explained — how a PLC reads your program every scan"
      - "How to read a Micro820 I/O map and wire your first discrete input"
      - "Simulating a conveyor sort-by-height in Factory I/O — step by step"
      - "Debugging a stuck output coil — the 3-minute method that finds it every time"

  preventive_maintenance:
    angles:
      - "How to build a conveyor PM checklist that actually prevents failures"
      - "Bearing replacement intervals — what the OEM manual doesn't tell you"
      - "How MIRA AI auto-generates a PM schedule from your equipment manuals"
      - "Vibration analysis basics — what your phone's accelerometer can tell you about a motor"

  nameplates_manuals:
    angles:
      - "How to read a motor nameplate — every field explained for maintenance techs"
      - "How to upload an OEM manual to MIRA and ask it fault code questions"
      - "What to do when the nameplate is missing — finding specs from model number alone"
      - "Understanding a VFD manual — the 4 sections every tech needs to know"

  mira_demos:
    angles:
      - "MIRA AI diagnoses a VFD overcurrent fault live — watch it pull the fix in seconds"
      - "Auto-generating a work order from a fault code with MIRA"
      - "How MIRA uses QR codes to pull up asset history on your phone"
      - "Uploading a wiring diagram and asking MIRA where to check first"
```

- [ ] **Step 3: Write initial calendar.json**

```json
{
  "next_angle_index": 0,
  "last_run_utc": null,
  "consecutive_failures": 0,
  "published": []
}
```

Save to `tools/yt-pipeline/calendar.json`.

- [ ] **Step 4: Commit scaffold**

```bash
git add tools/yt-pipeline/ tests/yt_pipeline/
git commit -m "feat(yt-pipeline): scaffold directory structure and topics.yaml"
```

---

## Task 2: planner.py

**Files:**
- Create: `tools/yt-pipeline/planner.py`
- Create: `tests/yt_pipeline/test_planner.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/yt_pipeline/test_planner.py
import json
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock


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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/bravonode/Mira
python3.12 -m pytest tests/yt_pipeline/test_planner.py -v 2>&1 | tail -15
```

Expected: `ModuleNotFoundError` — `tools.yt_pipeline.planner` doesn't exist yet.

- [ ] **Step 3: Implement planner.py**

```python
# tools/yt-pipeline/planner.py
"""Picks the next topic angle and generates a 3-scene video script via Groq."""
from __future__ import annotations

import json
import logging
from pathlib import Path

import httpx
import yaml

log = logging.getLogger("yt-pipeline.planner")

_DEFAULT_TOPICS = Path(__file__).parent / "topics.yaml"
_DEFAULT_CALENDAR = Path(__file__).parent / "calendar.json"


def load_topics(topics_path: Path = _DEFAULT_TOPICS) -> list[dict]:
    data = yaml.safe_load(topics_path.read_text())
    angles = []
    for area, config in data["topics"].items():
        for angle in config["angles"]:
            angles.append({"area": area, "angle": angle})
    return angles


def load_calendar(calendar_path: Path = _DEFAULT_CALENDAR) -> dict:
    if calendar_path.exists():
        return json.loads(calendar_path.read_text())
    return {"next_angle_index": 0, "last_run_utc": None, "consecutive_failures": 0, "published": []}


def save_calendar(cal: dict, calendar_path: Path = _DEFAULT_CALENDAR) -> None:
    calendar_path.write_text(json.dumps(cal, indent=2))


def generate_script(angle: str, groq_api_key: str) -> dict:
    """Call Groq to generate title, description, tags, and 3-scene script."""
    prompt = (
        f"You are writing a YouTube video script for the Industrial Skills Hub channel.\n"
        f"Topic: {angle}\n\n"
        f"Return a JSON object with these exact keys:\n"
        f"- title: string (YouTube title, keyword-rich, under 70 chars)\n"
        f"- description: string (150-200 words, include timestamps at 0:00 0:45 1:30 2:15 3:00 4:30)\n"
        f"- tags: list of 10 strings (industrial maintenance keywords)\n"
        f"- scene1_prompt: string (Seedance AI video prompt, 8s cinematic industrial B-roll hook)\n"
        f"- scene2_narration: string (narrator script for screen recording section, 200-300 words)\n"
        f"- scene3_prompt: string (Seedance AI video prompt, 8s B-roll for MIRA demo section)\n"
        f"- scene3_screenshot_keywords: list of 3 strings (filename substrings matching promo screenshots)\n\n"
        f"Return ONLY the JSON object, no markdown fences."
    )
    resp = httpx.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={"Authorization": f"Bearer {groq_api_key}"},
        json={
            "model": "llama-3.3-70b-versatile",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.7,
            "max_tokens": 2000,
        },
        timeout=60,
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"].strip()
    # Strip markdown fences if model adds them anyway
    if content.startswith("```"):
        content = content.split("```")[1]
        if content.startswith("json"):
            content = content[4:]
    return json.loads(content)


def plan_next(
    groq_api_key: str,
    topics_path: Path = _DEFAULT_TOPICS,
    calendar_path: Path = _DEFAULT_CALENDAR,
) -> dict:
    """Select next angle and generate script. Returns full plan dict."""
    cal = load_calendar(calendar_path)
    angles = load_topics(topics_path)
    idx = cal.get("next_angle_index", 0) % len(angles)
    chosen = angles[idx]
    log.info("Planning angle %d: area=%s", idx, chosen["area"])
    script = generate_script(chosen["angle"], groq_api_key)
    return {"area": chosen["area"], "angle": chosen["angle"], "angle_index": idx, **script}
```

- [ ] **Step 4: Fix import path — add `tools/yt-pipeline` as `tools/yt_pipeline` symlink**

The tests import `tools.yt_pipeline` but the directory is `tools/yt-pipeline` (hyphen). Create a symlink:

```bash
cd tools && ln -sf yt-pipeline yt_pipeline && cd ..
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
python3.12 -m pytest tests/yt_pipeline/test_planner.py -v
```

Expected: `3 passed`

- [ ] **Step 6: Commit**

```bash
git add tools/yt-pipeline/planner.py tools/yt_pipeline
git commit -m "feat(yt-pipeline): planner — topic rotation and Groq script generation"
```

---

## Task 3: producer.py

**Files:**
- Create: `tools/yt-pipeline/producer.py`
- Create: `tests/yt_pipeline/test_producer.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/yt_pipeline/test_producer.py
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock, call


def test_select_screenshots_matches_keywords(tmp_path):
    """select_screenshots() returns paths whose filenames contain the keywords."""
    (tmp_path / "2026-04-27_workorder-detail_desktop.png").touch()
    (tmp_path / "2026-04-27_hub-login_desktop.png").touch()
    (tmp_path / "2026-04-27_schedule-calendar_desktop.png").touch()

    from tools.yt_pipeline.producer import select_screenshots
    results = select_screenshots(["workorder", "hub"], screenshots_dir=tmp_path)
    names = [r.name for r in results]
    assert any("workorder" in n for n in names)
    assert any("hub" in n for n in names)


def test_select_screenshots_pads_to_four(tmp_path):
    """select_screenshots() always returns up to 4 paths, padding with recents."""
    for i in range(6):
        (tmp_path / f"2026-04-{i+1:02d}_shot_{i}.png").touch()

    from tools.yt_pipeline.producer import select_screenshots
    results = select_screenshots(["nomatch"], screenshots_dir=tmp_path)
    assert len(results) == 4


def test_generate_broll_polls_until_succeeded(tmp_path):
    """generate_broll() submits job, polls, downloads MP4 on success."""
    submit_resp = MagicMock()
    submit_resp.raise_for_status = MagicMock()
    submit_resp.json.return_value = {"id": "job-123"}

    poll_resp = MagicMock()
    poll_resp.raise_for_status = MagicMock()
    poll_resp.json.return_value = {
        "status": "succeeded",
        "content": [{"video_url": "https://example.com/clip.mp4"}],
    }

    download_resp = MagicMock()
    download_resp.content = b"fake-mp4-bytes"

    with patch("httpx.post", return_value=submit_resp), \
         patch("httpx.get", side_effect=[poll_resp, download_resp]):
        from tools.yt_pipeline.producer import generate_broll
        out = generate_broll("cinematic broll prompt", tmp_path, "scene1", "fake-key")

    assert out.exists()
    assert out.read_bytes() == b"fake-mp4-bytes"
    assert out.name == "scene1.mp4"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python3.12 -m pytest tests/yt_pipeline/test_producer.py -v 2>&1 | tail -10
```

Expected: `ImportError` or `ModuleNotFoundError`.

- [ ] **Step 3: Implement producer.py**

```python
# tools/yt-pipeline/producer.py
"""Generates Seedance B-roll clips and selects promo screenshots."""
from __future__ import annotations

import logging
import time
from pathlib import Path

import httpx

log = logging.getLogger("yt-pipeline.producer")

_REPO_ROOT = Path(__file__).parent.parent.parent
_DEFAULT_SCREENSHOTS_DIR = _REPO_ROOT / "docs" / "promo-screenshots"
_API_BASE = "https://ark.ap-southeast.byteplus.com/api/v3"
_MODEL = "seedance-1-0-lite-t2v-250428"
_POLL_INTERVAL = 10
_MAX_POLLS = 36  # 6 minutes


def select_screenshots(
    keywords: list[str],
    screenshots_dir: Path = _DEFAULT_SCREENSHOTS_DIR,
) -> list[Path]:
    """Return up to 4 screenshots: keyword matches first, then most recent."""
    all_shots = sorted(screenshots_dir.glob("*.png"), reverse=True)
    matches: list[Path] = []
    for kw in keywords:
        for shot in all_shots:
            if kw.lower() in shot.name.lower() and shot not in matches:
                matches.append(shot)
                break
    for shot in all_shots:
        if len(matches) >= 4:
            break
        if shot not in matches:
            matches.append(shot)
    return matches[:4]


def generate_broll(prompt: str, run_dir: Path, clip_name: str, api_key: str) -> Path:
    """Submit Seedance job, poll until complete, download MP4. Returns output path."""
    resp = httpx.post(
        f"{_API_BASE}/contents/generations/tasks",
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": _MODEL,
            "content": [{"type": "text", "text": prompt}],
            "parameters": {"resolution": "720p", "duration": 8, "aspect_ratio": "16:9"},
        },
        timeout=30,
    )
    resp.raise_for_status()
    task_id = resp.json()["id"]
    log.info("Seedance job submitted: %s", task_id)

    for _ in range(_MAX_POLLS):
        time.sleep(_POLL_INTERVAL)
        status_resp = httpx.get(
            f"{_API_BASE}/contents/generations/tasks/{task_id}",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=30,
        )
        status_resp.raise_for_status()
        data = status_resp.json()
        if data["status"] == "succeeded":
            video_url = data["content"][0]["video_url"]
            out_path = run_dir / f"{clip_name}.mp4"
            out_path.write_bytes(httpx.get(video_url, timeout=120).content)
            log.info("B-roll saved: %s", out_path)
            return out_path
        if data["status"] == "failed":
            raise RuntimeError(f"Seedance job {task_id} failed: {data}")

    raise TimeoutError(f"Seedance job {task_id} timed out after {_MAX_POLLS * _POLL_INTERVAL}s")


def produce(plan: dict, run_dir: Path, byteplus_api_key: str) -> dict:
    """Generate all assets for a run. Returns asset path dict."""
    run_dir.mkdir(parents=True, exist_ok=True)
    clip1 = generate_broll(plan["scene1_prompt"], run_dir, "scene1", byteplus_api_key)
    clip3 = generate_broll(plan["scene3_prompt"], run_dir, "scene3", byteplus_api_key)
    screenshots = select_screenshots(plan["scene3_screenshot_keywords"])
    narration_path = run_dir / "narration.txt"
    narration_path.write_text(plan["scene2_narration"])
    return {
        "scene1_clip": str(clip1),
        "scene3_clip": str(clip3),
        "screenshots": [str(s) for s in screenshots],
        "narration": str(narration_path),
    }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python3.12 -m pytest tests/yt_pipeline/test_producer.py -v
```

Expected: `3 passed`

- [ ] **Step 5: Commit**

```bash
git add tools/yt-pipeline/producer.py
git commit -m "feat(yt-pipeline): producer — Seedance B-roll generation and screenshot selection"
```

---

## Task 4: assembler.py

**Files:**
- Create: `tools/yt-pipeline/assembler.py`
- Create: `tests/yt_pipeline/test_assembler.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/yt_pipeline/test_assembler.py
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock, call


def _make_assets(tmp_path: Path) -> dict:
    scene1 = tmp_path / "scene1.mp4"
    scene1.write_bytes(b"fake")
    scene3 = tmp_path / "scene3.mp4"
    scene3.write_bytes(b"fake")
    shots = []
    for i in range(4):
        s = tmp_path / f"shot{i}.png"
        s.write_bytes(b"fake")
        shots.append(str(s))
    return {
        "scene1_clip": str(scene1),
        "scene3_clip": str(scene3),
        "screenshots": shots,
        "narration": str(tmp_path / "narration.txt"),
    }


def test_assemble_calls_ffmpeg_three_times(tmp_path):
    """assemble() calls ffmpeg for slideshow, title card, outro, and concat."""
    assets = _make_assets(tmp_path)
    plan = {"title": "Test Video Title"}

    with patch("subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0, stderr="")
        from tools.yt_pipeline.assembler import assemble
        out = assemble(plan, assets, tmp_path)

    assert mock_run.call_count == 4  # slideshow, title, outro, concat
    assert out == tmp_path / "final.mp4"


def test_assemble_raises_on_ffmpeg_failure(tmp_path):
    """assemble() raises RuntimeError if any ffmpeg call fails."""
    assets = _make_assets(tmp_path)
    plan = {"title": "Test"}

    with patch("subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=1, stderr="codec not found")
        from tools.yt_pipeline.assembler import assemble
        with pytest.raises(RuntimeError, match="ffmpeg failed"):
            assemble(plan, assets, tmp_path)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python3.12 -m pytest tests/yt_pipeline/test_assembler.py -v 2>&1 | tail -10
```

Expected: `ImportError`.

- [ ] **Step 3: Implement assembler.py**

```python
# tools/yt-pipeline/assembler.py
"""Assembles B-roll, screenshots, and title cards into final.mp4 via ffmpeg."""
from __future__ import annotations

import logging
import subprocess
from pathlib import Path

log = logging.getLogger("yt-pipeline.assembler")


def _ffmpeg(*args: str) -> None:
    result = subprocess.run(["ffmpeg", "-y", *args], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {result.stderr[-500:]}")


def assemble(plan: dict, assets: dict, run_dir: Path) -> Path:
    """Stitch all assets into final.mp4. Returns output path."""
    shots = assets["screenshots"]

    # 1. Screenshot slideshow: 4 × 5s with Ken Burns zoom
    inputs: list[str] = []
    for shot in shots:
        inputs += ["-loop", "1", "-t", "5", "-i", shot]

    filter_parts = [
        f"[{i}:v]scale=1920:1080:force_original_aspect_ratio=increase,"
        f"crop=1920:1080,zoompan=z='min(zoom+0.001,1.1)':d=125:s=1920x1080[v{i}]"
        for i in range(len(shots))
    ]
    filter_parts.append(
        "".join(f"[v{i}]" for i in range(len(shots)))
        + f"concat=n={len(shots)}:v=1[out]"
    )
    slideshow = run_dir / "slideshow.mp4"
    _ffmpeg(
        *inputs,
        "-filter_complex", ";".join(filter_parts),
        "-map", "[out]", "-r", "30", "-pix_fmt", "yuv420p",
        str(slideshow),
    )

    # 2. Title card (3s)
    title_card = run_dir / "title.mp4"
    safe_title = plan["title"].replace("'", "\\'").replace(":", "\\:")
    _ffmpeg(
        "-f", "lavfi", "-i", "color=c=black:s=1920x1080:d=3",
        "-vf", (
            f"drawtext=text='{safe_title}':fontcolor=white:fontsize=48"
            ":x=(w-text_w)/2:y=(h-text_h)/2:fontfile=/System/Library/Fonts/Helvetica.ttc"
        ),
        "-pix_fmt", "yuv420p", str(title_card),
    )

    # 3. Outro card (5s)
    outro = run_dir / "outro.mp4"
    _ffmpeg(
        "-f", "lavfi", "-i", "color=c=black:s=1920x1080:d=5",
        "-vf", (
            "drawtext=text='Try MIRA free at factorylm.com'"
            ":fontcolor=white:fontsize=36:x=(w-text_w)/2:y=(h-text_h)/2"
            ":fontfile=/System/Library/Fonts/Helvetica.ttc"
        ),
        "-pix_fmt", "yuv420p", str(outro),
    )

    # 4. Concatenate all segments
    segments = [
        assets["scene1_clip"],
        str(title_card),
        str(slideshow),
        assets["scene3_clip"],
        str(outro),
    ]
    concat_file = run_dir / "concat.txt"
    concat_file.write_text("\n".join(f"file '{s}'" for s in segments))
    out = run_dir / "final.mp4"
    _ffmpeg(
        "-f", "concat", "-safe", "0", "-i", str(concat_file),
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-pix_fmt", "yuv420p", str(out),
    )

    log.info("Assembly complete: %s (%.1f MB)", out, out.stat().st_size / 1e6)
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python3.12 -m pytest tests/yt_pipeline/test_assembler.py -v
```

Expected: `2 passed`

- [ ] **Step 5: Commit**

```bash
git add tools/yt-pipeline/assembler.py
git commit -m "feat(yt-pipeline): assembler — ffmpeg slideshow, title card, and concat pipeline"
```

---

## Task 5: uploader.py

**Files:**
- Create: `tools/yt-pipeline/uploader.py`
- Create: `tests/yt_pipeline/test_uploader.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/yt_pipeline/test_uploader.py
import json
import urllib.error
from pathlib import Path
from unittest.mock import patch, MagicMock, call


def _plan() -> dict:
    return {
        "title": "VFD Overcurrent Fix",
        "description": "How to fix VFD overcurrent faults.",
        "tags": ["vfd", "fault", "industrial"],
    }


def test_refresh_token_returns_access_token():
    """_refresh_token() exchanges refresh token for access token."""
    mock_resp = MagicMock()
    mock_resp.read.return_value = json.dumps({"access_token": "ya29.test"}).encode()
    mock_resp.__enter__ = lambda s: s
    mock_resp.__exit__ = MagicMock(return_value=False)

    with patch("urllib.request.urlopen", return_value=mock_resp):
        from tools.yt_pipeline.uploader import _refresh_token
        token = _refresh_token("client-id", "client-secret", "refresh-tok")

    assert token == "ya29.test"


def test_upload_returns_video_id(tmp_path):
    """upload() streams chunks and returns video ID from final 200 response."""
    video = tmp_path / "final.mp4"
    video.write_bytes(b"x" * 100)

    # Mock 1: token refresh
    token_resp = MagicMock()
    token_resp.read.return_value = json.dumps({"access_token": "ya29.test"}).encode()
    token_resp.__enter__ = lambda s: s
    token_resp.__exit__ = MagicMock(return_value=False)

    # Mock 2: initiate upload — returns Location header
    init_resp = MagicMock()
    init_resp.headers = {"Location": "https://upload.example.com/session/abc"}
    init_resp.__enter__ = lambda s: s
    init_resp.__exit__ = MagicMock(return_value=False)

    # Mock 3: chunk upload — returns 200 with video ID
    chunk_resp = MagicMock()
    chunk_resp.status = 200
    chunk_resp.read.return_value = json.dumps({"id": "vid-xyz"}).encode()
    chunk_resp.__enter__ = lambda s: s
    chunk_resp.__exit__ = MagicMock(return_value=False)

    with patch("urllib.request.urlopen", side_effect=[token_resp, init_resp, chunk_resp]):
        from tools.yt_pipeline.uploader import upload
        video_id = upload(_plan(), video, "cid", "csecret", "rtoken", auto_publish=True)

    assert video_id == "vid-xyz"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python3.12 -m pytest tests/yt_pipeline/test_uploader.py -v 2>&1 | tail -10
```

Expected: `ImportError`.

- [ ] **Step 3: Implement uploader.py**

```python
# tools/yt-pipeline/uploader.py
"""Uploads final.mp4 to YouTube via Data API v3 resumable upload."""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

log = logging.getLogger("yt-pipeline.uploader")

_TOKEN_URL = "https://oauth2.googleapis.com/token"
_UPLOAD_URL = (
    "https://www.googleapis.com/upload/youtube/v3/videos"
    "?uploadType=resumable&part=snippet,status"
)
_CHUNK_SIZE = 5 * 1024 * 1024  # 5 MB


def _refresh_token(client_id: str, client_secret: str, refresh_token: str) -> str:
    data = urllib.parse.urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }).encode()
    req = urllib.request.Request(_TOKEN_URL, data=data, method="POST")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())["access_token"]


def upload(
    plan: dict,
    video_path: Path,
    client_id: str,
    client_secret: str,
    refresh_token: str,
    auto_publish: bool = False,
) -> str:
    """Upload video_path to YouTube. Returns video ID."""
    access_token = _refresh_token(client_id, client_secret, refresh_token)
    video_size = video_path.stat().st_size

    metadata = json.dumps({
        "snippet": {
            "title": plan["title"],
            "description": plan["description"],
            "tags": plan["tags"],
            "categoryId": "28",
        },
        "status": {"privacyStatus": "public" if auto_publish else "private"},
    }).encode()

    init_req = urllib.request.Request(_UPLOAD_URL, data=metadata, method="POST")
    init_req.add_header("Authorization", f"Bearer {access_token}")
    init_req.add_header("Content-Type", "application/json")
    init_req.add_header("X-Upload-Content-Type", "video/mp4")
    init_req.add_header("X-Upload-Content-Length", str(video_size))
    with urllib.request.urlopen(init_req) as resp:
        upload_uri = resp.headers["Location"]

    log.info("Uploading %s (%.1f MB) to YouTube...", video_path.name, video_size / 1e6)
    with open(video_path, "rb") as f:
        offset = 0
        while offset < video_size:
            chunk = f.read(_CHUNK_SIZE)
            end = offset + len(chunk) - 1
            chunk_req = urllib.request.Request(upload_uri, data=chunk, method="PUT")
            chunk_req.add_header("Content-Range", f"bytes {offset}-{end}/{video_size}")
            chunk_req.add_header("Content-Type", "video/mp4")
            try:
                with urllib.request.urlopen(chunk_req) as resp:
                    if resp.status in (200, 201):
                        video_id = json.loads(resp.read())["id"]
                        log.info("Upload complete: https://youtube.com/watch?v=%s", video_id)
                        return video_id
                    offset += len(chunk)
            except urllib.error.HTTPError as exc:
                if exc.code == 308:  # Resume Incomplete — expected for non-final chunks
                    offset += len(chunk)
                else:
                    raise

    raise RuntimeError("Upload completed all chunks without receiving video ID")
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python3.12 -m pytest tests/yt_pipeline/test_uploader.py -v
```

Expected: `2 passed`

- [ ] **Step 5: Commit**

```bash
git add tools/yt-pipeline/uploader.py
git commit -m "feat(yt-pipeline): uploader — YouTube resumable upload with OAuth token refresh"
```

---

## Task 6: main.py orchestrator

**Files:**
- Create: `tools/yt-pipeline/main.py`

No separate tests — integration is verified by a `--dry-run` flag that runs planner only.

- [ ] **Step 1: Implement main.py**

```python
# tools/yt-pipeline/main.py
"""Orchestrates the YouTube content pipeline. Run daily via launchd; skips if <48h since last run."""
from __future__ import annotations

import logging
import os
import shutil
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("yt-pipeline")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

_PIPELINE_DIR = Path(__file__).parent
_CALENDAR_FILE = _PIPELINE_DIR / "calendar.json"
_ERROR_LOG = Path("/tmp/yt-pipeline/errors.log")
_PAUSE_SENTINEL = Path("/tmp/yt-pipeline/PAUSED")
_MIN_INTERVAL_HOURS = 47  # fire if ≥47h since last run (buffer for launchd jitter)


def _should_run(cal: dict) -> bool:
    last = cal.get("last_run_utc")
    if last is None:
        return True
    last_dt = datetime.fromisoformat(last)
    hours_since = (datetime.now(timezone.utc) - last_dt).total_seconds() / 3600
    return hours_since >= _MIN_INTERVAL_HOURS


def run(dry_run: bool = False) -> None:
    from .planner import plan_next, load_calendar, save_calendar
    from .producer import produce
    from .assembler import assemble
    from .uploader import upload

    if _PAUSE_SENTINEL.exists():
        log.warning("Pipeline paused. Delete %s to resume.", _PAUSE_SENTINEL)
        return

    cal = load_calendar(_CALENDAR_FILE)
    if not _should_run(cal):
        log.info("Last run was recent — skipping this trigger.")
        return

    run_id = uuid.uuid4().hex[:8]
    run_dir = Path(f"/tmp/yt-pipeline/{run_id}")

    try:
        groq_key = os.environ["GROQ_API_KEY"]
        byteplus_key = os.environ["BYTEPLUS_API_KEY"]
        yt_client_id = os.environ["YOUTUBE_CLIENT_ID"]
        yt_client_secret = os.environ["YOUTUBE_CLIENT_SECRET"]
        yt_refresh_token = os.environ["YOUTUBE_REFRESH_TOKEN_ISH"]
        auto_publish = os.environ.get("AUTO_PUBLISH", "false").lower() == "true"

        log.info("Run %s starting (dry_run=%s)", run_id, dry_run)
        plan = plan_next(groq_key)
        log.info("Planned: %s", plan["title"])

        if dry_run:
            log.info("Dry run — stopping after planner. Plan:\n%s", plan)
            return

        assets = produce(plan, run_dir, byteplus_key)
        video_path = assemble(plan, assets, run_dir)
        video_id = upload(plan, video_path, yt_client_id, yt_client_secret, yt_refresh_token, auto_publish)

        cal["next_angle_index"] = plan["angle_index"] + 1
        cal["last_run_utc"] = datetime.now(timezone.utc).isoformat()
        cal["consecutive_failures"] = 0
        cal.setdefault("published", []).append({
            "video_id": video_id,
            "title": plan["title"],
            "topic": plan["area"],
            "angle_index": plan["angle_index"],
            "status": "public" if auto_publish else "private",
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
        })
        save_calendar(cal, _CALENDAR_FILE)
        log.info("Run %s complete → https://youtube.com/watch?v=%s", run_id, video_id)

    except Exception as exc:
        log.exception("Run %s failed: %s", run_id, exc)
        _ERROR_LOG.parent.mkdir(parents=True, exist_ok=True)
        with open(_ERROR_LOG, "a") as f:
            f.write(f"{datetime.now(timezone.utc).isoformat()} run={run_id} error={exc}\n")
        cal = load_calendar(_CALENDAR_FILE)
        failures = cal.get("consecutive_failures", 0) + 1
        cal["consecutive_failures"] = failures
        save_calendar(cal, _CALENDAR_FILE)
        if failures >= 3:
            _PAUSE_SENTINEL.parent.mkdir(parents=True, exist_ok=True)
            _PAUSE_SENTINEL.write_text(f"Paused after {failures} failures. Last: {exc}")
            log.error("Pipeline paused after 3 failures. Delete %s to resume.", _PAUSE_SENTINEL)
        sys.exit(1)
    finally:
        if run_dir.exists():
            shutil.rmtree(run_dir, ignore_errors=True)


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    run(dry_run=dry_run)
```

- [ ] **Step 2: Smoke test with dry-run**

```bash
doppler run --project factorylm --config dev -- \
  python3.12 -m tools.yt_pipeline.main --dry-run
```

Expected output: logs the planned title and exits. No Seedance calls, no upload.

- [ ] **Step 3: Commit**

```bash
git add tools/yt-pipeline/main.py
git commit -m "feat(yt-pipeline): main orchestrator with 48h guard, dry-run mode, and pause sentinel"
```

---

## Task 7: Launchd service + install

**Files:**
- Create: `tools/yt-pipeline/com.factorylm.yt-pipeline.plist`

- [ ] **Step 1: Write plist**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!--
  YouTube content pipeline — Bravo daily trigger.

  Install on BRAVO:
    cp tools/yt-pipeline/com.factorylm.yt-pipeline.plist \
       ~/Library/LaunchAgents/
    launchctl load ~/Library/LaunchAgents/com.factorylm.yt-pipeline.plist

  Verify:
    launchctl list | grep yt-pipeline
    tail -f /tmp/yt-pipeline-stderr.log

  Dry run (test without Seedance/upload):
    launchctl unload ~/Library/LaunchAgents/com.factorylm.yt-pipeline.plist
    # add --dry-run to ProgramArguments below
    launchctl load ~/Library/LaunchAgents/com.factorylm.yt-pipeline.plist

  Pause: touch /tmp/yt-pipeline/PAUSED
  Resume: rm /tmp/yt-pipeline/PAUSED
-->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.factorylm.yt-pipeline</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>cd /Users/bravonode/Mira &amp;&amp; /Users/bravonode/.local/bin/doppler run --project factorylm --config dev -- /opt/homebrew/bin/python3.12 -m tools.yt_pipeline.main 2&gt;&gt;/tmp/yt-pipeline-stderr.log</string>
  </array>

  <key>WorkingDirectory</key>
  <string>/Users/bravonode/Mira</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>

  <!-- Fire daily at 2:00 AM; main.py enforces the 48h interval internally -->
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>2</integer>
    <key>Minute</key><integer>0</integer>
  </dict>

  <key>RunAtLoad</key>
  <false/>

  <key>StandardOutPath</key>
  <string>/tmp/yt-pipeline-stdout.log</string>

  <key>StandardErrorPath</key>
  <string>/tmp/yt-pipeline-stderr.log</string>
</dict>
</plist>
```

- [ ] **Step 2: Install on Bravo**

```bash
cp tools/yt-pipeline/com.factorylm.yt-pipeline.plist \
   ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.factorylm.yt-pipeline.plist
launchctl list | grep yt-pipeline
```

Expected: one line showing the service with PID `-` (not running yet, fires at 2 AM).

- [ ] **Step 3: Run a full dry-run through launchctl to verify env**

```bash
launchctl start com.factorylm.yt-pipeline
sleep 5
tail -20 /tmp/yt-pipeline-stderr.log
```

Expected: logs show `Planned: <video title>` and `Dry run — stopping after planner`.

- [ ] **Step 4: Commit and push**

```bash
git add tools/yt-pipeline/com.factorylm.yt-pipeline.plist
git commit -m "feat(yt-pipeline): launchd plist for Bravo daily trigger at 2 AM"
git push origin feature/yt-pipeline
```

---

## Full test run

After all tasks complete, run the entire test suite to confirm nothing regresses:

```bash
python3.12 -m pytest tests/yt_pipeline/ -v
```

Expected: `7 passed`

Then do one live dry-run to confirm the full chain works with real Doppler secrets:

```bash
doppler run --project factorylm --config dev -- \
  python3.12 -m tools.yt_pipeline.main --dry-run
```

Expected: logs a real LLM-generated title from Groq and exits cleanly.

---

## Plan Amendments (2026-05-31, pre-execution)

These corrections were made before execution after review surfaced plan-level
defects that all three quality gates (mocked tests, spec review, code review)
would have passed through. They are authoritative — they supersede the
as-written Task 3, Task 4, and Task 6 above where they conflict.

### A. Narration gets a real voiceover (Task 3)

The as-written plan generates `scene2_narration` text but never turns it into
audio — the video would ship silent. **Decision (user):** reuse MIRA's existing
TTS engine from the comic pipeline rather than inventing a new one.

- **Source of truth:** `marketing/comic-pipeline/pipeline/v2/tts.py::synth_beat`
  — OpenAI `gpt-4o-mini-tts`, voice `onyx`, speed `1.05`, maintenance-engineer
  style instruction. Verified importable via
  `sys.path.insert(0, "<repo>/marketing/comic-pipeline")` →
  `from pipeline.v2.tts import synth_beat`. `openai` 1.109.1 is installed for
  py3.12. Requires `OPENAI_API_KEY` (Doppler). Do **not** reinvent TTS or use
  macOS `say`.
- **producer.py** imports `synth_beat` at module load (so tests can
  `patch("tools.yt_pipeline.producer.synth_beat")`), adds
  `synth_narration(text, run_dir, *, api_key) -> Path` producing
  `narration.mp3`, and `produce(plan, run_dir, *, byteplus_api_key,
  openai_api_key)` returns `"narration_audio": <mp3 path>` (replacing the
  unused `narration.txt`).
- **Tests:** add `test_synth_narration_reuses_tts` (mock `synth_beat`, assert
  `narration.mp3` returned, no real API call). The existing
  `test_generate_broll_polls_until_succeeded` MUST also
  `patch("tools.yt_pipeline.producer.time.sleep")` so it doesn't really sleep.

### B. Assembler normalizes before concat + muxes audio + real ffmpeg test (Task 4)

The as-written assembler feeds the concat **demuxer** a mix of 720p Seedance
clips, 1080p lavfi cards (25fps default), and a 30fps slideshow. The concat
demuxer does not rescale → "Input link parameters do not match" / corrupt
output. Mocked `subprocess.run` never catches this. Corrections:

- **Title and outro cards** must be forced to `1920x1080`, `-r 30`,
  `format=yuv420p`.
- **Final step uses the concat *filter*, not the demuxer**, normalizing every
  segment per-input before concat, then maps the narration audio. One ffmpeg
  call, e.g.:
  ```
  ffmpeg -y -i scene1 -i title -i slideshow -i scene3 -i outro -i narration.mp3 \
    -filter_complex "
      [0:v]scale=1920:1080:force_original_aspect_ratio=decrease,
           pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v0];
      [1:v]...[v1];[2:v]...[v2];[3:v]...[v3];[4:v]...[v4];
      [v0][v1][v2][v3][v4]concat=n=5:v=1:a=0[vout]" \
    -map "[vout]" -map 5:a \
    -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 192k \
    -shortest -movflags +faststart final.mp4
  ```
  (`-shortest` trims narration to video length — acceptable for v1; matching
  slideshow duration to narration is a noted follow-up, not in scope.)
- **assemble(plan, assets, run_dir)** reads `assets["narration_audio"]`.
- **Tests:** keep one mocked failure-path test (`assemble` raises
  `RuntimeError` when ffmpeg returns non-zero). Drop the brittle
  "calls ffmpeg N times" count assertion. **ADD a real-bytes acceptance test**
  (`@pytest.mark.skipif(shutil.which("ffmpeg") is None)`) that builds tiny real
  inputs (lavfi-generated 720p mp4 clips, real PNGs, a real mp3) and asserts
  `final.mp4` exists, and `ffprobe` reports **both** a video and an audio
  stream with duration > 0. This is the only gate that proves assembly works.

### C. main.py reads OPENAI_API_KEY (Task 6)

Add `openai_key = os.environ["OPENAI_API_KEY"]` and call
`produce(plan, run_dir, byteplus_api_key=byteplus_key, openai_api_key=openai_key)`.
The launchd plist already runs under `doppler run`, so the key is present.
