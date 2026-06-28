"""Belt conveyor zone archetype."""
from __future__ import annotations

from simlab.models import TagCategory, TagDef, ValueType


def conveyor_zone_tags() -> dict[str, TagDef]:
    """Return tag dict for a belt conveyor zone PLC program archetype."""
    from simlab.baselines import packml_status_tags

    tags = packml_status_tags()
    tags.update(
        {
            "motor_current_amps": TagDef(
                name="motor_current_amps",
                category=TagCategory.MOTOR,
                value_type=ValueType.FLOAT,
                default=3.2,
                unit="A",
                description="Belt drive motor current draw.",
            ),
            "speed_fpm": TagDef(
                name="speed_fpm",
                category=TagCategory.PROCESS,
                value_type=ValueType.FLOAT,
                default=60.0,
                unit="fpm",
                description="Conveyor belt surface speed in feet per minute.",
            ),
            "photoeye_blocked": TagDef(
                name="photoeye_blocked",
                category=TagCategory.STATUS,
                value_type=ValueType.BOOL,
                default=False,
                description="True when the zone photoeye is blocked by product.",
            ),
            "blocked": TagDef(
                name="blocked",
                category=TagCategory.STATUS,
                value_type=ValueType.BOOL,
                default=False,
                description="True when the zone is in a blocked/backpressure condition.",
            ),
            "starved": TagDef(
                name="starved",
                category=TagCategory.STATUS,
                value_type=ValueType.BOOL,
                default=False,
                description="True when the zone has no product to convey.",
            ),
            "accumulation_percent": TagDef(
                name="accumulation_percent",
                category=TagCategory.PROCESS,
                value_type=ValueType.FLOAT,
                default=0.0,
                unit="%",
                description="Zone accumulation buffer fill level (0=empty, 100=full/backpressure).",
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
