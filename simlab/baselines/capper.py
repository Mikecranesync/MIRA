"""Capper archetype — rotary or inline bottle capping machine."""
from __future__ import annotations

from simlab.models import TagCategory, TagDef, ValueType


def capper_tags() -> dict[str, TagDef]:
    """Return tag dict for a capper PLC program archetype."""
    from simlab.baselines import packml_status_tags

    tags = packml_status_tags()
    tags.update(
        {
            "cap_present": TagDef(
                name="cap_present",
                category=TagCategory.STATUS,
                value_type=ValueType.BOOL,
                default=True,
                description="Cap chute feed sensor — True when cap supply is present.",
            ),
            "cap_torque_inlb": TagDef(
                name="cap_torque_inlb",
                category=TagCategory.PROCESS,
                value_type=ValueType.FLOAT,
                default=8.5,
                unit="in-lb",
                description="Measured cap application torque.",
            ),
            "cap_torque_target": TagDef(
                name="cap_torque_target",
                category=TagCategory.PROCESS,
                value_type=ValueType.FLOAT,
                default=8.5,
                unit="in-lb",
                description="Target cap torque setpoint.",
                writable=True,
            ),
            "cap_torque_variance": TagDef(
                name="cap_torque_variance",
                category=TagCategory.PROCESS,
                value_type=ValueType.FLOAT,
                default=0.0,
                unit="in-lb",
                description="Torque std-dev over last 10 caps.",
            ),
            "cap_chute_level": TagDef(
                name="cap_chute_level",
                category=TagCategory.STATUS,
                value_type=ValueType.FLOAT,
                default=80.0,
                unit="%",
                description="Cap chute fill level percentage.",
            ),
            "reject_count": TagDef(
                name="reject_count",
                category=TagCategory.QUALITY,
                value_type=ValueType.INT,
                default=0,
                description="Cumulative cap reject count.",
            ),
            "jam_detected": TagDef(
                name="jam_detected",
                category=TagCategory.STATUS,
                value_type=ValueType.BOOL,
                default=False,
                description="True when a jam is detected in the cap chute or infeed.",
            ),
            "motor_current_amps": TagDef(
                name="motor_current_amps",
                category=TagCategory.MOTOR,
                value_type=ValueType.FLOAT,
                default=4.0,
                unit="A",
                description="Capper drive motor current.",
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
