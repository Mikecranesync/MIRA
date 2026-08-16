"""CU-03 behavior locks: every knowledge_entries write states its visibility.

Findings (docs/architecture/convergence/DUPLICATE_CAPABILITIES.md):
- I-1: insert_chunk hardcoded is_private=false with no parameter — a per-tenant
  caller would silently publish tenant docs to the shared corpus (#1833 shape).
- I-2: ingest_url had no sources.yaml membership check — non-curated URLs
  landed in the shared corpus as unverified orphans.

Zero real DB / network calls — the SQLAlchemy engine is faked (same pattern as
test_store_verified.py) and the curation gate is tested as a pure function.
"""

from __future__ import annotations

import inspect
from pathlib import Path

import pytest
from ingest import store

CRAWLER_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = CRAWLER_ROOT.parent


class _FakeConn:
    def __init__(self, captured: dict) -> None:
        self.captured = captured

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, _stmt, params):
        self.captured.update(params)

    def commit(self):
        pass


class _FakeEngine:
    def __init__(self, captured: dict) -> None:
        self.captured = captured

    def connect(self):
        return _FakeConn(self.captured)


@pytest.fixture
def captured(monkeypatch) -> dict:
    box: dict = {}
    monkeypatch.setattr(store, "_engine", lambda: _FakeEngine(box))
    return box


class TestInsertChunkVisibility:
    """I-1: is_private is a required, explicitly-bound decision."""

    def test_is_private_is_required(self, captured: dict) -> None:
        with pytest.raises(TypeError):
            store.insert_chunk(
                tenant_id="t1", content="x", embedding=[0.1], source_url="u"
            )

    def test_binds_is_private_false(self, captured: dict) -> None:
        entry_id = store.insert_chunk(
            tenant_id="t1",
            content="x",
            embedding=[0.1],
            source_url="u",
            is_private=False,
        )
        assert entry_id
        assert captured["is_private"] is False

    def test_binds_is_private_true(self, captured: dict) -> None:
        entry_id = store.insert_chunk(
            tenant_id="t1",
            content="x",
            embedding=[0.1],
            source_url="u",
            is_private=True,
        )
        assert entry_id
        assert captured["is_private"] is True

    def test_sql_no_longer_hardcodes_visibility(self) -> None:
        # The literal `false` in the VALUES tuple was the I-1 defect; the value
        # must come from the bound parameter.
        src = inspect.getsource(store.insert_chunk)
        assert ":is_private" in src


class TestStoreChunksVisibility:
    """store_chunks threads the caller's explicit decision through."""

    def test_is_private_is_required(self) -> None:
        with pytest.raises(TypeError):
            store.store_chunks([({"text": "x"}, [0.1])], tenant_id="t1")

    def test_threads_is_private(self, monkeypatch) -> None:
        seen: dict = {}

        def _fake_insert(**kwargs):
            seen.update(kwargs)
            return "id-1"

        monkeypatch.setattr(store, "insert_chunk", _fake_insert)
        store.store_chunks(
            [({"text": "x", "source_url": "u", "chunk_index": 0}, [0.1])],
            tenant_id="t1",
            is_private=True,
        )
        assert seen["is_private"] is True


class TestIngestTextInlineVisibility:
    """The shared text-ingest helper must also require the decision."""

    def test_is_private_is_required_kwarg(self) -> None:
        try:
            from tasks._shared import ingest_text_inline
        except ImportError:
            from mira_crawler.tasks._shared import ingest_text_inline

        param = inspect.signature(ingest_text_inline).parameters["is_private"]
        assert param.default is inspect.Parameter.empty
        assert param.kind is inspect.Parameter.KEYWORD_ONLY


class TestCurationGate:
    """I-2: shared-corpus ingest of remote URLs is gated on sources.yaml."""

    def _gate(self):
        try:
            from tasks.ingest import shared_corpus_source_allowed
        except ImportError:
            from mira_crawler.tasks.ingest import shared_corpus_source_allowed
        return shared_corpus_source_allowed

    def test_curated_host_allowed(self) -> None:
        # ibiblio.org is a tier-1 sources.yaml host.
        ok, _ = self._gate()("https://ibiblio.org/kuphaldt/some/manual.pdf")
        assert ok

    def test_subdomain_of_curated_host_allowed(self) -> None:
        ok, _ = self._gate()("https://mirror.ibiblio.org/x.pdf")
        assert ok

    def test_uncurated_host_refused(self) -> None:
        ok, reason = self._gate()("https://evil-uncurated.example/manual.pdf")
        assert not ok
        assert reason

    def test_lookalike_suffix_refused(self) -> None:
        # notibiblio.org must not match ibiblio.org (dot-boundary check).
        ok, _ = self._gate()("https://notibiblio.org/x.pdf")
        assert not ok

    def test_file_scheme_allowed_inside_operator_dir(self, monkeypatch, tmp_path) -> None:
        # Operator-initiated local/Drive ingest (tasks/gdrive.py) — allowed
        # only under the configured dir (Gate 7 round-3 [high] finding).
        monkeypatch.setenv("INGEST_LOCAL_ALLOWED_DIR", str(tmp_path))
        ok, _ = self._gate()((tmp_path / "manual.pdf").as_uri())
        assert ok

    def test_file_scheme_refused_outside_operator_dir(self, monkeypatch, tmp_path) -> None:
        monkeypatch.setenv("INGEST_LOCAL_ALLOWED_DIR", str(tmp_path / "inbox"))
        ok, reason = self._gate()((tmp_path / "secrets" / "id_rsa").as_uri())
        assert not ok
        assert "outside allowed dir" in reason

    def test_file_scheme_traversal_cannot_escape(self, monkeypatch, tmp_path) -> None:
        inbox = tmp_path / "inbox"
        inbox.mkdir()
        monkeypatch.setenv("INGEST_LOCAL_ALLOWED_DIR", str(inbox))
        escape = (inbox / ".." / "etc-passwd").as_uri()
        ok, _ = self._gate()(escape)
        assert not ok

    def test_unreadable_manifest_fails_closed(self, monkeypatch) -> None:
        try:
            from tasks import ingest as ingest_mod
        except ImportError:
            from mira_crawler.tasks import ingest as ingest_mod

        def _boom():
            raise OSError("manifest unreadable")

        monkeypatch.setattr(ingest_mod, "_curated_hosts", _boom)
        ok, reason = ingest_mod.shared_corpus_source_allowed("https://ibiblio.org/x.pdf")
        assert not ok
        assert "fail closed" in reason or "sources.yaml" in reason

    def test_ingest_url_refuses_uncurated_before_download(self, monkeypatch) -> None:
        # No network patches: if the gate were not first, this would raise a
        # connection error instead of returning the refusal dict.
        monkeypatch.setenv("MIRA_TENANT_ID", "test-tenant")
        try:
            from tasks.ingest import ingest_url
        except ImportError:
            from mira_crawler.tasks.ingest import ingest_url

        result = ingest_url.run(url="https://evil-uncurated.example/manual.pdf")
        assert result.get("error") == "uncurated_source"
        assert result.get("inserted") == 0


class TestCallerPopulationExplicit:
    """Every store-layer caller states is_private at the call site.

    A required parameter fails at runtime; this locks it statically so a green
    suite means the whole population made an explicit visibility decision.
    """

    CALLER_FILES = [
        CRAWLER_ROOT / "tasks" / "ingest.py",
        CRAWLER_ROOT / "tasks" / "_shared.py",
        CRAWLER_ROOT / "tasks" / "youtube.py",
        CRAWLER_ROOT / "tasks" / "full_ingest_pipeline.py",
        CRAWLER_ROOT / "tasks" / "manualslib_scraper.py",
        CRAWLER_ROOT / "tasks" / "patents.py",
        CRAWLER_ROOT / "tasks" / "playwright_crawler.py",
        CRAWLER_ROOT / "crawler" / "base_crawler.py",
        CRAWLER_ROOT / "main.py",
        REPO_ROOT / "mira-core" / "scripts" / "ingest_equipment_photos.py",
    ]

    def test_every_call_site_passes_is_private(self) -> None:
        missing: list[str] = []
        for path in self.CALLER_FILES:
            src = path.read_text(encoding="utf-8", errors="replace")
            for needle in ("insert_chunk(", "store_chunks(", "ingest_text_inline("):
                start = 0
                while True:
                    idx = src.find(needle, start)
                    if idx == -1:
                        break
                    start = idx + len(needle)
                    line_start = src.rfind("\n", 0, idx) + 1
                    line = src[line_start:idx]
                    # Skip definitions, imports, comment/doc mentions, and
                    # empty-paren prose references like "ingest_text_inline()".
                    if (
                        "def " in line
                        or "import" in line
                        or line.lstrip().startswith("#")
                        or src[max(0, idx - 5) : idx].endswith(("from ", "def "))
                        or src[start : start + 1] == ")"
                    ):
                        continue
                    window = src[idx : idx + 900]
                    if "is_private" not in window:
                        line_no = src.count("\n", 0, idx) + 1
                        missing.append(f"{path.name}:{line_no} {needle}")
        assert not missing, (
            "call sites without an explicit is_private decision (I-1): "
            + ", ".join(missing)
        )


class TestLearningIngesterPrivate:
    """I-3 audit verdict: conversation-derived FAQ rows are private.

    Content is distilled from a tenant's production conversations; the write
    law says never make a row more visible than its source. No production
    scheduler runs this tool (no celery-beat/compose wiring), so flipping the
    visibility has no live retrieval consumer to regress.
    """

    def test_insert_faq_writes_private(self) -> None:
        src = (REPO_ROOT / "mira-bots" / "tools" / "learning_ingester.py").read_text(
            encoding="utf-8", errors="replace"
        )
        insert_idx = src.find("INSERT INTO knowledge_entries")
        assert insert_idx != -1
        window = src[insert_idx : insert_idx + 1200]
        # is_private=true, verified=true — private to the owning tenant, citable
        # there because a technician approved it.
        assert "true, true, 'faq'" in window
        assert "false, true, 'faq'" not in window
