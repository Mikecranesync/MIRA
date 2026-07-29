import importlib
import types
import pytest

from shared.chat.types import NormalizedAttachment, NormalizedChatEvent


@pytest.fixture
def router(tmp_path, monkeypatch):
    monkeypatch.setenv("MIRA_DB_PATH", str(tmp_path / "mira.db"))
    import shared.chat.drive_context as dc

    importlib.reload(dc)
    import shared.chat.fast_paths as fp

    importlib.reload(fp)
    return fp, dc


def _evt(text="", platform="slack", channel="C1", thread="T1", attachments=None):
    return NormalizedChatEvent(
        event_id="e",
        platform=platform,
        tenant_id="t",
        user_id="u",
        external_user_id="U1",
        external_channel_id=channel,
        external_thread_id=thread,
        text=text,
        attachments=attachments or [],
    )


def _photo_evt(caption="", **kw):
    att = NormalizedAttachment(
        kind="image", mime_type="image/jpeg", filename="p.jpg", url="", data=b"IMG"
    )
    return _evt(text=caption, attachments=[att], **kw)


@pytest.mark.asyncio
async def test_safety_text_yields_to_engine(router, monkeypatch):
    fp, _ = router
    monkeypatch.setattr(fp, "classify_intent", lambda _t: "safety")
    resp = await fp.try_fast_paths(_evt("the panel is arcing"), engine=object())
    assert resp is None  # engine owns SAFETY_ALERT


@pytest.mark.asyncio
async def test_drive_followup_answers_from_context(router, monkeypatch):
    fp, dc = router
    monkeypatch.setattr(fp, "classify_intent", lambda _t: "industrial")
    dc.set_drive_context("slack", "slack:C1:T1", "gs10")
    fake = types.SimpleNamespace(
        matched=True,
        answer="CE10 = comm loss",
        citations=[],
        answer_source="drive_pack",
        pack_id="gs10",
        fallback_used=False,
        live_telemetry=False,
        read_only=True,
    )
    monkeypatch.setattr(fp, "answer_question", lambda _p, _q: fake)
    resp = await fp.try_fast_paths(_evt("what is CE10?"), engine=object())
    assert resp is not None
    assert "CE10 = comm loss" in resp.text


@pytest.mark.asyncio
async def test_drive_followup_no_context_falls_through(router, monkeypatch):
    fp, _ = router
    monkeypatch.setattr(fp, "classify_intent", lambda _t: "industrial")
    resp = await fp.try_fast_paths(_evt("what is CE10?"), engine=object())
    assert resp is None


@pytest.mark.asyncio
async def test_wiring_question_verified_only(router, monkeypatch):
    fp, _ = router
    monkeypatch.setattr(fp, "classify_intent", lambda _t: "industrial")
    monkeypatch.setattr(
        fp.wiring_intake,
        "parse_wiring_intent",
        lambda _t: types.SimpleNamespace(
            kind="question", asset="cv-101", question="where does W200 land"
        ),
    )
    monkeypatch.setattr(fp, "_answer_wiring_blocking", lambda _tid, _a, _q: "ANSWER")
    monkeypatch.setattr(
        fp.wiring_intake, "format_wiring_answer", lambda _ans, _a: "W200 lands on X1:3"
    )
    resp = await fp.try_fast_paths(_evt("where does W200 land on cv-101?"), engine=object())
    assert resp is not None
    assert "W200 lands on X1:3" in resp.text


@pytest.mark.asyncio
async def test_plain_text_falls_through(router, monkeypatch):
    fp, _ = router
    monkeypatch.setattr(fp, "classify_intent", lambda _t: "industrial")
    monkeypatch.setattr(
        fp.wiring_intake,
        "parse_wiring_intent",
        lambda _t: types.SimpleNamespace(kind="none", asset=None, question=None),
    )
    resp = await fp.try_fast_paths(_evt("hello there"), engine=object())
    assert resp is None


@pytest.mark.asyncio
async def test_nameplate_resolves_sets_context_and_replies(router, monkeypatch):
    fp, dc = router
    monkeypatch.setattr(fp, "classify_intent", lambda _t: "industrial")

    async def fake_extract(_b64):
        return {"manufacturer": "TECO", "model": "GS10"}

    engine = types.SimpleNamespace(nameplate=types.SimpleNamespace(extract=fake_extract))
    monkeypatch.setattr(
        fp,
        "resolve_service_pack",
        lambda **kw: types.SimpleNamespace(pack_id="gs10", reason="ok"),
    )
    monkeypatch.setattr(
        fp,
        "build_asset_identity",
        lambda **kw: types.SimpleNamespace(
            manufacturer="TECO",
            model_number="GS10",
            sku_prefix="",
            serial_number="",
            candidate_pack_id="gs10",
            approval_status="live",
        ),
    )
    monkeypatch.setattr(
        fp,
        "load_pack",
        lambda _pid: types.SimpleNamespace(
            family=types.SimpleNamespace(manufacturer="TECO", series="GS10")
        ),
    )
    # no question (default caption) -> identify + invite
    resp = await fp.try_fast_paths(
        _photo_evt(caption="Analyze this equipment photo"), engine=engine
    )
    assert resp is not None
    assert "Identified" in resp.text
    assert dc.get_drive_context("slack", "slack:C1:T1") == "gs10"


@pytest.mark.asyncio
async def test_nameplate_unresolved_falls_through(router, monkeypatch):
    fp, _ = router
    monkeypatch.setattr(fp, "classify_intent", lambda _t: "industrial")

    async def fake_extract(_b64):
        return {"parse_error": "unreadable"}

    engine = types.SimpleNamespace(nameplate=types.SimpleNamespace(extract=fake_extract))
    resp = await fp.try_fast_paths(
        _photo_evt(caption="Analyze this equipment photo"), engine=engine
    )
    assert resp is None  # → engine multi-photo


@pytest.mark.asyncio
async def test_wiring_intake_writes_proposed_rows(router, monkeypatch):
    fp, _ = router
    monkeypatch.setattr(fp, "classify_intent", lambda _t: "industrial")

    async def fake_extract(_b64):
        return {"parse_error": "not a nameplate"}  # nameplate declines first

    async def fake_schematic(_b64):
        return {"relationships": [{"from": "W200", "to": "X1:3"}]}

    engine = types.SimpleNamespace(
        nameplate=types.SimpleNamespace(extract=fake_extract),
        _extract_schematic=fake_schematic,
    )
    monkeypatch.setattr(
        fp.wiring_intake,
        "parse_wiring_intent",
        lambda _t: types.SimpleNamespace(kind="intake", asset="cv-101", question=None),
    )
    monkeypatch.setattr(fp.wiring_intake, "payload_to_proposed_rows", lambda *a, **k: [{"r": 1}])
    monkeypatch.setattr(fp, "_write_rows_blocking", lambda _tid, _rows: (1, 0))
    monkeypatch.setattr(
        fp.wiring_intake, "build_intake_preview", lambda *a: "Proposed 1 wiring row"
    )
    monkeypatch.setattr(fp.chat_tenant, "resolve", lambda _uid: "tenant-1")
    resp = await fp.try_fast_paths(_photo_evt(caption="cv-101 add this wiring"), engine=engine)
    assert resp is not None
    assert "Proposed 1 wiring row" in resp.text
