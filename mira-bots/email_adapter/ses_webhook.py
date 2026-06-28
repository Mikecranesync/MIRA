"""MIRA Email Bot — SES inbound webhook via AWS SNS.

SES inbound rule:
  Email arrives → SES stores raw message in S3 → SNS notification →
  POST /email/inbound → parse + dispatch → SES SendRawEmail reply

Alternate path for testing:
  POST /email/inbound/raw — accepts raw RFC 2822 bytes directly.

Prerequisites:
  1. SES domain verified + inbound rule set to store to S3 + SNS notification
  2. SNS topic subscription confirmed (auto-handled by /email/inbound)
  3. MIRA_EMAIL_ADDRESS in Doppler (e.g. mira@mail.factorylm.com)
  4. EMAIL_S3_BUCKET — bucket where SES stores inbound emails
  5. AWS credentials (via IAM role or env vars)
"""

from __future__ import annotations

import json
import logging
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))  # mira-bots/shared

import httpx
from allowlist import AllowList
from chat_adapter import EmailChatAdapter
from fastapi import FastAPI, Request, Response
from file_processor import FileProcessor
from parser import extract_sender_email, parse_email
from shared.chat.dispatcher import ChatDispatcher
from shared.engine import Supervisor
from thread_tracker import ThreadTracker

logger = logging.getLogger("mira-email")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)

# ── Config ────────────────────────────────────────────────────────────────────

MIRA_DB_PATH = os.environ.get("MIRA_DB_PATH", "/data/mira.db")
OPENWEBUI_URL = os.environ.get("OPENWEBUI_BASE_URL", "http://mira-core:8080")
OPENWEBUI_API_KEY = os.environ.get("OPENWEBUI_API_KEY", "")
COLLECTION_ID = os.environ.get("KNOWLEDGE_COLLECTION_ID", "")
MIRA_TENANT_ID = os.environ.get("MIRA_TENANT_ID", "default")
EMAIL_WEBHOOK_SECRET = os.environ.get("EMAIL_WEBHOOK_SECRET", "")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
EMAIL_S3_BUCKET = os.environ.get("EMAIL_S3_BUCKET", "")
EMAIL_ATTACHMENT_PATH = os.environ.get("EMAIL_ATTACHMENT_PATH", "/data/email-attachments")
EMAIL_THREAD_DB = os.environ.get("EMAIL_THREAD_DB", "/data/email-threads.db")
MIRA_EMAIL_ADDRESS = os.environ.get("MIRA_EMAIL_ADDRESS", "mira@mail.factorylm.com")

# ── Services ──────────────────────────────────────────────────────────────────

engine = Supervisor(
    db_path=MIRA_DB_PATH,
    openwebui_url=OPENWEBUI_URL,
    api_key=OPENWEBUI_API_KEY,
    collection_id=COLLECTION_ID,
    vision_model=os.environ.get("VISION_MODEL", "qwen2.5vl:7b"),
    tenant_id=MIRA_TENANT_ID,
)

file_processor = FileProcessor(storage_path=EMAIL_ATTACHMENT_PATH)
allowlist = AllowList.from_env()
thread_tracker = ThreadTracker(db_path=EMAIL_THREAD_DB)
adapter = EmailChatAdapter(
    file_processor=file_processor,
    allowlist=allowlist,
    thread_tracker=thread_tracker,
    mira_address=MIRA_EMAIL_ADDRESS,
)
dispatcher = ChatDispatcher(engine)

app = FastAPI(title="MIRA Email Bot", version="1.0.0")

# ── Helpers ───────────────────────────────────────────────────────────────────


async def _s3_fetch(bucket: str, key: str) -> bytes:
    try:
        import boto3
        s3 = boto3.client("s3", region_name=AWS_REGION)
        obj = s3.get_object(Bucket=bucket, Key=key)
        return obj["Body"].read()
    except Exception as exc:
        logger.error("S3_FETCH_FAIL bucket=%s key=%s error=%s", bucket, key, str(exc)[:200])
        return b""


def _recipient_to_tenant(recipient: str) -> str:
    """mira+{tenant}@domain → tenant, else fall back to MIRA_TENANT_ID."""
    local = recipient.split("@")[0].lower()
    if "+" in local:
        return local.split("+", 1)[1]
    return MIRA_TENANT_ID


async def _handle_raw_email(raw_bytes: bytes, recipient: str) -> None:
    """Parse and dispatch one raw email. Never raises."""
    if not raw_bytes:
        return

    parsed = parse_email(raw_bytes)

    if parsed.is_auto_reply:
        logger.info("AUTO_REPLY_SKIPPED from=%s", parsed.sender)
        return

    if not parsed.body.strip() and not parsed.attachments:
        logger.info("EMPTY_EMAIL_SKIPPED from=%s", parsed.sender)
        return

    tenant_id = _recipient_to_tenant(recipient)
    sender_addr = extract_sender_email(parsed.sender)

    if not allowlist.is_allowed(sender_addr, tenant_id):
        logger.warning("ALLOWLIST_BLOCKED sender=%s tenant=%s", sender_addr, tenant_id)
        return

    try:
        event = await adapter.normalize_incoming(
            {"parsed_email": parsed, "tenant_id": tenant_id, "recipient": recipient}
        )
        response = await dispatcher.dispatch(event)
        await adapter.render_outgoing(response, event)
    except Exception as exc:
        logger.error("EMAIL_PIPELINE_FAIL from=%s error=%s", parsed.sender, str(exc)[:400])


# ── Routes ────────────────────────────────────────────────────────────────────


@app.post("/email/inbound")
async def sns_inbound(request: Request) -> Response:
    """Receive SNS Notification from SES inbound action."""
    try:
        body_bytes = await request.body()
        body = json.loads(body_bytes)
    except Exception:
        return Response(status_code=400, content="invalid json")

    msg_type = request.headers.get("x-amz-sns-message-type", "")

    # Auto-confirm SNS subscription
    if msg_type == "SubscriptionConfirmation":
        url = body.get("SubscribeURL", "")
        if url:
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    await client.get(url)
                logger.info("SNS_SUBSCRIPTION_CONFIRMED url=%s", url[:80])
            except Exception as exc:
                logger.warning("SNS_CONFIRM_FAIL error=%s", str(exc)[:100])
        return Response(status_code=200)

    if msg_type != "Notification":
        return Response(status_code=200)

    try:
        message = json.loads(body.get("Message", "{}"))
        if message.get("notificationType") != "Received":
            return Response(status_code=200)

        receipt = message.get("receipt", {})
        action = receipt.get("action", {})
        bucket = action.get("bucketName") or EMAIL_S3_BUCKET
        key = action.get("objectKey", "")

        recipients = message.get("mail", {}).get("destination", [])
        recipient = recipients[0] if recipients else MIRA_EMAIL_ADDRESS

        if bucket and key:
            raw_bytes = await _s3_fetch(bucket, key)
        else:
            content = message.get("content", "")
            raw_bytes = content.encode("utf-8") if content else b""

        await _handle_raw_email(raw_bytes, recipient)

    except Exception as exc:
        logger.error("SNS_PROCESS_FAIL error=%s", str(exc)[:300])

    return Response(status_code=200)


@app.post("/email/inbound/raw")
async def raw_inbound(request: Request) -> Response:
    """Direct raw RFC 2822 email POST — for testing and non-SES ingestion."""
    if EMAIL_WEBHOOK_SECRET:
        secret = request.headers.get("x-webhook-secret", "")
        if secret != EMAIL_WEBHOOK_SECRET:
            return Response(status_code=401, content="unauthorized")

    raw_bytes = await request.body()
    recipient = request.headers.get("x-recipient", MIRA_EMAIL_ADDRESS)

    await _handle_raw_email(raw_bytes, recipient)
    return Response(
        status_code=200,
        content='{"status":"ok"}',
        media_type="application/json",
    )


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "platform": "email"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("EMAIL_PORT", "8040"))
    logger.info("MIRA Email bot starting on port %d", port)
    uvicorn.run(app, host="0.0.0.0", port=port)
