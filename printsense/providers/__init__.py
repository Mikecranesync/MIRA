"""Capability-gated provider routing for PrintSense (fail closed)."""

from .registry import (  # noqa: F401
    CAPABILITIES,
    CapabilityUnavailable,
    capability_status,
    load_registry,
    reconstruction_gate,
    select_provider,
)
