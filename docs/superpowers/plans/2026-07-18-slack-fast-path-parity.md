# Slack Fast-Path Parity (①–④) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Slack adapter to parity with Telegram for the four grounded-diagnosis fast-paths (nameplate photo→cited drive-pack ID, wiring photo→proposed rows, wiring text→verified-only Q&A, drive-pack text continuity) via a new shared, adapter-agnostic router.

**Architecture:** A new `shared/chat/fast_paths.py` router takes a `NormalizedChatEvent` + `Supervisor` and returns a `NormalizedChatResponse` or `None` (fall-through). It orchestrates already-shared answer-logic (`shared/drive_packs/*`, `shared/wiring_intake.py`) and a new shared per-conversation drive-context store (`shared/chat/drive_context.py`). Slack's `handle_message` calls the router before the existing dispatcher; Telegram is left on its own copy (migrated in a later PR).

**Tech Stack:** Python 3.12, `uv`, ruff, pytest (`asyncio_mode=auto`), sqlite3 (WAL), psycopg2 (sync, wrapped in `asyncio.to_thread`), slack-bolt AsyncApp.

**Design spec:** `docs/superpowers/specs/2026-07-18-slack-fast-path-parity-design.md`

## Global Constraints

- **Python 3.12**; lint with `ruff check` / `ruff format` (NOT flake8/black). Type hints modern (`str | None`).
- **No new deps** (no LangChain/n8n). httpx for HTTP; `yaml.safe_load` only.
- **Router is adapter-agnostic:** `shared/chat/fast_paths.py` and `shared/chat/drive_context.py` MUST NOT import from `telegram/` or `slack/`.
- **Reads are cited/verified-only; writes are `approval_state='proposed'`** — never auto-verify (ADR-0017 / KG rules).
- **Safety turns yield to the engine** — the router returns `None` for `classify_intent(text)=="safety"` so the engine owns `SAFETY_ALERT`.
- **Telegram adapter, `shared/engine.py`, the FSM, and the dispatcher are NOT modified** by this plan.
- **Conventional Commits**, scope `slack`/`chat`. Bump `/VERSION` (feat→minor) + `docs/CHANGELOG.md` in the final task (code-touching PR is version-gated).
- **Tests:** `python3.12 -m pytest`. Run each test file in isolation (repo has dual-rootdir collision when mixing `tests/` and `mira-bots/tests/`).
- Sentinel: a photo with no real caption carries text `"Analyze this equipment photo"` (Slack sets this fallback; treat it as "no question", same as Telegram's `DEFAULT_PHOTO_CAPTION`).

---

### Task 1: Shared per-conversation drive-context store

**Files:**
- Create: `mira-bots/shared/chat/drive_context.py`
- Test: `mira-bots/tests/test_chat_drive_context.py`

**Interfaces:**
- Consumes: nothing (leaf module). SQLite at `os.environ["MIRA_DB_PATH"]` (default `/data/mira.db`).
- Produces:
  - `set_drive_context(source: str, session_key: str, pack_id: str) -> None`
  - `get_drive_context(source: str, session_key: str, max_age_s: int | None = None) -> str | None`
  - module const `DRIVE_CONTEXT_TTL_S: int = 1800`

- [ ] **Step 1: Write the failing test**

```python
# mira-bots/tests/test_chat_drive_context.py
import importlib
import time
import pytest


@pytest.fixture
def ctx(tmp_path, monkeypatch):
    monkeypatch.setenv("MIRA_DB_PATH", str(tmp_path / "mira.db"))
    import shared.chat.drive_context as dc
    importlib.reload(dc)  # rebind DB path read at import-safe boundaries
    return dc


def test_set_then_get_roundtrip(ctx):
    ctx.set_drive_context("slack", "slack:C1:T1", "gs10")
    assert ctx.get_drive_context("slack", "slack:C1:T1") == "gs10"


def test_ttl_expiry_returns_none(ctx):
    ctx.set_drive_context("slack", "slack:C1:T1", "gs10")
    assert ctx.get_drive_context("slack", "slack:C1:T1", max_age_s=0) is None


def test_source_isolation(ctx):
    ctx.set_drive_context("slack", "k", "gs10")
    assert ctx.get_drive_context("telegram", "k") is None


def test_missing_returns_none(ctx):
    assert ctx.get_drive_context("slack", "nope") is None


def test_set_overwrites_and_refreshes(ctx):
    ctx.set_drive_context("slack", "k", "gs10")
    ctx.set_drive_context("slack", "k", "pf525")
    assert ctx.get_drive_context("slack", "k") == "pf525"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bravonode/Mira-worktrees/slack-parity/mira-bots && python3.12 -m pytest tests/test_chat_drive_context.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'shared.chat.drive_context'`

- [ ] **Step 3: Write minimal implementation**

```python
# mira-bots/shared/chat/drive_context.py
"""Adapter-agnostic per-conversation drive-pack memory (#2782 sibling: Slack parity).

Generalizes the Telegram-local `telegram_drive_context` table. When a nameplate
photo or a drive command identifies a drive for a conversation, remember its pack
so a later TEXT follow-up continues in that pack's context. Keyed by
(source, session_key) with a freshness TTL so a stale context can't hijack a new
topic. A context write must NEVER break the turn — all failures are swallowed.
"""

from __future__ import annotations

import logging
import os
import sqlite3
import time

logger = logging.getLogger("chat-drive-context")

DRIVE_CONTEXT_TTL_S = 1800  # 30 min


def _db() -> sqlite3.Connection:
    db_path = os.environ.get("MIRA_DB_PATH", "/data/mira.db")
    db = sqlite3.connect(db_path)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute(
        "CREATE TABLE IF NOT EXISTS chat_drive_context ("
        "source TEXT NOT NULL, session_key TEXT NOT NULL, "
        "pack_id TEXT NOT NULL, updated_at REAL NOT NULL, "
        "PRIMARY KEY (source, session_key))"
    )
    return db


def set_drive_context(source: str, session_key: str, pack_id: str) -> None:
    try:
        db = _db()
        db.execute(
            "INSERT INTO chat_drive_context (source, session_key, pack_id, updated_at) "
            "VALUES (?, ?, ?, ?) ON CONFLICT(source, session_key) DO UPDATE SET "
            "pack_id = excluded.pack_id, updated_at = excluded.updated_at",
            (source, session_key, pack_id, time.time()),
        )
        db.commit()
        db.close()
    except Exception as exc:  # never let a context write break the turn
        logger.warning("drive-context write failed: %s", exc)


def get_drive_context(
    source: str, session_key: str, max_age_s: int | None = None
) -> str | None:
    max_age = DRIVE_CONTEXT_TTL_S if max_age_s is None else max_age_s
    try:
        db = _db()
        row = db.execute(
            "SELECT pack_id, updated_at FROM chat_drive_context "
            "WHERE source = ? AND session_key = ?",
            (source, session_key),
        ).fetchone()
        db.close()
    except Exception:
        return None
    if not row:
        return None
    pack_id, updated_at = row
    if (time.time() - float(updated_at)) > max_age:
        return None
    return pack_id
```

Also create `mira-bots/shared/chat/__init__.py` if it does not already exist (check: `ls mira-bots/shared/chat/__init__.py`; the `shared.chat` package already exists via `dispatcher.py`/`types.py`, so this file should already be present — do not overwrite it).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/bravonode/Mira-worktrees/slack-parity/mira-bots && python3.12 -m pytest tests/test_chat_drive_context.py -q`
Expected: PASS (5 passed)

- [ ] **Step 5: Lint + commit**

```bash
cd /Users/bravonode/Mira-worktrees/slack-parity
ruff check mira-bots/shared/chat/drive_context.py mira-bots/tests/test_chat_drive_context.py
ruff format mira-bots/shared/chat/drive_context.py mira-bots/tests/test_chat_drive_context.py
git add mira-bots/shared/chat/drive_context.py mira-bots/tests/test_chat_drive_context.py
git commit -m "feat(chat): shared per-conversation drive-context store"
```

---

### Task 2: Fast-path router — safety guard + text paths (③④)

**Files:**
- Create: `mira-bots/shared/chat/fast_paths.py`
- Test: `mira-bots/tests/test_fast_paths_router.py`

**Interfaces:**
- Consumes: `shared.chat.drive_context.{get_drive_context,set_drive_context}` (Task 1); `shared.chat.types.{NormalizedChatEvent,NormalizedChatResponse}`; `shared.guardrails.classify_intent`; `shared.wiring_intake` (`parse_wiring_intent`, `load_profile`, `answer_wiring_question`, `format_wiring_answer`, `open_neon_conn`, `MISSING_ASSET_REPLY`); `shared.drive_packs.answer_question`; `shared.chat_tenant.resolve`.
- Produces:
  - `async def try_fast_paths(event: NormalizedChatEvent, engine) -> NormalizedChatResponse | None`
  - helper `_session_key(event) -> str` = `f"{event.platform}:{event.external_channel_id}:{event.external_thread_id}"`
  - helper `_format_drive_pack_reply(result) -> str` (copied from `telegram/bot.py:213`, verbatim — plain text + `[Source: …]` + metadata footer)
  - module const `DRIVE_QUESTION_RE` (copied from `telegram/bot.py:476`)
  - module const `DEFAULT_PHOTO_CAPTION = "Analyze this equipment photo"`

- [ ] **Step 1: Write the failing test (text paths + safety + fall-through)**

```python
# mira-bots/tests/test_fast_paths_router.py
import importlib
import types
import pytest

from shared.chat.types import NormalizedChatEvent


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
        event_id="e", platform=platform, tenant_id="t", user_id="u",
        external_user_id="U1", external_channel_id=channel, external_thread_id=thread,
        text=text, attachments=attachments or [],
    )


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
        matched=True, answer="CE10 = comm loss", citations=[],
        answer_source="drive_pack", pack_id="gs10",
        fallback_used=False, live_telemetry=False, read_only=True,
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
        fp.wiring_intake, "parse_wiring_intent",
        lambda _t: types.SimpleNamespace(kind="question", asset="cv-101", question="where does W200 land"),
    )
    monkeypatch.setattr(fp, "_answer_wiring_blocking", lambda _tid, _a, _q: "ANSWER")
    monkeypatch.setattr(fp.wiring_intake, "format_wiring_answer", lambda _ans, _a: "W200 lands on X1:3")
    resp = await fp.try_fast_paths(_evt("where does W200 land on cv-101?"), engine=object())
    assert resp is not None
    assert "W200 lands on X1:3" in resp.text


@pytest.mark.asyncio
async def test_plain_text_falls_through(router, monkeypatch):
    fp, _ = router
    monkeypatch.setattr(fp, "classify_intent", lambda _t: "industrial")
    monkeypatch.setattr(
        fp.wiring_intake, "parse_wiring_intent",
        lambda _t: types.SimpleNamespace(kind="none", asset=None, question=None),
    )
    resp = await fp.try_fast_paths(_evt("hello there"), engine=object())
    assert resp is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bravonode/Mira-worktrees/slack-parity/mira-bots && python3.12 -m pytest tests/test_fast_paths_router.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'shared.chat.fast_paths'`

- [ ] **Step 3: Write minimal implementation (text paths only; photo paths added in Task 3)**

```python
# mira-bots/shared/chat/fast_paths.py
"""Adapter-agnostic grounded fast-path router (Slack/Telegram parity).

Given a NormalizedChatEvent + a Supervisor engine, returns a NormalizedChatResponse
if a grounded fast-path claims the turn, else None (caller falls through to the
FSM/LLM dispatcher). Fast-paths are read-only or `proposed`-write, cited, and never
invoke the LLM. A safety turn is handed straight to the engine (SAFETY_ALERT).

Precedence mirrors the Telegram adapter:
  photo: nameplate-drive-pack -> wiring-intake -> None
  text : drive-pack-followup  -> wiring-question -> None
"""

from __future__ import annotations

import asyncio
import base64
import logging
import re

from shared import chat_tenant, wiring_intake
from shared.chat.drive_context import get_drive_context, set_drive_context
from shared.chat.types import NormalizedChatEvent, NormalizedChatResponse
from shared.drive_packs import answer_question, build_asset_identity, load_pack, resolve_service_pack
from shared.guardrails import classify_intent

logger = logging.getLogger("fast-paths")

DEFAULT_PHOTO_CAPTION = "Analyze this equipment photo"

# A drive-question signal in free text (verbatim from telegram/bot.py:476).
DRIVE_QUESTION_RE = re.compile(
    r"\b[A-Za-z]\d{2}\.\d{2}\b"
    r"|\bP\d{3,4}\b"
    r"|\b(parameter|param|fault|error\s*code|alarm|trip|keypad|register)\b",
    re.IGNORECASE,
)


def _session_key(event: NormalizedChatEvent) -> str:
    return f"{event.platform}:{event.external_channel_id}:{event.external_thread_id}"


def _format_drive_pack_reply(result) -> str:
    # Verbatim from telegram/bot.py:_format_drive_pack_reply.
    reply = result.answer
    if result.citations:
        reply += "\n\nSources:"
        for c in result.citations:
            page = f" p.{c['page']}" if c.get("page") else ""
            reply += f"\n[Source: {c['doc']}{page}]"
    reply += (
        f"\n\nsource: {result.answer_source} · pack: {result.pack_id} · "
        f"fallback_used: {str(result.fallback_used).lower()} · "
        f"live_telemetry: {str(result.live_telemetry).lower()} · "
        f"read_only: {str(result.read_only).lower()}"
    )
    return reply


def _answer_wiring_blocking(tenant_id: str, asset: str, question: str):
    """Sync DB glue — read-only verified-rows answer. Mirrors telegram/bot.py."""
    conn = wiring_intake.open_neon_conn()
    try:
        with conn.cursor() as cur:
            profile = wiring_intake.load_profile(cur, tenant_id, asset=asset)
    finally:
        conn.close()
    return wiring_intake.answer_wiring_question(profile, question)


def _resp(event: NormalizedChatEvent, text: str) -> NormalizedChatResponse:
    return NormalizedChatResponse(text=text, thread_id=event.external_thread_id)


async def _try_drive_pack_followup(event: NormalizedChatEvent) -> NormalizedChatResponse | None:
    text = event.text or ""
    if not text:
        return None
    pack_id = get_drive_context(event.platform, _session_key(event))
    if not pack_id:
        return None
    result = await asyncio.to_thread(answer_question, pack_id, text)
    if not (result.matched or DRIVE_QUESTION_RE.search(text)):
        return None
    set_drive_context(event.platform, _session_key(event), pack_id)  # refresh TTL
    return _resp(event, _format_drive_pack_reply(result))


async def _try_wiring_question(event: NormalizedChatEvent) -> NormalizedChatResponse | None:
    text = event.text or ""
    intent = wiring_intake.parse_wiring_intent(text)
    if intent.kind != "question":
        return None
    if not intent.asset:
        return _resp(event, wiring_intake.MISSING_ASSET_REPLY)
    tenant_id = chat_tenant.resolve(event.external_user_id)
    answer = await asyncio.to_thread(
        _answer_wiring_blocking, tenant_id, intent.asset, intent.question or text
    )
    return _resp(event, wiring_intake.format_wiring_answer(answer, intent.asset))


async def try_fast_paths(event: NormalizedChatEvent, engine) -> NormalizedChatResponse | None:
    # Safety turns always go to the engine (SAFETY_ALERT).
    if classify_intent(event.text or "") == "safety":
        return None

    has_photo = any(getattr(a, "kind", "") == "image" and a.data for a in event.attachments)

    if has_photo:
        # Photo paths added in Task 3.
        return None

    for handler in (_try_drive_pack_followup, _try_wiring_question):
        try:
            resp = await handler(event)
        except Exception as exc:  # a broken fast-path degrades to the engine, never errors the turn
            logger.warning("fast-path %s failed: %s", handler.__name__, exc)
            resp = None
        if resp is not None:
            return resp
    return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/bravonode/Mira-worktrees/slack-parity/mira-bots && python3.12 -m pytest tests/test_fast_paths_router.py -q`
Expected: PASS (5 passed)

- [ ] **Step 5: Lint + commit**

```bash
cd /Users/bravonode/Mira-worktrees/slack-parity
ruff check mira-bots/shared/chat/fast_paths.py mira-bots/tests/test_fast_paths_router.py
ruff format mira-bots/shared/chat/fast_paths.py mira-bots/tests/test_fast_paths_router.py
git add mira-bots/shared/chat/fast_paths.py mira-bots/tests/test_fast_paths_router.py
git commit -m "feat(chat): fast-path router — safety guard + text paths (wiring Q&A, drive continuity)"
```

---

### Task 3: Fast-path router — photo paths (①②)

**Files:**
- Modify: `mira-bots/shared/chat/fast_paths.py` (add photo handlers; wire into `try_fast_paths`)
- Test: `mira-bots/tests/test_fast_paths_router.py` (add photo cases)

**Interfaces:**
- Consumes: `engine.nameplate.extract(photo_b64: str) -> dict`; `engine._extract_schematic(photo_b64: str) -> dict`; `resolve_service_pack(nameplate=…) -> PackResolution` (`.pack_id: str | None`, `.reason: str`); `load_pack(pack_id)` (`.family.manufacturer`, `.family.series`); `build_asset_identity(nameplate=…, resolution=…)`; `wiring_intake.{payload_to_proposed_rows, write_proposed_rows, build_intake_preview, open_neon_conn}`.
- Produces: `_try_nameplate_drive_pack(event, engine)`, `_try_wiring_intake(event, engine)`, `_write_rows_blocking(tenant_id, rows)`; `try_fast_paths` photo branch now dispatches these.

- [ ] **Step 1: Write the failing test (append to test_fast_paths_router.py)**

```python
from shared.chat.types import NormalizedAttachment


def _photo_evt(caption="", **kw):
    att = NormalizedAttachment(kind="image", mime_type="image/jpeg", filename="p.jpg", url="", data=b"IMG")
    return _evt(text=caption, attachments=[att], **kw)


@pytest.mark.asyncio
async def test_nameplate_resolves_sets_context_and_replies(router, monkeypatch):
    fp, dc = router
    monkeypatch.setattr(fp, "classify_intent", lambda _t: "industrial")

    async def fake_extract(_b64):
        return {"manufacturer": "TECO", "model": "GS10"}
    engine = types.SimpleNamespace(nameplate=types.SimpleNamespace(extract=fake_extract))
    monkeypatch.setattr(
        fp, "resolve_service_pack",
        lambda **kw: types.SimpleNamespace(pack_id="gs10", reason="ok"),
    )
    monkeypatch.setattr(fp, "build_asset_identity", lambda **kw: types.SimpleNamespace(
        manufacturer="TECO", model_number="GS10", sku_prefix="", serial_number="",
        candidate_pack_id="gs10", approval_status="live"))
    monkeypatch.setattr(fp, "load_pack", lambda _pid: types.SimpleNamespace(
        family=types.SimpleNamespace(manufacturer="TECO", series="GS10")))
    # no question (default caption) -> identify + invite
    resp = await fp.try_fast_paths(_photo_evt(caption="Analyze this equipment photo"), engine=engine)
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
    resp = await fp.try_fast_paths(_photo_evt(caption="Analyze this equipment photo"), engine=engine)
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
    monkeypatch.setattr(fp.wiring_intake, "parse_wiring_intent",
                        lambda _t: types.SimpleNamespace(kind="intake", asset="cv-101", question=None))
    monkeypatch.setattr(fp.wiring_intake, "payload_to_proposed_rows", lambda *a, **k: [{"r": 1}])
    monkeypatch.setattr(fp, "_write_rows_blocking", lambda _tid, _rows: (1, 0))
    monkeypatch.setattr(fp.wiring_intake, "build_intake_preview", lambda *a: "Proposed 1 wiring row")
    monkeypatch.setattr(fp.chat_tenant, "resolve", lambda _uid: "tenant-1")
    resp = await fp.try_fast_paths(_photo_evt(caption="cv-101 add this wiring"), engine=engine)
    assert resp is not None
    assert "Proposed 1 wiring row" in resp.text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bravonode/Mira-worktrees/slack-parity/mira-bots && python3.12 -m pytest tests/test_fast_paths_router.py -q`
Expected: FAIL — `AttributeError: module 'shared.chat.fast_paths' has no attribute '_write_rows_blocking'` (and the photo assertions fail because `try_fast_paths` returns None on photos)

- [ ] **Step 3: Add photo handlers to `fast_paths.py`**

Add these functions (after `_try_wiring_question`), and replace the photo branch stub in `try_fast_paths`:

```python
def _write_rows_blocking(tenant_id: str, rows: list):
    """Sync DB glue — writes proposed wiring rows. Mirrors telegram/bot.py."""
    conn = wiring_intake.open_neon_conn()
    try:
        with conn.cursor() as cur:
            inserted, skipped = wiring_intake.write_proposed_rows(cur, tenant_id, rows)
        conn.commit()
    finally:
        conn.close()
    return inserted, skipped


async def _try_nameplate_drive_pack(event: NormalizedChatEvent, engine) -> NormalizedChatResponse | None:
    att = next((a for a in event.attachments if getattr(a, "kind", "") == "image" and a.data), None)
    if att is None:
        return None
    photo_b64 = base64.b64encode(att.data).decode()
    try:
        fields = await engine.nameplate.extract(photo_b64)
    except Exception as exc:
        logger.warning("nameplate extract failed: %s", exc)
        return None
    if not isinstance(fields, dict) or "parse_error" in fields:
        return None

    resolution = resolve_service_pack(nameplate=fields)
    build_asset_identity(nameplate=fields, resolution=resolution)  # audit/evidence (Phase 2)

    caption = event.text or ""
    has_question = bool(caption) and caption != DEFAULT_PHOTO_CAPTION

    if resolution.pack_id is not None:
        pack = load_pack(resolution.pack_id)
        set_drive_context(event.platform, _session_key(event), resolution.pack_id)
        if has_question:
            result = await asyncio.to_thread(answer_question, resolution.pack_id, caption)
            return _resp(event, _format_drive_pack_reply(result))
        return _resp(
            event,
            f"\U0001f4c7 Identified: {pack.family.manufacturer} {pack.family.series} "
            f'— ask me about it, e.g. "what does CE10 mean?"',
        )

    if has_question and "recognized manufacturer" in resolution.reason:
        return _resp(event, resolution.reason)
    return None


async def _try_wiring_intake(event: NormalizedChatEvent, engine) -> NormalizedChatResponse | None:
    caption = event.text or ""
    intent = wiring_intake.parse_wiring_intent(caption)
    if intent.kind != "intake":
        return None
    if not intent.asset:
        return _resp(event, wiring_intake.MISSING_ASSET_REPLY)
    att = next((a for a in event.attachments if getattr(a, "kind", "") == "image" and a.data), None)
    if att is None:
        return None
    tenant_id = chat_tenant.resolve(event.external_user_id)
    photo_b64 = base64.b64encode(att.data).decode()
    payload = await engine._extract_schematic(photo_b64)
    if not payload or not payload.get("relationships"):
        return _resp(
            event,
            "I couldn't read any wiring connections from that image. "
            "Send a clearer electrical print.",
        )
    key = _session_key(event)
    rows = wiring_intake.payload_to_proposed_rows(
        payload, intent.asset,
        drawing_ref=f"{event.platform}:{key}",
        proposed_by=f"{event.platform}:wiring_intake",
        source=f"{event.platform}:{key}",
    )
    inserted, skipped = await asyncio.to_thread(_write_rows_blocking, tenant_id, rows)
    return _resp(event, wiring_intake.build_intake_preview(payload, inserted, skipped, intent.asset))
```

Replace the photo branch in `try_fast_paths`:

```python
    if has_photo:
        for handler in (_try_nameplate_drive_pack, _try_wiring_intake):
            try:
                resp = await handler(event, engine)
            except Exception as exc:
                logger.warning("fast-path %s failed: %s", handler.__name__, exc)
                resp = None
            if resp is not None:
                return resp
        return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/bravonode/Mira-worktrees/slack-parity/mira-bots && python3.12 -m pytest tests/test_fast_paths_router.py -q`
Expected: PASS (8 passed)

- [ ] **Step 5: Lint + commit**

```bash
cd /Users/bravonode/Mira-worktrees/slack-parity
ruff check mira-bots/shared/chat/fast_paths.py mira-bots/tests/test_fast_paths_router.py
ruff format mira-bots/shared/chat/fast_paths.py mira-bots/tests/test_fast_paths_router.py
git add mira-bots/shared/chat/fast_paths.py mira-bots/tests/test_fast_paths_router.py
git commit -m "feat(chat): fast-path router — photo paths (nameplate drive-pack, wiring intake)"
```

---

### Task 4: Wire the router into the Slack adapter + Hub photo submit + version bump

**Files:**
- Modify: `mira-bots/slack/bot.py` (import + call router before dispatch; background Hub photo submit)
- Modify: `mira-bots/slack/chat_adapter.py` **only if** `normalize_incoming` does not already set `external_thread_id` to the thread anchor (verify first; see Step 1)
- Test: `mira-bots/tests/test_slack_fast_paths.py`
- Modify: `VERSION`, `docs/CHANGELOG.md`

**Interfaces:**
- Consumes: `shared.chat.fast_paths.try_fast_paths` (Task 3); the module-global `engine` already constructed in `slack/bot.py`; existing `say`, `_thread_ts`, `log_turn`, `measure_ms`.
- Produces: Slack `handle_message` calls `try_fast_paths` before `dispatcher.dispatch`.

- [ ] **Step 1: Verify the adapter sets `external_thread_id`**

Run: `rg -n "external_thread_id|thread_ts|external_channel_id" mira-bots/slack/chat_adapter.py`
Expected: `normalize_incoming` sets `external_channel_id=event["channel"]` and `external_thread_id=event.get("thread_ts", event.get("ts",""))`. If `external_thread_id` is NOT populated with the thread anchor (thread_ts-or-ts), fix it so per-thread scoping works:

```python
# in normalize_incoming(...)
external_thread_id=raw_event.get("thread_ts", raw_event.get("ts", "")),
```

- [ ] **Step 2: Write the failing integration test**

```python
# mira-bots/tests/test_slack_fast_paths.py
import importlib
import sys
import types
import pytest


@pytest.fixture
def slackbot(tmp_path, monkeypatch):
    monkeypatch.setenv("MIRA_DB_PATH", str(tmp_path / "mira.db"))
    monkeypatch.setenv("SLACK_BOT_TOKEN", "xoxb-test")
    monkeypatch.setenv("SLACK_APP_TOKEN", "xapp-test")
    for m in ("shared.chat.drive_context", "shared.chat.fast_paths", "slack.bot"):
        if m in sys.modules:
            importlib.reload(sys.modules[m])
    import slack.bot as bot
    importlib.reload(bot)
    return bot


@pytest.mark.asyncio
async def test_photo_nameplate_reply_in_thread(slackbot, monkeypatch):
    bot = slackbot
    sent = {}

    async def say(text=None, thread_ts=None, **kw):
        sent["text"] = text
        sent["thread_ts"] = thread_ts

    async def fake_router(event, engine):
        from shared.chat.types import NormalizedChatResponse
        return NormalizedChatResponse(text="📷 Identified: TECO GS10", thread_id=event.external_thread_id)

    monkeypatch.setattr(bot, "try_fast_paths", fake_router)
    # a photo event with a file
    event = {"channel": "C1", "ts": "T1", "user": "U1",
             "files": [{"mimetype": "image/jpeg", "url_private_download": "http://x/p.jpg", "name": "p.jpg"}]}
    monkeypatch.setattr(bot, "_download_slack_file", lambda _u: _async_bytes())
    await bot.handle_message(event, say, client=None)
    assert "Identified" in sent["text"]
    assert sent["thread_ts"] == "T1"


async def _async_bytes():
    return b"IMG"
```

Note for the implementer: the exact monkeypatch seams (how `handle_message` obtains bytes) depend on the wiring in Step 3 — adjust the test's patched names to match the final `handle_message`. The behavioral assertions (router response is `say`'d in-thread; router is called before dispatch) are the contract.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/bravonode/Mira-worktrees/slack-parity/mira-bots && python3.12 -m pytest tests/test_slack_fast_paths.py -q`
Expected: FAIL — `AttributeError: module 'slack.bot' has no attribute 'try_fast_paths'`

- [ ] **Step 4: Wire the router into `slack/bot.py handle_message`**

Add the import near the other `shared` imports:

```python
from shared.chat.fast_paths import try_fast_paths
```

In `handle_message`, AFTER the image download/resize block (where `img_att.data` is set) and BEFORE `response = await dispatcher.dispatch(normalized)`, insert:

```python
    # Grounded fast-paths (parity with Telegram): nameplate→drive-pack,
    # wiring intake, wiring Q&A, drive continuity. Returns None → fall through.
    fp_resp = await try_fast_paths(normalized, engine)
    if fp_resp is not None:
        await say(text=fp_resp.text, thread_ts=thread)
        await log_turn(
            chat_id=str(event.get("channel", "")),
            user_message=normalized.text or "",
            bot_response=fp_resp.text or "",
            source="slack",
            intent="fast_path",
            has_citations=("[Source:" in (fp_resp.text or "")),
            response_time_ms=0,
        )
        return
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/bravonode/Mira-worktrees/slack-parity/mira-bots && python3.12 -m pytest tests/test_slack_fast_paths.py -q`
Expected: PASS

- [ ] **Step 6: Full-suite regression (no Telegram/engine regressions)**

```bash
cd /Users/bravonode/Mira-worktrees/slack-parity/mira-bots
python3.12 -m pytest tests/test_chat_drive_context.py tests/test_fast_paths_router.py tests/test_slack_fast_paths.py -q
python3.12 -m pytest tests/test_slack_adapter.py tests/test_slack_relay.py -q
python3.12 -m pytest tests/test_telegram_wiring_hooks.py tests/test_telegram_nameplate_ask.py tests/test_telegram_drive_followup.py -q
```
Expected: all PASS (Telegram unaffected — proves the shared modules didn't regress it).

- [ ] **Step 7: Version bump + changelog + commit**

```bash
cd /Users/bravonode/Mira-worktrees/slack-parity
# bump minor: read current, set X.(Y+1).0
printf '<NEW_MINOR>' > VERSION   # e.g. if main is 3.165.0 at merge time → 3.166.0
```
Prepend to `docs/CHANGELOG.md` under `# MIRA Release Notes`:

```markdown
### vX.Y.0 (2026-07-18) - feat(slack): Telegram fast-path parity — nameplate/wiring/drive-pack grounded fast-paths

- Slack now runs the same four grounded fast-paths as Telegram via a new adapter-agnostic router (`shared/chat/fast_paths.py`) + shared per-conversation drive-context store (`shared/chat/drive_context.py`, per-thread on Slack): nameplate photo → cited drive-pack ID, wiring photo → `proposed` rows, wiring text → verified-only Q&A, drive-pack text continuity. Reads are cited/verified-only; writes are `approval_state='proposed'`; safety turns yield to the engine. Telegram unchanged (its shared-router migration is a separate PR).
```

```bash
git add mira-bots/slack/bot.py mira-bots/tests/test_slack_fast_paths.py VERSION docs/CHANGELOG.md
# include chat_adapter.py only if Step 1 required the fix
git commit -m "feat(slack): wire grounded fast-path router into the Slack adapter"
```

---

## Self-Review

**Spec coverage:**
- ① nameplate photo → Task 3 (`_try_nameplate_drive_pack`). ✓
- ② wiring photo → proposed rows → Task 3 (`_try_wiring_intake`). ✓
- ③ wiring text → verified-only → Task 2 (`_try_wiring_question`). ✓
- ④ drive-pack continuity → Task 1 (store) + Task 2 (`_try_drive_pack_followup`). ✓
- Per-thread scoping → Task 2 `_session_key` uses `external_thread_id`; Task 4 Step 1 verifies the adapter sets it. ✓
- Safety yield → Task 2 (`classify_intent=="safety"` → None) + test. ✓
- Slack wiring, Telegram untouched → Task 4 (+ Step 6 regression). ✓
- Hub asset-identity → `build_asset_identity` is called for audit in Task 3 (evidence not dropped). NOTE: the background Hub *file* submit (Telegram's `_submit_photo_to_hub`) is intentionally NOT ported in this plan — it is orthogonal to the four fast-paths and adds env/config surface; if parity requires it, add a follow-up task wiring `shared.contextualization_intake.submit_file_to_hub_folder` into the Slack photo branch. Flagged as a known deferral.

**Placeholder scan:** `<NEW_MINOR>` / `vX.Y.0` in Task 4 Step 7 are deliberate — the exact number depends on `origin/main`'s VERSION at merge time (main moves fast). Compute at execution. No other placeholders.

**Type consistency:** `try_fast_paths(event, engine)` signature consistent across Tasks 2–4. `_session_key`, `_format_drive_pack_reply`, `_write_rows_blocking`, `_answer_wiring_blocking` names consistent. `PackResolution.pack_id/.reason`, `DrivePackAnswer.matched/.answer/.citations`, `WiringIntent.kind/.asset/.question` match the shared source.

**Known deferral surfaced:** background Hub file submit for Slack photos (see Spec coverage note) — decide during execution or a follow-up PR.
