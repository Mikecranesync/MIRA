"""Component profile schema + LLM extractor.

A ComponentProfile is a structured representation of a single industrial
component (VFD, sensor, contactor, etc.) extracted from one or more vendor
manuals. Stored in NeonDB table `component_profiles`. Distinct from
sm_profiles.SmProfile, which models equipment state, not maintenance docs.
"""

from .schema import (
    ComponentProfile,
    Confidence,
    CopyrightHandling,
    ElectricalSpecs,
    FaultCode,
    Parameter,
    PreventiveMaintenance,
    SafetyWarning,
    SourceDocument,
    SparePart,
    Terminal,
    Troubleshooting,
    UnsSuggestions,
)

__all__ = [
    "ComponentProfile",
    "Confidence",
    "CopyrightHandling",
    "ElectricalSpecs",
    "FaultCode",
    "Parameter",
    "PreventiveMaintenance",
    "SafetyWarning",
    "SourceDocument",
    "SparePart",
    "Terminal",
    "Troubleshooting",
    "UnsSuggestions",
]
