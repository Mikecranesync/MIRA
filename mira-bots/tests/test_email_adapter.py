"""Tests for email adapter — parser, file_processor, allowlist, thread_tracker,
chat_adapter normalize/render, and HTML renderer.

All tests run offline. No SES, no S3, no SMTP.
"""

from __future__ import annotations

import importlib.util
import io
import os
import sys
import zipfile
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, "mira-bots")
sys.path.insert(0, "mira-bots/email")
sys.modules.pop("chat_adapter", None)  # isolate from other bot adapters

# chat_adapter, file_processor, parser, thread_tracker are safe to import at
# collection time — no other test caches these names before email is collected.
# renderers is NOT safe: test_image_downscale/typing_indicator import
# telegram/bot.py at collection time, which caches telegram's renderers first.
# Use importlib below for render_email to bypass sys.modules entirely.
from chat_adapter import EmailChatAdapter  # noqa: E402
from file_processor import FileProcessor  # noqa: E402
from parser import ParsedEmail  # noqa: E402
from shared.chat.adapter import ChatAdapter  # noqa: E402
from shared.chat.types import (  # noqa: E402
    NormalizedChatEvent,
    NormalizedChatResponse,
    ResponseBlock,
)
from thread_tracker import ThreadTracker  # noqa: E402

_EMAIL_DIR = os.path.join(os.path.dirname(__file__), "..", "email")


def _load_render_email():
    """Load render_email from mira-bots/email/renderers.py via absolute path.

    importlib bypasses sys.modules so the telegram renderers cache doesn't interfere.
    """
    spec = importlib.util.spec_from_file_location(
        "_email_renderers", os.path.join(_EMAIL_DIR, "renderers.py")
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod.render_email


# ---------------------------------------------------------------------------
# MIME Parser
# ---------------------------------------------------------------------------


def _simple_email(
    body: str,
    subject: str = "VFD fault OC1",
    from_addr: str = "mike@acme.com",
    msg_id: str = "test-001@acme.com",
) -> bytes:
    msg = MIMEText(body, "plain", "utf-8")
    msg["From"] = from_addr
    msg["To"] = "mira@mail.factorylm.com"
    msg["Subject"] = subject
    msg["Message-ID"] = f"<{msg_id}>"
    return msg.as_bytes()


def _email_with_attachment(
    body: str,
    filename: str,
    data: bytes,
    ct: str = "application/octet-stream",
) -> bytes:
    outer = MIMEMultipart("mixed")
    outer["From"] = "mike@acme.com"
    outer["To"] = "mira@mail.factorylm.com"
    outer["Subject"] = "Equipment photo"
    outer["Message-ID"] = "<attach-001@acme.com>"
    outer.attach(MIMEText(body, "plain", "utf-8"))
    main_type, sub_type = ct.split("/", 1) if "/" in ct else ("application", "octet-stream")
    part = MIMEBase(main_type, sub_type)
    part.set_payload(data)
    encoders.encode_base64(part)
    part.add_header("Content-Disposition", "attachment", filename=filename)
    outer.attach(part)
    return outer.as_bytes()


def test_parse_simple_plain_text():
    from parser import extract_sender_email, parse_email

    raw = _simple_email("VFD tripped on Line 3. Fault code OC1.")
    parsed = parse_email(raw)

    assert "VFD tripped on Line 3" in parsed.body
    assert extract_sender_email(parsed.sender) == "mike@acme.com"
    assert parsed.subject == "VFD fault OC1"
    assert parsed.message_id == "test-001@acme.com"
    assert parsed.is_auto_reply is False
    assert parsed.attachments == []


def test_parse_strips_dashes_signature():
    from parser import parse_email

    body = "Motor overload relay tripped.\n\n-- \nMike Harper\nFactoryLM"
    parsed = parse_email(_simple_email(body))

    assert "Motor overload relay tripped" in parsed.body
    assert "Mike Harper" not in parsed.body


def test_parse_strips_iphone_signature():
    from parser import parse_email

    body = "Check the breaker panel.\nSent from my iPhone"
    parsed = parse_email(_simple_email(body))

    assert "Check the breaker panel" in parsed.body
    assert "Sent from my iPhone" not in parsed.body


def test_parse_detects_auto_reply_header():
    from parser import parse_email

    msg = MIMEText("I am out of office.", "plain")
    msg["From"] = "mike@acme.com"
    msg["To"] = "mira@mail.factorylm.com"
    msg["Subject"] = "Motor fault query"
    msg["Auto-Submitted"] = "auto-replied"
    parsed = parse_email(msg.as_bytes())

    assert parsed.is_auto_reply is True


def test_parse_detects_auto_reply_subject():
    from parser import parse_email

    raw = _simple_email("(away)", subject="Out of Office: Re: VFD fault")
    assert parse_email(raw).is_auto_reply is True


def test_parse_extracts_jpeg_attachment():
    from parser import parse_email

    fake_jpg = b"\xff\xd8\xff\xe0" + b"\xab" * 80
    raw = _email_with_attachment("See attached panel photo.", "panel.jpg", fake_jpg, "image/jpeg")
    parsed = parse_email(raw)

    assert len(parsed.attachments) == 1
    att = parsed.attachments[0]
    assert att["filename"] == "panel.jpg"
    assert att["content_type"] == "image/jpeg"
    assert att["data"] == fake_jpg


def test_parse_multipart_alternative_prefers_plain():
    from parser import parse_email

    msg = MIMEMultipart("alternative")
    msg["From"] = "mike@acme.com"
    msg["To"] = "mira@mail.factorylm.com"
    msg["Subject"] = "Test"
    msg["Message-ID"] = "<alt-001@acme.com>"
    msg.attach(MIMEText("Plain body text", "plain", "utf-8"))
    msg.attach(MIMEText("<b>HTML body</b>", "html", "utf-8"))
    parsed = parse_email(msg.as_bytes())

    assert "Plain body text" in parsed.body
    assert "<b>" not in parsed.body
    assert parsed.html_body != ""


def test_parse_extracts_in_reply_to():
    from parser import parse_email

    msg = MIMEText("Follow-up.", "plain")
    msg["From"] = "mike@acme.com"
    msg["To"] = "mira@mail.factorylm.com"
    msg["Subject"] = "Re: Motor fault"
    msg["Message-ID"] = "<reply-001@acme.com>"
    msg["In-Reply-To"] = "<original-000@mira.com>"
    msg["References"] = "<original-000@mira.com>"
    parsed = parse_email(msg.as_bytes())

    assert parsed.in_reply_to == "original-000@mira.com"
    assert "original-000@mira.com" in parsed.references


def test_parse_never_raises_on_garbage():
    from parser import parse_email

    result = parse_email(b"@@@ NOT AN EMAIL @@@\x00\xff")
    assert isinstance(result.body, str)
    assert isinstance(result.attachments, list)


def test_parse_multiple_attachments():
    from parser import parse_email

    outer = MIMEMultipart("mixed")
    outer["From"] = "mike@acme.com"
    outer["To"] = "mira@mail.factorylm.com"
    outer["Subject"] = "Multiple files"
    outer["Message-ID"] = "<multi-001@acme.com>"
    outer.attach(MIMEText("See all files.", "plain", "utf-8"))
    for fname, ct, data in [
        ("photo.jpg", "image/jpeg", b"\xff\xd8\xff" + b"\x00" * 20),
        ("manual.pdf", "application/pdf", b"%PDF-1.4" + b"\x00" * 20),
        ("notes.txt", "text/plain", b"VFD manual notes"),
    ]:
        part = MIMEBase(*ct.split("/", 1))
        part.set_payload(data)
        encoders.encode_base64(part)
        part.add_header("Content-Disposition", "attachment", filename=fname)
        outer.attach(part)
    parsed = parse_email(outer.as_bytes())

    assert len(parsed.attachments) == 3
    filenames = {a["filename"] for a in parsed.attachments}
    assert filenames == {"photo.jpg", "manual.pdf", "notes.txt"}


# ---------------------------------------------------------------------------
# Allowlist
# ---------------------------------------------------------------------------


def test_allowlist_wildcard_allows_all():
    from allowlist import AllowList

    al = AllowList({"acme": ["*"]})
    assert al.is_allowed("anyone@example.com", "acme") is True


def test_allowlist_domain_match():
    from allowlist import AllowList

    al = AllowList({"acme": ["@acme.com", "@contractor.net"]})
    assert al.is_allowed("mike@acme.com", "acme") is True
    assert al.is_allowed("vendor@contractor.net", "acme") is True
    assert al.is_allowed("spam@evil.com", "acme") is False


def test_allowlist_exact_email():
    from allowlist import AllowList

    al = AllowList({"acme": ["mike@acme.com"]})
    assert al.is_allowed("mike@acme.com", "acme") is True
    assert al.is_allowed("other@acme.com", "acme") is False


def test_allowlist_default_fallback():
    from allowlist import AllowList

    al = AllowList({"default": ["@trusted.com"]})
    assert al.is_allowed("admin@trusted.com", "unknown-tenant") is True
    assert al.is_allowed("evil@bad.com", "unknown-tenant") is False


def test_allowlist_empty_rules_defaults_to_wildcard():
    from allowlist import AllowList

    al = AllowList({})
    assert al.is_allowed("anyone@anywhere.com", "acme") is True


# ---------------------------------------------------------------------------
# Thread Tracker
# ---------------------------------------------------------------------------


def test_thread_new_email_creates_thread(tmp_path):
    from thread_tracker import ThreadTracker

    tracker = ThreadTracker(db_path=str(tmp_path / "t.db"))
    tid = tracker.resolve("msg-001", "", [], "VFD fault on line 3", "mike@acme.com")
    assert tid.startswith("email:")


def test_thread_reply_reuses_parent_thread(tmp_path):
    from thread_tracker import ThreadTracker

    tracker = ThreadTracker(db_path=str(tmp_path / "t.db"))
    tid1 = tracker.resolve("msg-001", "", [], "VFD fault", "mike@acme.com")
    tid2 = tracker.resolve("msg-002", "msg-001", ["msg-001"], "Re: VFD fault", "mike@acme.com")
    assert tid1 == tid2


def test_thread_same_sender_subject_reuses_within_24h(tmp_path):
    from thread_tracker import ThreadTracker

    tracker = ThreadTracker(db_path=str(tmp_path / "t.db"))
    tid1 = tracker.resolve("msg-A", "", [], "Equipment check", "mike@acme.com")
    tid2 = tracker.resolve("msg-B", "", [], "Equipment check", "mike@acme.com")
    assert tid1 == tid2


def test_thread_different_senders_isolated(tmp_path):
    from thread_tracker import ThreadTracker

    tracker = ThreadTracker(db_path=str(tmp_path / "t.db"))
    tid1 = tracker.resolve("msg-X", "", [], "Motor fault", "alice@acme.com")
    tid2 = tracker.resolve("msg-Y", "", [], "Motor fault", "bob@acme.com")
    assert tid1 != tid2


# ---------------------------------------------------------------------------
# FileProcessor
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fp_vision_handler_calls_pipeline(tmp_path):
    from file_processor import FileProcessor

    called_with = []

    async def mock_vision(b64):
        called_with.append(b64)
        return {"description": "VFD panel with OC1 fault", "text": "OC1"}

    fp = FileProcessor(vision_pipeline=mock_vision, storage_path=str(tmp_path))
    result = await fp.process("panel.jpg", "image/jpeg", b"\xff\xd8\xff" + b"\x00" * 50)

    assert result["status"] == "processed"
    assert result["handler"] == "vision"
    assert len(called_with) == 1
    assert "OC1" in result["description"] or "VFD" in result["description"]


@pytest.mark.asyncio
async def test_fp_vision_fallback_when_no_pipeline(tmp_path):
    from file_processor import FileProcessor

    fp = FileProcessor(vision_pipeline=None, storage_path=str(tmp_path))
    result = await fp.process("panel.jpg", "image/jpeg", b"\xff\xd8\xff" + b"\x00" * 50)

    assert result["status"] == "stored"
    assert result["filename"] == "panel.jpg"


@pytest.mark.asyncio
async def test_fp_text_ingest(tmp_path):
    from file_processor import FileProcessor

    fp = FileProcessor(storage_path=str(tmp_path))
    result = await fp.process("notes.txt", "text/plain", b"VFD manual notes page 5")

    assert result["status"] == "processed"
    assert result["handler"] == "text"
    assert "VFD manual notes" in result["extracted_text"]


@pytest.mark.asyncio
async def test_fp_csv_ingest(tmp_path):
    from file_processor import FileProcessor

    csv = b"timestamp,fault_code\n2024-01-01,OC1\n2024-01-02,OV\n"
    fp = FileProcessor(storage_path=str(tmp_path))
    result = await fp.process("faults.csv", "text/csv", csv)

    assert result["status"] == "processed"
    assert result["handler"] == "csv"
    assert "OC1" in result["extracted_text"]


@pytest.mark.asyncio
async def test_fp_cad_file_stored_with_message(tmp_path):
    from file_processor import FileProcessor

    fp = FileProcessor(storage_path=str(tmp_path))
    result = await fp.process("wiring.dwg", "application/acad", b"AC1012" + b"\x00" * 50)

    assert result["status"] == "stored"
    assert ".dwg" in result["description"] or "dwg" in result["description"].lower()
    assert (
        "can't process" in result["description"].lower() or "store" in result["description"].lower()
    )


@pytest.mark.asyncio
async def test_fp_unknown_extension_stored_gracefully(tmp_path):
    from file_processor import FileProcessor

    fp = FileProcessor(storage_path=str(tmp_path))
    result = await fp.process("mystery.xyz", "application/x-totally-unknown", b"\x00" * 100)

    assert result["status"] == "stored"
    assert result["filename"] == "mystery.xyz"
    assert "description" in result


@pytest.mark.asyncio
async def test_fp_oversized_file_rejected(tmp_path):
    from file_processor import MAX_FILE_SIZE, FileProcessor

    fp = FileProcessor(storage_path=str(tmp_path))
    result = await fp.process("huge.bin", "application/octet-stream", b"\x00" * (MAX_FILE_SIZE + 1))

    assert result["status"] == "stored"
    assert "50 MB" in result["description"] or "limit" in result["description"].lower()


@pytest.mark.asyncio
async def test_fp_extension_fallback_overrides_wrong_ct(tmp_path):
    from file_processor import FileProcessor

    fp = FileProcessor(storage_path=str(tmp_path))
    # content-type wrong but filename is .txt → should use text handler
    result = await fp.process("readme.txt", "application/octet-stream", b"plain text content")

    assert result["status"] == "processed"
    assert result["handler"] == "text"


@pytest.mark.asyncio
async def test_fp_zip_extraction(tmp_path):
    from file_processor import FileProcessor

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("notes.txt", "Motor fault log: OC1 overcurrent detected")
        zf.writestr("readme.md", "Equipment manual notes")
    buf.seek(0)

    fp = FileProcessor(storage_path=str(tmp_path))
    result = await fp.process("archive.zip", "application/zip", buf.getvalue())

    assert result["status"] == "processed"
    assert result["handler"] == "archive"
    assert "notes.txt" in result["description"] or "OC1" in result["extracted_text"]


@pytest.mark.asyncio
async def test_fp_never_raises_on_corrupt_pdf(tmp_path):
    from file_processor import FileProcessor

    fp = FileProcessor(storage_path=str(tmp_path))
    result = await fp.process("corrupt.pdf", "application/pdf", b"THIS IS NOT A PDF")

    assert "status" in result
    assert "filename" in result


@pytest.mark.asyncio
async def test_fp_heic_fallback_on_no_pillow(tmp_path):
    from file_processor import FileProcessor

    fp = FileProcessor(storage_path=str(tmp_path))
    # Fake HEIC bytes that PIL can't open → graceful fallback
    result = await fp.process("photo.heic", "image/heic", b"\x00\x00\x00\x18ftyp" + b"\x00" * 80)

    # Must not crash; will either convert or store
    assert "status" in result
    assert result["filename"] in ("photo.heic", "photo.jpg")


# ---------------------------------------------------------------------------
# HTML Renderer
# ---------------------------------------------------------------------------


def test_renderer_plain_text_fallback():
    render_email = _load_render_email()
    response = NormalizedChatResponse(text="Check the motor overload relay.")
    plain, html = render_email(response, subject="Re: VFD fault")

    assert plain == "Check the motor overload relay."
    assert "Check the motor overload relay." in html
    assert "<html" in html.lower()
    assert "MIRA" in html


def test_renderer_blocks_key_value():
    render_email = _load_render_email()
    response = NormalizedChatResponse(
        text="Diagnosis result",
        blocks=[
            ResponseBlock(kind="header", data={"text": "VFD Fault OC1"}),
            ResponseBlock(
                kind="key_value",
                data={"pairs": [["Fault Code", "OC1"], ["Action", "Check motor load"]]},
            ),
            ResponseBlock(kind="warning", data={"text": "Isolate power before inspecting"}),
        ],
    )
    plain, html = render_email(response)

    assert "VFD Fault OC1" in html
    assert "OC1" in html
    assert "Isolate power" in html
    assert "⚠️" in html


def test_renderer_has_reply_cta():
    render_email = _load_render_email()
    _, html = render_email(NormalizedChatResponse(text="Hello."))
    assert "Reply" in html or "reply" in html


def test_renderer_escapes_html():
    render_email = _load_render_email()
    response = NormalizedChatResponse(text='<script>alert("xss")</script>')
    _, html = render_email(response)

    assert "<script>" not in html
    assert "&lt;script&gt;" in html


# ---------------------------------------------------------------------------
# ChatAdapter — normalize_incoming
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_adapter_normalize_text_only(tmp_path):
    parsed = ParsedEmail(
        message_id="msg-001@acme.com",
        in_reply_to="",
        references=[],
        subject="VFD fault OC1",
        sender="Mike Harper <mike@acme.com>",
        reply_to="mike@acme.com",
        body="The VFD tripped with fault OC1 on Line 3.",
        html_body="",
        attachments=[],
        is_auto_reply=False,
        headers={},
    )
    adapter = EmailChatAdapter(
        file_processor=FileProcessor(storage_path=str(tmp_path)),
        thread_tracker=ThreadTracker(db_path=str(tmp_path / "t.db")),
    )
    event = await adapter.normalize_incoming(
        {"parsed_email": parsed, "tenant_id": "acme", "recipient": "mira@mail.factorylm.com"}
    )

    assert event.platform == "email"
    assert event.external_user_id == "mike@acme.com"
    assert "OC1" in event.text
    assert event.tenant_id == "acme"
    assert event.external_thread_id.startswith("email:")


@pytest.mark.asyncio
async def test_adapter_normalize_with_attachment(tmp_path):
    parsed = ParsedEmail(
        message_id="msg-attach@acme.com",
        in_reply_to="",
        references=[],
        subject="Panel photo",
        sender="mike@acme.com",
        reply_to="mike@acme.com",
        body="",
        html_body="",
        attachments=[
            {
                "filename": "panel.jpg",
                "content_type": "image/jpeg",
                "data": b"\xff\xd8\xff" + b"\x00" * 50,
                "disposition": "attachment",
                "content_id": "",
                "size": 53,
            }
        ],
        is_auto_reply=False,
        headers={},
    )
    adapter = EmailChatAdapter(
        file_processor=FileProcessor(storage_path=str(tmp_path)),
        thread_tracker=ThreadTracker(db_path=str(tmp_path / "t.db")),
    )
    event = await adapter.normalize_incoming(
        {"parsed_email": parsed, "tenant_id": "acme", "recipient": "mira@mail.factorylm.com"}
    )

    assert len(event.attachments) == 1
    assert event.attachments[0].kind == "image"
    assert event.attachments[0].filename == "panel.jpg"


@pytest.mark.asyncio
async def test_adapter_render_outgoing_dry_run(tmp_path):
    adapter = EmailChatAdapter(
        ses_client=None,  # dry-run
        thread_tracker=ThreadTracker(db_path=str(tmp_path / "t.db")),
    )
    response = NormalizedChatResponse(text="Check the motor relay.")
    event = NormalizedChatEvent(
        event_id="msg-001",
        platform="email",
        tenant_id="acme",
        user_id="",
        external_user_id="mike@acme.com",
        external_channel_id="mike@acme.com",
        external_thread_id="email:abc123",
        raw={"subject": "VFD fault", "message_id": "msg-001"},
    )

    # Should not raise (dry-run just logs)
    await adapter.render_outgoing(response, event)


@pytest.mark.asyncio
async def test_adapter_render_outgoing_calls_ses(tmp_path):
    mock_ses = MagicMock()
    mock_ses.send_raw_email = MagicMock(return_value={"MessageId": "ses-001"})

    adapter = EmailChatAdapter(
        ses_client=mock_ses,
        thread_tracker=ThreadTracker(db_path=str(tmp_path / "t.db")),
    )
    response = NormalizedChatResponse(text="Check the motor relay.")
    event = NormalizedChatEvent(
        event_id="msg-001",
        platform="email",
        tenant_id="acme",
        user_id="",
        external_user_id="mike@acme.com",
        external_channel_id="mike@acme.com",
        external_thread_id="email:abc123",
        raw={"subject": "VFD fault", "message_id": "msg-001"},
    )

    await adapter.render_outgoing(response, event)

    mock_ses.send_raw_email.assert_called_once()
    call_kwargs = mock_ses.send_raw_email.call_args[1]
    assert call_kwargs["Destinations"] == ["mike@acme.com"]


# ---------------------------------------------------------------------------
# ChatAdapter protocol compliance
# ---------------------------------------------------------------------------


def test_email_adapter_satisfies_protocol(tmp_path):
    adapter = EmailChatAdapter()
    assert isinstance(adapter, ChatAdapter)
