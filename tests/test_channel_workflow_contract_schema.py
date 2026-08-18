"""Published channel-workflow schema/runtime parity locks."""

from __future__ import annotations

import json
from pathlib import Path
import re

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "contracts/channel-workflow.v1.schema.json").read_text())
TENANT = "11111111-1111-4111-8111-111111111111"
USER = "22222222-2222-4222-8222-222222222222"


def request(*, user_id: str = USER, uploader_id: str = USER) -> dict[str, object]:
    return {
        "contractVersion": "1.0",
        "tenantId": TENANT,
        "actor": {
            "userId": user_id,
            "externalUserId": "42",
            "uploaderId": uploader_id,
        },
        "channel": "telegram",
        "eventId": "tg:9001",
        "conversation": {"id": "telegram:-42"},
        "action": "message",
        "text": "Can you find the manual?",
        "caption": "",
        "attachments": [],
    }


def _schema_accepts_actor_id(field: str, value: str) -> bool:
    actor_field = SCHEMA["properties"]["actor"]["properties"][field]
    assert actor_field == {"$ref": "#/$defs/uuid"}
    uuid_pattern = SCHEMA["$defs"]["uuid"]["pattern"]
    return re.fullmatch(uuid_pattern, value) is not None


def test_published_schema_accepts_canonical_actor_uuids() -> None:
    payload = request()
    actor = payload["actor"]
    assert _schema_accepts_actor_id("userId", actor["userId"])  # type: ignore[index]
    assert _schema_accepts_actor_id("uploaderId", actor["uploaderId"])  # type: ignore[index]


def test_published_schema_declares_user_authorized_delivery_recovery() -> None:
    assert "recover_delivery" in SCHEMA["properties"]["action"]["enum"]
    non_message_actions = SCHEMA["allOf"][0]["if"]["properties"]["action"]["enum"]
    assert "recover_delivery" in non_message_actions
    recovery_rule = SCHEMA["allOf"][1]
    assert "recover_delivery" in recovery_rule["if"]["properties"]["action"]["enum"]
    assert recovery_rule["then"]["required"] == ["priorOperationId"]


def test_published_schema_limits_corrected_identity_to_confirmation() -> None:
    identity_rule = SCHEMA["allOf"][2]
    assert identity_rule["if"]["required"] == ["confirmedIdentity"]
    assert identity_rule["then"]["properties"]["action"] == {"const": "confirm_identity"}


def test_published_schema_limits_prior_operation_to_consuming_actions() -> None:
    prior_rule = SCHEMA["allOf"][3]
    assert prior_rule["if"]["required"] == ["priorOperationId"]
    assert prior_rule["then"]["properties"]["action"]["enum"] == [
        "confirm_identity",
        "recover_delivery",
    ]


@pytest.mark.parametrize("field", ["userId", "uploaderId"])
def test_published_schema_rejects_noncanonical_actor_ids(field: str) -> None:
    assert not _schema_accepts_actor_id(field, "user-123")
