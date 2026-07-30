"""Print-workspace persistence spine (Package A) — hermetic tests.

Covers ``shared/print_workspace.py`` + the two additive store methods
(``supersede_observation`` / ``set_current_revision``) on the InMemory store:
mapping CRUD + TTL, photo-turn ingest (bbox single-writer), zero-OCR honesty,
close-up supersede-by-tag-overlap, revision bumps, fail-open behavior, the
PrintSynth graph sink (CAS + LIKELY observation), technician observations,
and vision_data reconstruction.

Hermetic and keyless: InMemory visual store (``NEON_DATABASE_URL`` removed),
tmp sqlite mapping db via ``MIRA_DB_PATH``, tmp CAS dir, no network, no LLM.
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, "mira-bots")

import pytest

pytest.importorskip("PIL")

from PIL import Image

from shared import print_workspace
from shared.visual.evidence_state import EvidenceState
from shared.visual.models import Observation
from shared.visual.store import InMemoryVisualStore

# --------------------------------------------------------------------------- #
# fixtures + helpers
# --------------------------------------------------------------------------- #


@pytest.fixture
def ws_env(monkeypatch, tmp_path):
    """Hermetic workspace environment: no Neon, tmp mapping db, tmp CAS."""
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
    monkeypatch.setenv("MIRA_DB_PATH", str(tmp_path / "mira.db"))
    monkeypatch.setenv("MIRA_PRINT_CAS_DIR", str(tmp_path / "cas"))
    print_workspace._reset_for_tests()
    yield tmp_path
    print_workspace._reset_for_tests()


_IMAGE_CACHE: dict[str, bytes] = {}


def _good_image_bytes() -> bytes:
    """A small, sharp, high-contrast checkerboard that passes the quality
    gate (sharpness 1.0 + contrast 1.0 -> combined 0.80 >= 0.35) while
    staying fast on the pure-python (no-numpy) variance path."""
    cached = _IMAGE_CACHE.get("good")
    if cached is not None:
        return cached
    img = Image.new("L", (320, 240))
    px = img.load()
    for y in range(240):
        for x in range(320):
            px[x, y] = 255 if ((x // 8) + (y // 8)) % 2 == 0 else 0
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    _IMAGE_CACHE["good"] = buf.getvalue()
    return _IMAGE_CACHE["good"]


def _tokens(*pairs: tuple[str, list[int]]) -> list[dict]:
    return [{"text": text, "bbox": bbox} for text, bbox in pairs]


def _print_vision(**overrides) -> dict:
    data = {
        "classification": "ELECTRICAL_PRINT",
        "classification_confidence": 0.9,
        "drawing_type": "control circuit",
        "ocr_items": [],
    }
    data.update(overrides)
    return data


def _age_mapping_row(db_path: str, chat_id: str, seconds: float) -> None:
    db = sqlite3.connect(db_path)
    db.execute(
        "UPDATE telegram_print_workspace SET updated_at = updated_at - ? WHERE chat_id = ?",
        (seconds, chat_id),
    )
    db.commit()
    db.close()


async def _drain_tasks() -> None:
    for _ in range(4):
        await asyncio.sleep(0)


def _store() -> InMemoryVisualStore:
    store = print_workspace._get_service().store
    assert isinstance(store, InMemoryVisualStore), "tests must run on the InMemory store"
    return store


# --------------------------------------------------------------------------- #
# mapping CRUD + TTL
# --------------------------------------------------------------------------- #


def test_mapping_crud_and_ttl(ws_env):
    assert print_workspace.get_workspace("no-such-chat") is None

    print_workspace.set_workspace("c1", "s1", "t1")
    ref = print_workspace.get_workspace("c1")
    assert ref is not None
    assert (ref.chat_id, ref.session_id, ref.tenant_id, ref.last_entity) == ("c1", "s1", "t1", None)

    # last_entity upsert semantics: explicit value sticks; None preserves it.
    print_workspace.set_workspace("c1", "s1", "t1", last_entity="K44")
    assert print_workspace.get_workspace("c1").last_entity == "K44"
    print_workspace.set_workspace("c1", "s2", "t1")
    ref = print_workspace.get_workspace("c1")
    assert ref.session_id == "s2"
    assert ref.last_entity == "K44"

    # fresh row honored under a TTL; aged row rejected only when TTL given.
    assert print_workspace.get_workspace("c1", max_age_s=3600) is not None
    _age_mapping_row(os.environ["MIRA_DB_PATH"], "c1", 7200)
    assert print_workspace.get_workspace("c1", max_age_s=3600) is None
    assert print_workspace.get_workspace("c1") is not None


# --------------------------------------------------------------------------- #
# photo-turn ingest (the bbox single-writer path)
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_photo_turn_creates_workspace_and_mapping(ws_env):
    vision = _print_vision(
        ocr_items=["-27/K44", "21/22"],
        ocr_tokens=_tokens(("-27/K44", [10, 20, 110, 40]), ("21/22", [200, 300, 260, 320])),
    )
    outcome = await print_workspace.persist_print_turn(
        "chat-1", "tenant-1", _good_image_bytes(), vision, "explain this print", "THE ANSWER"
    )
    assert outcome is not None
    assert outcome.status == "ingested"
    assert outcome.evidence_id

    ref = print_workspace.get_workspace("chat-1")
    assert ref is not None
    assert ref.session_id == outcome.session_id
    assert ref.tenant_id == "tenant-1"

    store = _store()
    session = await store.get_session(outcome.session_id, "tenant-1")
    assert session is not None
    assert outcome.revision
    assert session.current_revision == outcome.revision

    obs = await store.load_observations(outcome.session_id, "tenant-1")
    ocr = [o for o in obs if o.extractor == "ocr"]
    # single-writer: exactly one VISIBLE row per token, bbox metadata carried,
    # and NO duplicate bare-ocr_items rows from the spine.
    assert len(ocr) == 2
    assert {o.raw_value for o in ocr} == {"-27/K44", "21/22"}
    assert all(o.evidence_state is EvidenceState.VISIBLE for o in ocr)
    assert all(o.metadata.get("bbox") for o in ocr)
    assert len(outcome.new_observation_ids) == 2

    # the Q&A turn was recorded against the session
    answers = [q["answer"] for q in store._questions.values()]
    assert "THE ANSWER" in answers


@pytest.mark.asyncio
async def test_ingest_writes_visible_ocr_ledger(ws_env):
    """Bare ocr_items (no tokens): the spine writes the VISIBLE rows."""
    vision = _print_vision(ocr_items=["S110", "K20"])
    outcome = await print_workspace.ingest_print_photo(
        "chat-2", _good_image_bytes(), vision, "explain this print", tenant_id="t2"
    )
    assert outcome is not None
    assert outcome.status == "ingested"
    assert len(outcome.new_observation_ids) == 2

    obs = await _store().load_observations(outcome.session_id, "t2")
    ocr = [o for o in obs if o.extractor == "ocr"]
    assert {o.raw_value for o in ocr} == {"S110", "K20"}
    assert all(o.evidence_state is EvidenceState.VISIBLE for o in ocr)


@pytest.mark.asyncio
async def test_zero_ocr_ingest_stays_honest(ws_env):
    vision = _print_vision(ocr_items=[])
    outcome = await print_workspace.ingest_print_photo(
        "chat-3", _good_image_bytes(), vision, "explain this print", tenant_id="t3"
    )
    assert outcome is not None
    assert outcome.status in {"ingested", "degraded"}
    assert outcome.new_observation_ids == []
    assert outcome.superseded_ids == []
    ocr = [
        o
        for o in await _store().load_observations(outcome.session_id, "t3")
        if o.extractor == "ocr"
    ]
    assert ocr == []


# --------------------------------------------------------------------------- #
# close-up supersede + revision
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_close_up_supersedes_by_tag_overlap(ws_env):
    base = _print_vision(
        ocr_tokens=_tokens(
            ("-27/K44", [1, 2, 3, 4]), ("21/22", [5, 6, 7, 8]), ("S110", [9, 10, 11, 12])
        )
    )
    o1 = await print_workspace.persist_print_turn(
        "chat-4", "t4", _good_image_bytes(), base, "explain this print", "ANSWER 1"
    )
    assert o1 is not None and o1.status == "ingested"
    assert o1.superseded_ids == []

    closeup = _print_vision(
        ocr_tokens=_tokens(("21/22", [50, 60, 70, 80]), ("S110", [90, 100, 110, 120]))
    )
    o2 = await print_workspace.persist_print_turn(
        "chat-4", "t4", _good_image_bytes(), closeup, "closer look at the contact", "ANSWER 2"
    )
    assert o2 is not None
    assert o2.session_id == o1.session_id
    assert len(o2.superseded_ids) == 2
    assert sorted(o2.overlap_tags) == ["21/22", "S110"]
    assert o2.revision and o2.revision != o1.revision

    store = _store()
    active = await store.load_observations(o2.session_id, "t4", active_only=True)
    active_ids = {o.observation_id for o in active}
    assert not (set(o2.superseded_ids) & active_ids), "superseded rows must leave the active view"
    active_ocr = [o for o in active if o.extractor == "ocr"]
    # the close-up rows replaced the stale ones; the un-re-read tag survives
    assert sorted(o.raw_value for o in active_ocr) == ["-27/K44", "21/22", "S110"]

    everything = await store.load_observations(o2.session_id, "t4", active_only=False)
    superseded = [o for o in everything if o.observation_id in set(o2.superseded_ids)]
    assert len(superseded) == 2
    for o in superseded:
        assert o.evidence_state is EvidenceState.SUPERSEDED
        assert o.superseded_by in set(o2.new_observation_ids)


@pytest.mark.asyncio
async def test_revision_bumps_on_evidence_change(ws_env):
    o1 = await print_workspace.ingest_print_photo(
        "chat-5", _good_image_bytes(), _print_vision(ocr_items=["A1"]), "explain", tenant_id="t5"
    )
    o2 = await print_workspace.ingest_print_photo(
        "chat-5", _good_image_bytes(), _print_vision(ocr_items=["B2"]), "explain", tenant_id="t5"
    )
    assert o1 is not None and o2 is not None
    assert o1.revision and o2.revision
    assert o1.revision != o2.revision
    session = await _store().get_session(o2.session_id, "t5")
    assert session.current_revision == o2.revision


@pytest.mark.asyncio
async def test_supersede_and_revision_fail_open(ws_env, monkeypatch):
    base = _print_vision(ocr_tokens=_tokens(("X1", [1, 2, 3, 4]), ("Y2", [5, 6, 7, 8])))
    o1 = await print_workspace.persist_print_turn(
        "chat-6", "t6", _good_image_bytes(), base, "explain this print", "ANS 1"
    )
    assert o1 is not None

    store = _store()

    async def _boom(*args, **kwargs):
        raise RuntimeError("store broke")

    async def _false(*args, **kwargs):
        return False

    # raising supersede + False-returning revision: the ingest still lands,
    # no exception escapes, the outcome degrades honestly.
    monkeypatch.setattr(store, "supersede_observation", _boom)
    monkeypatch.setattr(store, "set_current_revision", _false)
    closeup = _print_vision(ocr_tokens=_tokens(("X1", [9, 9, 9, 9])))
    o2 = await print_workspace.persist_print_turn(
        "chat-6", "t6", _good_image_bytes(), closeup, "closer", "ANS 2"
    )
    assert o2 is not None
    assert o2.superseded_ids == []
    assert o2.revision is None

    # raising revision bump: same contract.
    monkeypatch.setattr(store, "set_current_revision", _boom)
    o3 = await print_workspace.ingest_print_photo(
        "chat-6", _good_image_bytes(), _print_vision(ocr_items=["Z9"]), "explain", tenant_id="t6"
    )
    assert o3 is not None
    assert o3.revision is None


# --------------------------------------------------------------------------- #
# store-level contracts for the new methods
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_inmemory_store_supersede_and_revision_scoping(ws_env):
    store = InMemoryVisualStore()
    session_id = await store.create_session("t-a", title="scoped")
    obs_id = await store.append_observation(
        session_id,
        "t-a",
        obs_kind="entity",
        evidence_state=EvidenceState.VISIBLE,
        raw_value="K44",
        extractor="ocr",
    )
    # wrong tenant / wrong session / missing ids all refuse
    assert not await store.supersede_observation(session_id, "t-b", obs_id, superseded_by="new-id")
    assert not await store.supersede_observation("nope", "t-a", obs_id, superseded_by="new-id")
    assert not await store.set_current_revision(session_id, "t-b", "rev-1")
    assert not await store.set_current_revision(session_id, "t-a", "")

    assert await store.set_current_revision(session_id, "t-a", "rev-1")
    assert (await store.get_session(session_id, "t-a")).current_revision == "rev-1"

    assert await store.supersede_observation(session_id, "t-a", obs_id, superseded_by="new-id")
    active = await store.load_observations(session_id, "t-a", active_only=True)
    assert active == []
    everything = await store.load_observations(session_id, "t-a", active_only=False)
    assert len(everything) == 1
    assert everything[0].evidence_state is EvidenceState.SUPERSEDED
    assert everything[0].superseded_by == "new-id"


# --------------------------------------------------------------------------- #
# graph sink (CAS + LIKELY observation)
# --------------------------------------------------------------------------- #


class _FakeGraph:
    def model_dump_json(self) -> str:
        return json.dumps({"devices": [{"tag": "K44"}], "sheet_count": 1})


@pytest.mark.asyncio
async def test_graph_sink_writes_cas_and_observation(ws_env):
    session_id = await print_workspace.ensure_workspace(
        "chat-7", tenant_id="t7", title="graph sink"
    )
    assert session_id

    sink = print_workspace.graph_sink_for("chat-7")
    sink(_FakeGraph())
    await _drain_tasks()

    cas_dir = Path(os.environ["MIRA_PRINT_CAS_DIR"])
    cas_files = [p for p in cas_dir.rglob("*") if p.is_file()]
    assert cas_files, "graph JSON must land in the CAS"

    obs = await _store().load_observations(session_id, "t7")
    graph_obs = [o for o in obs if o.extractor == "graph"]
    assert len(graph_obs) == 1
    assert graph_obs[0].evidence_state is EvidenceState.LIKELY
    assert graph_obs[0].obs_kind == "relation"
    assert graph_obs[0].metadata.get("graph_cas_key")
    assert graph_obs[0].metadata.get("trust") == "proposed"


def test_graph_sink_without_workspace_or_loop_is_silent(ws_env):
    """No mapping + no running loop: the sink must swallow everything."""
    sink = print_workspace.graph_sink_for("chat-never-seen")
    sink(_FakeGraph())  # sync context: no event loop; still must not raise

    class _BrokenGraph:
        def model_dump_json(self):
            raise RuntimeError("no dump for you")

    sink(_BrokenGraph())  # a broken graph object must not raise either


# --------------------------------------------------------------------------- #
# technician observations + vision_data reconstruction
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_technician_observation_documented_no_revision_bump(ws_env):
    session_id = await print_workspace.ensure_workspace("chat-8", tenant_id="t8", title="tech")
    assert session_id
    store = _store()
    rev = "11111111-1111-1111-1111-111111111111"
    assert await store.set_current_revision(session_id, "t8", rev)

    obs_id = await print_workspace.append_technician_observation(
        session_id, "t8", "measured 24.1 VDC at TB1-4", {"voltage_vdc": 24.1, "point": "TB1-4"}
    )
    assert obs_id

    obs = await store.load_observations(session_id, "t8")
    tech = [o for o in obs if o.extractor == "technician"]
    assert len(tech) == 1
    assert tech[0].evidence_state is EvidenceState.DOCUMENTED
    assert tech[0].raw_value == "measured 24.1 VDC at TB1-4"
    assert tech[0].metadata["measurement"] == {"voltage_vdc": 24.1, "point": "TB1-4"}
    assert tech[0].metadata["at_revision"] == rev
    assert tech[0].metadata.get("reported_at")
    # technician input never bumps the print-model revision
    assert (await store.get_session(session_id, "t8")).current_revision == rev


def test_rebuild_vision_data_from_ledger(ws_env):
    def _obs(oid: str, **kw) -> Observation:
        defaults = dict(
            observation_id=oid,
            session_id="s",
            tenant_id="t",
            obs_kind="entity",
            evidence_state=EvidenceState.VISIBLE,
            extractor="ocr",
        )
        defaults.update(kw)
        return Observation(**defaults)

    observations = [
        _obs("1", raw_value="K44", metadata={"bbox": [1, 2, 3, 4]}),
        _obs("2", raw_value="S110"),  # no bbox -> ocr_items only
        _obs("3", raw_value="OLD", evidence_state=EvidenceState.SUPERSEDED),
        _obs("4", raw_value="a schematic", extractor="vision_worker"),
        _obs("5", raw_value=None),
    ]
    data = print_workspace.rebuild_vision_data(observations)
    assert data["ocr_items"] == ["K44", "S110"]
    assert data["ocr_tokens"] == [{"text": "K44", "bbox": [1, 2, 3, 4]}]
