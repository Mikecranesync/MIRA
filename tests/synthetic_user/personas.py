"""Synthetic user personas — expertise levels and phrasing styles.

Each persona defines how a generated question is transformed: abbreviations,
greetings, verbosity, typos, etc. Ported from FactoryLM synthetic_user_tasks.py
and adapted for MIRA's industrial maintenance domain.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Persona:
    """A synthetic user profile that shapes question phrasing."""

    id: str
    name: str
    role: str
    expertise_level: str  # apprentice | technician | senior | engineer | manager | programmer
    phrasing_style: str  # formal | terse | verbose | abbreviated | confused | casual
    uses_abbreviations: bool
    includes_context: bool  # operational context (shift, uptime, history)
    typo_probability: float  # 0.0–0.3, chance of typo per word
    greeting_prefix: str  # empty string = no greeting


PERSONAS: list[Persona] = [
    Persona(
        id="senior_tech",
        name="Ray Dalton",
        role="Senior Maintenance Tech",
        expertise_level="senior",
        phrasing_style="terse",
        uses_abbreviations=True,
        includes_context=False,
        typo_probability=0.0,
        greeting_prefix="",
    ),
    Persona(
        id="apprentice",
        name="Alex Martinez",
        role="Apprentice",
        expertise_level="apprentice",
        phrasing_style="verbose",
        uses_abbreviations=False,
        includes_context=True,
        typo_probability=0.05,
        greeting_prefix="Hi, ",
    ),
    Persona(
        id="reliability_eng",
        name="Sarah Chen",
        role="Reliability Engineer",
        expertise_level="engineer",
        phrasing_style="formal",
        uses_abbreviations=False,
        includes_context=True,
        typo_probability=0.0,
        greeting_prefix="",
    ),
    Persona(
        id="plant_operator",
        name="James Wilson",
        role="Plant Operator",
        expertise_level="technician",
        phrasing_style="casual",
        uses_abbreviations=False,
        includes_context=False,
        typo_probability=0.02,
        greeting_prefix="Hey ",
    ),
    Persona(
        id="plc_programmer",
        name="David Park",
        role="PLC Programmer",
        expertise_level="programmer",
        phrasing_style="formal",
        uses_abbreviations=False,
        includes_context=True,
        typo_probability=0.0,
        greeting_prefix="",
    ),
    Persona(
        id="night_shift",
        name="Carlos Reyes",
        role="Night Shift Tech",
        expertise_level="technician",
        phrasing_style="terse",
        uses_abbreviations=True,
        includes_context=False,
        typo_probability=0.15,
        greeting_prefix="",
    ),
]

PERSONA_MAP: dict[str, Persona] = {p.id: p for p in PERSONAS}
