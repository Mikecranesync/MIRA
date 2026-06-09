"""Pick-and-place depalletizer archetype — vacuum-head layer-by-layer infeed."""
from __future__ import annotations

from simlab.models import TagCategory, TagDef, ValueType


def pick_place_depalletizer_tags() -> dict[str, TagDef]:
    """Return tag dict for a pick-and-place depalletizer PLC program archetype."""
    from simlab.baselines import packml_status_tags

    tags = packml_status_tags()
    tags.update(
        {
            "pallet_present": TagDef(
                name="pallet_present",
                category=TagCategory.STATUS,
                value_type=ValueType.BOOL,
                default=True,
                description="True when a pallet load is present at the infeed station.",
            ),
            "layer_count": TagDef(
                name="layer_count",
                category=TagCategory.PRODUCTION,
                value_type=ValueType.INT,
                default=8,
                description="Remaining bottle layers on the current pallet.",
            ),
            "bottle_outfeed_rate": TagDef(
                name="bottle_outfeed_rate",
                category=TagCategory.PROCESS,
                value_type=ValueType.INT,
                default=120,
                unit="bpm",
                description="Measured outfeed bottle rate.",
            ),
            "vacuum_pressure": TagDef(
                name="vacuum_pressure",
                category=TagCategory.PROCESS,
                value_type=ValueType.FLOAT,
                default=22.0,
                unit="inHg",
                description="Vacuum head suction pressure during pick cycle.",
            ),
            "jam_detected": TagDef(
                name="jam_detected",
                category=TagCategory.STATUS,
                value_type=ValueType.BOOL,
                default=False,
                description="True when a bottle jam is detected on the outfeed.",
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
