#!/usr/bin/env python3
"""
telethon_forwarder.py
---------------------
Sends filtered Reddit troubleshooting posts to a Telegram channel or chat
using Telethon (MTProto — not the Bot API, so it can post as your user account
OR as a bot depending on which credentials you supply).

Doppler secrets expected:
  TELEGRAM_API_ID        — from https://my.telegram.org/apps
  TELEGRAM_API_HASH      — from https://my.telegram.org/apps
  TELEGRAM_SESSION_NAME  — local .session file name (default: reddit_forwarder)
  TELEGRAM_TARGET        — channel username (@mychannel), chat ID (-100xxxxx),
                           or phone number of DM recipient

Optional:
  TELEGRAM_BOT_TOKEN     — if set, uses bot mode instead of user-account mode
  MESSAGE_DELAY_SECS     — seconds to sleep between messages (default: 3)
  DRY_RUN                — if "1" or "true", prints messages without sending
"""

import asyncio
import logging
import os

from telethon import TelegramClient, errors

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Message template
# ---------------------------------------------------------------------------
def format_post(post: dict, index: int, total: int) -> str:
    """Build a clean Telegram message from a Reddit post dict."""
    sub = post.get("subreddit", "?")
    title = post.get("title", "")
    body = post.get("body", "").strip()
    upvotes = post.get("upvotes", 0)
    comments = post.get("num_comments", 0)
    url = post.get("url", "")
    author = post.get("author", "unknown")

    # Trim body for Telegram's 4096-char limit
    max_body = 600
    if body and len(body) > max_body:
        body = body[:max_body] + "…"

    lines = [
        f"🔧 **r/{sub}** · {index}/{total}",
        "",
        f"**{title}**",
    ]
    if body:
        lines += ["", body]

    lines += [
        "",
        f"👍 {upvotes:,} upvotes  |  💬 {comments} comments  |  👤 u/{author}",
        f"🔗 [View on Reddit]({url})",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Core forwarder
# ---------------------------------------------------------------------------
async def _send_posts(
    posts: list[dict],
    target: str,
    api_id: int,
    api_hash: str,
    session_name: str,
    bot_token: str | None,
    delay_secs: float,
    dry_run: bool,
) -> dict:
    """Internal async coroutine. Returns summary stats."""
    stats = {"sent": 0, "skipped": 0, "errors": 0}

    if dry_run:
        log.info("[DRY RUN] Would send %d posts to %s", len(posts), target)
        for i, post in enumerate(posts, 1):
            msg = format_post(post, i, len(posts))
            print(f"\n--- Message {i} ---\n{msg}\n")
            stats["sent"] += 1
        return stats

    # Build the TelegramClient
    if bot_token:
        client = TelegramClient(session_name, api_id, api_hash)
        await client.start(bot_token=bot_token)
        log.info("Connected as bot.")
    else:
        client = TelegramClient(session_name, api_id, api_hash)
        await client.start()
        me = await client.get_me()
        log.info("Connected as user: %s (@%s)", me.first_name, me.username)

    async with client:
        # Resolve the target entity once
        try:
            entity = await client.get_entity(target)
            log.info("Target resolved: %s", entity)
        except Exception as exc:
            log.error("Could not resolve target '%s': %s", target, exc)
            stats["errors"] = len(posts)
            return stats

        total = len(posts)
        for i, post in enumerate(posts, 1):
            msg = format_post(post, i, total)
            try:
                await client.send_message(entity, msg, link_preview=False)
                log.info("[%d/%d] Sent: %s", i, total, post.get("title", "")[:60])
                stats["sent"] += 1
            except errors.FloodWaitError as fwe:
                wait = fwe.seconds + 5
                log.warning("FloodWait — sleeping %ds before retry...", wait)
                await asyncio.sleep(wait)
                # Retry once
                try:
                    await client.send_message(entity, msg, link_preview=False)
                    stats["sent"] += 1
                except Exception as retry_exc:
                    log.error("Retry failed for post %d: %s", i, retry_exc)
                    stats["errors"] += 1
            except errors.ChatWriteForbiddenError:
                log.error("Write access denied for target '%s' — aborting.", target)
                stats["skipped"] = total - i
                break
            except Exception as exc:
                log.error("Failed to send post %d: %s", i, exc)
                stats["errors"] += 1

            if i < total:
                await asyncio.sleep(delay_secs)

    return stats


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------
def forward_posts(
    posts: list[dict],
    target: str | None = None,
    dry_run: bool | None = None,
) -> dict:
    """
    Forward a list of post dicts to Telegram.
    Reads credentials from environment / Doppler.
    Returns a summary dict: {sent, skipped, errors}.
    """
    api_id_raw = os.environ.get("TELEGRAM_API_ID")
    api_hash = os.environ.get("TELEGRAM_API_HASH")
    session_name = os.environ.get("TELEGRAM_SESSION_NAME", "reddit_forwarder")
    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN")  # optional
    _target = target or os.environ.get("TELEGRAM_TARGET")
    delay_secs = float(os.environ.get("MESSAGE_DELAY_SECS", 3))

    _dry_run = dry_run
    if _dry_run is None:
        _dry_run = os.environ.get("DRY_RUN", "0").lower() in ("1", "true", "yes")

    # Validate required vars
    missing = []
    if not api_id_raw:
        missing.append("TELEGRAM_API_ID")
    if not api_hash:
        missing.append("TELEGRAM_API_HASH")
    if not _target:
        missing.append("TELEGRAM_TARGET")
    if missing:
        raise EnvironmentError(
            f"Missing required Telegram env vars: {', '.join(missing)}\n"
            "Set them via Doppler before running."
        )

    api_id = int(api_id_raw)  # type: ignore[arg-type]

    if not posts:
        log.info("No posts to forward.")
        return {"sent": 0, "skipped": 0, "errors": 0}

    log.info(
        "Forwarding %d posts to '%s'%s",
        len(posts),
        _target,
        " [DRY RUN]" if _dry_run else "",
    )

    return asyncio.run(
        _send_posts(
            posts=posts,
            target=_target,
            api_id=api_id,
            api_hash=api_hash,
            session_name=session_name,
            bot_token=bot_token,
            delay_secs=delay_secs,
            dry_run=_dry_run,
        )
    )


# ---------------------------------------------------------------------------
# Standalone test
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    sample = [
        {
            "subreddit": "techsupport",
            "title": "Why does my PC keep restarting randomly?",
            "body": "It happens every few hours with no warning. No BSOD, just an instant reboot.",
            "upvotes": 142,
            "num_comments": 38,
            "url": "https://reddit.com/r/techsupport/comments/example",
            "author": "test_user",
        }
    ]

    # Enable dry-run for standalone test so no real messages are sent
    os.environ.setdefault("DRY_RUN", "1")
    os.environ.setdefault("TELEGRAM_TARGET", "@your_channel_here")

    result = forward_posts(sample)
    print(f"\nResult: {result}")
