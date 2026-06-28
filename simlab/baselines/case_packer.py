"""Case packer archetype — end-of-line case forming and packing machine."""
from __future__ import annotations

from simlab.models import TagCategory, TagDef, ValueType


def case_packer_tags() -> dict[str, TagDef]:
    """Return tag dict for a case packer PLC program archetype."""
    from simlab.baselines import packml_status_tags

    tags = packml_status_tags()
    tags.update(
        {
            "case_count": TagDef(
                name="case_count",
                category=TagCategory.PRODUCTION,
                value_type=ValueType.INT,
                default=0,
                description="Cumulative completed cases since last reset.",
            ),
            "bottle_infeed_count": TagDef(
                name="bottle_infeed_count",
                category=TagCategory.PRODUCTION,
                value_type=ValueType.INT,
                default=0,
                description="Cumulative bottle infeed count.",
            ),
            "case_former_ready": TagDef(
                name="case_former_ready",
                category=TagCategory.STATUS,
                value_type=ValueType.BOOL,
                default=True,
                description="True when the case former is ready to produce a blank.",
            ),
            "glue_level": TagDef(
                name="glue_level",
                category=TagCategory.STATUS,
                value_type=ValueType.FLOAT,
                default=70.0,
                unit="%",
                description="Case sealer hot-melt glue tank level.",
            ),
            "glue_temperature": TagDef(
                name="glue_temperature",
                category=TagCategory.PROCESS,
                value_type=ValueType.FLOAT,
                default=340.0,
                unit="°F",
                description="Case sealer hot-melt glue temperature.",
            ),
            "jam_detected": TagDef(
                name="jam_detected",
                category=TagCategory.STATUS,
                value_type=ValueType.BOOL,
                default=False,
                description="True when a bottle or case jam is detected.",
            ),
            "reject_count": TagDef(
                name="reject_count",
                category=TagCategory.QUALITY,
                value_type=ValueType.INT,
                default=0,
                description="Cumulative case reject count.",
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
