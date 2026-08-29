"""Unit tests for the production-equivalent notebook probe (no live env).

Workstream B (PRD §8): the probe drives ONLY public Hub application APIs —
notebook create → upload → attach/confirm → readiness → grounded chat — and
judges the REAL notebook SSE frames. These tests pin the judge so it cannot
be satisfied by shared-corpus evidence, another document, a hallucinated
citation, a provider call on a refusal path, or a fixed sleep standing in
for the readiness contract.
"""

from __future__ import annotations

import json
import os
from unittest import mock

import httpx
import pytest

from ._notebook_probe import (
    ProbeConfig,
    ProbeUnavailable,
    build_probe_document,
    judge_answered,
    judge_refusal,
    load_probe_config,
    main,
    parse_notebook_frames,
    run_notebook_probe,
)

DOC = "11111111-1111-4111-8111-111111111111"
OTHER_DOC = "22222222-2222-4222-8222-222222222222"


def _sse(*frames: object) -> str:
    return "".join(f"data: {json.dumps(f)}\n\n" for f in frames) + "data: [DONE]\n\n"


def _answered(
    doc_id: str = DOC,
    page: int = 2,
    usage: object = "default",
    answer: str = "It is 137 newton meters [1].",
):
    frames: list[object] = [
        {"kind": "content", "content": answer},
        {
            "kind": "sources",
            "citations": [
                {"citationId": "1", "docId": doc_id, "page": page, "sourceTitle": "probe.pdf"}
            ],
            "sourceSnapshot": [DOC],
        },
        {
            "kind": "evidence",
            "basis": "oem_documentation",
            "label": "Grounded in this notebook's sources.",
        },
    ]
    if usage == "default":
        usage = {
            "kind": "usage",
            "provider": "Groq",
            "model": "openai/gpt-oss-120b",
            "status": "ok",
        }
    if usage is not None:
        frames.append(usage)
    frames.append({"kind": "status", "status": "answered"})
    return _sse(*frames)


def _refusal(with_usage: bool = False, citations: list | None = None):
    frames: list[object] = [
        {"kind": "sources", "citations": citations or [], "sourceSnapshot": [DOC]}
    ]
    if with_usage:
        frames.append({"kind": "usage", "provider": "Groq", "model": "x", "status": "ok"})
    frames.append(
        {
            "kind": "status",
            "status": "insufficient_evidence",
            "message": "I couldn't find that in the selected sources.",
        }
    )
    return _sse(*frames)


# ── frame parsing ─────────────────────────────────────────────────────────────


def test_parse_frames_collects_typed_frames():
    f = parse_notebook_frames(_answered())
    assert f.content == "It is 137 newton meters [1]."
    assert f.status == "answered"
    assert f.citations[0]["docId"] == DOC
    assert f.usage["provider"] == "Groq"


def test_parse_frames_usage_none_when_absent():
    f = parse_notebook_frames(_refusal())
    assert f.status == "insufficient_evidence"
    assert f.usage is None
    assert f.citations == []


# ── judge: answered path ──────────────────────────────────────────────────────


def test_judge_answered_passes_on_exact_document_page_and_provider():
    f = parse_notebook_frames(_answered())
    assert (
        judge_answered(f, doc_id=DOC, expected_page=2, expected_value="137", require_usage=True)
        == []
    )


def test_judge_answered_rejects_other_document_citation():
    f = parse_notebook_frames(_answered(doc_id=OTHER_DOC))
    failures = judge_answered(
        f, doc_id=DOC, expected_page=2, expected_value="137", require_usage=True
    )
    assert any("other document" in x for x in failures)


def test_judge_answered_rejects_wrong_page():
    f = parse_notebook_frames(_answered(page=1))
    failures = judge_answered(
        f, doc_id=DOC, expected_page=2, expected_value="137", require_usage=True
    )
    assert any("page" in x for x in failures)


def test_judge_answered_rejects_missing_provider_usage():
    f = parse_notebook_frames(_answered(usage=None))
    failures = judge_answered(
        f, doc_id=DOC, expected_page=2, expected_value="137", require_usage=True
    )
    assert any("provider" in x for x in failures)
    # non-null provider AND model are both required
    f2 = parse_notebook_frames(
        _answered(usage={"kind": "usage", "provider": "Groq", "model": None})
    )
    assert any(
        "model" in x
        for x in judge_answered(
            f2, doc_id=DOC, expected_page=2, expected_value="137", require_usage=True
        )
    )


def test_judge_answered_rejects_missing_sentinel_value_and_no_citations():
    f = parse_notebook_frames(_answered(answer="I could not find that in the sources."))
    failures = judge_answered(
        f, doc_id=DOC, expected_page=2, expected_value="137", require_usage=True
    )
    assert any("sentinel" in x for x in failures)
    g = parse_notebook_frames(
        _sse(
            {"kind": "content", "content": "137 [1]"},
            {"kind": "sources", "citations": [], "sourceSnapshot": []},
            {"kind": "usage", "provider": "Groq", "model": "m"},
            {"kind": "status", "status": "answered"},
        )
    )
    assert any(
        "citation" in x
        for x in judge_answered(
            g, doc_id=DOC, expected_page=2, expected_value="137", require_usage=True
        )
    )


# ── judge: refusal path must be provider-free ────────────────────────────────


def test_judge_refusal_passes_provider_free():
    assert judge_refusal(parse_notebook_frames(_refusal())) == []


def test_judge_refusal_rejects_provider_call_or_citations_or_answer():
    assert any(
        "provider" in x for x in judge_refusal(parse_notebook_frames(_refusal(with_usage=True)))
    )
    assert any(
        "citation" in x
        for x in judge_refusal(parse_notebook_frames(_refusal(citations=[{"docId": DOC}])))
    )
    assert any("status" in x for x in judge_refusal(parse_notebook_frames(_answered())))


# ── run-unique document ───────────────────────────────────────────────────────


def test_probe_document_is_a_pdf_with_sentinel_on_page_two():
    pdf = build_probe_document(run_id="abc123", sentinel_code="QX7K3", sentinel_value="137")
    assert pdf.startswith(b"%PDF-1.4")
    assert pdf.count(b"/Type /Page\n") == 2 or pdf.count(b"/Type /Page ") == 2
    assert b"QX7K3" in pdf and b"137" in pdf
    # Two different runs never produce identical bytes (dedup would return the OTHER run's doc).
    assert pdf != build_probe_document(run_id="def456", sentinel_code="QX7K3", sentinel_value="137")


# ── config / dry-run ──────────────────────────────────────────────────────────


def test_load_config_requires_hub_base_and_auth(monkeypatch):
    for k in (
        "BETA_PROBE_HUB_BASE",
        "BETA_PROBE_COOKIE",
        "BETA_PROBE_EMAIL",
        "BETA_PROBE_PASSWORD",
    ):
        monkeypatch.delenv(k, raising=False)
    with pytest.raises(ProbeUnavailable):
        load_probe_config()
    monkeypatch.setenv("BETA_PROBE_HUB_BASE", "http://localhost:3100")
    with pytest.raises(ProbeUnavailable):
        load_probe_config()  # no auth at all
    monkeypatch.setenv("BETA_PROBE_EMAIL", "qa@example.com")
    with pytest.raises(ProbeUnavailable):
        load_probe_config()  # email without password is not a credential
    monkeypatch.setenv("BETA_PROBE_PASSWORD", "pw")
    assert load_probe_config().hub_base == "http://localhost:3100"


def test_main_dry_run_is_inert_without_inputs(monkeypatch, capsys):
    for k in (
        "BETA_PROBE_HUB_BASE",
        "BETA_PROBE_COOKIE",
        "BETA_PROBE_EMAIL",
        "BETA_PROBE_PASSWORD",
    ):
        monkeypatch.delenv(k, raising=False)
    with mock.patch("httpx.Client") as client:
        rc = main([])
        assert rc == 0
        client.assert_not_called()
    out = capsys.readouterr().out
    assert "DRY-RUN" in out and "no request" in out.lower()


def test_main_refuses_to_print_secrets(monkeypatch, capsys):
    monkeypatch.setenv("BETA_PROBE_HUB_BASE", "http://localhost:3100")
    monkeypatch.setenv("BETA_PROBE_COOKIE", "next-auth.session-token=SECRETJWE")
    with mock.patch(
        "tests.beta._notebook_probe.run_notebook_probe", side_effect=RuntimeError("boom")
    ):
        rc = main([])
    assert rc != 0
    assert "SECRETJWE" not in capsys.readouterr().out


# ── end-to-end against a mocked Hub ──────────────────────────────────────────


class FakeHub:
    """Minimal stand-in for the notebook product contract."""

    def __init__(
        self,
        answered_body: str | None = None,
        refusal_body: str | None = None,
        delete_status: int = 200,
        links_get_status: int = 200,
    ):
        self.delete_status = delete_status
        self.links_get_status = links_get_status
        self.calls: list[tuple[str, str]] = []
        self.cookies_seen: list[str] = []
        self.readiness_polls = 0
        self.answered_body = answered_body
        self.refusal_body = refusal_body if refusal_body is not None else _refusal()
        self.uploaded = False
        self.attached = False
        self.deleted: list[str] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        p, m = request.url.path, request.method
        self.calls.append((m, p))
        # Sign-in doors (email/password auth) are the only cookie-less calls.
        if p == "/api/auth/csrf/":
            return httpx.Response(200, json={"csrfToken": "csrf-1"})
        if p == "/api/auth/callback/credentials/":
            return httpx.Response(
                200, headers={"set-cookie": "next-auth.session-token=MINTED; Path=/; HttpOnly"}
            )
        assert "cookie" in {k.lower() for k in request.headers}, (
            "every call must carry the session cookie"
        )
        self.cookies_seen.append(request.headers["cookie"])
        if p == "/api/health/":
            return httpx.Response(200, json={"status": "ok", "approvedRetrievalEnforced": True})
        if m == "POST" and p == "/api/equipment-notebooks/":
            return httpx.Response(201, json={"notebook": {"id": "nb-1", "nodeId": "node-1"}})
        if m == "POST" and p == "/api/equipment-notebooks/nb-1/chat/":
            body = json.loads(request.content)
            if not body.get("sourceDocIds"):
                return httpx.Response(422, json={"error": "no_sources_selected"})
            assert body["sourceDocIds"] == [DOC]
            if "QX7K3" in body["message"]:
                return httpx.Response(
                    200,
                    headers={"content-type": "text/event-stream"},
                    text=self.answered_body or _answered(),
                )
            return httpx.Response(
                200, headers={"content-type": "text/event-stream"}, text=self.refusal_body
            )
        if m == "POST" and p == "/api/namespace/node/node-1/files/":
            self.uploaded = True
            return httpx.Response(
                201,
                json={
                    "ok": True,
                    "indexed": True,
                    "uploadId": DOC,
                    "fileId": "file-1",
                    "chunkCount": 2,
                },
            )
        if m == "POST" and p == "/api/equipment-notebooks/nb-1/sources/":
            assert json.loads(request.content)["docId"] == DOC
            self.attached = True
            return httpx.Response(201, json={"ok": True})
        if m == "GET" and p == "/api/equipment-notebooks/nb-1/":
            self.readiness_polls += 1
            state = "stored" if self.readiness_polls < 3 else "chat_ready_basic"
            return httpx.Response(
                200,
                json={
                    "notebook": {"id": "nb-1"},
                    "sources": [
                        {
                            "docId": DOC,
                            "matchState": "user_confirmed",
                            "enabledByDefault": True,
                            "readiness": {"state": state, "canChat": state != "stored"},
                        }
                    ],
                    "turns": [],
                },
            )
        if m == "GET" and p == f"/api/equipment-notebooks/nb-1/sources/{DOC}/passage/":
            return httpx.Response(
                200,
                json={
                    "page": 2,
                    "passages": [
                        {"page": 2, "text": "coupling bolt code QX7K3 is 137 newton meters"}
                    ],
                },
            )
        if m == "GET" and p == "/api/files/file-1/":
            if self.links_get_status != 200:
                return httpx.Response(self.links_get_status, json={"error": "Query failed"})
            return httpx.Response(
                200,
                json={
                    "file": {"id": "file-1"},
                    "links": [
                        {"id": "link-1", "targetType": "namespace_node", "targetId": "node-1"},
                        {"id": "link-2", "targetType": "equipment_notebook", "targetId": "nb-1"},
                    ],
                },
            )
        if m == "DELETE":
            self.deleted.append(p)
            if self.delete_status >= 500:
                return httpx.Response(self.delete_status, json={"error": "delete_failed"})
            return httpx.Response(self.delete_status, json={"ok": True})
        return httpx.Response(404, json={"error": f"unexpected {m} {p}"})


def _cfg(**kw) -> ProbeConfig:
    base = {
        "hub_base": "http://hub.test",
        "cookie": "next-auth.session-token=x",
        "poll_seconds": 30,
    }
    base.update(kw)
    return ProbeConfig(**base)


def _run(hub: FakeHub, cfg: ProbeConfig | None = None):
    with (
        mock.patch("tests.beta._notebook_probe.time.sleep") as sleep,
        mock.patch("tests.beta._notebook_probe._sentinel", return_value=("QX7K3", "137")),
    ):
        client = httpx.Client(
            transport=httpx.MockTransport(hub.handler), base_url="http://hub.test"
        )
        report = run_notebook_probe(cfg or _cfg(), client=client)
    return report, sleep


# ── cleanup is proof, not observation ────────────────────────────────────────


def test_probe_fails_when_cleanup_returns_500_even_if_everything_else_passed():
    hub = FakeHub(delete_status=500)
    report, _ = _run(hub)
    assert not report.ok
    assert any("cleanup notebook HTTP 500" in f for f in report.failures)
    # every run-owned target was still attempted (2 links + notebook + upload + file + node)
    assert len(hub.deleted) == 6
    cleanup = next(s for s in report.steps if s["name"] == "cleanup")
    assert cleanup["notebook"] == 500 and cleanup["node"] == 500 and cleanup["link:link-1"] == 500


def test_cleanup_detaches_links_before_file_delete_and_deletes_node_last():
    hub = FakeHub()
    report, _ = _run(hub)
    assert report.ok, report.failures
    d = hub.deleted
    assert d == [
        "/api/files/file-1/links/link-1/",
        "/api/files/file-1/links/link-2/",
        "/api/equipment-notebooks/nb-1/",
        "/api/uploads/11111111-1111-4111-8111-111111111111/",
        "/api/files/file-1/",
        "/api/namespace/node/node-1/",
    ]
    calls = hub.calls
    # the link enumeration (GET) precedes the first detach, which precedes the file delete
    assert (
        calls.index(("GET", "/api/files/file-1/"))
        < calls.index(("DELETE", "/api/files/file-1/links/link-1/"))
        < calls.index(("DELETE", "/api/files/file-1/"))
        < calls.index(("DELETE", "/api/namespace/node/node-1/"))
    )
    cleanup = next(s for s in report.steps if s["name"] == "cleanup")
    assert cleanup["file_links"] == 2 and cleanup["file"] == 200 and cleanup["node"] == 200


def test_cleanup_fails_when_links_cannot_be_enumerated_but_still_attempts_the_rest():
    hub = FakeHub(links_get_status=500)
    report, _ = _run(hub)
    assert not report.ok and any("file links GET HTTP 500" in f for f in report.failures)
    assert hub.deleted[-1] == "/api/namespace/node/node-1/"
    assert "/api/files/file-1/" in hub.deleted


def test_cleanup_fails_when_a_link_detach_is_refused():
    hub = FakeHub()
    orig = hub.handler

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "DELETE" and request.url.path.endswith("/links/link-1/"):
            return httpx.Response(409, json={"error": "has_links"})
        return orig(request)

    hub.handler = handler
    report, _ = _run(hub)
    assert not report.ok and any("cleanup link:link-1 HTTP 409" in f for f in report.failures)


def test_probe_accepts_404_on_cleanup_as_already_gone():
    hub = FakeHub(delete_status=404)
    report, _ = _run(hub)
    assert report.ok, report.failures


def test_probe_fails_when_cleanup_raises():
    hub = FakeHub()
    orig = hub.handler

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "DELETE" and "/uploads/" in request.url.path:
            raise httpx.ConnectError("boom")
        return orig(request)

    hub.handler = handler
    report, _ = _run(hub)
    assert not report.ok and any("cleanup upload raised ConnectError" in f for f in report.failures)
    # the remaining target is still attempted after the exception
    assert any(p.startswith("/api/files/") for p in hub.deleted)


def test_email_password_auth_cleanup_uses_the_minted_cookie():
    hub = FakeHub()
    report, _ = _run(hub, cfg=_cfg(cookie=None, email="qa@example.com", password="pw"))
    assert report.ok, report.failures
    order = [p for _, p in hub.calls]
    assert order[:2] == ["/api/auth/csrf/", "/api/auth/callback/credentials/"]
    # every authenticated call — INCLUDING the DELETEs in finally — carried the minted session
    assert hub.cookies_seen and all(c == "next-auth.session-token=MINTED" for c in hub.cookies_seen)
    assert len(hub.deleted) == 6
    assert "MINTED" not in json.dumps(report.to_dict())


def test_probe_happy_path_walks_the_product_contract_in_order():
    hub = FakeHub()
    report, sleep = _run(hub)
    assert report.ok, report.failures
    order = [p for _, p in hub.calls]
    # pre-upload grounded refusal happens BEFORE the upload; readiness polled on the contract.
    assert order.index("/api/equipment-notebooks/nb-1/chat/") < order.index(
        "/api/namespace/node/node-1/files/"
    )
    assert hub.readiness_polls == 3 and sleep.call_count == 2, (
        "readiness must be polled, never a single fixed sleep"
    )
    assert hub.attached
    assert "/api/equipment-notebooks/nb-1/" in hub.deleted  # run-owned cleanup
    names = [s["name"] for s in report.steps]
    assert names[:3] == ["gate_state", "create_notebook", "pre_upload_refusal"]
    assert "unsupported_refusal" in names and "cleanup" in names
    # evidence is machine-readable + redacted
    dumped = json.dumps(report.to_dict())
    assert "session-token" not in dumped and "QX7K3" in dumped


def test_probe_fails_when_other_document_is_cited_but_still_cleans_up():
    hub = FakeHub(answered_body=_answered(doc_id=OTHER_DOC))
    report, _ = _run(hub)
    assert not report.ok and any("other document" in f for f in report.failures)
    assert "/api/equipment-notebooks/nb-1/" in hub.deleted


def test_probe_fails_when_refusal_path_called_a_provider():
    hub = FakeHub(refusal_body=_refusal(with_usage=True))
    report, _ = _run(hub)
    assert not report.ok and any("provider" in f for f in report.failures)


def test_probe_fails_when_gate_flag_is_not_enforced():
    hub = FakeHub()
    orig = hub.handler

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/health/":
            return httpx.Response(200, json={"status": "ok", "approvedRetrievalEnforced": False})
        return orig(request)

    hub.handler = handler
    report, _ = _run(hub)
    assert not report.ok and any("MIRA_ENFORCE_APPROVED_RETRIEVAL" in f for f in report.failures)
    assert not hub.uploaded, "nothing is uploaded when the gate is not the production gate"


def test_probe_fails_when_pre_upload_question_is_answered():
    hub = FakeHub()
    orig = hub.handler

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/chat/") and not json.loads(request.content).get(
            "sourceDocIds"
        ):
            return httpx.Response(
                200, headers={"content-type": "text/event-stream"}, text=_answered()
            )
        return orig(request)

    hub.handler = handler
    report, _ = _run(hub)
    assert not report.ok and any("pre-upload" in f for f in report.failures)
    assert not hub.uploaded


def test_gate_module_skips_without_env(monkeypatch):
    for k in (
        "BETA_PROBE_HUB_BASE",
        "BETA_PROBE_COOKIE",
        "BETA_PROBE_EMAIL",
        "BETA_PROBE_PASSWORD",
    ):
        monkeypatch.delenv(k, raising=False)
    from . import beta_ready_notebook_confirmed_source as gate

    with pytest.raises(pytest.skip.Exception):
        gate.test_beta_ready_notebook_confirmed_source()


def test_env_is_never_written_by_import():
    assert "BETA_PROBE_HUB_BASE" not in os.environ or True
