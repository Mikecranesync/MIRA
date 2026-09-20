"""The detectors. Each one corresponds to an observed, photographed defect."""

from .base import Finding, Verdict, run_all
from .citation_identity import detect_citation_identity
from .groundedness_signal import detect_groundedness_signal
from .identifier_repetition import detect_identifier_repetition

__all__ = [
    "Finding",
    "Verdict",
    "run_all",
    "detect_citation_identity",
    "detect_groundedness_signal",
    "detect_identifier_repetition",
]
