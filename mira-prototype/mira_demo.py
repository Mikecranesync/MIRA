#!/usr/bin/env python3
"""MIRA AR HUD Simulator — Phase 1 laptop webcam prototype.

Opens the laptop webcam (or URL stream, or synthetic test frame) and composites
an AR heads-up display overlay showing step-by-step maintenance instructions
viewed through smart glasses lenses.

Display modes:
    Desktop:   cv2.imshow() window (default)
    Streaming: --serve flag starts Flask MJPEG server on LAN for phone viewing

Controls (desktop mode):
    SPACE  — advance to next step
    R      — reset to step 1
    G      — generate new procedure via Claude API
    F      — toggle fullscreen
    M      — toggle monocular / binocular lens mode
    Q/ESC  — quit

Controls (streaming mode):
    Tap right half of phone screen — advance step
    Tap left half — reset
    Keyboard on browser also works (SPACE, R, M)

Usage:
    python mira_demo.py                                    # webcam + desktop window
    python mira_demo.py --test                             # synthetic frame, no camera
    python mira_demo.py --test --serve                     # headless, stream to phone
    python mira_demo.py --camera 1                         # alternate camera index
    python mira_demo.py --camera "http://192.168.1.5:8080/video"  # IP camera URL
    python mira_demo.py --monocular                        # single right-eye lens
    python mira_demo.py --serve --port 8080                # custom port

Environment:
    ANTHROPIC_API_KEY — required for --generate mode
"""

import argparse
import json
import math
import socket
import sys
import threading
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

# --- Shared state for Flask streaming ---
output_lock = threading.Lock()
output_frame: np.ndarray | None = None

# --- Shared state for remote control ---
control_lock = threading.Lock()
pending_commands: list[str] = []


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
# Test frame generator
# ---------------------------------------------------------------------------

def generate_test_frame(width: int, height: int, elapsed: float) -> np.ndarray:
    """Generate a synthetic frame — animated dark industrial gradient."""
    frame = np.zeros((height, width, 3), dtype=np.uint8)

    # Slow-moving vertical gradient (dark blue-gray tones)
    shift = int(elapsed * 8) % height
    for y in range(height):
        gy = ((y + shift) % height) / height
        r = int(20 + 25 * gy)
        g = int(25 + 30 * gy)
        b = int(35 + 40 * gy)
        frame[y, :] = (b, g, r)

    # Horizontal machinery bands
    band_h = 60
    for i in range(3):
        y0 = 120 + i * 180
        if y0 + band_h < height:
            brightness = 0.6 + 0.15 * math.sin(elapsed * 0.5 + i)
            frame[y0:y0 + band_h, :] = (
                frame[y0:y0 + band_h, :].astype(np.float32) * brightness
            ).astype(np.uint8)

    # Pulsing indicator light (simulates machine status LED)
    pulse = int(127 + 127 * math.sin(elapsed * 3))
    cx, cy = width - 80, 80
    cv2.circle(frame, (cx, cy), 12, (0, pulse, 0), -1)
    cv2.circle(frame, (cx, cy), 14, (0, 100, 0), 1)

    # Grid lines (industrial floor / panel look)
    for x in range(0, width, 160):
        xoff = x + int(elapsed * 2) % 160
        if xoff < width:
            cv2.line(frame, (xoff, 0), (xoff, height), (40, 40, 45), 1)

    return frame


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

    right = geom["right"]
    cv2.ellipse(mask, right["center"], right["axes"], 0, 0, 360, 255, -1)

    if geom["mode"] == "binocular":
        left = geom["left"]
        cv2.ellipse(mask, left["center"], left["axes"], 0, 0, 360, 255, -1)

        lx = left["center"][0] + left["axes"][0]
        rx = right["center"][0] - right["axes"][0]
        bridge_y = int(h * 0.50)
        cv2.line(mask, (lx, bridge_y), (rx, bridge_y), 255, 10)

    kernel = np.ones((LENS_FEATHER_KERNEL, LENS_FEATHER_KERNEL), np.uint8)
    soft_mask = cv2.erode(mask, kernel, iterations=2)
    soft_mask = cv2.GaussianBlur(soft_mask, (LENS_FEATHER_BLUR, LENS_FEATHER_BLUR), 0)
    norm_mask = soft_mask.astype(np.float32) / 255.0

    for c in range(3):
        frame[:, :, c] = (frame[:, :, c] * norm_mask).astype(np.uint8)

    cv2.ellipse(frame, right["center"], right["axes"], 0, 0, 360, TEAL, 2)

    if geom["mode"] == "binocular":
        cv2.ellipse(frame, left["center"], left["axes"], 0, 0, 360, TEAL, 2)
        cv2.line(frame, (lx, bridge_y), (rx, bridge_y), TEAL_RIM, 1)
    else:
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

    rc = geom["right"]["center"]
    ra = geom["right"]["axes"]
    lx = rc[0] - ra[0] + 20
    rx = rc[0] + ra[0] - 20
    ty = rc[1] - ra[1] + 16
    by = rc[1] + ra[1] - 16
    lens_w = rx - lx

    overlay = frame.copy()
    output = frame.copy()

    font_title = get_font(20)
    font_body = get_font(15)
    font_small = get_font(12)
    font_large = get_font(24)

    top_bar_h = 36
    cv2.rectangle(overlay, (lx, ty), (rx, ty + top_bar_h), BLACK, -1)

    card_h = 100
    progress_h = 30
    card_top = by - card_h - progress_h
    cv2.rectangle(overlay, (lx, card_top), (rx, by), BLACK, -1)

    cv2.addWeighted(overlay, ALPHA_OVERLAY, output, 1 - ALPHA_OVERLAY, 0, output)

    minutes = int(elapsed) // 60
    seconds = int(elapsed) % 60
    time_str = f"{minutes:02d}:{seconds:02d}"

    output = draw_text_pil(output, "MIRA", (lx + 8, ty + 8), font_title, (0, 220, 200))
    output = draw_text_pil(output, "|", (lx + 62, ty + 8), font_small, (100, 100, 100))
    output = draw_text_pil(output, "CRANE SYNC", (lx + 78, ty + 10), font_small, (160, 160, 160))
    output = draw_text_pil(output, time_str, (rx - 55, ty + 10), font_small, (160, 160, 160))

    cv2.line(output, (lx, ty + top_bar_h), (rx, ty + top_bar_h), TEAL, 1)

    pad = 12

    if completed:
        output = draw_text_pil(
            output, "COMPLETE", (lx + pad, card_top + pad), font_large, (0, 220, 100)
        )
        output = draw_text_pil(
            output, f"{len(steps)} steps in {time_str}",
            (lx + pad, card_top + pad + 30), font_body, (160, 160, 160),
        )
        output = draw_text_pil(
            output, "[R] Restart  [Q] Quit",
            (lx + pad, card_top + pad + 52), font_small, (100, 100, 100),
        )
    else:
        step_data = steps[current_step]
        step_num = current_step + 1
        total = len(steps)

        output = draw_text_pil(
            output, f"STEP {step_num} OF {total}",
            (lx + pad, card_top + pad), font_small, (0, 200, 200),
        )

        title = step_data["title"]
        output = draw_text_pil(
            output, f"> {title}",
            (lx + pad, card_top + pad + 20), font_title, (255, 255, 255),
        )

        detail = step_data["detail"]
        if len(detail) > 45:
            detail = detail[:42] + "..."
        output = draw_text_pil(
            output, f"  {detail}",
            (lx + pad, card_top + pad + 46), font_body, (170, 170, 170),
        )

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

    if not completed:
        output = draw_text_pil(
            output, "[SPACE]", (rx - 60, progress_top + 8), font_small, (100, 100, 100)
        )

    return output


# ---------------------------------------------------------------------------
# Flask MJPEG streaming server
# ---------------------------------------------------------------------------

def create_flask_app() -> "Flask":
    """Create Flask app for wireless AR feed streaming."""
    from flask import Flask, Response, request

    app = Flask(__name__)

    @app.route("/")
    def index():
        return """<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>MIRA AR</title>
<style>
  *{margin:0;padding:0}
  body{background:#000;overflow:hidden;touch-action:none}
  img{width:100vw;height:100vh;object-fit:contain;display:block}
</style>
</head><body>
<img src="/video" alt="MIRA AR Feed">
<script>
document.addEventListener('keydown',function(e){
  if(e.code==='Space'){e.preventDefault();fetch('/next',{method:'POST'})}
  if(e.key==='r')fetch('/reset',{method:'POST'});
  if(e.key==='m')fetch('/toggle-lens',{method:'POST'});
});
document.addEventListener('touchstart',function(e){
  e.preventDefault();
  var x=e.touches[0].clientX;
  if(x>window.innerWidth*0.5)fetch('/next',{method:'POST'});
  else fetch('/reset',{method:'POST'});
},{passive:false});
</script>
</body></html>"""

    def gen_frames():
        """Yield MJPEG frames from shared output_frame."""
        while True:
            with output_lock:
                frame = output_frame
            if frame is None:
                time.sleep(0.05)
                continue
            ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            if not ok:
                continue
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n" + buf.tobytes() + b"\r\n"
            )
            time.sleep(0.033)  # ~30 fps cap

    @app.route("/video")
    def video_feed():
        return Response(gen_frames(), mimetype="multipart/x-mixed-replace; boundary=frame")

    @app.route("/next", methods=["POST"])
    def next_step():
        with control_lock:
            pending_commands.append("next")
        return "", 204

    @app.route("/reset", methods=["POST"])
    def reset():
        with control_lock:
            pending_commands.append("reset")
        return "", 204

    @app.route("/toggle-lens", methods=["POST"])
    def toggle_lens():
        with control_lock:
            pending_commands.append("toggle-lens")
        return "", 204

    return app


def get_lan_ip() -> str:
    """Auto-detect LAN IP address."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    global output_frame

    parser = argparse.ArgumentParser(description="MIRA AR HUD Simulator")
    parser.add_argument(
        "--procedure", type=Path, default=DEFAULT_PROCEDURE, help="Path to procedure JSON file"
    )
    parser.add_argument("--generate", type=str, default=None, help="Generate procedure via Claude API")
    parser.add_argument("--camera", type=str, default="0", help="Camera index (int) or URL (string)")
    parser.add_argument("--width", type=int, default=1280, help="Requested camera width")
    parser.add_argument("--height", type=int, default=720, help="Requested camera height")
    parser.add_argument(
        "--monocular", action="store_true",
        help="Single right-eye lens (Frame hardware accurate). Default: binocular",
    )
    parser.add_argument("--test", action="store_true", help="Synthetic test frame — no camera needed")
    parser.add_argument("--serve", action="store_true", help="Start Flask MJPEG server for phone viewing")
    parser.add_argument("--port", type=int, default=5000, help="Flask server port (default: 5000)")
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

    # Open camera or test mode
    cap = None
    if args.test:
        print(f"Test mode: synthetic {args.width}x{args.height} frame")
    else:
        cam = int(args.camera) if args.camera.isdigit() else args.camera
        cap = cv2.VideoCapture(cam)
        if not cap.isOpened():
            print(f"ERROR: Cannot open camera '{args.camera}'")
            sys.exit(1)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)
        actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        print(f"Camera: {actual_w}x{actual_h}")

    # Start Flask server if --serve
    if args.serve:
        app = create_flask_app()
        lan_ip = get_lan_ip()
        print(f"Serving AR feed -> http://{lan_ip}:{args.port}")
        flask_thread = threading.Thread(
            target=app.run,
            kwargs={"host": "0.0.0.0", "port": args.port, "debug": False, "use_reloader": False},
            daemon=True,
        )
        flask_thread.start()
    else:
        window_name = "MIRA AR HUD"
        cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(window_name, args.width, args.height)

    monocular = args.monocular
    current_step = 0
    completed = False
    fullscreen = False
    start_time = time.time()

    mode_str = "monocular (Frame)" if monocular else "binocular (demo)"
    print(f"Lens mode: {mode_str}")
    if not args.serve:
        print("Controls: SPACE=next  R=reset  M=toggle lens  F=fullscreen  G=generate  Q=quit")

    try:
        while True:
            # Get frame
            if args.test:
                elapsed = time.time() - start_time
                frame = generate_test_frame(args.width, args.height, elapsed)
            else:
                ret, frame = cap.read()
                if not ret:
                    print("Camera read failed")
                    break
                elapsed = time.time() - start_time

            # Compute lens geometry
            fh, fw = frame.shape[:2]
            geom = compute_lens_geometry(fw, fh, monocular)

            # Render HUD + lens mask
            rendered = draw_hud(frame, steps, current_step, elapsed, task_name, completed, geom)
            rendered = draw_lens_mask(rendered, geom)

            # Process remote commands (from Flask endpoints)
            with control_lock:
                cmds = list(pending_commands)
                pending_commands.clear()
            for cmd in cmds:
                if cmd == "next" and not completed:
                    current_step += 1
                    if current_step >= len(steps):
                        completed = True
                        print(f"Procedure complete in {int(elapsed)}s")
                elif cmd == "reset":
                    current_step = 0
                    completed = False
                    start_time = time.time()
                    print("Reset to step 1")
                elif cmd == "toggle-lens":
                    monocular = not monocular
                    print(f"Lens mode: {'monocular' if monocular else 'binocular'}")

            if args.serve:
                # Write frame for Flask streaming
                with output_lock:
                    output_frame = rendered.copy()
                time.sleep(0.033)  # ~30 fps pacing
            else:
                # Desktop display
                cv2.imshow(window_name, rendered)
                key = cv2.waitKey(1) & 0xFF

                if key == ord("q") or key == 27:
                    break
                elif key == ord(" "):
                    if not completed:
                        current_step += 1
                        if current_step >= len(steps):
                            completed = True
                            print(f"Procedure complete in {int(elapsed)}s")
                elif key == ord("r"):
                    current_step = 0
                    completed = False
                    start_time = time.time()
                    print("Reset to step 1")
                elif key == ord("m"):
                    monocular = not monocular
                    mode_str = "monocular (Frame)" if monocular else "binocular (demo)"
                    print(f"Lens mode: {mode_str}")
                elif key == ord("f"):
                    fullscreen = not fullscreen
                    if fullscreen:
                        cv2.setWindowProperty(window_name, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)
                    else:
                        cv2.setWindowProperty(window_name, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_NORMAL)
                elif key == ord("g"):
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

    except KeyboardInterrupt:
        print("\nShutting down...")

    if cap is not None:
        cap.release()
    if not args.serve:
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
