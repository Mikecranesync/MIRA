"""Effective capabilities: what a session may claim is bounded by its node's inventory."""

from __future__ import annotations


class CapabilityNotOnNode(ValueError):
    """A session claimed a capability its node does not have (e.g. `adb` on travel)."""


def effective_capabilities(session_caps: list[str], node_caps: list[str]) -> list[str]:
    """The session's capabilities, validated as a subset of the node's inventory
    (deployment/network.yml `peer_network.capabilities`). A session can be LESS equipped than its
    node (no Bash tool) — never more. Raises CapabilityNotOnNode naming the offending entries."""
    extra = sorted(set(session_caps) - set(node_caps))
    if extra:
        raise CapabilityNotOnNode(f"not in node inventory: {extra}")
    return sorted(set(session_caps))
