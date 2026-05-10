#!/usr/bin/env python3
"""
End-to-end programmatic build of the VFD F004 comic explainer.

Three stages, all automatic:
  1. Generate 5 comic pages via gpt-image-1 (images.edit + input_fidelity=high),
     each anchored to the matching v2 comic page so Rico/Deb/etc. carry across.
  2. Calibrate focal coordinates via Claude vision — for each beat, find
     where its `target` description actually lives on the generated page
     and write back canvas-normalized cx/cy/zoom.
  3. Build the mp4 by monkey-patching `build_video_v2.STORYBOARD_PATH` and
     `FINAL_DIR`, then calling `build_video_v2.main()`. Outputs to
     `~/mira/marketing/videos/comic-vfd-f004/mira_explainer_vfd_f004.mp4`.

Cost (one-shot, no n=2 candidates to keep budget tight):
  - 5× gpt-image-1 1536x1024 high     ≈ 5 × $0.17  = $0.85
  - 5× Claude haiku-4-5 vision pass   ≈ $0.05
  - 23× tts-1-hd at 0.9× speed         ≈ $0.06
  - ffmpeg / music synth               = $0.00
  Total ≈ $0.96

Run:
  doppler run --project factorylm --config prd -- \\
      .venv/bin/python scripts/generate_vfd_comic.py

Idempotent: any panel already on disk at reference/vfd_shot_NN.png is reused.
Pass --regen to force a fresh image-gen pass.
"""
from __future__ import annotations

import argparse
import base64
import json
import logging
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

import anthropic
import yaml
from openai import APIError, OpenAI, RateLimitError

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

STORYBOARD_PATH = PROJECT_ROOT / "scripts" / "storyboard_vfd_f004.yaml"
CALIBRATED_STORYBOARD_PATH = PROJECT_ROOT / "scripts" / "storyboard_vfd_f004.calibrated.yaml"
REF_DIR = PROJECT_ROOT / "reference"
FINAL_DIR = (PROJECT_ROOT / ".." / "videos" / "comic-vfd-f004").resolve()

# Each new shot is anchored to the v2 page playing the same role — keeps
# Rico's face, Deb's headset, Holt's office consistent across the two videos.
ANCHORS: dict[int, str] = {
    1: "ChatGPT Image Apr 24, 2026 at 02_05_37 PM.png",  # v2 shot 1 — factory floor
    2: "ChatGPT Image Apr 24, 2026 at 02_11_45 PM.png",  # v2 shot 2 — Maximo desk
    3: "ChatGPT Image Apr 24, 2026 at 02_22_55 PM.png",  # v2 shot 3 — multi-character vignette
    4: "ChatGPT Image Apr 24, 2026 at 11_53_02 AM.png",  # v2 shot 4 — Rico + tablet
    5: "ChatGPT Image Apr 24, 2026 at 12_12_29 PM.png",  # v2 shot 5 — multi-panel resolution
    6: "ChatGPT Image Apr 24, 2026 at 12_12_29 PM.png",  # v2 shot 5 again — explainer is resolution-themed
}

# Comic-page generation prompts — verbatim from the YAML comments in
# storyboard_vfd_f004.yaml. Hardcoded here so the script doesn't need to
# parse YAML comments (fragile).
PANEL_PROMPTS: dict[int, str] = {
    1: """\
Industrial comic book single-page layout, gritty 1990s Vertigo aesthetic,
dark steel blue + amber + high-contrast black palette, bold panel borders.
Wide establishing shot of an industrial cell labeled "CELL B" — three
parallel conveyor lines visible, drive cabinets on the right side. Cell
B drive 7 is dark — its red fault light is on. Top-right corner: large
red metal sign "CELL B — DRIVE 7 STOPPED". Foreground close-up: the
PowerFlex 525 keypad showing "F004" in red on its small LCD, with
"UNDERVOLT" subtext below. Mid-foreground: Rico (mid-30s, dark hair,
glasses, navy blue coveralls with "RICO" name patch) standing tense in
front of drive 7's cabinet, hand on hip, looking at the keypad.
Background: idle workers in soft focus. Dramatic chiaroscuro lighting,
amber fault-light glow. Same Rico character as the supplied reference.""",
    2: """\
Industrial comic book multi-panel layout. Same Rico character as the
supplied reference image (mid-30s man, dark hair, glasses, navy blue
coveralls with white "RICO" name patch on chest).

CHARACTER-TO-SCENE: In every panel where Rico appears, his POSE must
match the scene action. Here he is the maintenance technician
investigating a fault — hunched, focused, intent. He is holding tools
and reading. He is NOT relaxed, NOT confident yet. The scene is the
"frustration" beat of the story.

ZERO SPELLING ERRORS. Every word in every speech bubble and caption
must be spelled correctly. Use these EXACT spellings:
  • "Voltage is fine." — capital V, then lowercase: o-l-t-a-g-e
    (DO NOT write "VOltage" with capital O)
  • "All three phases present." — all lowercase except "All"
  • "Bus is healthy." — all lowercase except "Bus"
  • "THE MANUAL ENDS HERE." — all caps, MANUAL spelled M-A-N-U-A-L
  • "THE FAULT DOESN'T." — all caps, DOESN'T with apostrophe

Setting: maintenance workshop bench, late dawn, fluorescent overhead.

LEFT 50% of page: Rico hunched over an open paper manual on the desk.
Manual has a visible cover label "PowerFlex 525 User Manual". Inside,
a section header reads "F004 UNDERVOLTAGE" (one word, U-N-D-E-R-V-O-L-
T-A-G-E — twelve letters total, only ONE L between V and T). Multimeter
sits beside the manual. Rico's face: focused, glasses on, faint frown.

RIGHT 50% of page: three stacked horizontal panels.
  PANEL A (top): close-up of a multimeter display reading "480 V - OK".
    Speech bubble: "Voltage is fine." (capital V only on first letter.)
  PANEL B (middle): drive cabinet open showing three vertical green
    bars (phase indicators). Speech bubble: "All three phases present."
  PANEL C (bottom): drive diagnostic screen showing "650 VDC" reading.
    Speech bubble: "Bus is healthy."

BOTTOM of page: a hand-lettered caption strip across the full width:
"THE MANUAL ENDS HERE. THE FAULT DOESN'T."

Style: dark steel blue + amber palette, gritty Vertigo comic, bold
black panel borders, dramatic chiaroscuro on Rico's face.""",
    3: """\
Industrial comic book multi-panel layout. Gritty Vertigo style. Bold black
panel borders. Dark steel blue + amber + black palette.

CRITICAL: Director Holt and Elena are TWO COMPLETELY SEPARATE PEOPLE. Do
NOT combine them. Do NOT label one figure with both "Director" and
"Engineering Manager". They appear in TWO DIFFERENT panels with
DIFFERENT label boxes.

TOP BANNER (full width, bold red sign-style block letters, no typos):
"CELL B  F004  REPEAT FAULT  14x IN 6 WEEKS"  followed by a ticking clock
graphic that reads "07:14".

LEFT 30% (vertical panel, full height under banner): wide overhead of
the stopped Cell B floor — drive 7 cabinet in foreground with red fault
light, idle conveyor behind, distant workers. Time-pressure mood, dim
amber backlight.

RIGHT 70%: FOUR stacked horizontal vignette panels (this is non-negotiable
— exactly 4 panels, one per character below).

PANEL A (top): An OPERATOR (woman, hard hat, headset radio, work jacket)
with one yellow label box reading "OPERATOR". Speech bubble: "Rico, this
is the THIRD time this week."

PANEL B: MARCUS — 40s, dark complexion, short beard, at a laptop. One
yellow label box reading "MARCUS - MAINTENANCE MANAGER". Laptop screen
shows a downtime chart. Speech bubble: "Cell B has eaten THIRTY MINUTES
SINCE MONDAY." (Spelling: M-I-N-U-T-E-S, S-I-N-C-E.)

PANEL C: ELENA — 30s woman, long dark hair, on a phone, holding a tablet
showing a fault-history chart. One yellow label box reading "ELENA -
ENGINEERING MANAGER". Speech bubble: "Same fault. Drives 7, 8, 9."

PANEL D (bottom): DIRECTOR HOLT — A SENIOR MAN with GREY hair, in a DARK
SUIT and tie, at an office desk with monitor. He is OLDER and DIFFERENT
from every other character. One yellow label box reading "DIRECTOR HOLT
- PLANT DIRECTOR". Speech bubble: "Customer's on the line. We're missing
the morning lot."

Spelling: WEEKS (two E's only). MINUTES. SINCE.""",
    4: """\
Industrial comic book multi-panel layout. Same Rico character as the
supplied reference (mid-30s, dark hair, glasses, navy blue coveralls
with white "RICO" name patch on chest).

CHARACTER-TO-SCENE: This is the DIAGNOSIS moment. Rico's pose is
confident-but-tense — he has the answer but hasn't fixed it yet. He
stands upright, tablet in both hands, eyes locked on the screen. NOT
slumped, NOT relaxed.

CRITICAL CONTEXT: The line is STILL DOWN. Cell B is STOPPED, red fault
light on cabinet, red overhead sign reads "CELL B - DRIVE 7 STOPPED".
Do NOT show green RUNNING signs in this panel.

ZERO SPELLING ERRORS. Use these EXACT spellings (these are the most
critical strings in the panel — get them perfect):
  • "F004"  — that's letter F, then THREE characters: digit ZERO, digit
    ZERO, digit FOUR. Not "FOO4", not "F00 4". Treat F004 as a single
    fixed token — one capital F followed by three numerals 0, 0, 4.
  • "UNDERVOLTAGE" — exactly twelve letters: U-N-D-E-R-V-O-L-T-A-G-E.
    There is only ONE L. Do NOT write "UNDERVLLTAGE" or "UNDERVLTAGE"
    or "LINDERVOLTAGE". The word starts with U, not L.
  • "Cell B" — capital C, lowercase e-l-l, space, capital B. Not
    "Cell 6". B is a letter, not the numeral 6.
  • "Drives 7, 8, 9" — three numerals 7, 8, 9. Not "Drives 7, 0, 3".

TOP HALF of page (wide establishing panel): Rico standing at a
maintenance bench, tablet held in both hands at chest height, eyes on
the screen, posture upright and tense. Behind him: Cell B is DARK, drive
7 cabinet with RED fault light, conveyor STOPPED. Overhead sign reads
"CELL B - DRIVE 7 STOPPED" in red letters on black background.

BOTTOM-LEFT panel: close-up of the tablet screen. Header (large, bold):
"MIRA - FAULT INTELLIGENCE". Below the header, exactly six short labels
stacked vertically, large readable text, ONE label per line. Type each
label exactly:
  Line 1:  F004 UNDERVOLTAGE
  Line 2:  Cell B Drive 7
  Line 3:  14x in 6 weeks
  Line 4:  Mondays 07:00 - 07:30
  Line 5:  Drives 7, 8, 9 affected
  Line 6 (in green or amber): FIX: stagger startup +0.5s
Dark UI background, amber accent. Six lines total, nothing else.

BOTTOM-RIGHT panel: A pure TIMING DIAGRAM — no people. Three vertical
bars labeled "7", "8", "9" on an x-axis. TOP HALF of this panel: the
three bars all rise at the SAME instant, glowing RED, with a header
"BEFORE - SIMULTANEOUS". BOTTOM HALF of this panel: the same three bars
rise staggered 0.5 seconds apart, glowing GREEN, with header "AFTER -
STAGGERED". Pure chart, no Rico, no other figures.

Style: gritty 1990s Vertigo aesthetic, dark steel blue + amber palette,
bold black panel borders. The MIRA app screen is the only spot of clean
modern UI in an otherwise grimy industrial scene.""",
    5: """\
Industrial comic book PAGE LAYOUT. The page is divided into THREE
horizontal bands, top to bottom, with bold black panel borders.

Mood: confident, forward, green LED accent throughout — Cell B is
RUNNING again.

== TOP BAND (top 35% of page, two side-by-side panels) ==

LEFT panel: Rico (mid-30s, dark hair, glasses, blue "RICO" coveralls) at
a laptop. Screen shows PLC ladder logic with three lines:
"DRIVE 7 START +0.0s / DRIVE 8 START +0.5s / DRIVE 9 START +1.0s".
Speech bubble: "Staging the startup."

RIGHT panel: Cell B running — all three drives lit GREEN, conveyor
moving. Overhead sign in green reads "CELL B - RUNNING". Workers active.
Caption box: "Monday, 07:00. No fault."

== MIDDLE BAND (middle 35% of page, three smaller side-by-side panels) ==

LEFT: Marcus (40s, dark complexion). On the wall behind him: a HUGE
green "0" with the small label "min lost this week" beneath it. That's
the entire chart — just the giant green 0. Speech bubble: "Pattern
broken."

CENTER: Elena (30s woman, long dark hair, on phone), holding her tablet.
Speech bubble (two short lines): "The manual was right. The story WAS
incomplete." (The word "WAS" must appear and be readable.)

RIGHT: Director Holt (SENIOR MAN, GREY hair, dark suit) at office desk,
calm and informed. Speech bubble: "This is what happens when your data
tells the story."

== BOTTOM BAND (bottom 30% of page — DEDICATED CTA STRIP) ==

This bottom strip is a SOLID amber-or-black background with MASSIVE
HAND-LETTERED bold text. Three lines, perfectly centered, must be
clearly readable:

  Line 1 (largest):  "MIRA"
  Line 2 (medium):   "BUILT FOR THE FLOOR"
  Line 3 (smaller):  "factorylm.com"

This bottom CTA is the most prominent element on the entire page.

Spelling: factorylm.com (one word, dot com). MIRA. INCOMPLETE.

Style: dark steel blue + amber palette with green accent lights, gritty
Vertigo comic, bold black panel borders.""",
    6: """\
Industrial comic book layout — a SINGLE PAGE explainer / aftermath
panel that ties the bow on the story. Different shape from earlier
shots: this is a MOSTLY-INFOGRAPHIC page, not a multi-character scene.

Mood: confident, factual, brand-forward. Warm amber + green accent
lights, dark steel blue base. No characters in the foreground — this
page belongs to the data and to MIRA itself.

ZERO SPELLING ERRORS. Use these EXACT spellings:
  • "MIRA"            (4 capital letters: M, I, R, A)
  • "F004"            (capital F, then three numerals: 0, 0, 4)
  • "UNDERVOLTAGE"    (only ONE L, between V and T)
  • "BEFORE", "AFTER" (capital headers for the comparison columns)
  • "PATTERN BROKEN"  (two words)
  • "STAGGER"         (S-T-A-G-G-E-R, two G's)
  • "factorylm.com"   (lowercase, single token, ends ".com")
  • "BUILT FOR THE FLOOR" (all caps, four words)

PAGE LAYOUT (top to bottom, four horizontal bands):

== TOP BAND (15% of page height) — HEADER ==
Black bar with bold amber text: "HOW MIRA SOLVED IT". Subtitle in
smaller text below: "F004 UNDERVOLTAGE — Cell B".

== UPPER MIDDLE BAND (35% of page height) — BEFORE / AFTER COMPARISON ==
Two side-by-side columns separated by a vertical divider line.

LEFT COLUMN — header in red: "BEFORE". Three stacked stat boxes:
  • "F004 TRIPS:  14"   (red number, large)
  • "DOWNTIME:  21 MIN" (red number)
  • "PATTERN:  EVERY MONDAY 07:00"

RIGHT COLUMN — header in green: "AFTER". Three stacked stat boxes:
  • "F004 TRIPS:  0"    (green number, large)
  • "DOWNTIME:  6 MIN"  (green number)
  • "PATTERN:  BROKEN"

== LOWER MIDDLE BAND (25% of page height) — THE FIX ==
A single horizontal panel showing the timing-diagram fix at smaller
scale. Three vertical bars labeled 7, 8, 9. Top half (red): bars
simultaneous. Bottom half (green): bars staggered. Caption to the
right: "STAGGER STARTUP +0.5s — MIRA RECOMMENDATION."

== BOTTOM BAND (25% of page height) — DEDICATED CTA STRIP ==
Solid amber background. Three stacked lines, hand-lettered, perfectly
centered, must be readable:
  Line 1 (largest):   MIRA
  Line 2 (medium):    BUILT FOR THE FLOOR
  Line 3 (smaller):   factorylm.com

This bottom CTA is the most prominent visual element of the page.

Style: bold black panel borders, gritty Vertigo industrial aesthetic,
dark steel blue + amber + green palette. The page reads like a one-page
diagnostic report a maintenance manager would tape to the wall.""",
}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("vfd-comic")


# ─── Stage 1: panel generation ────────────────────────────────────────────────


def generate_panel(
    client: OpenAI,
    *,
    shot_id: int,
    out_path: Path,
    max_retries: int = 5,
) -> None:
    """gpt-image-1.images.edit() — anchor first, input_fidelity=high."""
    if out_path.exists() and out_path.stat().st_size > 0:
        logger.info("[panel] cache hit shot %d -> %s", shot_id, out_path.name)
        return

    anchor_path = REF_DIR / ANCHORS[shot_id]
    if not anchor_path.exists():
        raise RuntimeError(f"anchor missing for shot {shot_id}: {anchor_path}")
    prompt = PANEL_PROMPTS[shot_id]

    last: Exception | None = None
    for attempt in range(max_retries):
        try:
            with open(anchor_path, "rb") as fh:
                response = client.images.edit(
                    model="gpt-image-1.5",
                    image=[fh],
                    prompt=prompt,
                    size="1536x1024",
                    quality="high",
                    n=1,
                    input_fidelity="high",
                    output_format="png",
                )
            b64 = response.data[0].b64_json
            if not b64:
                raise RuntimeError("empty b64_json")
            out_path.write_bytes(base64.b64decode(b64))
            logger.info("[panel] generated shot %d (%d bytes) -> %s",
                        shot_id, out_path.stat().st_size, out_path.name)
            return
        except (RateLimitError, APIError) as e:
            last = e
            wait = 2.0 * (2**attempt)
            logger.warning("shot %d attempt %d/%d failed: %s — sleeping %.1fs",
                           shot_id, attempt + 1, max_retries, e, wait)
            time.sleep(wait)
    raise RuntimeError(f"shot {shot_id} failed after {max_retries} retries: {last}")


def generate_all_panels(
    *,
    force_regen: bool = False,
    shot_filter: set[int] | None = None,
) -> dict[int, Path]:
    """Generate every panel in PANEL_PROMPTS.

    If `shot_filter` is set, ONLY shots in that set are processed. Caller
    can use this to regen just (e.g.) shots 3, 4, 5 without touching 1, 2.
    Cached panels not in the filter are returned as-is in the result dict
    so downstream code still sees the full mapping.
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set — run under `doppler run ...`")
    client = OpenAI(api_key=api_key)

    results: dict[int, Path] = {}
    for shot_id in sorted(PANEL_PROMPTS):
        out_path = REF_DIR / f"vfd_shot_{shot_id:02d}.png"
        if shot_filter is not None and shot_id not in shot_filter:
            # Not in the filter — keep the existing file (no API call)
            results[shot_id] = out_path
            logger.info("[panel] shot %d not in --shots filter, keeping %s",
                        shot_id, out_path.name)
            continue
        if force_regen and out_path.exists():
            out_path.unlink()
        generate_panel(client, shot_id=shot_id, out_path=out_path)
        results[shot_id] = out_path
    return results


# ─── Stage 2: focal calibration via Claude vision ─────────────────────────────


CALIBRATION_RUBRIC = """\
You are looking at a comic-book page that will become one shot of an animated
explainer video. The video pans/zooms across the page, parking on different
elements at different beats.

For each TARGET in the list below, return the SOURCE-IMAGE-NORMALIZED
coordinates of where that target is centered on this page (cx and cy, each
in 0.0–1.0 where 0.0 is the top/left edge of the source image), plus a
recommended ZOOM level:
  - zoom = 1.0  : the whole page (use for "wide establish" or "full pull-back")
  - zoom = 1.5–1.8 : a half-page region
  - zoom = 2.0–2.5 : a single panel close-up
  - zoom = 3.0+ : a tight close-up on text or a face inside a panel

Be precise. cx and cy describe the CENTER of the target's bounding box. If
a target is in the top-right quadrant, cx will be 0.7–0.9 and cy will be
0.1–0.3. If a target is in the bottom-center, cx will be 0.4–0.6 and cy
will be 0.7–0.9.

Return ONLY this JSON object — no preamble, no fences:
{"targets": [{"target": "<exact target string>", "cx": <float>, "cy": <float>, "zoom": <float>}]}
"""


def calibrate_shot_focals(
    client: anthropic.Anthropic,
    *,
    shot_id: int,
    image_path: Path,
    targets: list[str],
    model: str = "claude-haiku-4-5-20251001",
) -> list[dict[str, float]]:
    """Ask Claude vision to locate each beat target on the generated page."""
    media = "image/png"
    data = base64.standard_b64encode(image_path.read_bytes()).decode("ascii")

    target_block = "\n".join(f"  - {t!r}" for t in targets)
    user_text = f"TARGETS:\n{target_block}\n\n{CALIBRATION_RUBRIC}"

    msg = client.messages.create(
        model=model,
        max_tokens=600,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media, "data": data}},
                {"type": "text", "text": user_text},
            ],
        }],
    )
    raw = "".join(b.text for b in msg.content if getattr(b, "type", None) == "text")
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        raise ValueError(f"shot {shot_id}: no JSON in response: {raw[:300]}")
    parsed = json.loads(m.group(0))
    out: list[dict[str, float]] = []
    by_target = {t["target"]: t for t in parsed.get("targets", [])}
    for t in targets:
        match = by_target.get(t)
        if not match:
            logger.warning("shot %d: no match for target %r — defaulting to center",
                           shot_id, t)
            out.append({"cx": 0.5, "cy": 0.5, "zoom": 1.0})
            continue
        out.append({
            "cx": float(match["cx"]),
            "cy": float(match["cy"]),
            "zoom": float(match["zoom"]),
        })
    return out


def _src_to_canvas(
    *,
    source_w: int,
    source_h: int,
    canvas_w: int = 1920,
    canvas_h: int = 1080,
) -> tuple[float, float, float, float]:
    """Letterbox math: source (sw,sh) → canvas (cw,ch).

    Returns (offset_x_norm, offset_y_norm, scale_x_norm, scale_y_norm) where:
      canvas_x_norm = offset_x_norm + source_x_norm * scale_x_norm
      canvas_y_norm = offset_y_norm + source_y_norm * scale_y_norm
    """
    scale = min(canvas_w / source_w, canvas_h / source_h)
    scaled_w = source_w * scale
    scaled_h = source_h * scale
    pad_x = (canvas_w - scaled_w) / 2
    pad_y = (canvas_h - scaled_h) / 2
    return (
        pad_x / canvas_w,
        pad_y / canvas_h,
        scaled_w / canvas_w,
        scaled_h / canvas_h,
    )


def calibrate_all(
    *,
    storyboard: dict[str, Any],
    panel_paths: dict[int, Path],
) -> dict[str, Any]:
    """For every beat in every shot, fill in calibrated focal coords.

    Returns a deep-copied storyboard with focals updated. Original is
    untouched.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set — run under `doppler run ...`")
    client = anthropic.Anthropic(api_key=api_key)

    # Deep copy via re-load
    sb = yaml.safe_load(yaml.safe_dump(storyboard))

    # All gpt-image-1 panels at 1536×1024 — letterbox math is identical
    ox, oy, sx, sy = _src_to_canvas(source_w=1536, source_h=1024)

    for shot in sb["shots"]:
        shot_id = int(shot["id"])
        targets = [b["target"] for b in shot["beats"]]
        logger.info("[calib] shot %d: locating %d targets", shot_id, len(targets))
        located = calibrate_shot_focals(
            client,
            shot_id=shot_id,
            image_path=panel_paths[shot_id],
            targets=targets,
        )
        for beat, src in zip(shot["beats"], located):
            cx_canvas = ox + src["cx"] * sx
            cy_canvas = oy + src["cy"] * sy
            beat["focal"] = {
                "cx": round(cx_canvas, 3),
                "cy": round(cy_canvas, 3),
                "zoom": round(src["zoom"], 2),
            }
            logger.info("  beat: %s -> cx=%.3f cy=%.3f zoom=%.2f",
                        beat["target"][:50], beat["focal"]["cx"],
                        beat["focal"]["cy"], beat["focal"]["zoom"])
    return sb


# ─── Stage 3: drive build_video_v2 with the calibrated storyboard ─────────────


def run_build(*, calibrated_storyboard_path: Path) -> Path:
    """Monkey-patch build_video_v2 module-level config and call main()."""
    import build_video_v2

    build_video_v2.STORYBOARD_PATH = calibrated_storyboard_path
    build_video_v2.FINAL_DIR = FINAL_DIR

    # build_video_v2.main() reads sys.argv via argparse — strip our argv.
    saved_argv = sys.argv[:]
    sys.argv = ["build_video_v2.py", "--skip-verify"]
    try:
        rc = build_video_v2.main()
    finally:
        sys.argv = saved_argv
    if rc != 0:
        raise RuntimeError(f"build_video_v2.main() returned {rc}")

    storyboard = yaml.safe_load(calibrated_storyboard_path.read_text())
    return FINAL_DIR / storyboard["video"]["output_name"]


def main() -> int:
    p = argparse.ArgumentParser(description="Programmatic VFD F004 comic build")
    p.add_argument("--regen", action="store_true",
                   help="re-generate panels even if reference/vfd_shot_*.png exists")
    p.add_argument("--shots",
                   help="comma-separated shot IDs to regen (default: all). "
                        "e.g. --shots 3,4,5")
    p.add_argument("--skip-calibrate", action="store_true",
                   help="reuse first-pass focals from the source storyboard "
                        "(default: re-calibrate via Claude vision against the "
                        "actual generated images)")
    p.add_argument("--skip-build", action="store_true",
                   help="generate (and optionally calibrate) only — do NOT "
                        "invoke build_video_v2 to stitch the final mp4")
    args = p.parse_args()

    shot_filter: set[int] | None = None
    if args.shots:
        shot_filter = {int(x.strip()) for x in args.shots.split(",")}

    storyboard = yaml.safe_load(STORYBOARD_PATH.read_text())

    logger.info("──── Stage 1: panel generation (gpt-image-1, 1536x1024 high) ────")
    panel_paths = generate_all_panels(force_regen=args.regen, shot_filter=shot_filter)

    if args.skip_calibrate:
        logger.info("──── Stage 2: SKIPPED (using first-pass focals from source) ────")
        # Just copy the source storyboard to the calibrated path so build sees the same file
        CALIBRATED_STORYBOARD_PATH.write_text(yaml.safe_dump(storyboard, sort_keys=False))
    else:
        logger.info("──── Stage 2: focal calibration (Claude vision) ────")
        calibrated = calibrate_all(storyboard=storyboard, panel_paths=panel_paths)
        CALIBRATED_STORYBOARD_PATH.write_text(yaml.safe_dump(calibrated, sort_keys=False))
        logger.info("[calib] wrote %s", CALIBRATED_STORYBOARD_PATH.name)

    if args.skip_build:
        logger.info("──── Stage 3: SKIPPED (--skip-build) ────")
        logger.info("✅ Panels regenerated. Run QC: scripts/qc_panels.py")
        return 0

    logger.info("──── Stage 3: build_video_v2 with calibrated storyboard ────")
    final_path = run_build(calibrated_storyboard_path=CALIBRATED_STORYBOARD_PATH)
    logger.info("✅ Final video: %s (%.2f MB)",
                final_path, final_path.stat().st_size / (1024 * 1024))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
