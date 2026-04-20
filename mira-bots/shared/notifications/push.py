"""MIRA push notifications via ntfy.sh — zero cost, zero API key."""
from __future__ import annotations

import logging
import os

import httpx

logger = logging.getLogger("mira-gsd")

NTFY_BASE_URL = os.getenv("NTFY_URL", "https://ntfy.sh")
NTFY_TOPIC = os.getenv("NTFY_TOPIC", "mira-factorylm-alerts")


async def send_push(
    message: str,
    title: str = "MIRA Alert",
    priority: str = "default",
    tags: list[str] | None = None,
    click_url: str | None = None,
) -> bool:
    """Send a push notification via ntfy.sh. Never raises."""
    headers: dict[str, str] = {"Title": title, "Priority": priority}
    if tags:
        headers["Tags"] = ",".join(tags)
    if click_url:
        headers["Click"] = click_url

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{NTFY_BASE_URL}/{NTFY_TOPIC}",
                content=message,
                headers=headers,
            )
            resp.raise_for_status()
            logger.info("PUSH_SENT topic=%s priority=%s title=%r", NTFY_TOPIC, priority, title)
            return True
    except Exception as e:
        logger.warning("PUSH_FAILED topic=%s error=%s", NTFY_TOPIC, str(e)[:200])
        return False


async def push_safety_alert(asset: str, message: str) -> bool:
    return await send_push(
        message=f"SAFETY: {message}\nAsset: {asset}",
        title="MIRA SAFETY STOP",
        priority="urgent",
        tags=["rotating_light", "stop_sign"],
        click_url="https://app.factorylm.com",
    )


async def push_diagnostic_started(tech_name: str, asset: str) -> bool:
    return await send_push(
        message=f"{tech_name} is diagnosing {asset}",
        title="Diagnostic In Progress",
        priority="low",
        tags=["wrench"],
        click_url="https://app.factorylm.com",
    )


async def push_wo_created(wo_id: str, asset: str, tech_name: str) -> bool:
    return await send_push(
        message=f"Work order {wo_id} created for {asset} by {tech_name}",
        title="Work Order Logged",
        priority="default",
        tags=["clipboard", "white_check_mark"],
        click_url="https://cmms.factorylm.com",
    )


async def push_equipment_online(asset: str) -> bool:
    return await send_push(
        message=f"{asset} is back online",
        title="Equipment Restored",
        priority="low",
        tags=["green_circle", "tada"],
    )


async def push_fault_unresolved(asset: str, minutes: int) -> bool:
    return await send_push(
        message=f"{asset} has been down for {minutes} minutes. Intervention may be needed.",
        title="Unresolved Fault",
        priority="high",
        tags=["warning", "clock3"],
        click_url="https://app.factorylm.com",
    )
