"""Air system archetype — plant compressed-air utility skid.

NOTE: Utility assets do NOT receive packml_status_tags() (no run_state).
The air system's tag set is exactly as specified in the line spec.
"""
from __future__ import annotations

from simlab.models import TagCategory, TagDef, ValueType


def air_system_tags() -> dict[str, TagDef]:
    """Return tag dict for a compressed-air utility skid archetype.

    No PackML run_state — utility assets are not ISA-88 unit-of-operation machines.
    """
    return {
        "header_pressure_psi": TagDef(
            name="header_pressure_psi",
            category=TagCategory.PROCESS,
            value_type=ValueType.FLOAT,
            default=90.0,
            unit="psi",
            description="Plant compressed-air header pressure.",
        ),
        "compressor_running": TagDef(
            name="compressor_running",
            category=TagCategory.STATUS,
            value_type=ValueType.BOOL,
            default=True,
            description="True when the lead compressor is running.",
        ),
        "dryer_fault": TagDef(
            name="dryer_fault",
            category=TagCategory.ALARMS,
            value_type=ValueType.BOOL,
            default=False,
            description="True when the refrigerated air dryer is in fault.",
        ),
        "low_air_alarm": TagDef(
            name="low_air_alarm",
            category=TagCategory.ALARMS,
            value_type=ValueType.BOOL,
            default=False,
            description="True when header pressure drops below low-pressure setpoint.",
        ),
    }
