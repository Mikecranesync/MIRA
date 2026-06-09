"""Bottle rinser archetype — inline inverter/rinse station."""
from __future__ import annotations

from simlab.models import TagCategory, TagDef, ValueType


def rinser_tags() -> dict[str, TagDef]:
    """Return tag dict for a bottle rinser PLC program archetype."""
    from simlab.baselines import packml_status_tags

    tags = packml_status_tags()
    tags.update(
        {
            "infeed_bottle_count": TagDef(
                name="infeed_bottle_count",
                category=TagCategory.PRODUCTION,
                value_type=ValueType.INT,
                default=0,
                description="Cumulative bottles entering the rinser.",
            ),
            "outfeed_bottle_count": TagDef(
                name="outfeed_bottle_count",
                category=TagCategory.PRODUCTION,
                value_type=ValueType.INT,
                default=0,
                description="Cumulative bottles exiting the rinser.",
            ),
            "water_pressure": TagDef(
                name="water_pressure",
                category=TagCategory.PROCESS,
                value_type=ValueType.FLOAT,
                default=45.0,
                unit="psi",
                description="Rinse water supply pressure.",
            ),
            "rinse_valve_open": TagDef(
                name="rinse_valve_open",
                category=TagCategory.STATUS,
                value_type=ValueType.BOOL,
                default=True,
                description="True when rinse water valve is commanded open.",
            ),
            "reject_count": TagDef(
                name="reject_count",
                category=TagCategory.QUALITY,
                value_type=ValueType.INT,
                default=0,
                description="Cumulative bottles rejected by rinser inspection.",
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
