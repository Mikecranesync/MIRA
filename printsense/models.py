"""PrintSynth -- the typed, evidence-backed representation of one electrical print package.

Pydantic v2 models. Every human-readable claim in a PrintSense answer must be reproducible from this
model; every fact carries its source ``sheet``, ``evidence``, ``confidence`` and ``trust`` state.
Export the JSON Schema (Draft 2020-12) with ``PrintSynthGraph.model_json_schema()``.

The shape is derived from the SCU2 gold package (``fixtures/scu2/graph.json``). ``extra="allow"`` on
every model tolerates the richer per-item detail the interpreter emits without silently dropping it --
the fields declared here are the *guaranteed* contract; anything extra is preserved.
"""

from __future__ import annotations

import json
from enum import Enum
from pathlib import Path
from typing import ClassVar

from pydantic import BaseModel, ConfigDict, Field

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


class TrustState(str, Enum):
    """The 3-state trust gate (+ ``unresolved``).

    ``proposed`` (vision/LLM) cannot drive deterministic answers unqualified. Promotion is
    ``proposed -> machine_verified`` (deterministic replay + independent agreement + cross-checks)
    ``-> human_verified`` (a qualified technician -- the verifier of record -- approves/corrects).
    ``unresolved`` is unreadable/contradictory and is *never* promoted by plausibility.
    """

    proposed = "proposed"
    machine_verified = "machine_verified"
    human_verified = "human_verified"
    unresolved = "unresolved"


class Entity(BaseModel):
    """A single typed electrical object or relationship: one visible/inferred fact with evidence.

    Shared shape for ``devices``, ``terminals``, ``conductors``, ``cables``, ``contacts``,
    ``power_domains``, ``pe_bonds``, ``off_page_references``, ``plc_io_channels`` and ``network_links``.
    """

    model_config = ConfigDict(extra="allow")

    tag: str = Field(description="exact visible designation, or 'UNREADABLE'")
    type: str | None = None
    detail: str | None = None
    connects: list[str] = Field(default_factory=list)
    evidence: str | None = Field(
        default=None, description="the on-sheet text/region supporting this fact"
    )
    confidence: float | None = None
    trust: TrustState = TrustState.proposed
    sheet: str | int | None = None


class FunctionalPath(BaseModel):
    """An ordered operating/energy path across the graph (e.g. F2 -> S10 -> S11 -> X1 -> E1)."""

    model_config = ConfigDict(extra="allow")

    name: str
    sheet: str | int | None = None
    sequence: list[str] = Field(default_factory=list)


class PhysicalMatch(BaseModel):
    """A schematic<->physical-layout correlation.

    A form-factor resemblance is only a *candidate*; a certain match needs a readable tag or another
    strong corroborating relation.
    """

    model_config = ConfigDict(extra="allow")

    layout_feature: str
    candidate_schematic_device: str | None = None
    basis: str | None = None
    confidence: float | None = None
    trust: TrustState = TrustState.proposed
    status: str | None = None
    needed_to_confirm: str | None = None


class Unresolved(BaseModel):
    """An unreadable/contradictory observation kept explicit -- never promoted by plausibility."""

    model_config = ConfigDict(extra="allow")

    item: str
    status: str | None = None
    resolution: str | None = None


class PrintSynthGraph(BaseModel):
    """The typed representation of one print package (one cabinet's multi-sheet drawing set)."""

    model_config = ConfigDict(extra="allow")

    package: dict = Field(
        default_factory=dict, description="drawing no, cabinet, sheet list, unit chain"
    )
    devices: list[Entity] = Field(default_factory=list)
    terminals: list[Entity] = Field(default_factory=list)
    conductors: list[Entity] = Field(default_factory=list)
    cables: list[Entity] = Field(default_factory=list)
    contacts: list[Entity] = Field(default_factory=list)
    power_domains: list[Entity] = Field(default_factory=list)
    pe_bonds: list[Entity] = Field(default_factory=list)
    off_page_references: list[Entity] = Field(default_factory=list)
    plc_io_channels: list[Entity] = Field(default_factory=list)
    network_links: list[Entity] = Field(default_factory=list)
    functional_paths: list[FunctionalPath] = Field(default_factory=list)
    physical_layout_matches: list[PhysicalMatch] = Field(default_factory=list)
    unresolved: list[Unresolved] = Field(default_factory=list)
    cross_sheet_notes: str | None = None

    #: The sections that share the :class:`Entity` shape (used for whole-graph traversal).
    ENTITY_SECTIONS: ClassVar[tuple[str, ...]] = (
        "devices",
        "terminals",
        "conductors",
        "cables",
        "contacts",
        "power_domains",
        "pe_bonds",
        "off_page_references",
        "plc_io_channels",
        "network_links",
    )

    def all_entities(self) -> list[Entity]:
        """Every :class:`Entity` across the graph, in section order."""
        out: list[Entity] = []
        for name in self.ENTITY_SECTIONS:
            out.extend(getattr(self, name))
        return out

    def find(self, tag_substr: str) -> list[Entity]:
        """All entities whose ``tag`` contains ``tag_substr`` (case-insensitive)."""
        key = tag_substr.lower()
        return [e for e in self.all_entities() if key in e.tag.lower()]


def load_package(name: str) -> PrintSynthGraph:
    """Load and validate a package's PrintSynth graph from ``fixtures/<name>/graph.json``."""
    path = FIXTURES_DIR / name / "graph.json"
    return PrintSynthGraph.model_validate(json.loads(path.read_text(encoding="utf-8")))
