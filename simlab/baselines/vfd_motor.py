"""VFD motor archetype — generic variable-frequency drive + motor assembly."""
from __future__ import annotations

from simlab.models import TagCategory, TagDef, ValueType


def vfd_motor_tags() -> dict[str, TagDef]:
    """Return tag dict for a VFD-driven motor archetype.

    Intended as a composable sub-set — call sites merge these into a larger
    asset tag dict when the asset includes a significant drive motor.
    """
    return {
        "vfd_speed_hz": TagDef(
            name="vfd_speed_hz",
            category=TagCategory.MOTOR,
            value_type=ValueType.FLOAT,
            default=45.0,
            unit="Hz",
            description="VFD output frequency.",
        ),
        "motor_current_amps": TagDef(
            name="motor_current_amps",
            category=TagCategory.MOTOR,
            value_type=ValueType.FLOAT,
            default=8.0,
            unit="A",
            description="Motor stator current draw.",
        ),
        "motor_temp_c": TagDef(
            name="motor_temp_c",
            category=TagCategory.MOTOR,
            value_type=ValueType.FLOAT,
            default=45.0,
            unit="°C",
            description="Motor winding temperature (NTC sensor).",
        ),
        "vfd_fault_code": TagDef(
            name="vfd_fault_code",
            category=TagCategory.FAULTS,
            value_type=ValueType.STRING,
            default="",
            description="Active VFD fault code (empty = no fault).",
        ),
    }
