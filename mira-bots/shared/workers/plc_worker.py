"""PLC Worker — Stub for future live PLC data queries."""

import logging

logger = logging.getLogger("mira-gsd")


class PLCWorker:
    """Stub worker for PLC data integration.

    Will connect to Micro820 via EtherNet/IP or Modbus TCP
    once the live PLC connection is established.
    """

    async def process(self, message: str, state: dict) -> str:
        """Return a stub response until PLC integration is live."""
        logger.info("LLM_CALL worker=plc (stub)")
        return (
            "Live PLC data is not connected yet. "
            "I can still help you diagnose issues from photos, "
            "fault codes, or equipment manuals. What do you need?"
        )
