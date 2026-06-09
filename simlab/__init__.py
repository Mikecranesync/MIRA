"""MIRA SimLab — a deterministic, headless simulated factory benchmark.

SimLab is **not** a toy conveyor demo. It is a ProveIt-style simulated factory:
a deterministic, repeatable tag/event simulator that MIRA can monitor, reason
over, map into a UNS, diagnose, cite documentation against, and gate with
train-before-deploy approval — exactly like a real PLC/SCADA source.

The flagship line is a **juice/beverage bottling line** (`simlab.lines.juice_bottling`):

    Depalletizer → Conveyor/Accumulation → Rinser → Filler → Capper
        → Labeler → Case Packer → Palletizer  (+ Air & CIP utilities)

Authoritative data source: the **headless deterministic simulator** in this
package. Factory I/O (and any future visual layer) is an OPTIONAL projection —
never the source of truth. See `docs/simlab/factory-io-optional-adapter.md`.

Layers
------
- ``simlab.packml``      PackML/ISA-88 machine-state model
- ``simlab.models``      PLC-baseline normalization (tags, alarms, fault codes, assets)
- ``simlab.uns``         canonical ltree UNS paths + MQTT/display projections
- ``simlab.baselines``   reusable PLC program archetypes (filler, conveyor, …)
- ``simlab.lines``       concrete line definitions (juice_bottling)
- ``simlab.engine``      deterministic, seeded tick engine (holds tag state)
- ``simlab.scenarios``   replayable fault scenarios (A–F) with ground-truth rubrics
- ``simlab.publishers``  publisher abstraction (in-memory / MQTT / relay-ingest / fake)
- ``simlab.diagnostic``  evidence-packet assembler + rubric grader (NOT an answer engine)
- ``simlab.approval``    train-before-deploy approval store (good/bad/needs_review + lifecycle)
- ``simlab.api``         FastAPI surface for Hub / MIRA consumption

Everything here is synthetic, deterministic, and repo-contained. No proprietary
customer PLC code and no confidential plant data is used. Every reading carries
``simulated=True`` and is published under ``source_system="simulator"``.
"""

from __future__ import annotations

__all__ = ["SIMLAB_TENANT_ID", "__version__"]

__version__ = "0.1.0"

# Fixed, well-known tenant for the SimLab Florida-Natural juice-bottling demo.
# A reserved 0-prefixed UUID so it can be seeded to dev or prod without colliding
# with a real customer. Single source of truth: the doc-seed
# (tools/seeds/seed-simlab-docs.py) ingests knowledge_entries under it, and the
# scenario runner (tests/simlab/runner.py) binds the Supervisor to it so recall
# actually surfaces those docs at scenario runtime. Both import from here.
SIMLAB_TENANT_ID = "00000000-0000-0000-0000-000000515ab1"
