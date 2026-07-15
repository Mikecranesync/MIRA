"""Token redaction for bot logs (#2711).

httpx logs every request URL at INFO, and Telegram Bot API URLs embed the full
bot token (``/bot<id>:<token>/getUpdates``) — so a routine ``docker logs`` read
leaks the credential (it did, 2026-07-15: both bot tokens landed in a debugging
transcript and had to be rotated). This filter masks token-bearing URL segments
in the FORMATTED message, so %-style records with the URL in ``args`` (exactly
how httpx logs) are covered too. Filtering beats silencing httpx entirely —
request visibility stays, the secret goes.

Usage (both bot entrypoints, right after ``logging.basicConfig``)::

    from shared.log_redaction import install_token_redaction
    install_token_redaction()
"""

from __future__ import annotations

import logging
import re

# `/bot<digits>:<token>` and the URL-encoded `/bot<digits>%3A<token>` form used
# in file-download URLs. Telegram tokens are [A-Za-z0-9_-]; the match stops at
# the next path separator so the rest of the URL survives.
_TOKEN_RE = re.compile(r"/bot\d+(?:%3A|:)[A-Za-z0-9_-]+", re.IGNORECASE)

_MASK = "/bot<REDACTED>"


class TokenRedactionFilter(logging.Filter):
    """Mask bot-token URL segments in log records (message AND args)."""

    def filter(self, record: logging.LogRecord) -> bool:  # noqa: A003 — logging API
        try:
            msg = record.getMessage()
        except Exception:  # noqa: BLE001 — never let redaction break logging
            return True
        masked = _TOKEN_RE.sub(_MASK, msg)
        if masked != msg:
            record.msg = masked
            record.args = ()
        return True


# Loggers that carry Telegram API URLs: httpx (request lines), httpcore
# (lower-level traces), telegram/telegram.ext (PTB's own logging).
_TOKEN_ADJACENT_LOGGERS = ("httpx", "httpcore", "telegram", "telegram.ext")


def install_token_redaction(extra_loggers: tuple[str, ...] = ()) -> None:
    """Attach the redaction filter to token-adjacent loggers + root handlers.

    Idempotent — repeated installs don't stack duplicate filters.
    """
    flt = TokenRedactionFilter(name="token-redaction")

    def _attach(target) -> None:
        if not any(isinstance(f, TokenRedactionFilter) for f in target.filters):
            target.addFilter(flt)

    for name in (*_TOKEN_ADJACENT_LOGGERS, *extra_loggers):
        _attach(logging.getLogger(name))
    for handler in logging.getLogger().handlers:
        _attach(handler)
