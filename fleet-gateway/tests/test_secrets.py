from __future__ import annotations

from helpers import LAUNCH_OK, TEST_BEARER


def test_secrets_never_logged(service, auth, caplog):
    params = dict(LAUNCH_OK)
    params["api_key"] = "sk-this-must-not-be-logged"
    params["password"] = "hunter2-secret"
    params["authorization"] = "Bearer leaked-inner-token"
    with caplog.at_level("DEBUG"):
        service.invoke("launch_worker", params, authorization=auth)
    raw = service.audit.path.read_text(encoding="utf-8")
    assert TEST_BEARER not in raw
    assert "sk-this-must-not-be-logged" not in raw
    assert "hunter2-secret" not in raw
    assert "leaked-inner-token" not in raw
    rec = service.audit.read_all()[-1]
    assert rec["parameters"]["api_key"] == "[redacted]"
    assert rec["parameters"]["password"] == "[redacted]"
    blob = caplog.text
    assert TEST_BEARER not in blob
    assert "sk-this-must-not-be-logged" not in blob
