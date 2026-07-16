"""Paid package-pilot operating record (commercial PR-5).

The internal template every pilot runs on. Positioning is fixed; supported
and unsupported capabilities are explicit; reconstruction claims are
structurally impossible while the capability registry keeps the gate closed.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

POSITIONING = ("PrintSense turns existing electrical prints into searchable, "
               "cited troubleshooting knowledge. It does not replace "
               "engineering review or claim complete reconstruction.")

SUPPORTED = (
    "page ordering + table of contents", "device register with page evidence",
    "terminal/cable/conductor inventories", "deterministic cross-reference "
    "extraction with bounding-box evidence", "duplicate/missing/unreadable "
    "page reports", "probable subsystem clustering", "human-reviewed cited "
    "customer report", "unresolved-work queue with human confirmation")
UNSUPPORTED = (
    "autonomous full-system reconstruction (capability-gated: unqualified)",
    "PLC program logic recovery", "control writes or live-equipment actions",
    "engineering sign-off")


class ProcessingScope(BaseModel):
    pages_estimate: int = Field(ge=1)
    photo_capture_expected: bool = False
    ocr_in_container: bool = True
    review_hours_estimate: float = Field(ge=0.5)


class Pricing(BaseModel):
    intro_price_usd: float | None = None
    currency: str = "USD"
    billing_notes: str = "introductory pilot pricing — set per deal"


class PilotPackage(BaseModel):
    customer: str
    machine: str
    positioning: str = POSITIONING
    deliverables: list[str] = Field(default_factory=lambda: list(SUPPORTED))
    customer_prerequisites: list[str] = Field(default_factory=lambda: [
        "complete print package (PDF preferred; bound-book photos accepted)",
        "named technician contact for confirmation questions",
        "written authorization to process the documents",
    ])
    supported_capabilities: list[str] = Field(
        default_factory=lambda: list(SUPPORTED))
    unsupported_capabilities: list[str] = Field(
        default_factory=lambda: list(UNSUPPORTED))
    security_retention: str = ("tenant-isolated content-addressed storage; "
                               "hash-only logs; deletion on request; no "
                               "training use; local-only originals")
    review_requirements: str = ("every delivered artifact passes the human "
                                "review queue; machine originals preserved "
                                "with audit history")
    acceptance_criteria: list[str] = Field(default_factory=lambda: [
        "technician answers a real troubleshooting question from the report",
        "every claim carries page-level evidence",
        "unresolved items are explicitly listed, not hidden",
    ])
    processing_scope: ProcessingScope
    pricing: Pricing = Field(default_factory=Pricing)
    handoff_report_ref: str | None = None

    model_config = {"extra": "forbid"}

    def summary(self) -> str:
        return (f"Pilot: {self.customer} / {self.machine} — "
                f"~{self.processing_scope.pages_estimate} pages, "
                f"review ≥{self.processing_scope.review_hours_estimate}h. "
                f"{self.positioning}")
