"""Typed errors for the Fleet Gateway control plane."""

from __future__ import annotations


class FleetGatewayError(Exception):
    """Base error. ``http_status`` drives the HTTP surface."""

    http_status = 400


class AuthenticationError(FleetGatewayError):
    http_status = 401


class DeniedToolError(FleetGatewayError):
    """Hard-deny list: the tool does not exist on this gateway."""

    http_status = 403


class ContractViolation(FleetGatewayError):
    """Locked-contract rejection (role, required fields, Charlie-only, …)."""

    http_status = 400


class NotFoundError(FleetGatewayError):
    http_status = 404


class CaoConfigError(FleetGatewayError):
    """CAO adapter refused a non-loopback or credentialed URL."""

    http_status = 500
