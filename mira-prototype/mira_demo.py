#!/usr/bin/env python3
"""MIRA AR HUD Simulator — Phase 1 laptop webcam prototype.

Opens the laptop webcam and composites an AR heads-up display overlay showing
step-by-step maintenance instructions viewed through smart glasses lenses.

Controls:
    SPACE  — advance to next step
    R      — reset to step 1
    G      — generate new procedure via Claude API
    F      — toggle fullscreen
    M      — toggle monocular / binocular lens mode
    Q/ESC  — quit

Usage:
    python mira_demo.py                                           # binocular (demo video)
    python mira_demo.py --monocular                               # single right-eye (Frame accurate)
    python mira_demo.py --procedure procedures/press_unit_4.json  # load specific procedure
    python mira_demo.py --generate "Conveyor belt tensioning"     # generate via Claude API

Environment:
    ANTHROPIC_API_KEY — required for --generate mode
"""

import argparse
import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
DEFAULT_PROCEDURE = HERE / "procedures" / "press_unit_4.json"

# --- Colors (BGR for OpenCV) ---
TEAL = (160, 220, 0)        # #00DCA0 in BGR
TEAL_RIM = (130, 180, 0)    # slightly darker for rim
BLACK = (0, 0, 0)
WHITE = (255, 255, 255)
GREEN = (0, 220, 100)
CYAN = (220, 200, 0)
GRAY = (160, 160, 160)
DARK_GRAY = (80, 80, 80)

# --- HUD layout constants ---
ALPHA_OVERLAY = 0.60
LENS_FEATHER_KERNEL = 31
LENS_FEATHER_BLUR = 61


# ---------------------------------------------------------------------------
# Procedure loading / generation
# ---------------------------------------------------------------------------

def load_procedure(path: Path) -> dict:
    """Load a procedure from a JSON file."""
    with open(path) as f:
        return json.load(f)


def generate_procedure_claude(task_name: str) -> dict:
    """Generate a 6-step maintenance procedure via Claude API."""
    try:
        import anthropic
    except ImportError:
        print("ERROR: anthropic package required for --generate. Run: pip install anthropic")
        sys.exit(1)

    import os
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY environment variable required for --generate")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=(
            "You are MIRA, an industrial maintenance AI. Generate a 6-step maintenance "
            "procedure for the given task. Return ONLY valid JSON with this exact structure: "
            '{"task": "...", "equipment_id": "...", "steps": [{"step": 1, "title": "...", '
            '"detail": "..."}]}. Each title should be under 6 words. Each detail should be '
            "one concise sentence under 15 words. Exactly 6 steps."
        ),
        messages=[{"role": "user", "content": f"Generate a maintenance procedure for: {task_name}"}],
    )

    text = response.content[0].text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1])
    return json.loads(text)


# ---------------------------------------------------------------------------
# Font / text helpers
# ---------------------------------------------------------------------------

_font_cache: dict[int, ImageFont.FreeTypeFont] = {}


def get_font(size: int) -> ImageFont.FreeTypeFont:
    """Get a clean font, with caching."""
    if size in _font_cache:
        return _font_cache[size]
    candidates = [
        "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/consola.ttf",
        "/System/Library/Fonts/SFNSMono.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            font = ImageFont.truetype(path, size)
            _font_cache[size] = font
            return font
    font = ImageFont.load_default()
    _font_cache[size] = font
    return font


def draw_text_pil(
    frame: np.ndarray,
    text: str,
    pos: tuple[int, int],
    font: ImageFont.FreeTypeFont,
    color: tuple[int, int, int] = (255, 255, 255),
) -> np.ndarray:
    """Draw anti-aliased text onto an OpenCV frame using Pillow."""
    pil_img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(pil_img)
    draw.text(pos, text, font=font, fill=color)
    return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)


# ---------------------------------------------------------------------------
# Lens mask
# ---------------------------------------------------------------------------

def compute_lens_geometry(w: int, h: int, monocular: bool) -> dict:
    """Compute lens ellipse positions and sizes."""
    if monocular:
        return {
            "mode": "monocular",
            "right": {"center": (int(w * 0.62), int(h * 0.50)),
                      "axes": (int(w * 0.30), int(h * 0.42))},
        }
    else:
        return {
            "mode": "binocular",
            "left": {"center": (int(w * 0.30), int(h * 0.50)),
                     "axes": (int(w * 0.22), int(h * 0.40))},
            "right": {"center": (int(w * 0.70), int(h * 0.50)),
                      "axes": (int(w * 0.22), int(h * 0.40))},
        }


def draw_lens_mask(frame: np.ndarray, geom: dict) -> np.ndarray:
    """Apply lens-shaped vignette mask — darkens everything outside the lenses."""
    h, w = frame.shape[:2]
    mask = np.zeros((h, w), dtype=np.uint8)

    # Draw filled ellipses for each lens
    right = geom["right"]
    cv2.ellipse(mask, right["center"], right["axes"], 0, 0, 360, 255, -1)

    if geom["mode"] == "binocular":
        left = geom["left"]
        cv2.ellipse(mask, left["center"], left["axes"], 0, 0, 360, 255, -1)

        # Bridge between lenses
        lx = left["center"][0] + left["axes"][0]
        rx = right["center"][0] - right["axes"][0]
        bridge_y = int(h * 0.50)
        cv2.line(mask, (lx, bridge_y), (rx, bridge_y), 255, 10)

    # Soft feathered edge
    kernel = np.ones((LENS_FEATHER_KERNEL, LENS_FEATHER_KERNEL), np.uint8)
    soft_mask = cv2.erode(mask, kernel, iterations=2)
    soft_mask = cv2.GaussianBlur(soft_mask, (LENS_FEATHER_BLUR, LENS_FEATHER_BLUR), 0)
    norm_mask = soft_mask.astype(np.float32) / 255.0

    # Darken outside the lenses
    for c in range(3):
        frame[:, :, c] = (frame[:, :, c] * norm_mask).astype(np.uint8)

    # Lens rim — thin teal ellipse outline
    cv2.ellipse(frame, right["center"], right["axes"], 0, 0, 360, TEAL, 2)

    if geom["mode"] == "binocular":
        cv2.ellipse(frame, left["center"], left["axes"], 0, 0, 360, TEAL, 2)
        # Bridge line
        cv2.line(frame, (lx, bridge_y), (rx, bridge_y), TEAL_RIM, 1)
    else:
        # Monocular — thin bridge line extending left from the lens
        bridge_x = right["center"][0] - right["axes"][0]
        cv2.line(frame, (bridge_x - 60, h // 2), (bridge_x, h // 2), TEAL_RIM, 1)

    return frame


# ---------------------------------------------------------------------------
# HUD overlay — anchored to right lens
# ---------------------------------------------------------------------------

def draw_hud(
    frame: np.ndarray,
    steps: list[dict],
    current_step: int,
    elapsed: float,
    task_name: str,
    completed: bool,
    geom: dict,
) -> np.ndarray:
    """Composite the AR HUD overlay inside the right lens area."""
    h, w = frame.shape[:2]

    # Right lens bounding box — all HUD elements anchor here
    rc = geom["right"]["center"]
    ra = geom["right"]["axes"]
    lx = rc[0] - ra[0] + 20   # left edge + padding
    rx = rc[0] + ra[0] - 20   # right edge - padding
    ty = rc[1] - ra[1] + 16   # top edge + padding
    by = rc[1] + ra[1] - 16   # bottom edge - padding
    lens_w = rx - lx
    lens_h = by - ty

    # Semi-transparent overlay for HUD panels
    overlay = frame.copy()
    output = frame.copy()

    font_title = get_font(20)
    font_body = get_font(15)
    font_small = get_font(12)
    font_large = get_font(24)

    # --- Top bar inside right lens ---
    top_bar_h = 36
    cv2.rectangle(overlay, (lx, ty), (rx, ty + top_bar_h), BLACK, -1)

    # --- Bottom card area inside right lens ---
    card_h = 100
    progress_h = 30
    card_top = by - card_h - progress_h
    cv2.rectangle(overlay, (lx, card_top), (rx, by), BLACK, -1)

    # Blend
    cv2.addWeighted(overlay, ALPHA_OVERLAY, output, 1 - ALPHA_OVERLAY, 0, output)

    # --- Top bar text ---
    minutes = int(elapsed) // 60
    seconds = int(elapsed) % 60
    time_str = f"{minutes:02d}:{seconds:02d}"

    output = draw_text_pil(output, "MIRA", (lx + 8, ty + 8), font_title, (0, 220, 200))
    output = draw_text_pil(output, "|", (lx + 62, ty + 8), font_small, (100, 100, 100))
    output = draw_text_pil(output, "CRANE SYNC", (lx + 78, ty + 10), font_small, (160, 160, 160))
    output = draw_text_pil(output, time_str, (rx - 55, ty + 10), font_small, (160, 160, 160))

    # Accent line
    cv2.line(output, (lx, ty + top_bar_h), (rx, ty + top_bar_h), TEAL, 1)

    # --- Content area ---
    pad = 12

    if completed:
        output = draw_text_pil(
            output, "COMPLETE", (lx + pad, card_top + pad), font_large, (0, 220, 100)
        )
        output = draw_text_pil(
            output,
            f"{len(steps)} steps in {time_str}",
            (lx + pad, card_top + pad + 30),
            font_body,
            (160, 160, 160),
        )
        output = draw_text_pil(
            output, "[R] Restart  [Q] Quit",
            (lx + pad, card_top + pad + 52),
            font_small, (100, 100, 100),
        )
    else:
        step_data = steps[current_step]
        step_num = current_step + 1
        total = len(steps)

        # Step counter
        output = draw_text_pil(
            output,
            f"STEP {step_num} OF {total}",
            (lx + pad, card_top + pad),
            font_small,
            (0, 200, 200),
        )

        # Step title
        title = step_data["title"]
        output = draw_text_pil(
            output,
            f"> {title}",
            (lx + pad, card_top + pad + 20),
            font_title,
            (255, 255, 255),
        )

        # Step detail — wrap if needed
        detail = step_data["detail"]
        if len(detail) > 45:
            detail = detail[:42] + "..."
        output = draw_text_pil(
            output,
            f"  {detail}",
            (lx + pad, card_top + pad + 46),
            font_body,
            (170, 170, 170),
        )

    # --- Progress bar at bottom of lens ---
    progress_top = by - progress_h
    cv2.line(output, (lx, progress_top), (rx, progress_top), (60, 60, 60), 1)

    total = len(steps)
    dot_spacing = min(22, lens_w // (total + 2))
    dot_start_x = lx + pad
    dot_y = progress_top + progress_h // 2

    for i in range(total):
        cx = dot_start_x + i * dot_spacing + dot_spacing // 2
        if cx > rx - 10:
            break
        if i < current_step:
            cv2.circle(output, (cx, dot_y), 6, GREEN, -1)
        elif i == current_step and not completed:
            cv2.circle(output, (cx, dot_y), 7, CYAN, -1)
        else:
            cv2.circle(output, (cx, dot_y), 6, GRAY, 1)

    # Hint
    if not completed:
        output = draw_text_pil(
            output, "[SPACE]", (rx - 60, progress_top + 8), font_small, (100, 100, 100)
        )

    return output


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="MIRA AR HUD Simulator")
    parser.add_argument(
        "--procedure", type=Path, default=DEFAULT_PROCEDURE, help="Path to procedure JSON file"
    )
    parser.add_argument("--generate", type=str, default=None, help="Generate procedure via Claude API")
    parser.add_argument("--camera", type=int, default=0, help="Camera index (default: 0)")
    parser.add_argument("--width", type=int, default=1280, help="Requested camera width")
    parser.add_argument("--height", type=int, default=720, help="Requested camera height")
    parser.add_argument(
        "--monocular", action="store_true",
        help="Single right-eye lens (Frame hardware accurate). Default: binocular",
    )
    args = parser.parse_args()

    # Load or generate procedure
    if args.generate:
        print(f"Generating procedure for: {args.generate}")
        procedure = generate_procedure_claude(args.generate)
        cache_path = HERE / "procedures" / f"{args.generate.lower().replace(' ', '_')[:30]}.json"
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        with open(cache_path, "w") as f:
            json.dump(procedure, f, indent=2)
        print(f"Cached to: {cache_path}")
    else:
        if not args.procedure.exists():
            print(f"ERROR: Procedure file not found: {args.procedure}")
            print("Use --generate 'task name' to create one via Claude API")
            sys.exit(1)
        procedure = load_procedure(args.procedure)

    steps = procedure["steps"]
    task_name = procedure.get("task", "Maintenance Procedure")
    print(f"Loaded: {task_name} ({len(steps)} steps)")

    # Open webcam
    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        print(f"ERROR: Cannot open camera {args.camera}")
        sys.exit(1)

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)

    actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"Camera: {actual_w}x{actual_h}")

    # Window
    window_name = "MIRA AR HUD"
    cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(window_name, actual_w, actual_h)

    monocular = args.monocular
    current_step = 0
    completed = False
    fullscreen = False
    start_time = time.time()

    mode_str = "monocular (Frame)" if monocular else "binocular (demo)"
    print(f"Lens mode: {mode_str}")
    print("Controls: SPACE=next  R=reset  M=toggle lens  F=fullscreen  G=generate  Q=quit")

    while True:
        ret, frame = cap.read()
        if not ret:
            print("Camera read failed")
            break

        elapsed = time.time() - start_time

        # Compute lens geometry for current frame size
        fh, fw = frame.shape[:2]
        geom = compute_lens_geometry(fw, fh, monocular)

        # Draw HUD anchored inside right lens, then apply lens mask on top
        output = draw_hud(frame, steps, current_step, elapsed, task_name, completed, geom)
        output = draw_lens_mask(output, geom)

        cv2.imshow(window_name, output)
        key = cv2.waitKey(1) & 0xFF

        if key == ord("q") or key == 27:  # Q or ESC
            break
        elif key == ord(" "):  # SPACE — advance
            if not completed:
                current_step += 1
                if current_step >= len(steps):
                    completed = True
                    print(f"Procedure complete in {int(elapsed)}s")
        elif key == ord("r"):  # R — reset
            current_step = 0
            completed = False
            start_time = time.time()
            print("Reset to step 1")
        elif key == ord("m"):  # M — toggle lens mode
            monocular = not monocular
            mode_str = "monocular (Frame)" if monocular else "binocular (demo)"
            print(f"Lens mode: {mode_str}")
        elif key == ord("f"):  # F — fullscreen toggle
            fullscreen = not fullscreen
            if fullscreen:
                cv2.setWindowProperty(window_name, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)
            else:
                cv2.setWindowProperty(window_name, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_NORMAL)
        elif key == ord("g"):  # G — generate new procedure
            task = input("Enter task name: ").strip()
            if task:
                print(f"Generating: {task}")
                procedure = generate_procedure_claude(task)
                steps = procedure["steps"]
                task_name = procedure.get("task", task)
                current_step = 0
                completed = False
                start_time = time.time()
                print(f"Loaded: {task_name} ({len(steps)} steps)")

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
