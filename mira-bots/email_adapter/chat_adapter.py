"""Email chat adapter implementing the ChatAdapter protocol.

Inbound:  SES → SNS → ses_webhook.py → normalize_incoming() → ChatDispatcher
Outbound: ChatDispatcher → render_outgoing() → SES SendRawEmail
"""

from __future__ import annotations

import logging
import os

from allowlist import AllowList
from file_processor import FileProcessor
from parser import ParsedEmail, extract_sender_email
from renderers import render_email
from shared.chat.types import NormalizedAttachment, NormalizedChatEvent, NormalizedChatResponse
from thread_tracker import ThreadTracker

logger = logging.getLogger("mira-email")

_MIRA_ADDRESS = os.environ.get("MIRA_EMAIL_ADDRESS", "mira@mail.factorylm.com")


class EmailChatAdapter:
    platform = "email"

    def __init__(
        self,
        *,
        file_processor: FileProcessor | None = None,
        allowlist: AllowList | None = None,
        thread_tracker: ThreadTracker | None = None,
        ses_client=None,
        mira_address: str = _MIRA_ADDRESS,
    ) -> None:
        self._fp = file_processor or FileProcessor()
        self._allow = allowlist or AllowList.from_env()
        self._threads = thread_tracker or ThreadTracker()
        self._ses = ses_client
        self._mira_address = mira_address

    async def normalize_incoming(self, raw_event: dict) -> NormalizedChatEvent:
        """Convert an inbound email dict to NormalizedChatEvent.

        raw_event keys:
            parsed_email  — ParsedEmail namedtuple from parser.py
            tenant_id     — str
            recipient     — str (the MIRA address that received the email)
        """
        parsed: ParsedEmail = raw_event["parsed_email"]
        tenant_id: str = raw_event.get("tenant_id", "")

        sender_addr = extract_sender_email(parsed.sender)

        thread_id = self._threads.resolve(
            message_id=parsed.message_id,
            in_reply_to=parsed.in_reply_to,
            references=parsed.references,
            subject=parsed.subject,
            sender=sender_addr,
        )

        attachments: list[NormalizedAttachment] = []
        attachment_summaries: list[str] = []

        for att_dict in parsed.attachments:
            filename = att_dict.get("filename", "attachment")
            ct = att_dict.get("content_type", "application/octet-stream")
            data = att_dict.get("data", b"")

            result = await self._fp.process(filename, ct, data)
            attachment_summaries.append(result.get("description", ""))

            att = NormalizedAttachment(
                kind=_ct_to_kind(ct),
                mime_type=ct,
                filename=filename,
                url="",
                auth_header="",
                size_bytes=len(data),
                data=data,
            )
            # Stash processing result so dispatcher can use extracted text
            att._process_result = result  # type: ignore[attr-defined]
            attachments.append(att)

        # Build message text — body + attachment processing summaries
        text_parts = []
        if parsed.body.strip():
            text_parts.append(parsed.body.strip())
        for summary in attachment_summaries:
            if summary:
                text_parts.append(f"[Attachment: {summary}]")
        text = "\n\n".join(text_parts)

        return NormalizedChatEvent(
            event_id=parsed.message_id or _fallback_id(parsed),
            platform="email",
            tenant_id=tenant_id,
            user_id="",
            external_user_id=sender_addr,
            external_channel_id=sender_addr,
            external_thread_id=thread_id,
            text=text,
            attachments=attachments,
            event_type="dm",
            raw={
                "subject": parsed.subject,
                "sender": parsed.sender,
                "message_id": parsed.message_id,
                "in_reply_to": parsed.in_reply_to,
            },
        )

    async def render_outgoing(
        self, response: NormalizedChatResponse, event: NormalizedChatEvent
    ) -> None:
        """Send MIRA response as a HTML email via SES."""
        orig_subject = event.raw.get("subject", "")
        if orig_subject and not orig_subject.lower().startswith("re:"):
            subject = f"Re: {orig_subject}"
        elif not orig_subject:
            subject = "MIRA Response"
        else:
            subject = orig_subject

        to_addr = event.external_user_id
        plain_text, html_body = render_email(response, subject=subject)

        if self._ses is None:
            logger.info(
                "EMAIL_DRY_RUN to=%s subject=%s len=%d",
                to_addr, subject, len(plain_text),
            )
            return

        try:
            raw_msg = _build_mime_email(
                from_addr=self._mira_address,
                to_addr=to_addr,
                subject=subject,
                plain_text=plain_text,
                html_body=html_body,
                in_reply_to=event.raw.get("message_id", ""),
            )
            self._ses.send_raw_email(
                Source=self._mira_address,
                Destinations=[to_addr],
                RawMessage={"Data": raw_msg},
            )
            logger.info("EMAIL_SENT to=%s subject=%s", to_addr, subject)
        except Exception as exc:
            logger.error("EMAIL_SEND_FAIL to=%s error=%s", to_addr, str(exc)[:300])

    async def download_attachment(self, attachment: NormalizedAttachment) -> bytes:
        """Email attachments are already in-memory from normalize_incoming."""
        return attachment.data


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ct_to_kind(ct: str) -> str:
    ct = ct.lower().split(";")[0].strip()
    if ct.startswith("image/"):
        return "image"
    if ct == "application/pdf":
        return "pdf"
    if ct.startswith("text/") or "document" in ct or "spreadsheet" in ct or "presentation" in ct:
        return "document"
    return "other"


def _fallback_id(parsed: ParsedEmail) -> str:
    import hashlib
    key = f"{parsed.sender}:{parsed.subject}:{parsed.body[:100]}"
    return "email-" + hashlib.sha256(key.encode()).hexdigest()[:12]


def _build_mime_email(
    from_addr: str,
    to_addr: str,
    subject: str,
    plain_text: str,
    html_body: str,
    in_reply_to: str = "",
) -> bytes:
    import email.mime.multipart
    import email.mime.text
    from email.header import Header

    msg = email.mime.multipart.MIMEMultipart("alternative")
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg["Subject"] = str(Header(subject, "utf-8"))
    if in_reply_to:
        msg["In-Reply-To"] = f"<{in_reply_to}>"
        msg["References"] = f"<{in_reply_to}>"

    msg.attach(email.mime.text.MIMEText(plain_text, "plain", "utf-8"))
    msg.attach(email.mime.text.MIMEText(html_body, "html", "utf-8"))
    return msg.as_bytes()
