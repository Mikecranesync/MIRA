"""Token redaction in bot logs (#2711).

The bot containers logged every Telegram getUpdates/getFile URL at httpx INFO
level — URLs that embed the full bot token (`/bot<id>:<token>/…`). A routine
log read during the 2026-07-15 phone-test debugging disclosed both prod and
staging tokens into a session transcript (both are on the rotation list).

The fix: a logging.Filter that masks token-bearing URL segments in the
formatted message (including %-style records with args, which is exactly how
httpx logs), installed on the token-adjacent loggers AND the root handlers.
Hermetic tests — no network, no real tokens.
"""

from __future__ import annotations

import io
import logging
import sys

sys.path.insert(0, "mira-bots")

from shared.log_redaction import TokenRedactionFilter, install_token_redaction

FAKE_URL = "https://api.telegram.org/bot1234567890:AAHfakeFAKEfake-token_string/getUpdates"
FAKE_FILE_URL = "https://api.telegram.org/file/bot1234567890%3AAAHfakeFAKEfake/photos/f.jpg"


def _capture(logger: logging.Logger) -> io.StringIO:
    buf = io.StringIO()
    handler = logging.StreamHandler(buf)
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)
    return buf


def test_filter_masks_plain_message():
    rec = logging.LogRecord("x", logging.INFO, "f", 1, f"GET {FAKE_URL} 200", None, None)
    assert TokenRedactionFilter().filter(rec) is True
    out = rec.getMessage()
    assert "AAHfake" not in out
    assert "/bot<REDACTED>" in out


def test_filter_masks_percent_style_args():
    """httpx logs 'HTTP Request: %s %s' with the URL in args — the filter must
    mask the FORMATTED message, not just msg."""
    rec = logging.LogRecord(
        "httpx", logging.INFO, "f", 1, 'HTTP Request: %s "%s"', (FAKE_URL, "HTTP/1.1 200 OK"), None
    )
    TokenRedactionFilter().filter(rec)
    out = rec.getMessage()
    assert "AAHfake" not in out
    assert "200 OK" in out  # the rest of the message survives


def test_filter_masks_urlencoded_token():
    rec = logging.LogRecord("httpx", logging.INFO, "f", 1, f"GET {FAKE_FILE_URL}", None, None)
    TokenRedactionFilter().filter(rec)
    assert "AAHfake" not in rec.getMessage()


def test_install_covers_httpx_logger_end_to_end():
    install_token_redaction()
    httpx_logger = logging.getLogger("httpx")
    httpx_logger.setLevel(logging.INFO)
    httpx_logger.propagate = False
    buf = _capture(httpx_logger)

    httpx_logger.info('HTTP Request: POST %s "%s"', FAKE_URL, "HTTP/1.1 200 OK")

    out = buf.getvalue()
    assert "AAHfake" not in out
    assert "/bot<REDACTED>" in out


def test_clean_messages_pass_untouched():
    rec = logging.LogRecord("x", logging.INFO, "f", 1, "PRINT_INTERPRETED devices=%d", (4,), None)
    TokenRedactionFilter().filter(rec)
    assert rec.getMessage() == "PRINT_INTERPRETED devices=4"
