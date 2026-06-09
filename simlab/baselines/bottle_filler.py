"""Bottle filler archetype — rotary volumetric/gravity fill machine."""
from __future__ import annotations

from simlab.models import TagCategory, TagDef, ValueType


def bottle_filler_tags() -> dict[str, TagDef]:
    """Return tag dict for a rotary bottle-filler PLC program archetype.

    Merges PackML run_state + filler-specific process tags.
    """
    from simlab.baselines import packml_status_tags

    tags = packml_status_tags()
    tags.update(
        {
            "bottles_per_minute": TagDef(
                name="bottles_per_minute",
                category=TagCategory.PROCESS,
                value_type=ValueType.INT,
                default=0,
                unit="bpm",
                description="Actual bottle throughput rate.",
            ),
            "fill_level_oz": TagDef(
                name="fill_level_oz",
                category=TagCategory.PROCESS,
                value_type=ValueType.FLOAT,
                default=16.0,
                unit="oz",
                description="Mean fill volume of last cycle.",
            ),
            "fill_level_target_oz": TagDef(
                name="fill_level_target_oz",
                category=TagCategory.PROCESS,
                value_type=ValueType.FLOAT,
                default=16.0,
                unit="oz",
                description="Target fill setpoint.",
                writable=True,
            ),
            "fill_level_variance": TagDef(
                name="fill_level_variance",
                category=TagCategory.PROCESS,
                value_type=ValueType.FLOAT,
                default=0.0,
                unit="oz",
                description="Std-dev of fill volume over last 10 fills.",
            ),
            "tank_level_percent": TagDef(
                name="tank_level_percent",
                category=TagCategory.PROCESS,
                value_type=ValueType.FLOAT,
                default=75.0,
                unit="%",
                description="Product supply tank level.",
            ),
            "product_temperature": TagDef(
                name="product_temperature",
                category=TagCategory.PROCESS,
                value_type=ValueType.FLOAT,
                default=38.0,
                unit="°F",
                description="Product temperature in the filler bowl.",
            ),
            "filler_bowl_pressure": TagDef(
                name="filler_bowl_pressure",
                category=TagCategory.PROCESS,
                value_type=ValueType.FLOAT,
                default=12.0,
                unit="psi",
                description="Filler bowl air/product pressure.",
            ),
            "nozzle_fault_count": TagDef(
                name="nozzle_fault_count",
                category=TagCategory.FAULTS,
                value_type=ValueType.INT,
                default=0,
                description="Cumulative nozzle no-flow faults since last reset.",
            ),
            "underfill_reject_count": TagDef(
                name="underfill_reject_count",
                category=TagCategory.QUALITY,
                value_type=ValueType.INT,
                default=0,
                description="Cumulative underfill rejects.",
            ),
            "overfill_reject_count": TagDef(
                name="overfill_reject_count",
                category=TagCategory.QUALITY,
                value_type=ValueType.INT,
                default=0,
                description="Cumulative overfill rejects.",
            ),
            "vfd_speed_hz": TagDef(
                name="vfd_speed_hz",
                category=TagCategory.MOTOR,
                value_type=ValueType.FLOAT,
                default=45.0,
                unit="Hz",
                description="Filler carousel VFD output frequency.",
            ),
            "motor_current_amps": TagDef(
                name="motor_current_amps",
                category=TagCategory.MOTOR,
                value_type=ValueType.FLOAT,
                default=8.5,
                unit="A",
                description="Filler drive motor current draw.",
            ),
            "fault_code": TagDef(
                name="fault_code",
                category=TagCategory.FAULTS,
                value_type=ValueType.STRING,
                default="",
                description="Active fault code string (empty = no fault).",
            ),
        }
    )
    return tags
