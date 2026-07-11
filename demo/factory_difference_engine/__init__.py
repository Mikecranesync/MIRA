"""Factory Difference Engine — the Prove-It 2027 demo (Connect→Pick→Prove→Explain→Learn).

Reuse-only orchestration over SimLab + the difference engine + the ADR-0017
proposal state machine. Offline + deterministic by default. See README.md.
"""
from .pipeline import run_pipeline

__all__ = ["run_pipeline"]
