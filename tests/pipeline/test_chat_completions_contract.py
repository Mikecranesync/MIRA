"""Contract tests for POST /v1/chat/completions (OpenAI-compat surface).

This is the live VPS chat path: Open WebUI → mira-pipeline → Supervisor.
The Supervisor is mocked (tests/pipeline/conftest.py); everything is offline.
"""

from __future__ import annotations


def _chat_payload(content, role: str = "user", **extra):
    return {"model": "mira-diagnostic", "messages": [{"role": role, "content": content}], **extra}


def test_chat_completion_openai_shape(pipeline_client, mock_engine):
    """A plain user turn returns the full OpenAI chat.completion envelope."""
    resp = pipeline_client.post(
        "/v1/chat/completions",
        json=_chat_payload("why is conveyor CV-101 stopped?"),
        headers={"X-OpenWebUI-Chat-Id": "chat-abc"},
    )
    assert resp.status_code == 200
    body = resp.json()

    assert body["id"].startswith("chatcmpl-")
    assert body["object"] == "chat.completion"
    assert body["model"] == "mira-diagnostic"
    assert isinstance(body["created"], int)
    choice = body["choices"][0]
    assert choice["index"] == 0
    assert choice["finish_reason"] == "stop"
    assert choice["message"]["role"] == "assistant"
    assert choice["message"]["content"] == "Grounded diagnostic reply [manual p.12]"
    assert set(body["usage"]) == {"prompt_tokens", "completion_tokens", "total_tokens"}

    # The engine saw the OW chat id and the OpenWebUI platform tag.
    kwargs = mock_engine.process.await_args.kwargs
    assert kwargs["chat_id"] == "chat-abc"
    assert kwargs["platform"] == "openwebui"
    assert kwargs["message"] == "why is conveyor CV-101 stopped?"


def test_chat_completion_no_user_message_is_400(pipeline_client, mock_engine):
    resp = pipeline_client.post(
        "/v1/chat/completions", json=_chat_payload("You are MIRA.", role="system")
    )
    assert resp.status_code == 400
    mock_engine.process.assert_not_awaited()


def test_chat_completion_engine_uninitialized_is_503(pipeline_client, monkeypatch):
    import main

    monkeypatch.setattr(main, "engine", None)
    resp = pipeline_client.post("/v1/chat/completions", json=_chat_payload("hello"))
    assert resp.status_code == 503


def test_owui_synthetic_title_task_never_reaches_engine(pipeline_client, mock_engine):
    """Open WebUI title-generation tasks must not corrupt FSM state."""
    resp = pipeline_client.post(
        "/v1/chat/completions",
        json=_chat_payload("### Task:\nGenerate a title for this chat."),
    )
    assert resp.status_code == 200
    assert resp.json()["choices"][0]["message"]["content"] == ""
    mock_engine.process.assert_not_awaited()


def test_owui_continue_echoes_last_assistant_turn(pipeline_client, mock_engine):
    resp = pipeline_client.post(
        "/v1/chat/completions",
        json={
            "model": "mira-diagnostic",
            "messages": [
                {"role": "user", "content": "check the VFD"},
                {"role": "assistant", "content": "Fault F0004 — check DC bus."},
                {"role": "user", "content": "### Task: Continue the response"},
            ],
        },
    )
    assert resp.status_code == 200
    assert resp.json()["choices"][0]["message"]["content"] == "Fault F0004 — check DC bus."
    mock_engine.process.assert_not_awaited()


def test_reset_phrase_resets_fsm_and_clears_qr_cookie(pipeline_client, mock_engine):
    resp = pipeline_client.post(
        "/v1/chat/completions",
        json=_chat_payload("reset"),
        headers={"X-OpenWebUI-Chat-Id": "chat-reset"},
    )
    assert resp.status_code == 200
    assert "reset" in resp.json()["choices"][0]["message"]["content"].lower()
    mock_engine.reset.assert_called_once_with("chat-reset")
    mock_engine.process.assert_not_awaited()
    # Reset wins over any pending QR scan (#409) — one-shot cookie is cleared.
    assert "mira_pending_scan" in resp.headers.get("set-cookie", "")
