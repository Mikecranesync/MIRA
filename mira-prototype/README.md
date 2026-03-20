# MIRA AR HUD Simulator

Phase 1 laptop prototype — renders step-by-step maintenance instructions as an AR heads-up display over a live webcam feed.

## Quick Start

```bash
cd mira-prototype
pip install -r requirements.txt
python mira_demo.py
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

# Use a different camera
python mira_demo.py --camera 1
```

## Controls

| Key | Action |
|---|---|
| SPACE | Advance to next step |
| R | Reset to step 1 |
| G | Generate new procedure (Claude API) |
| F | Toggle fullscreen |
| Q / ESC | Quit |

## Recording a Demo

1. Start OBS or screen recorder
2. Run `python mira_demo.py`
3. Press F for fullscreen
4. Walk through the 6 steps with SPACE, narrating as you go
5. Target: 90 seconds total

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
