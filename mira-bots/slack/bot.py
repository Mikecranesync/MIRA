# MIRA FactoryLM - Apache 2.0
"""MIRA Slack Bot - GSD engine + direct data commands via Socket Mode."""

from __future__ import annotations

import asyncio
import io as _io
import logging
import os
import re
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any

import httpx
from chat_adapter import SlackChatAdapter
from PIL import Image
from shared.conversation_logger import log_turn, measure_ms

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("mira-slack")

IMAGE_MIMES = {"image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"}
_SECRET_PREFIX_RE = re.compile(r"(xox[a-zA-Z0-9-]*-|xapp-)[A-Za-z0-9-]+")


class SlackConfigError(RuntimeError):
    """Raised when required Slack runtime configuration is missing."""


@dataclass(frozen=True, slots=True)
class SlackSettings:
    bot_token: str
    app_token: str
    signing_secret: str = ""
    allowed_channels: tuple[str, ...] = ()
    expected_bot_user_id: str = ""
    db_path: str = "/data/mira.db"
    openwebui_base_url: str = "http://mira-core:8080"
    openwebui_api_key: str = ""
    mcp_base_url: str = "http://mira-mcp:8001"
    mcp_rest_api_key: str = ""
    knowledge_collection_id: str = ""
    vision_model: str = "qwen2.5vl:7b"
    tenant_id: str = ""

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "SlackSettings":
        source = os.environ if env is None else env
        bot_token = source.get("SLACK_BOT_TOKEN", "").strip()
        app_token = source.get("SLACK_APP_TOKEN", "").strip()
        if not bot_token:
            raise SlackConfigError("SLACK_BOT_TOKEN is required for mira-bot-slack")
        if not app_token:
            raise SlackConfigError("SLACK_APP_TOKEN is required for mira-bot-slack Socket Mode")
        allowed_channels = tuple(
            c.strip() for c in source.get("SLACK_ALLOWED_CHANNELS", "").split(",") if c.strip()
        )
        return cls(
            bot_token=bot_token,
            app_token=app_token,
            signing_secret=source.get("SLACK_SIGNING_SECRET", ""),
            allowed_channels=allowed_channels,
            expected_bot_user_id=source.get("SLACK_EXPECTED_BOT_USER_ID", "").strip(),
            db_path=source.get("MIRA_DB_PATH", "/data/mira.db"),
            openwebui_base_url=source.get("OPENWEBUI_BASE_URL", "http://mira-core:8080"),
            openwebui_api_key=source.get("OPENWEBUI_API_KEY", ""),
            mcp_base_url=source.get("MCP_BASE_URL", "http://mira-mcp:8001"),
            mcp_rest_api_key=source.get("MCP_REST_API_KEY", ""),
            knowledge_collection_id=source.get("KNOWLEDGE_COLLECTION_ID", ""),
            vision_model=source.get("VISION_MODEL", "qwen2.5vl:7b"),
            tenant_id=source.get("MIRA_TENANT_ID", ""),
        )


def _redact_secret(value: object) -> str:
    return _SECRET_PREFIX_RE.sub(r"\1REDACTED", str(value))


def _event_meta(event: dict) -> dict[str, object]:
    return {
        "channel": event.get("channel", ""),
        "channel_type": event.get("channel_type", ""),
        "user": event.get("user", ""),
        "bot_id": bool(event.get("bot_id")),
        "subtype": event.get("subtype", ""),
        "thread_ts": event.get("thread_ts", ""),
        "ts": event.get("ts", ""),
        "file_count": len(event.get("files", []) or []),
    }


def _log_event_decision(event: dict, *, decision: str, reason: str, path: str = "") -> None:
    logger.info(
        "slack_event decision=%s reason=%s path=%s meta=%s",
        decision,
        reason,
        path,
        _event_meta(event),
    )


def _session_key(event: dict) -> str:
    """Derive unique session key from Slack event."""
    channel = event["channel"]
    thread_ts = event.get("thread_ts", event.get("ts", ""))
    return f"slack:{channel}:{thread_ts}"


def _thread_ts(event: dict) -> str:
    """Get the thread_ts to reply in-thread."""
    return event.get("thread_ts", event.get("ts", ""))


def _resize_for_vision(image_bytes: bytes) -> bytes:
    """Downscale image to MAX_VISION_PX longest side before base64 encoding."""
    max_px = int(os.getenv("MAX_VISION_PX", "512"))
    img = Image.open(_io.BytesIO(image_bytes))
    w, h = img.size
    if max(w, h) <= max_px:
        return image_bytes
    scale = max_px / max(w, h)
    img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    buf = _io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


FastPathFn = Callable[[Any, Any], Awaitable[Any | None]]
ResizeFn = Callable[[bytes], bytes]


class SlackRuntime:
    def __init__(
        self,
        *,
        settings: SlackSettings,
        engine: Any,
        adapter: Any,
        dispatcher: Any,
        fast_paths: FastPathFn,
        resize_for_vision: ResizeFn = _resize_for_vision,
    ) -> None:
        self.settings = settings
        self.engine = engine
        self.adapter = adapter
        self.dispatcher = dispatcher
        self.fast_paths = fast_paths
        self.resize_for_vision = resize_for_vision
        self.seen_events: set[str] = set()

    def thread_ts(self, event: dict) -> str:
        return _thread_ts(event)

    async def download_slack_file(self, url: str) -> bytes:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                url,
                headers={"Authorization": f"Bearer {self.settings.bot_token}"},
            )
            resp.raise_for_status()
            return resp.content

    async def log_startup_auth_identity(self, app: Any) -> None:
        try:
            auth = await app.client.auth_test()
        except Exception as exc:
            logger.error("slack_auth_test_failed error=%s", type(exc).__name__)
            return

        user_id = auth.get("user_id", "")
        bot_id = auth.get("bot_id", "")
        team_id = auth.get("team_id", "")
        team = auth.get("team", "")
        expected = self.settings.expected_bot_user_id
        mismatch = bool(expected and user_id and user_id != expected)
        if mismatch:
            logger.error(
                "slack_auth_identity_mismatch expected_user_id=%s actual_user_id=%s "
                "bot_id=%s team_id=%s team=%s",
                expected,
                user_id,
                bot_id,
                team_id,
                team,
            )
        else:
            logger.info(
                "slack_auth_identity_ok user_id=%s bot_id=%s team_id=%s team=%s "
                "expected_configured=%s",
                user_id,
                bot_id,
                team_id,
                team,
                bool(expected),
            )

    async def handle_message(self, event, say, client) -> None:
        """Handle all message events: text, photos, and file uploads."""
        ts = event.get("ts", "")
        if ts in self.seen_events:
            _log_event_decision(event, decision="ignored", reason="duplicate")
            return
        self.seen_events.add(ts)
        if len(self.seen_events) > 200:
            self.seen_events.clear()

        if event.get("subtype") in ("bot_message", "message_changed", "message_deleted"):
            _log_event_decision(
                event,
                decision="ignored",
                reason=f"subtype:{event.get('subtype')}",
            )
            return
        if event.get("bot_id"):
            _log_event_decision(event, decision="ignored", reason="bot_event")
            return

        if (
            self.settings.allowed_channels
            and event.get("channel") not in self.settings.allowed_channels
        ):
            _log_event_decision(event, decision="ignored", reason="channel_not_allowed")
            return

        _log_event_decision(event, decision="accepted", reason="message_handler")
        thread = self.thread_ts(event)
        files = event.get("files", [])
        pdf_files = [f for f in files if f.get("mimetype", "") == "application/pdf"]

        if pdf_files:
            await say(text="Processing PDF...", thread_ts=thread)
            try:
                from pdf_handler import ingest_pdf

                file_info = pdf_files[0]
                url = file_info.get("url_private_download") or file_info.get("url_private")
                filename = file_info.get("name", "document.pdf")
                pdf_bytes = await self.download_slack_file(url)
                reply = await ingest_pdf(pdf_bytes, filename)
            except Exception as exc:
                logger.error("PDF handler error: %s", exc)
                reply = f"MIRA error processing PDF: {exc}"
            await say(text=reply, thread_ts=thread)
            _log_event_decision(event, decision="handled", reason="pdf")
            return

        normalized = await self.adapter.normalize_incoming(event)

        if normalized.attachments:
            img_att = next((a for a in normalized.attachments if a.kind == "image"), None)
            if img_att:
                await say(text="Analyzing equipment...", thread_ts=thread)
                try:
                    raw_bytes = await self.adapter.download_attachment(img_att)
                    img_att.data = self.resize_for_vision(raw_bytes)
                    if not normalized.text:
                        normalized.text = "Analyze this equipment photo"
                except Exception as exc:
                    logger.error("Photo download error: %s", exc)
                    await say(text=f"MIRA error downloading photo: {exc}", thread_ts=thread)
                    return

        if not normalized.text and not any(a.kind == "image" for a in normalized.attachments):
            _log_event_decision(event, decision="ignored", reason="empty")
            return

        fp_resp = await self.fast_paths(normalized, self.engine)
        if fp_resp is not None:
            await say(text=fp_resp.text, thread_ts=thread)
            await log_turn(
                chat_id=str(event.get("channel", "")),
                user_message=normalized.text or "",
                bot_response=fp_resp.text or "",
                source="slack",
                intent="fast_path",
                has_citations=("[Source:" in (fp_resp.text or "")),
                response_time_ms=0,
            )
            _log_event_decision(event, decision="handled", reason="fast_path")
            return

        try:
            import time as _time

            t0 = _time.monotonic()
            response = await self.dispatcher.dispatch(normalized)
            await self.adapter.render_outgoing(response, normalized)
            await log_turn(
                chat_id=str(event.get("channel", "")),
                user_message=normalized.text or "",
                bot_response=response.text or "",
                source="slack",
                intent=getattr(response, "intent", None),
                has_citations=bool(getattr(response, "citations", None)),
                response_time_ms=measure_ms(t0),
            )
            _log_event_decision(event, decision="handled", reason="dispatcher")
        except Exception as exc:
            logger.error("Dispatch error: %s", exc)
            await say(text=f"MIRA error: {exc}", thread_ts=thread)


def create_runtime(settings: SlackSettings) -> SlackRuntime:
    from shared.chat.dispatcher import ChatDispatcher
    from shared.chat.fast_paths import try_fast_paths
    from shared.engine import Supervisor
    from shared.identity.service import get_identity_service

    engine = Supervisor(
        db_path=settings.db_path,
        openwebui_url=settings.openwebui_base_url,
        api_key=settings.openwebui_api_key,
        collection_id=settings.knowledge_collection_id,
        vision_model=settings.vision_model,
        tenant_id=settings.tenant_id,
    )
    adapter = SlackChatAdapter(
        bot_token=settings.bot_token,
        signing_secret=settings.signing_secret,
    )
    identity_service = get_identity_service()
    if identity_service is None:
        logger.warning(
            "NEON_DATABASE_URL not set or sqlalchemy missing - Slack dispatcher will fail closed "
            "until identity service is configured (multi-tenant gate)"
        )
    dispatcher = ChatDispatcher(engine, identity_service=identity_service)
    return SlackRuntime(
        settings=settings,
        engine=engine,
        adapter=adapter,
        dispatcher=dispatcher,
        fast_paths=try_fast_paths,
    )


def create_app(runtime: SlackRuntime):
    from slack_bolt.async_app import AsyncApp

    app = AsyncApp(token=runtime.settings.bot_token)

    @app.event("app_mention")
    async def handle_mention(event, say, client):
        await runtime.handle_message(event, say, client)

    @app.event("message")
    async def handle_message(event, say, client):
        await runtime.handle_message(event, say, client)

    @app.command("/mira-equipment")
    async def equipment_command(ack, command, say):
        await ack()
        equipment_id = command.get("text", "").strip()
        url = f"{runtime.settings.mcp_base_url}/api/equipment"
        if equipment_id:
            url += f"?equipment_id={equipment_id}"
        headers = {}
        if runtime.settings.mcp_rest_api_key:
            headers["Authorization"] = f"Bearer {runtime.settings.mcp_rest_api_key}"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(url, headers=headers)
                resp.raise_for_status()
                rows = resp.json().get("equipment", [])
            if not rows:
                await say(text="No equipment found.")
                return
            lines = ["*Equipment Status:*"]
            for row in rows:
                readings = []
                if row.get("speed_rpm") is not None:
                    readings.append(f"{row['speed_rpm']} RPM")
                if row.get("temperature_c") is not None:
                    readings.append(f"{row['temperature_c']}C")
                if row.get("current_amps") is not None:
                    readings.append(f"{row['current_amps']}A")
                if row.get("pressure_psi") is not None:
                    readings.append(f"{row['pressure_psi']} PSI")
                reading_str = ", ".join(readings) if readings else "no readings"
                lines.append(
                    f"* {row['name']} ({row['equipment_id']}): "
                    f"{row['status'].upper()} - {reading_str}"
                )
            await say(text="\n".join(lines))
        except Exception as exc:
            logger.error("Equipment command error: %s", exc)
            await say(text=f"MIRA error: {exc}")

    @app.command("/mira-faults")
    async def faults_command(ack, command, say):
        await ack()
        headers = {}
        if runtime.settings.mcp_rest_api_key:
            headers["Authorization"] = f"Bearer {runtime.settings.mcp_rest_api_key}"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"{runtime.settings.mcp_base_url}/api/faults/active",
                    headers=headers,
                )
                resp.raise_for_status()
                faults = resp.json().get("active_faults", [])
            if not faults:
                await say(text="No active faults.")
                return
            lines = [f"*Active Faults ({len(faults)}):*"]
            for fault in faults:
                lines.append(
                    f"* [{fault['severity'].upper()}] {fault['equipment_id']} - "
                    f"{fault['fault_code']}: {fault['description']}"
                )
            await say(text="\n".join(lines))
        except Exception as exc:
            logger.error("Faults command error: %s", exc)
            await say(text=f"MIRA error: {exc}")

    @app.command("/mira-status")
    async def status_command(ack, command, say):
        await ack()
        headers = {"Content-Type": "application/json"}
        if runtime.settings.openwebui_api_key:
            headers["Authorization"] = f"Bearer {runtime.settings.openwebui_api_key}"
        try:
            payload = {
                "model": "mira:latest",
                "messages": [
                    {
                        "role": "user",
                        "content": "Give a brief status summary of all monitored equipment",
                    }
                ],
            }
            if runtime.settings.knowledge_collection_id:
                payload["files"] = [
                    {"type": "collection", "id": runtime.settings.knowledge_collection_id}
                ]
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(
                    f"{runtime.settings.openwebui_base_url}/api/chat/completions",
                    headers=headers,
                    json=payload,
                )
                resp.raise_for_status()
                data = resp.json()
            await say(text=data["choices"][0]["message"]["content"])
        except Exception as exc:
            logger.error("Status command error: %s", exc)
            await say(text=f"MIRA error: {exc}")

    @app.command("/mira-reset")
    async def reset_command(ack, command, say):
        await ack()
        channel = command["channel_id"]
        session = f"slack:{channel}:main"
        runtime.engine.reset(session)
        await say(text="Conversation reset. Start fresh anytime.")

    async def _dispatch_command(command, say, text: str) -> None:
        channel_id = command["channel_id"]
        normalized = await runtime.adapter.normalize_incoming(
            {
                "ts": command.get("trigger_id", ""),
                "user": command.get("user_id", ""),
                "channel": channel_id,
                "channel_type": "slash",
                "text": text,
            }
        )
        response = await runtime.dispatcher.dispatch(normalized)
        await runtime.adapter.render_outgoing(response, normalized)

    @app.command("/mira")
    async def mira_command(ack, command, say):
        await ack()
        question = command.get("text", "").strip()
        if not question:
            await say(text="Usage: `/mira [question]` - e.g. `/mira VFD tripped OC1 fault`")
            return
        try:
            await _dispatch_command(command, say, question)
        except Exception as exc:
            logger.error("/mira command error: %s", exc)
            await say(text=f"MIRA error: {exc}")

    @app.command("/work-order")
    async def work_order_command(ack, command, say):
        await ack()
        description = command.get("text", "").strip()
        if not description:
            await say(
                text=(
                    "Usage: `/work-order [description]` - e.g. "
                    "`/work-order Conveyor belt slipping on Line 1`"
                )
            )
            return
        try:
            await _dispatch_command(command, say, f"create work order: {description}")
        except Exception as exc:
            logger.error("/work-order command error: %s", exc)
            await say(text=f"MIRA error: {exc}")

    @app.command("/asset")
    async def asset_command(ack, command, say):
        await ack()
        tag = command.get("text", "").strip()
        if not tag:
            await say(text="Usage: `/asset [tag]` - e.g. `/asset PUMP-A3`")
            return
        try:
            await _dispatch_command(command, say, f"check equipment history for {tag}")
        except Exception as exc:
            logger.error("/asset command error: %s", exc)
            await say(text=f"MIRA error: {exc}")

    @app.command("/mira-help")
    async def help_command(ack, command, say):
        await ack()
        await say(
            text=(
                "*MIRA Commands:*\n"
                "`/mira [question]` - Ask MIRA anything about your equipment\n"
                "`/work-order [description]` - Open a corrective work order\n"
                "`/asset [tag]` - Look up asset history by QR tag\n"
                "`/mira-equipment [id]` - Live equipment status (instant)\n"
                "`/mira-faults` - Active fault list (instant)\n"
                "`/mira-status` - AI equipment summary\n"
                "`/mira-reset` - Reset conversation state\n\n"
                "Or just type any maintenance question in a thread.\n"
                "Upload a photo to identify equipment and diagnose faults."
            )
        )

    return app


async def main() -> None:
    from slack_bolt.adapter.socket_mode.async_handler import AsyncSocketModeHandler

    settings = SlackSettings.from_env()
    runtime = create_runtime(settings)
    app = create_app(runtime)
    await runtime.log_startup_auth_identity(app)
    handler = AsyncSocketModeHandler(app, settings.app_token)
    logger.info("MIRA Slack bot started (Socket Mode)")
    await handler.start_async()


if __name__ == "__main__":
    asyncio.run(main())
