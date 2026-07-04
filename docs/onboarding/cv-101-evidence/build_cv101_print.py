"""Build the CV-101 wiring print from CITED bench evidence.

Phase 2 of docs/discovery/electrical_print_reuse_audit.md. Constructs a DiagramSpec
strictly from docs/onboarding/cv-101-evidence/wiring_evidence.md — confirmed devices +
confirmed connections only. UNKNOWN loads / power terminals / unconfirmed wiring are
NOT invented; they are recorded as explicit gap NOTES on the drawing.

Run from the mira-bots dir so `shared` is importable:
    cd mira-bots && python ../docs/onboarding/cv-101-evidence/build_cv101_print.py
"""

from __future__ import annotations

import os
import sys

# allow running from repo root or mira-bots
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO, "mira-bots"))

from shared.wiring_diagram import (  # noqa: E402
    Component,
    Connection,
    DiagramSpec,
    Ratings,
    Terminal,
    WiringRenderer,
)


def build_spec() -> DiagramSpec:
    """CV-101 spec — confirmed evidence only; gaps go in notes, never invented."""
    return DiagramSpec(
        title="CV-101 Garage Conveyor - Wiring Print (DRAFT)",
        drawing_number="FLM-WD-CV101",
        revision="A",
        author="MIRA (cited bench photos 2026-07-02)",
        date="2026-07-02",
        standard="IEC",
        description="Control side from cited photos; power side pending photos.",
        components=[
            # --- Motor (photo ...153 nameplate) ---
            Component(
                tag="M1",
                type="motor_3ph",
                label="M-101 Conveyor Motor",
                ratings=Ratings(power="1 HP", voltage="230/460 V", current="3.8/1.9 A", frequency="60 Hz"),
                group="power",
            ),
            # --- VFD (photos ...151/...152) ---
            Component(
                tag="T1",
                type="vfd",
                label="VFD-101 GS11N-20P2 (GS10, 0.25HP)",
                ratings=Ratings(voltage="1PH 230V in / 3PH 0-230V out", current="1.8 A out", power="0.25 HP"),
                group="power",
            ),
            # --- PLC I/O (photos ...142/...144/...146/...147) ---
            Component(
                tag="K-IN",
                type="plc_input_card",
                label="Micro820 2080-LC20-20QBB Inputs (192.168.1.100)",
                # plc_io_card only draws pins whose side is left/right (not the default 'top')
                terminals=[Terminal(id=f"I-0{i}", label=f"I-0{i}", side="left") for i in range(6)],
                group="control",
            ),
            Component(
                tag="K-OUT",
                type="plc_output_card",
                label="Micro820 Outputs (loads UNVERIFIED)",
                terminals=[Terminal(id=f"O-0{i}", label=f"O-0{i}", side="right") for i in range(7)],
                group="control",
            ),
            # --- Operator station "PMC STATION" (photo ...142) ---
            Component(tag="S1", type="pushbutton_no", label="START (green NO)", group="control"),
            Component(tag="SA1", type="pushbutton_no", label="Selector FWD-OFF-REV (3-pos)", group="control"),
            Component(tag="S2", type="emergency_stop", label="E-STOP (dual-channel)", group="control"),
            Component(tag="PE101", type="proximity_sensor", label="Photo-eye PE-101 (PROPOSED)", group="control"),
        ],
        # CONFIRMED connections only (terminal IDs verified against each symbol's
        # exposed pins). Unconfirmed wiring (E-stop/photo-eye inputs, outputs, power
        # feed) is deliberately NOT drawn -- it lives in the gap notes below.
        connections=[
            Connection.model_validate({"from": "S1.4", "to": "K-IN.I-04", "wire_label": "START", "wire_type": "control"}),
            Connection.model_validate({"from": "SA1.4", "to": "K-IN.I-00", "wire_label": "FWD=DI:0", "wire_type": "control"}),
            Connection.model_validate({"from": "SA1.3", "to": "K-IN.I-01", "wire_label": "REV=DI:1", "wire_type": "control"}),
            # VFD output -> motor: relationship physically certain; actual terminal landing UNVERIFIED (see note 3).
            Connection.model_validate({"from": "T1.U", "to": "M1.U1", "wire_label": "3~", "wire_type": "power"}),
            Connection.model_validate({"from": "T1.V", "to": "M1.V1", "wire_type": "power"}),
            Connection.model_validate({"from": "T1.W", "to": "M1.W1", "wire_type": "power"}),
        ],
        # No buses: the +24V/0V rails weren't a photo finding and carry no drawn
        # wire in this draft, so they'd be decorative clutter. Omitted (not invented).
        buses=[],
        notes=[
            "DRIVE UNDERSIZED: GS11N-20P2 0.25HP/1.8A out vs motor 1HP/3.8A FLA -> overcurrent ceiling ~1.8A (drive), not 3.8A.",
            "SUPPLY: 1-phase 200-240V per GS10 nameplate (DC bus ~320V). R/S/T landing + contactor NOT photographed.",
            "CONFIRMED (not drawn - no RJ45 symbol): RS-485 Modbus RTU - Micro820 D+/D-/G <-> GS10 RJ45 (purple).",
            "GAP: PLC outputs O-00..O-06 loads UNVERIFIED - no photo maps outputs to loads.",
            "GAP: GS10 power terminals R/S/T (in) & U/V/W (out) UNVERIFIED - covered by caution label.",
            "GAP: E-STOP dual-channel -> PLC inputs (I-02/I-03?) NOT label-confirmed - shown unwired.",
            "GAP: Photo-eye PE-101 -> I-05 PROPOSED, not confirmed - shown unwired.",
        ],
    )


def main() -> None:
    from shared.wiring_diagram.layout import compute_layout

    spec = build_spec()
    renderer = WiringRenderer(spec)

    # Report the real, wireable terminal IDs each symbol exposed, so connections
    # can be authored against ground truth instead of guessed pin names.
    probe = compute_layout(spec)
    renderer._draw_components(probe)  # fills terminal_positions
    print("=== wireable terminals per component ===")
    for pc in probe.placed_components:
        keys = sorted(pc.terminal_positions.keys())
        print(f"{pc.component.tag:6} ({pc.component.type:16}): {keys}")

    svg = renderer.render_svg()

    out = HERE
    with open(os.path.join(out, "cv101_print.svg"), "w", encoding="utf-8") as f:
        f.write(svg)
    renderer.render_pdf_to_file(os.path.join(out, "cv101_print.pdf"))
    with open(os.path.join(out, "cv101_diagram_spec.json"), "w", encoding="utf-8") as f:
        f.write(spec.model_dump_json(by_alias=True, indent=2))
    print(f"\nwrote cv101_print.svg / .pdf / cv101_diagram_spec.json to {out}")


if __name__ == "__main__":
    main()
