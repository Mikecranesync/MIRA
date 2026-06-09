"""SimLab baseline archetypes — reusable PLC program normalizations.

Each sub-module exposes a factory function that returns the canonical tag/fault/alarm
set for that machine class. These are clean-room archetypes of standard industrial
patterns — no proprietary ladder or structured-text code is copied or executed.

Public helper
-------------
:func:`packml_status_tags` — returns the standard PackML status-layer tags that
every *process* asset carries (``run_state``, ``fault_code``). Utility assets
(air_system, cip_skid) have their own bespoke tag lists and do NOT receive these.

Archetypes
----------
bottle_filler, conveyor_zone, reject_station, palletizer,
pick_place_depalletizer, vfd_motor, capper, labeler, case_packer,
rinser, air_system, cip_skid
"""

from __future__ import annotations

from simlab.models import TagCategory, TagDef, ValueType


def packml_status_tags() -> dict[str, TagDef]:
    """Standard PackML status-layer tags for every *process* asset.

    Returns a dict keyed by bare tag name. Callers merge this into their own
    tag dict — do NOT apply to utility assets (air_system, cip_skid).
    """
    return {
        "run_state": TagDef(
            name="run_state",
            category=TagCategory.STATUS,
            value_type=ValueType.ENUM,
            default="Idle",
            description="PackML run state (ISA-88/PackML label from run_state_label()).",
        ),
    }


from simlab.baselines.air_system import air_system_tags  # noqa: E402
from simlab.baselines.bottle_filler import bottle_filler_tags  # noqa: E402
from simlab.baselines.capper import capper_tags  # noqa: E402
from simlab.baselines.case_packer import case_packer_tags  # noqa: E402
from simlab.baselines.cip_skid import cip_skid_tags  # noqa: E402
from simlab.baselines.conveyor_zone import conveyor_zone_tags  # noqa: E402
from simlab.baselines.labeler import labeler_tags  # noqa: E402
from simlab.baselines.palletizer import palletizer_tags  # noqa: E402
from simlab.baselines.pick_place_depalletizer import pick_place_depalletizer_tags  # noqa: E402
from simlab.baselines.rinser import rinser_tags  # noqa: E402
from simlab.baselines.vfd_motor import vfd_motor_tags  # noqa: E402

__all__ = [
    "packml_status_tags",
    "bottle_filler_tags",
    "conveyor_zone_tags",
    "capper_tags",
    "labeler_tags",
    "case_packer_tags",
    "palletizer_tags",
    "pick_place_depalletizer_tags",
    "rinser_tags",
    "air_system_tags",
    "cip_skid_tags",
    "vfd_motor_tags",
]
