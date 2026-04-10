"""CMMS adapter factory — selects the right adapter based on CMMS_PROVIDER env var."""

from __future__ import annotations

import logging
import os

from cmms.base import CMMSAdapter

logger = logging.getLogger("mira-cmms")


def create_cmms_adapter(provider: str | None = None) -> CMMSAdapter | None:
    """Create a CMMS adapter based on provider name.

    Args:
        provider: One of "atlas", "maintainx", "limble", "fiix".
                  If None, reads from CMMS_PROVIDER env var.
                  If still None/empty, returns None (CMMS disabled).

    Returns:
        CMMSAdapter instance, or None if no provider configured.
    """
    provider = provider or os.getenv("CMMS_PROVIDER", "")
    if not provider:
        logger.info("No CMMS_PROVIDER set — CMMS integration disabled")
        return None

    provider = provider.lower().strip()

    match provider:
        case "atlas":
            from cmms.atlas import AtlasCMMS

            return AtlasCMMS()
        case "maintainx":
            from cmms.maintainx import MaintainXCMMS

            return MaintainXCMMS()
        case "limble":
            from cmms.limble import LimbleCMMS

            return LimbleCMMS()
        case "fiix":
            from cmms.fiix import FiixCMMS

            return FiixCMMS()
        case _:
            logger.error("Unknown CMMS_PROVIDER: %s", provider)
            return None
