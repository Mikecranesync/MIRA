"""Layer 3 — ROUTE-AWARE live staging E2E via a Telethon USER client (never a bot).

A print photo and a nameplate photo take DIFFERENT paths through the bot, so the
client must interact differently:

  * ``electrical_print_with_map`` — send the photo, await the PrintSense reply,
    validate it, send ``map``, await + validate the detailed map.
  * ``nameplate`` — send the photo, await the nameplate / Drive-Commander reply,
    assert it did NOT route as an electrical print, and send NO ``map`` (the
    nameplate route has no map follow-up).
  * ``generic_image`` — send the photo, await any substantive reply, send no map.

The result distinguishes a ROUTING failure (wrong route) from a REPLY-DETECTION
failure (no/za timed-out reply), so reports can tell them apart.

Credentials + session load from the ENVIRONMENT (Doppler-injected), NEVER committed
and NEVER logged:
  TELEGRAM_TEST_API_ID, TELEGRAM_TEST_API_HASH  — the Telegram API app creds
  TELEGRAM_TEST_SESSION                          — a StringSession for a dedicated
                                                   TEST USER account (NOT a bot)
Bot under test defaults to @Mira_stagong_bot (staging); override PRINTSENSE_STAGING_BOT.
Requires the optional `telethon` dependency.
"""

from __future__ import annotations

import io
import os
import time
from dataclasses import dataclass

STAGING_BOT = os.getenv("PRINTSENSE_STAGING_BOT", "@Mira_stagong_bot")

# Interaction modes.
MODE_PRINT = "electrical_print_with_map"
MODE_NAMEPLATE = "nameplate"
MODE_GENERIC = "generic_image"

# The transient "reading…" acknowledgement — never the real answer.
_ACK_MARKERS = ("🔍", "Reading your electrical print", "Reading")
# The PrintSense electrical-print reply (brief 📋 / map 📐 / measurement closing).
_PRINT_MARKERS = ("📋", "📐", "Read from the drawing", "reply \"map\"", "🔑 signals")
# The nameplate / Drive-Commander reply (a drive pack, not a print brief). Lowercased
# substring match; override with PRINTSENSE_NAMEPLATE_MARKERS (comma-separated).
_NAMEPLATE_MARKERS = tuple(
    m.strip().lower()
    for m in os.getenv(
        "PRINTSENSE_NAMEPLATE_MARKERS",
        "drive,vfd,gs10,nameplate,fault code,parameter,drive commander,🔧 drive",
    ).split(",")
    if m.strip()
)


def creds_available() -> bool:
    return all(os.getenv(k) for k in ("TELEGRAM_TEST_API_ID", "TELEGRAM_TEST_API_HASH", "TELEGRAM_TEST_SESSION"))


@dataclass
class E2EResult:
    mode: str
    got_reply: bool          # a substantive (non-ack) reply arrived
    timed_out: bool          # no substantive reply within the timeout (reply-detection failure)
    routed_as: str           # "print" | "nameplate" | "other"
    routed_as_print: bool
    map_sent: bool           # whether a "map" follow-up was sent (print route only)
    default_reply: str
    map_reply: str
    default_latency_s: float
    map_latency_s: float


def _is_ack(text: str) -> bool:
    t = text or ""
    return any(a in t for a in _ACK_MARKERS) and not any(m in t for m in _PRINT_MARKERS)


def _classify(text: str) -> str:
    """Which route did this reply come from? Print markers win (they are unambiguous
    PrintSense glyphs); else nameplate markers; else 'other'."""
    t = (text or "")
    tl = t.lower()
    if any(m in t for m in ("📋", "📐")) or any(m.lower() in tl for m in _PRINT_MARKERS):
        return "print"
    if any(m in tl for m in _NAMEPLATE_MARKERS):
        return "nameplate"
    return "other"


async def _await_substantive_reply(client, bot, after_id: int, timeout: float) -> tuple[str, int]:
    """Poll for the bot's next non-ack reply after message id `after_id`. Returns
    ('', after_id) on timeout so the caller can record a reply-detection failure."""
    import asyncio

    deadline = time.monotonic() + timeout
    last_id = after_id
    while time.monotonic() < deadline:
        msgs = await client.get_messages(bot, limit=8, min_id=after_id)
        for m in sorted(msgs, key=lambda x: x.id):
            if m.id <= after_id or m.out:  # skip already-seen + our own outgoing
                continue
            last_id = max(last_id, m.id)
            body = m.message or ""
            if body and not _is_ack(body):
                return body, m.id
        await asyncio.sleep(2)
    return "", last_id


async def _roundtrip(image_bytes: bytes, caption: str, mode: str, timeout: float) -> E2EResult:
    from telethon import TelegramClient
    from telethon.sessions import StringSession

    api_id = int(os.environ["TELEGRAM_TEST_API_ID"])
    api_hash = os.environ["TELEGRAM_TEST_API_HASH"]
    session = os.environ["TELEGRAM_TEST_SESSION"]

    default_reply = map_reply = ""
    default_latency = map_latency = 0.0
    map_sent = False

    async with TelegramClient(StringSession(session), api_id, api_hash) as client:
        me = await client.get_me()
        assert not getattr(me, "bot", False), "TELEGRAM_TEST_SESSION must be a USER account, not a bot"
        bot = await client.get_entity(STAGING_BOT)

        base = await client.get_messages(bot, limit=1)
        base_id = base[0].id if base else 0

        t0 = time.monotonic()
        buf = io.BytesIO(image_bytes)
        buf.name = "image.jpg"  # neutral name — never the sensitive original filename
        await client.send_file(bot, file=buf, caption=caption)
        default_reply, reply_id = await _await_substantive_reply(client, bot, base_id, timeout)
        default_latency = round(time.monotonic() - t0, 1)

        routed_as = _classify(default_reply) if default_reply else "other"

        # `map` is a PRINT-route affordance ONLY. Never send it on the nameplate/generic
        # route (it would be an invalid follow-up), and only when the route is print.
        if mode == MODE_PRINT and routed_as == "print" and default_reply:
            t1 = time.monotonic()
            await client.send_message(bot, "map")
            map_sent = True
            map_reply, _ = await _await_substantive_reply(client, bot, reply_id, timeout)
            map_latency = round(time.monotonic() - t1, 1)

    return E2EResult(
        mode=mode,
        got_reply=bool(default_reply),
        timed_out=not default_reply,
        routed_as=routed_as,
        routed_as_print=(routed_as == "print"),
        map_sent=map_sent,
        default_reply=default_reply,
        map_reply=map_reply,
        default_latency_s=default_latency,
        map_latency_s=map_latency,
    )


def send_image(image_bytes: bytes, *, mode: str, caption: str, timeout: float = 150) -> E2EResult:
    """Route-aware send. `mode` is one of MODE_PRINT / MODE_NAMEPLATE / MODE_GENERIC.
    Only the print mode sends a `map` follow-up (and only if the reply routed as print)."""
    import asyncio

    return asyncio.run(_roundtrip(image_bytes, caption, mode, timeout))
