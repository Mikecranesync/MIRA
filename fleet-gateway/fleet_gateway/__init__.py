"""FactoryLM Fleet Gateway MCP v1 — public control plane, private/loopback CAO.

Grok/Foreman talks only to this gateway. CAO stays on 127.0.0.1 behind an
interface and is never bound to a public address in this package. Public
exposure of CAO (tunnel/VPS) is a later Mike-approved step, not this PR.
"""

from __future__ import annotations

FLEET_GATEWAY_VERSION = "1.1.0"

__all__ = ["FLEET_GATEWAY_VERSION"]
