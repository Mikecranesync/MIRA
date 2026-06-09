"""CIP skid archetype — clean-in-place utility skid.

NOTE: Utility assets do NOT receive packml_status_tags() (no run_state).
The CIP skid tag set is exactly as specified in the line spec.
"""
from __future__ import annotations

from simlab.models import TagCategory, TagDef, ValueType


def cip_skid_tags() -> dict[str, TagDef]:
    """Return tag dict for a clean-in-place (CIP) utility skid archetype.

    No PackML run_state — utility assets are not ISA-88 unit-of-operation machines.
    """
    return {
        "cip_active": TagDef(
            name="cip_active",
            category=TagCategory.STATUS,
            value_type=ValueType.BOOL,
            default=False,
            description="True when a CIP cycle is active on this skid.",
        ),
        "cycle_step": TagDef(
            name="cycle_step",
            category=TagCategory.STATUS,
            value_type=ValueType.STRING,
            default="idle",
            description="Current CIP cycle step name (idle/pre-rinse/caustic/acid/final-rinse).",
        ),
        "supply_temp": TagDef(
            name="supply_temp",
            category=TagCategory.PROCESS,
            value_type=ValueType.FLOAT,
            default=0.0,
            unit="°F",
            description="CIP solution supply temperature.",
        ),
        "return_temp": TagDef(
            name="return_temp",
            category=TagCategory.PROCESS,
            value_type=ValueType.FLOAT,
            default=0.0,
            unit="°F",
            description="CIP solution return temperature.",
        ),
        "conductivity": TagDef(
            name="conductivity",
            category=TagCategory.PROCESS,
            value_type=ValueType.FLOAT,
            default=0.0,
            unit="mS/cm",
            description="Return solution conductivity (chemical concentration proxy).",
        ),
        "valve_fault": TagDef(
            name="valve_fault",
            category=TagCategory.ALARMS,
            value_type=ValueType.BOOL,
            default=False,
            description="True when a CIP valve position fault is detected.",
        ),
    }
