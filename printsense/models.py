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


class KeySignal(BaseModel):
    """One important signal on the sheet, in plain English WITH its exact code preserved.

    The default reply shows ``signal`` (plain); the on-request map shows the exact
    ``tag`` / ``terminal`` / ``destination``. This is how a cryptic designation is
    translated without losing it.
    """

    model_config = ConfigDict(extra="allow")

    signal: str = Field(
        description="Plain-English meaning of this signal (e.g. 'Sensor Unit 7 broken')."
    )
    tag: str | None = Field(default=None, description="Exact printed code, e.g. 'LOK3'.")
    terminal: str | None = Field(default=None, description="Exact terminal, e.g. '-X4:4'.")
    destination: str | None = Field(
        default=None,
        description=(
            "The EXACT visible destination / continuation, e.g. 'DA5 controller (sheet 10.2)'. "
            "Use the real target — NEVER a vague word like 'external'. Null only if truly not shown."
        ),
    )
    confidence: float | None = Field(default=None, description="0-1 confidence in this reading.")


class KeyDevice(BaseModel):
    """One device on the sheet, plain role WITH its exact tag preserved."""

    model_config = ConfigDict(extra="allow")

    device: str = Field(description="Plain-English role (e.g. 'fiber-optic opto-coupler module').")
    tag: str | None = Field(default=None, description="Exact designation, e.g. '-21/A13'.")
    confidence: float | None = Field(default=None, description="0-1 confidence in this reading.")


class TechnicianBrief(BaseModel):
    """Typed, evidence-backed, plain-English presentation of the print for a technician.

    The one grounded object the interpreter emits ALONGSIDE the typed graph (same
    call — no second request). Every sentence must map to something actually read
    (extracted evidence) or be an explicitly-labelled inference; it NEVER invents
    function, a destination, or a voltage. The render layer leads with this so a
    tech reads plain English understandable WITHOUT decoding IEC tags; the exact
    designations remain in the graph + the on-request "map".
    """

    model_config = ConfigDict(extra="allow")

    sheet_title: str | None = Field(
        default=None,
        description=(
            "One plain sentence naming what this sheet/print IS — the equipment or circuit it "
            "documents, in a technician's words (e.g. 'the signal-output terminal strip of the "
            "sensor-monitoring panel'). Include the sheet number if known. Not a bare designation."
        ),
    )
    purpose: str | None = Field(
        default=None,
        description=(
            "2-5 plain sentences: what the circuit/sheet DOES and how it works, translating "
            "cryptic designations into their function. Understandable when read aloud, without "
            "decoding IEC tags. No tag-walls."
        ),
    )
    key_signals: list[KeySignal] = Field(
        default_factory=list,
        description=(
            "The COMPLETE list of important signals shown on the sheet — every one, not a "
            "sample. Include indicator/status signals too (e.g. status LEDs such as RUN/FAULT/"
            "COMM/ENET), not just wired I/O — anything a technician would look at. Each in plain "
            "English (`signal`) with its exact `tag`/`terminal`/`destination` preserved. Name the "
            "REAL destination (e.g. 'DA5 controller'), never 'external'."
        ),
    )
    key_devices: list[KeyDevice] = Field(
        default_factory=list,
        description="The important devices on the sheet, plain role + exact tag. Complete, not a sample.",
    )
    troubleshooting_example: str | None = Field(
        default=None,
        description=(
            "ONE complete, grounded troubleshooting example: name the SOURCE terminal and the "
            "DESTINATION / cross-reference when visible. The device-vs-wiring test must be "
            "DISCRIMINATING — name TWO distinct measurement points and what each result means "
            "(e.g. 'if terminal X reads open it's the device; if X is good but nothing shows at Y, "
            "it's the cable between them'). A symptom that looks identical for both faults is not "
            "enough. NEVER claim what the PLC/controller does in response unless the control logic "
            "is actually on this sheet — if it isn't, say so."
        ),
    )
    safety_context: str | None = Field(
        default=None,
        description=(
            "Measurement-specific safety guidance. State a specific VOLTAGE only when it is "
            "visibly printed on the sheet or in the graph — NEVER infer voltage from general "
            "knowledge; if the level isn't shown, say the drawing doesn't establish it. Match the "
            "measurement: continuity/resistance -> de-energize, lock out, verify absence of "
            "voltage; voltage testing -> follow energized-work procedures with appropriately "
            "rated equipment; unclear circuit state -> state the drawing does not prove present "
            "field conditions. Do NOT default to 'de-energize before metering' for every case."
        ),
    )
    unresolved_items: list[str] = Field(
        default_factory=list,
        description=(
            "What could NOT be read and why it matters (blurred tags, ambiguous digits, "
            "off-page targets not legible). Never replace an unresolved value with a likely one."
        ),
    )
    detailed_map_available: bool = Field(
        default=True,
        description="True — the exact tag/terminal/wire list is available on request ('map').",
    )


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
    brief: TechnicianBrief | None = Field(
        default=None,
        description=(
            "A typed, evidence-backed technician brief grounded ONLY in what you read on this "
            "print: sheet_title, purpose, the COMPLETE key_signals and key_devices (translated to "
            "plain English with exact tags/terminals/destinations preserved), one grounded "
            "troubleshooting_example, measurement-specific safety_context (never invent a voltage), "
            "and unresolved_items. Every sentence maps to extracted evidence or is a labelled "
            "inference; never invent function or a destination. This human-first summary renders "
            "BEFORE the tag detail, so always fill it."
        ),
    )

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
