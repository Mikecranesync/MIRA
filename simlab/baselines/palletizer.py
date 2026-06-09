"""Palletizer archetype — robotic or gantry end-of-line palletizer."""
from __future__ import annotations

from simlab.models import TagCategory, TagDef, ValueType


def palletizer_tags() -> dict[str, TagDef]:
    """Return tag dict for a palletizer PLC program archetype."""
    from simlab.baselines import packml_status_tags

    tags = packml_status_tags()
    tags.update(
        {
            "case_infeed_count": TagDef(
                name="case_infeed_count",
                category=TagCategory.PRODUCTION,
                value_type=ValueType.INT,
                default=0,
                description="Cumulative cases inducted onto the palletizer.",
            ),
            "pallet_present": TagDef(
                name="pallet_present",
                category=TagCategory.STATUS,
                value_type=ValueType.BOOL,
                default=True,
                description="True when a pallet is present at the build station.",
            ),
            "layer_count": TagDef(
                name="layer_count",
                category=TagCategory.PRODUCTION,
                value_type=ValueType.INT,
                default=0,
                description="Current layer count on the pallet in build.",
            ),
            "robot_ready": TagDef(
                name="robot_ready",
                category=TagCategory.STATUS,
                value_type=ValueType.BOOL,
                default=True,
                description="True when the robot cell is in home position and ready.",
            ),
            "slip_sheet_present": TagDef(
                name="slip_sheet_present",
                category=TagCategory.STATUS,
                value_type=ValueType.BOOL,
                default=True,
                description="True when slip sheet magazine is loaded.",
            ),
            "jam_detected": TagDef(
                name="jam_detected",
                category=TagCategory.STATUS,
                value_type=ValueType.BOOL,
                default=False,
                description="True when a case jam is detected on the palletizer infeed.",
            ),
            "fault_code": TagDef(
                name="fault_code",
                category=TagCategory.FAULTS,
                value_type=ValueType.STRING,
                default="",
                description="Active fault code string.",
            ),
        }
    )
    return tags
