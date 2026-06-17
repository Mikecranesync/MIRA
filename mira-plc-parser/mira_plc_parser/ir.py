"""MIRA PLC Intermediate Representation (IR) -- the neutral model every parser targets.

This is the heart of the PLC Parser Project. Different vendors store logic differently (Rockwell
L5X, Siemens TIA XML, PLCopen XML, CODESYS/OpenPLC ST, AutomationDirect, plain CSV tag exports,
even PDFs). Rather than teach MIRA every file format, each *parser* converts its input into THIS
structure, and all analysis runs against THIS structure.

Design rules:
  * The IR holds what is LITERALLY in the export (structural facts) -- high confidence.
  * Interpretations (interlock? mode bit? asset?) are NOT baked into the IR; they are produced by
    the analysis layer as inferred candidates with their own (medium/low) confidence. Keeping the
    IR free of guesses is what makes it trustworthy and vendor-neutral.
  * Every node may carry Provenance (where it came from + how confident) so a reviewer can trace
    any downstream claim back to a file location.

Read-only by construction: nothing here writes to a PLC; this is an analysis model only.
Python 3.12, dataclasses, type hints. (Cloud-side -- not the Jython gateway, so modern style.)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class Confidence(str, Enum):
    """How much to trust an extracted/inferred fact (Mike's grading scale)."""
    HIGH = "high"        # structured extract from L5X / XML
    MEDIUM = "medium"    # inferred from names, comments, repeated usage
    LOW = "low"          # OCR from PDF / screenshot
    REVIEW = "review"    # human review REQUIRED (safety / e-stop / bypass / motion / guarding)


class RoutineType(str, Enum):
    RLL = "RLL"          # relay ladder logic
    ST = "ST"            # structured text
    FBD = "FBD"          # function block diagram
    SFC = "SFC"          # sequential function chart
    UNKNOWN = "unknown"


class TagScope(str, Enum):
    CONTROLLER = "controller"
    PROGRAM = "program"
    AOI_PARAMETER = "aoi_parameter"
    AOI_LOCAL = "aoi_local"


@dataclass
class Provenance:
    """Where a node came from, and how confident the extraction is."""
    source_file: str = ""
    source_format: str = ""     # e.g. "rockwell_l5x", "csv", "plcopen_xml"
    locator: str = ""           # xpath / rung number / csv row -- enough to find it again
    confidence: Confidence = Confidence.HIGH


@dataclass
class DataTypeMember:
    name: str
    data_type: str = ""
    description: str = ""


@dataclass
class DataType:
    """A user-defined type (UDT) or struct referenced by tags."""
    name: str
    members: list[DataTypeMember] = field(default_factory=list)
    description: str = ""
    provenance: Provenance | None = None


@dataclass
class Tag:
    """A controller- or program-scoped tag. `roles` are inferred later, not at parse time."""
    name: str
    data_type: str = ""
    scope: str = TagScope.CONTROLLER.value
    description: str = ""
    address: str = ""           # physical / IO address when known
    alias_for: str = ""         # if this is an alias tag, its target
    external_access: str = ""   # Read/Write, Read Only, None
    radix: str = ""             # Decimal, Float, Binary, ...
    initial_value: str = ""
    unit: str = ""              # engineering unit when a CSV/XML carries one
    usage: list[str] = field(default_factory=list)   # locators where the tag is referenced
    roles: list[str] = field(default_factory=list)    # inferred (analysis fills this)
    provenance: Provenance | None = None

    @property
    def is_alias(self) -> bool:
        return bool(self.alias_for)


@dataclass
class Rung:
    """One ladder rung. `text` is the vendor-neutral rung text; refs/outputs are extracted from it."""
    number: int
    text: str = ""
    comment: str = ""
    refs: list[str] = field(default_factory=list)     # every tag referenced in the rung
    outputs: list[str] = field(default_factory=list)  # tags energized by output instructions
    instructions: list[str] = field(default_factory=list)  # instruction mnemonics seen (XIC, OTE,...)
    provenance: Provenance | None = None


@dataclass
class Routine:
    name: str
    type: str = RoutineType.RLL.value
    description: str = ""
    rungs: list[Rung] = field(default_factory=list)
    st_text: str = ""           # populated for ST routines
    provenance: Provenance | None = None


@dataclass
class Program:
    name: str
    description: str = ""
    main_routine: str = ""
    routines: list[Routine] = field(default_factory=list)
    tags: list[Tag] = field(default_factory=list)   # program-scoped tags


@dataclass
class ModulePort:
    id: str = ""
    address: str = ""
    type: str = ""
    upstream: bool = False


@dataclass
class ModuleDefinition:
    """A Rockwell I/O module — physical hardware in the chassis or on an EtherNet/IP network."""
    name: str
    catalog_number: str = ""
    vendor: str = ""
    product_type: str = ""
    product_code: str = ""
    major: str = ""
    minor: str = ""
    parent_module: str = ""
    parent_port: str = ""
    inhibited: bool = False
    ports: list[ModulePort] = field(default_factory=list)
    provenance: Provenance | None = None


@dataclass
class AOIDefinition:
    """A Rockwell Add-On Instruction definition — a reusable function block."""
    name: str
    revision: str = ""
    description: str = ""
    parameters: list[Tag] = field(default_factory=list)   # interface tags (Input/Output/InOut)
    local_tags: list[Tag] = field(default_factory=list)   # internal state tags
    routines: list[Routine] = field(default_factory=list)
    provenance: Provenance | None = None


@dataclass
class Controller:
    name: str = ""
    processor_type: str = ""
    vendor: str = ""
    software: str = ""          # e.g. "RSLogix 5000 v34.00"
    tags: list[Tag] = field(default_factory=list)   # controller-scoped tags
    programs: list[Program] = field(default_factory=list)
    datatypes: list[DataType] = field(default_factory=list)
    aoi_definitions: list[AOIDefinition] = field(default_factory=list)
    module_definitions: list[ModuleDefinition] = field(default_factory=list)
    provenance: Provenance | None = None


@dataclass
class PLCProject:
    """Top of the IR. One parsed export package (may carry >1 controller in theory; usually one)."""
    controllers: list[Controller] = field(default_factory=list)
    source_format: str = ""
    source_files: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    # ---- convenience accessors used by the analysis layer ----
    def all_tags(self) -> list[Tag]:
        out: list[Tag] = []
        for c in self.controllers:
            out.extend(c.tags)
            for p in c.programs:
                out.extend(p.tags)
        return out

    def all_routines(self) -> list[tuple[str, Routine]]:
        """(program_name, routine) pairs across every controller/program and AOI definition."""
        out: list[tuple[str, Routine]] = []
        for c in self.controllers:
            for p in c.programs:
                for r in p.routines:
                    out.append((p.name, r))
            for aoi in c.aoi_definitions:
                for r in aoi.routines:
                    out.append((aoi.name, r))
        return out

    def all_rungs(self) -> list[tuple[str, str, Rung]]:
        """(program_name, routine_name, rung) across the whole project."""
        out: list[tuple[str, str, Rung]] = []
        for prog_name, r in self.all_routines():
            for rung in r.rungs:
                out.append((prog_name, r.name, rung))
        return out
