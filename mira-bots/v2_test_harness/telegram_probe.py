"""
telegram_probe.py — Tests Supervisor path (10 cases). Advisory only, never blocks release.
Graceful degradation: Telethon → Supervisor direct → skipped.
"""
import asyncio
import base64
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

_HERE = Path(__file__).parent
_MIRA_BOTS = _HERE.parent


@dataclass
class ProbeResult:
    results: list[dict] = field(default_factory=list)
    path_used: str = "skipped"      # "telethon" | "supervisor_direct" | "skipped"
    skipped: bool = False
    skip_reason: str = ""


async def probe_cases(cases_10: list[dict], artifacts_dir: str) -> ProbeResult:
    """Run 10 probe cases. Never raises — all exceptions → ProbeResult(skipped=True)."""
    try:
        session_path = _check_telethon_session()
        if session_path:
            return await _probe_via_telethon(session_path, cases_10)

        # Try Supervisor direct
        if str(_MIRA_BOTS) not in sys.path:
            sys.path.insert(0, str(_MIRA_BOTS))
        try:
            from shared.engine import Supervisor  # noqa: F401
        except ImportError as e:
            return ProbeResult(skipped=True, skip_reason=f"Supervisor import failed: {e}")

        webui_url = os.getenv("PROBE_OPENWEBUI_URL",
            os.environ.get("MIRA_SERVER_BASE_URL", "http://localhost") + ":3000")
        reachable = await _check_webui_reachable(webui_url)
        if not reachable:
            return ProbeResult(skipped=True, skip_reason=f"OpenWebUI not reachable at {webui_url}")

        return await _probe_via_supervisor(cases_10)

    except Exception as exc:
        return ProbeResult(skipped=True, skip_reason=f"Unexpected error: {exc}")


def _select_probe_cases(manifest: list[dict]) -> list[dict]:
    """Pick first 2 cases from each of 5 target categories = 10 total."""
    target_cats = ["VFD_FAULT", "PLC_FAULT", "MOTOR_FAULT", "PANEL_FAULT", "SENSOR_FAULT"]
    selected = []
    for cat in target_cats:
        count = 0
        for case in manifest:
            if case.get("expected", {}).get("fault_category") == cat:
                selected.append(case)
                count += 1
                if count >= 2:
                    break
    return selected[:10]


def _check_telethon_session() -> str | None:
    """Return session path if Telethon session file exists, else None."""
    env_path = os.getenv("TELEGRAM_TEST_SESSION_PATH", "")
    if env_path and Path(env_path).exists():
        return env_path
    # Check default locations
    for candidate in [
        Path.home() / ".mira_test.session",
        Path.home() / "Mira" / "mira-bots" / "telegram_test_runner" / "test.session",
    ]:
        if candidate.exists():
            return str(candidate)
    return None


async def _check_webui_reachable(url: str) -> bool:
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(url)
            return r.status_code < 500
    except Exception:
        return False


async def _probe_via_supervisor(cases: list[dict]) -> ProbeResult:
    """Direct Supervisor.process() calls."""
    from shared.engine import Supervisor

    db_path = f"/tmp/mira_probe_{int(time.time())}.db"
    engine = Supervisor(
        db_path=db_path,
        openwebui_url=os.getenv("PROBE_OPENWEBUI_URL",
            os.environ.get("MIRA_SERVER_BASE_URL", "http://localhost") + ":3000"),
        api_key=os.getenv("OPENWEBUI_API_KEY", ""),
        collection_id="",
        vision_model=os.getenv("VISION_MODEL", "qwen2.5vl:7b"),
    )

    results = []
    for i, case in enumerate(cases):
        img_path = Path(__file__).parent.parent / case.get("image", "")
        photo_b64 = None
        if img_path.exists():
            photo_b64 = base64.b64encode(img_path.read_bytes()).decode()
        try:
            reply = await engine.process(
                f"probe_{i}",
                case.get("caption", ""),
                photo_b64=photo_b64,
            )
        except Exception as exc:
            reply = f"ERROR: {exc}"
        results.append({
            "case": case.get("name", f"probe_{i}"),
            "reply": reply,
            "path": "supervisor_direct",
        })

    try:
        os.unlink(db_path)
    except OSError:
        pass

    return ProbeResult(results=results, path_used="supervisor_direct", skipped=False)


async def _probe_via_telethon(session_path: str, cases: list[dict]) -> ProbeResult:
    """Send cases via Telethon (real Telegram messages)."""
    try:
        from telethon import TelegramClient  # type: ignore
    except ImportError:
        return ProbeResult(skipped=True, skip_reason="telethon not installed")

    api_id = int(os.getenv("TELEGRAM_API_ID", "0"))
    api_hash = os.getenv("TELEGRAM_API_HASH", "")
    bot_username = os.getenv("TELEGRAM_BOT_USERNAME", "")

    if not api_id or not api_hash or not bot_username:
        return ProbeResult(skipped=True, skip_reason="TELEGRAM_API_ID/HASH/BOT_USERNAME not set")

    results = []
    client = TelegramClient(session_path, api_id, api_hash)
    try:
        await client.connect()
        for i, case in enumerate(cases):
            img_path = Path(__file__).parent.parent / case.get("image", "")
            caption = case.get("caption", "")
            try:
                if img_path.exists():
                    await client.send_file(bot_username, str(img_path), caption=caption)
                else:
                    await client.send_message(bot_username, caption)
                await asyncio.sleep(5)
                msgs = await client.get_messages(bot_username, limit=1)
                reply = msgs[0].text if msgs else None
            except Exception as exc:
                reply = f"ERROR: {exc}"
            results.append({
                "case": case.get("name", f"probe_{i}"),
                "reply": reply,
                "path": "telethon",
            })
    finally:
        await client.disconnect()

    return ProbeResult(results=results, path_used="telethon", skipped=False)
