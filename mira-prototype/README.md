# MIRA AR HUD Simulator

Renders step-by-step maintenance instructions as an AR heads-up display over a live camera feed — viewed through simulated smart glasses lenses. Stream to your phone for a glasses demo.

## Quick Start

```bash
cd mira-prototype
pip install -r requirements.txt

# Desktop window (needs webcam)
python mira_demo.py

# No camera? Use test mode
python mira_demo.py --test

# Stream to phone (headless — no GUI needed)
python mira_demo.py --test --serve
# Open the printed URL on your phone browser
```

## Usage

```bash
# Default procedure (Hydraulic Press Unit 4 PM)
python mira_demo.py

# Load a specific procedure
python mira_demo.py --procedure procedures/press_unit_4.json

# Generate a new procedure via Claude API
export ANTHROPIC_API_KEY=your_key
python mira_demo.py --generate "Conveyor belt tensioning"

# Camera options
python mira_demo.py --camera 1                                    # alternate index
python mira_demo.py --camera "http://192.168.1.5:8080/video"     # IP camera URL

# Lens modes
python mira_demo.py --monocular          # single right-eye (Frame hardware accurate)
python mira_demo.py                       # binocular (default — better for demo video)

# Flask streaming to phone
python mira_demo.py --serve               # webcam + stream on port 5000
python mira_demo.py --test --serve        # synthetic frame + stream
python mira_demo.py --serve --port 8080   # custom port
```

## Controls

### Desktop Mode (keyboard)

| Key | Action |
|---|---|
| SPACE | Advance to next step |
| R | Reset to step 1 |
| M | Toggle monocular / binocular |
| G | Generate new procedure (Claude API) |
| F | Toggle fullscreen |
| Q / ESC | Quit |

### Streaming Mode (phone browser)

| Action | Effect |
|---|---|
| Tap right half of screen | Advance step |
| Tap left half of screen | Reset |
| Keyboard SPACE / R / M | Also works if browser has focus |

## Recording a Demo

### Option A: Desktop screen recording
1. Start OBS or screen recorder
2. `python mira_demo.py` (or `--test` without camera)
3. Press F for fullscreen, walk through 6 steps with SPACE

### Option B: Phone as glasses mockup
1. `python mira_demo.py --test --serve`
2. Open the URL on your phone
3. Go fullscreen in Chrome (tap menu > "Add to Home Screen" or F11)
4. Hold phone up like a monocle — screen record from phone

## Procedure File Format

```json
{
  "task": "Description of the maintenance task",
  "equipment_id": "EQUIP-001",
  "steps": [
    {"step": 1, "title": "Short title", "detail": "One-line instruction"}
  ]
}
```

## Dependencies

- `opencv-python` (Apache 2.0) — webcam capture + rendering
- `anthropic` (MIT) — Claude API for procedure generation
- `Pillow` (HPND) — anti-aliased text rendering
- `flask` (BSD-3) — MJPEG wireless streaming
