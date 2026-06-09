# Factory I/O — Optional Visual Adapter (Planning Document)

## Status: Future / Planning — Not Built

Factory I/O is a 3D industrial simulation tool that renders conveyor lines,
robotic cells, palletizers, and other packaging machinery as real-time 3D scenes.
This document describes how Factory I/O *could* be connected to SimLab as an
optional visual projection layer.

**Factory I/O is never the source of truth for SimLab.** The headless deterministic
simulator (`simlab.engine`) is authoritative. Any Factory I/O connection is a
read-only display that reflects the simulator's state — it does not drive the
simulator and does not feed into MIRA diagnostics.

---

## Why Visual Is Optional, Not Required

SimLab's design goal is a **deterministic, headless, CI-runnable benchmark** —
not a visual demo. The simulator:

- Runs without a display, without Factory I/O installed, without Windows.
- Produces byte-identical replays given the same seed and scenario.
- Drives MIRA's diagnostic evidence packets and approval workflow entirely from tag data.

A visual layer adds operator intuition during development and demos. It cannot
add to or subtract from the correctness of MIRA's diagnosis.

---

## How a Factory I/O Adapter Would Work

Factory I/O communicates via its **Factory I/O SDK** (Windows DLL / C++ API) or via
**Modbus TCP** (Factory I/O can act as a Modbus TCP server, exposing its internal
sensors and actuators as registers).

A `simlab.publishers.FactoryIOPublisher` (not yet built) would:

1. On every `SimEngine.advance()` tick, call `engine.snapshot_dict()` to get the current
   tag state as `{uns_path: value}`.
2. Map each tag's value to the corresponding Factory I/O sensor/actuator address
   (see Possible Mappings below).
3. Write the values to Factory I/O via Modbus TCP (FC16 write holding registers).
4. Optionally read Factory I/O actuator feedback to confirm the visual state matches.

This is a **one-way push from simulator → Factory I/O** — the simulator never reads
from Factory I/O. The Factory I/O scene is a mirror, not a source.

---

## Possible Visual Mappings

Factory I/O's built-in scenes do not include a bottling line, but the following
standard Factory I/O elements provide approximate visual analogs:

| SimLab Asset | Factory I/O Analog | Notes |
|-------------|-------------------|-------|
| `depalletizer01` | Pick-and-place / palletizer scene | Run in reverse (pick from pallet → place on conveyor) |
| `conveyorzone01` / `conveyorzone02` | Belt conveyor | Belt speed maps to `speed_fpm`; photoeye sensor maps to `photoeye_blocked` |
| `rinser01` | Box washing station (closest available) | No direct rinser in default scenes; washing box approximates |
| `filler01` | No direct analog | Could use a custom scene element; alternatively animate bottle count via a counter display |
| `capper01` | No direct analog | Push-cap pneumatic press approximates the motion |
| `labeler01` | No direct analog | Label placement has no built-in scene element |
| `casepacker01` | Case conveyor + stacker | Stacker approximates case collation |
| `palletizer01` | Palletizer (built-in) | Direct mapping — Factory I/O's built-in palletizer scene is a reasonable match |
| `airsystem01` | No direct analog | Pressure value could be displayed on a Factory I/O numeric display |
| `cipskid01` | No direct analog | Could be represented as a valve array |

**Key limitation:** Factory I/O's default scene library does not include a beverage
filling or capping machine. A complete visual representation would require a custom
scene built in Factory I/O's scene editor, which is non-trivial effort. The partial
mappings above are best-effort approximations for demo purposes only.

---

## Accumulation / Backup Visualization

SimLab's most important multi-machine behavior is **upstream backup propagation**
(Scenarios D and E). In Factory I/O, this can be approximated by:

- Placing multiple accumulation conveyor segments end-to-end.
- When `accumulation_percent` = 100% on a zone, halting the drive motor for that segment.
- As the jam propagates upstream, successive segments halt — producing a visible queue build-up.

The `blocked` and `starved` tags map directly to the start/stop signals of each
conveyor segment's motor in Factory I/O.

---

## Reject Sorter Approximation

All assets with `reject_count` use a pneumatic push diverter to reject out-of-spec
bottles or cases. In Factory I/O, the **reject sorter** built-in element (a diverter
belt) can approximate this behavior. Map `capper01.quality.reject_count` increment
to a brief diverter actuation signal.

---

## What This Adapter Would NOT Do

- It would not change the simulator's tick logic or tag values.
- It would not change the evidence packets assembled by `simlab.diagnostic`.
- It would not change the rubric grades or approval states.
- It would not feed tag data back to MIRA — MIRA reads from `simlab.api`, not from Factory I/O.
- It would not make the simulator non-deterministic — the simulator still runs on its own seeded clock.

---

## Implementation Path (When This Gets Built)

1. Implement `simlab/publishers.py` `FactoryIOPublisher` class (lazy-imports `pymodbus`).
2. Build or procure a Factory I/O scene with the best available analogs.
3. Map SimLab tag names → Factory I/O Modbus addresses in a `factory_io_map.yaml` config.
4. Add a `--factory-io` flag to `python -m simlab` that optionally attaches the publisher.
5. Document the address map in this file once confirmed against the scene.

The adapter must remain **strictly optional**: `python -m simlab` without `--factory-io`
must work identically (same tests, same behavior) regardless of whether Factory I/O is
installed or even available on the operating system.
