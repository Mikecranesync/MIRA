"""ComponentProfile Pydantic schema — manual → structured maintenance brain.

Extraction target for `component_profiles.extractor.extract()`. Validates
LLM-produced JSON before it lands in the `component_profiles` NeonDB table.

Design rules baked into the schema:
  - Every optional fact is Optional[T] = None. Missing data must not crash.
  - Every list defaults to []. Missing data must not crash.
  - Confidence.needs_human_review auto-flips True when:
      overall < 0.7, OR any fault has severity == "critical",
      OR any safety_warnings were extracted.
  - source_documents[].copyright_handling restricted to a closed enum.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CopyrightHandling(str, Enum):
    LINK_ONLY = "link_only"
    CUSTOMER_UPLOADED = "customer_uploaded"
    LICENSED = "licensed"
    UNKNOWN = "unknown"


class Severity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class Criticality(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class DocumentType(str, Enum):
    MANUAL = "manual"
    DATASHEET = "datasheet"
    WORK_ORDER = "work_order"
    PLC_EXPORT = "plc_export"
    OTHER = "other"


class ElectricalSpecs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_voltage: Optional[str] = None
    output_voltage: Optional[str] = None
    phase: Optional[str] = None
    horsepower_range: Optional[str] = None
    current_range: Optional[str] = None
    frequency_range: Optional[str] = None


class Terminal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    terminal: str = Field(min_length=1)
    purpose: Optional[str] = None
    notes: Optional[str] = None
    page_reference: Optional[str] = None


class Parameter(BaseModel):
    model_config = ConfigDict(extra="forbid")

    parameter: str = Field(min_length=1)
    name: Optional[str] = None
    description: Optional[str] = None
    default: Optional[str] = None
    maintenance_relevance: Optional[str] = None
    page_reference: Optional[str] = None


class FaultCode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1)
    meaning: Optional[str] = None
    likely_causes: list[str] = []
    technician_steps: list[str] = []
    reset_method: Optional[str] = None
    severity: Optional[Severity] = None
    page_reference: Optional[str] = None


class PreventiveMaintenance(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task: str = Field(min_length=1)
    interval: Optional[str] = None
    tools_required: list[str] = []
    safety_notes: list[str] = []
    page_reference: Optional[str] = None


class SparePart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    part_number: Optional[str] = None
    description: Optional[str] = None
    criticality: Optional[Criticality] = None
    page_reference: Optional[str] = None


class SafetyWarning(BaseModel):
    model_config = ConfigDict(extra="forbid")

    warning: str = Field(min_length=1)
    page_reference: Optional[str] = None


class Troubleshooting(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symptom: str = Field(min_length=1)
    possible_causes: list[str] = []
    recommended_actions: list[str] = []
    page_reference: Optional[str] = None


class UnsSuggestions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset_type: Optional[str] = None
    suggested_topics: list[str] = []
    suggested_tags: list[str] = []


class SourceDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Optional[str] = None
    url: Optional[str] = None
    storage_path: Optional[str] = None
    document_type: DocumentType = DocumentType.MANUAL
    copyright_handling: CopyrightHandling = CopyrightHandling.LINK_ONLY
    page_references_used: list[str] = []


class Confidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    overall: float = Field(ge=0.0, le=1.0)
    missing_information: list[str] = []
    assumptions: list[str] = []
    needs_human_review: bool = False


class ComponentProfile(BaseModel):
    """Structured maintenance intelligence for one industrial component."""

    model_config = ConfigDict(extra="forbid")

    component_type: str = Field(min_length=1)
    manufacturer: Optional[str] = None
    series: Optional[str] = None
    model_numbers: list[str] = []
    description: Optional[str] = None
    common_applications: list[str] = []

    electrical_specs: ElectricalSpecs = Field(default_factory=ElectricalSpecs)
    terminals: list[Terminal] = []
    parameters: list[Parameter] = []
    fault_codes: list[FaultCode] = []
    preventive_maintenance: list[PreventiveMaintenance] = []
    spare_parts: list[SparePart] = []
    safety_warnings: list[SafetyWarning] = []
    troubleshooting: list[Troubleshooting] = []
    uns_suggestions: UnsSuggestions = Field(default_factory=UnsSuggestions)
    source_documents: list[SourceDocument] = []

    confidence: Confidence

    @model_validator(mode="after")
    def _set_review_flag(self) -> "ComponentProfile":
        """Auto-flip needs_human_review when safety-critical content is present."""
        has_critical_fault = any(
            f.severity == Severity.CRITICAL for f in self.fault_codes
        )
        has_safety_warning = len(self.safety_warnings) > 0
        low_confidence = self.confidence.overall < 0.7
        if has_critical_fault or has_safety_warning or low_confidence:
            self.confidence.needs_human_review = True
        return self
