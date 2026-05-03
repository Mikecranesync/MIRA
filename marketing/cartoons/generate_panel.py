#!/usr/bin/env python3
"""
Generate a single panel of the compound-interest cartoon via gpt-image-2.

Usage:
    doppler run --project factorylm --config prd -- \
        python marketing/cartoons/generate_panel.py 1

Panels live in marketing/cartoons/compound-interest/panel-N.png so each one
can be previewed independently before we wire them into feature-cartoons.js.

Model note: uses OpenAI's gpt-image-2 (released 2026-04-21), which renders
in-image text — name patches, phone-screen fault codes, signage — letter-
perfect in a way gpt-image-1 could not. Same OPENAI_API_KEY, same SDK call.
"""
from __future__ import annotations

import base64
import os
import sys
from pathlib import Path
from openai import OpenAI

OUT_DIR = Path(__file__).parent / "compound-interest"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Master style context — kept consistent across all four panels of this
# cartoon so the look reads as a series, not a grab bag. Recipe inherited
# from the Rico onboarding panel (mira-hub/public/onboarding/panel-1.png),
# which is the visual quality bar.
MASTER_STYLE = """\
Industrial comic book art style. Painterly, cinematic, gritty graphic-novel
panel. Dark steel-blue and amber color palette, high-contrast black panel
borders. Dramatic chiaroscuro lighting from overhead industrial lamps and
glowing screens. Textured rendering — visible brushwork, atmospheric haze,
real depth and weight. Strong character presence — humans drawn with
specific posture, expression, and grime. Editorial graphic-novel feel —
think the painted panels of Sean Phillips or Greg Ruth, not infographic
wireframe. Cinematic landscape 3:2 aspect.

NOT flat schematic. NOT blueprint or wireframe. NOT cute, NOT Pixar,
NOT 3D-rendered, NOT superheroes. The frame should feel like a still from
a graphic novel about industrial maintenance.\
"""

PANEL_PROMPTS: dict[int, str] = {
    1: """\
Cedar Creek Dairy, late afternoon. Interior of the dairy processing hall.

In the foreground, slightly off-center, a maintenance technician — call
him RICO — stands facing an open variable-frequency-drive panel
(PowerFlex 525) mounted on a stainless-steel column. Mid-30s, dark hair,
glasses, navy-blue coveralls with a "RICO" name patch on the chest, a
multi-tool clipped to his belt. Posture focused, professional — not
panicked. He's holding his phone in one hand at chest height, eyes on
the screen.

The VFD's red FAULT indicator LED is flashing, casting a small warm-red
glow on his face and the open panel door. His phone screen (visible at
an angle to the viewer) shows in monospace amber type: "F-012 fault on
PowerFlex 525" — the dairy's diagnostic message. Below the fault line,
smaller and dimmer: "Searching..." with a typing cursor.

Behind Rico, the dairy floor stretches in atmospheric depth — three
tall cylindrical stainless-steel milk silos visible through a wide
interior window or doorway, sanitary piping running along the ceiling,
fluorescent shop lights overhead with visible glow halos and dust motes
in the beams. Floor is wet polished concrete reflecting the cold light.
A small "CEDAR CREEK DAIRY" placard or wall label is faintly visible
on a doorframe.

Crucially: NO ONE ELSE in the frame. Rico is alone. The hall extends
empty into shadow behind him. This is the lonely-first-call mood —
he has the problem, and right now he is the only one in the world who
knows about it.

Color: dominant cool steel-blue and shadow black, punctuated by warm
amber from the phone screen and the small red of the fault LED. Heavy
black panel border around the whole frame in the comic-book convention.

Bottom-right of the panel, in tiny monospace caps overlaid as a
diegetic HUD readout: "NETWORK: 1 PLANT · 0 PRIOR INCIDENTS".

Mood: cinematic, gritty, focused isolation. The first trouble call is
the slowest because no one has ever solved it before.\
""",
    2: """\
Cedar Creek Dairy, late afternoon. Same dairy processing hall as panel 1.

In the foreground, the same maintenance technician RICO stands facing
the open variable-frequency-drive panel (PowerFlex 525) mounted on a
stainless-steel column. Mid-30s, dark hair, reading glasses, navy-blue
coveralls with a bright embroidered "RICO" name patch clearly visible
on his chest, a multi-tool clipped to his belt.

He is in 3/4 view, slightly turned toward the camera so both his face
and his chest patch are visible. In both hands he holds open a thick
spiral-bound paper user manual. The title at the top of the open spread
reads in bold caps: "POWERFLEX 525 · FAULT CODE REFERENCE."

The page he's looking at shows a long three-column reference table
with the headers "CODE | NAME | ACTION". Visible rows include:
  F-008  Phase Loss          CONSULT FACTORY
  F-009  Bus Undervoltage    CONSULT FACTORY
  F-010  Heatsink Overtemp   CONSULT FACTORY
  F-011  IGBT Fault          CONSULT FACTORY
  F-012  Overload            CONSULT FACTORY
  F-013  Ground Fault        CONSULT FACTORY
The ACTION column repeats "CONSULT FACTORY" almost line after line —
a wall of useless. His index finger traces the row for F-012.

CRITICALLY: his phone is NOT in the frame. The paper manual is the
only tool he has.

The VFD's red FAULT indicator LED is flashing in his peripheral vision,
casting a small warm-red glow on his cheek and the open panel door.
There is NO warm amber phone-screen light in this scene — only the
cold steel-blue of overhead industrial fluorescents and the small
punctuation of the red fault LED. The absence of helper-light is the
storytelling point.

His expression: focused-but-stuck. Brow tight, jaw set, eyes locked on
the page, professionally engaged but quietly defeated by the table —
he has read every relevant row and the manual gives him nothing
actionable.

Behind Rico, the dairy floor stretches in atmospheric depth — three
tall cylindrical stainless-steel milk silos visible through a wide
interior window or doorway, sanitary piping running along the ceiling,
fluorescent shop lights overhead with visible glow halos and dust motes
in the beams. Floor is wet polished concrete reflecting the cold light.
A small "CEDAR CREEK DAIRY" placard or wall label is faintly visible
on a doorframe.

Crucially: NO ONE ELSE in the frame. Rico is alone with his manual.

Color: dominant cool steel-blue and shadow black, punctuated only by
the small warm red of the fault LED. Compared to panel 1, this scene
is intentionally COLDER — no warm amber, no helper glow. Heavy black
panel border around the whole frame in the comic-book convention.

Bottom-right of the panel, in tiny monospace caps overlaid as a
diegetic HUD readout: "WITHOUT MIRA · MANUAL ONLY · ETA UNKNOWN".

Mood: lonely, paper-bound, slow. This is the world without MIRA —
cryptic codes, "consult factory," and a tech alone with a book that
won't help him.\
""",
    3: """\
Single comic-book hero panel for an industrial-maintenance landing
page — Marvel-comics split-panel convention. The canvas is divided
DIAGONALLY by a thick jagged BLACK divider line running from the
UPPER-LEFT corner down to the LOWER-RIGHT corner, splitting the frame
into two triangular scenes. The divider has a thin warm-red accent
stroke along one edge, echoing a fault-LED glow. The split is
deliberate and clearly readable as a comic-book before/after device.

Both scenes show the SAME character — RICO, a maintenance technician,
mid-30s, dark hair, reading glasses, navy-blue coveralls with a clearly
embroidered "RICO" name patch on the chest, a multi-tool clipped to
his belt — at the SAME open variable-frequency-drive panel (PowerFlex
525) in the SAME Cedar Creek Dairy processing hall, with the SAME
flashing red FAULT LED on the drive. Both Ricos are in 3/4 view, each
turned slightly toward the diagonal divider so the two figures face
each other across the split.

LEFT SCENE — labeled along the upper-left edge in tiny monospace caps
"WITHOUT MIRA":
  Rico holds open a thick spiral-bound paper user manual in both hands.
  The visible spread shows in legible type "POWERFLEX 525 · FAULT CODE
  REFERENCE" at the top and a three-column table with the headers
  "CODE | NAME | ACTION" and a column of repeated "CONSULT FACTORY"
  entries running down it. His expression: focused-but-stuck.
  Lighting on this side is COLD — only steel-blue fluorescents and
  the small warm-red glow from the FAULT LED. NO warm amber
  phone-screen light on this side.

  A classic comic-book THOUGHT BALLOON (cloud-shape with a trail of
  small bubble dots leading down to his head) floats in the upper
  region of his triangle, containing three short lines of bold caps
  text on three separate lines:
    F-012 AGAIN
    INTAKE? P035? MOTOR?
    HOW LONG TILL THE LINE'S COLD?

RIGHT SCENE — labeled along the upper-right edge in tiny monospace
caps "WITH MIRA":
  Rico has the manual closed (it's tucked under one arm or set on the
  open panel door). He holds his phone in one hand at chest height.
  The phone screen is visible at an angle and shows a clean chat
  interface — at the top a user line "F-012 fault on PowerFlex 525,"
  then a clear bulleted MIRA reply with three short troubleshooting
  steps. His expression: focused, getting-it, calm. Warm AMBER glow
  from the phone screen catches his face — the helper-light is back
  on this side.

  A classic comic-book THOUGHT BALLOON floats in the upper region of
  his triangle, containing three short lines of bold caps text on
  three separate lines:
    F-012 = INTAKE OVERLOAD
    CLEAR THE GUARD
    FOUR MINUTES

Style: painterly industrial comic book, Sean Phillips / Greg Ruth feel,
gritty graphic-novel paint, visible brushwork. Cool steel-blue and
shadow-black palette overall, with warm amber localized to the right
scene ONLY (heroic helper-light) and a small warm-red FAULT LED on
both sides. Heavy black panel border around the entire combined
frame. The thick diagonal divider is unmistakable.

Aspect: cinematic landscape, 16:9-ish, suitable as a hero image on a
website landing page.

Mood: BEFORE/AFTER contrast made physical. Same Rico, same problem,
same drive. The only difference is what's in his hand and what he
can think — chaotic guesses on the left, definite next-steps on
the right.

NOT cute, NOT Pixar, NOT 3D-rendered, NOT superheroes — but DOES
follow the Marvel-comics split-panel layout convention the way a
comic page would, with thought balloons rendering each Rico's
inner monologue.\
""",
}


def main() -> None:
    if len(sys.argv) < 2 or not sys.argv[1].isdigit():
        sys.exit("usage: generate_panel.py <panel_number>")
    n = int(sys.argv[1])
    if n not in PANEL_PROMPTS:
        sys.exit(f"no prompt defined yet for panel {n}; have: {sorted(PANEL_PROMPTS)}")

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        sys.exit("OPENAI_API_KEY not set — run via 'doppler run -- python ...'")

    client = OpenAI(api_key=api_key)

    prompt = f"{MASTER_STYLE}\n\n{PANEL_PROMPTS[n].strip()}"
    out_path = OUT_DIR / f"panel-{n}.png"

    print(f"Generating panel {n} -> {out_path}")
    print(f"Model: gpt-image-2, size: 1792x1024, quality: high")

    response = client.images.generate(
        model="gpt-image-2",
        prompt=prompt,
        size="1792x1024",
        quality="high",
        n=1,
    )

    b64 = response.data[0].b64_json
    if not b64:
        sys.exit("gpt-image-2 returned empty b64_json")

    out_path.write_bytes(base64.b64decode(b64))
    size_kb = out_path.stat().st_size // 1024
    print(f"OK  ({size_kb} KB)")
    print(f"Preview: {out_path}")


if __name__ == "__main__":
    main()
