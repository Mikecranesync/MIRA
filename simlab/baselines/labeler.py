"""Labeler archetype — pressure-sensitive or hot-glue label applicator."""
from __future__ import annotations

from simlab.models import TagCategory, TagDef, ValueType


def labeler_tags() -> dict[str, TagDef]:
    """Return tag dict for a labeler PLC program archetype."""
    from simlab.baselines import packml_status_tags

    tags = packml_status_tags()
    tags.update(
        {
            "label_roll_percent": TagDef(
                name="label_roll_percent",
                category=TagCategory.STATUS,
                value_type=ValueType.FLOAT,
                default=85.0,
                unit="%",
                description="Label roll remaining percentage.",
            ),
            "label_web_tension": TagDef(
                name="label_web_tension",
                category=TagCategory.PROCESS,
                value_type=ValueType.FLOAT,
                default=1.2,
                unit="N",
                description="Label web tension at the registration sensor.",
            ),
            "label_sensor_blocked": TagDef(
                name="label_sensor_blocked",
                category=TagCategory.STATUS,
                value_type=ValueType.BOOL,
                default=False,
                description="True when the label-present photoeye is blocked.",
            ),
            "glue_temperature": TagDef(
                name="glue_temperature",
                category=TagCategory.PROCESS,
                value_type=ValueType.FLOAT,
                default=325.0,
                unit="°F",
                description="Hot-melt glue temperature (cold-glue machines = 0).",
            ),
            "registration_error_mm": TagDef(
                name="registration_error_mm",
                category=TagCategory.PROCESS,
                value_type=ValueType.FLOAT,
                default=0.0,
                unit="mm",
                description="Label registration error relative to target window.",
            ),
            "reject_count": TagDef(
                name="reject_count",
                category=TagCategory.QUALITY,
                value_type=ValueType.INT,
                default=0,
                description="Cumulative mislabeled / off-registration reject count.",
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
