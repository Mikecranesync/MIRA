"""Reject station archetype — inline quality-reject diverter."""
from __future__ import annotations

from simlab.models import TagCategory, TagDef, ValueType


def reject_station_tags() -> dict[str, TagDef]:
    """Return tag dict for an inline reject station archetype."""
    from simlab.baselines import packml_status_tags

    tags = packml_status_tags()
    tags.update(
        {
            "reject_count": TagDef(
                name="reject_count",
                category=TagCategory.QUALITY,
                value_type=ValueType.INT,
                default=0,
                description="Cumulative rejects diverted at this station.",
            ),
            "reject_bin_full": TagDef(
                name="reject_bin_full",
                category=TagCategory.STATUS,
                value_type=ValueType.BOOL,
                default=False,
                description="True when the reject collection bin is full.",
            ),
            "diverter_active": TagDef(
                name="diverter_active",
                category=TagCategory.STATUS,
                value_type=ValueType.BOOL,
                default=False,
                description="True when the reject diverter actuator is commanded.",
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
