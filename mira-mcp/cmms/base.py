"""Abstract base class for CMMS integrations.

All CMMS adapters implement this interface. The factory in factory.py
selects the concrete adapter based on CMMS_PROVIDER env var.
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class CMMSAdapter(ABC):
    """Abstract base for CMMS integrations.

    Every method returns a dict or list[dict] and never raises on API errors.
    Errors are returned as {"error": "description"} for graceful degradation.
    """

    @property
    @abstractmethod
    def configured(self) -> bool:
        """True when all required credentials/config are present."""

    @abstractmethod
    async def health_check(self) -> dict:
        """Check CMMS API availability."""

    @abstractmethod
    async def list_work_orders(self, status: str = "", limit: int = 20) -> list[dict]:
        """List work orders, optionally filtered by status."""

    @abstractmethod
    async def create_work_order(
        self,
        title: str,
        description: str,
        priority: str = "MEDIUM",
        asset_id: str | None = None,
        category: str = "CORRECTIVE",
    ) -> dict:
        """Create a work order from diagnostic findings."""

    @abstractmethod
    async def complete_work_order(self, work_order_id: str, feedback: str = "") -> dict:
        """Mark a work order as complete."""

    @abstractmethod
    async def list_assets(self, limit: int = 50) -> list[dict]:
        """List equipment assets."""

    @abstractmethod
    async def get_asset(self, asset_id: str) -> dict:
        """Get a single asset by ID."""

    @abstractmethod
    async def list_pm_schedules(self, asset_id: str | None = None, limit: int = 20) -> list[dict]:
        """List preventive maintenance schedules."""

    @abstractmethod
    async def create_asset(
        self,
        name: str,
        description: str,
        manufacturer: str = "",
        model: str = "",
        serial: str = "",
        **kwargs: object,
    ) -> dict:
        """Create an equipment asset from nameplate data."""
