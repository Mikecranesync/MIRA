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
        assert "outside the allowed dir" in reason

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


class TestRedirectHopValidation:
    """Gate 9 finding: redirects bypassed the sources.yaml boundary.

    Every hop must be scheme-checked and curation-gated BEFORE its request is
    sent; the client must not auto-follow; the validated final URL is the
    provenance/dedup key.
    """

    def _run(self, monkeypatch, start: str, hops: dict):
        from unittest.mock import patch

        monkeypatch.setenv("MIRA_TENANT_ID", "test-tenant")
        requested: list[str] = []
        insert_kwargs: dict = {}

        class _Resp:
            def __init__(self, url: str):
                requested.append(url)
                self.status_code, self.headers = hops[url]

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def raise_for_status(self):
                return None

            def iter_bytes(self, chunk_size):
                yield b"%PDF-1.4"

        class _Client:
            def __init__(self, *a, **k):
                # Lock the contract: the ingest client must never auto-follow.
                assert k.get("follow_redirects") is False

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def stream(self, method, url):
                return _Resp(url)

        def _fake_insert(**kwargs):
            insert_kwargs.update(kwargs)
            return "id-1"

        fake_chunks = [
            {"text": "chunk body long enough", "chunk_index": 0, "chunk_type": "text"}
        ]
        with (
            patch("tasks.ingest.httpx.Client", _Client),
            patch("ingest.converter.extract_from_pdf_with_fallback", return_value=[{"text": "x"}]),
            patch("ingest.chunker.chunk_blocks", return_value=fake_chunks),
            patch("ingest.embedder.embed_text", return_value=[0.1] * 768),
            patch("ingest.store.chunk_exists", return_value=False),
            patch("ingest.store.insert_chunk", side_effect=_fake_insert),
            patch("ingest.quality.quality_gate", return_value=(True, "")),
        ):
            try:
                from tasks.ingest import ingest_url
            except ImportError:
                from mira_crawler.tasks.ingest import ingest_url

            result = ingest_url.run(url=start)
        return result, requested, insert_kwargs

    def test_uncurated_redirect_refused_before_request(self, monkeypatch) -> None:
        start = "https://ibiblio.org/a.pdf"
        result, requested, _ = self._run(
            monkeypatch,
            start,
            {start: (302, {"location": "https://evil-uncurated.example/b.pdf"})},
        )
        assert result["error"] == "uncurated_redirect"
        # The uncurated target was never requested — validation precedes I/O.
        assert requested == [start]

    def test_non_http_redirect_refused(self, monkeypatch) -> None:
        start = "https://ibiblio.org/a.pdf"
        result, requested, _ = self._run(
            monkeypatch,
            start,
            {start: (302, {"location": "file:///etc/passwd"})},
        )
        assert result["error"] == "uncurated_redirect"
        assert requested == [start]

    def test_curated_hop_followed_and_final_url_is_provenance(self, monkeypatch) -> None:
        start = "https://ibiblio.org/a.pdf"
        final = "https://mirror.ibiblio.org/b.pdf"
        result, requested, insert_kwargs = self._run(
            monkeypatch,
            start,
            {
                start: (302, {"location": final}),
                final: (200, {"content-type": "application/pdf"}),
            },
        )
        assert result.get("error") is None or not result.get("error")
        assert requested == [start, final]
        assert insert_kwargs["source_url"] == final

    def test_hop_limit_enforced(self, monkeypatch) -> None:
        try:
            from tasks.ingest import MAX_REDIRECT_HOPS
        except ImportError:
            from mira_crawler.tasks.ingest import MAX_REDIRECT_HOPS

        urls = [f"https://ibiblio.org/hop{i}.pdf" for i in range(MAX_REDIRECT_HOPS + 2)]
        hops = {
            u: (302, {"location": urls[i + 1]})
            for i, u in enumerate(urls[:-1])
        }
        hops[urls[-1]] = (200, {"content-type": "application/pdf"})
        result, requested, _ = self._run(monkeypatch, urls[0], hops)
        assert result["error"] == "uncurated_redirect"
        assert len(requested) == MAX_REDIRECT_HOPS + 1


class TestCallerPopulationExplicit:
    """Every store-layer caller, REPO-WIDE, states is_private at the call site.

    A required parameter fails at runtime; this locks it statically so a green
    suite means the whole population made an explicit visibility decision.
    Repository-wide AST enforcement (Gate 9 round-1 finding): the first version
    used a fixed file list whose enumeration was built from a `| head`-capped
    grep — it silently omitted tasks/reddit.py, whose call then raised
    TypeError at runtime while CI stayed green. Default-deny: any new caller
    anywhere in the repo is scanned automatically.
    """

    TARGETS = {"insert_chunk", "store_chunks", "ingest_text_inline"}
    PRUNE_DIRS = {
        ".git", "node_modules", ".venv", "venv", "__pycache__", ".next",
        "dist", "build", ".claude", "plc",  # plc/ holds dual Py2 sources
    }

    @classmethod
    def _scan_tree(cls, tree, rel_posix: str) -> list[str]:
        """Flag target calls in one parsed module that lack an explicit
        is_private keyword. Gate 9 round-2 hardenings: import ALIASES of the
        targets are resolved (``from x import insert_chunk as ic``), and
        ``**kwargs`` forwarding does NOT count as explicit — the decision must
        be visible at the call site."""
        import ast

        target_names = set(cls.TARGETS)
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                for alias in node.names:
                    if alias.name in cls.TARGETS and alias.asname:
                        target_names.add(alias.asname)
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.split(".")[-1] in cls.TARGETS and alias.asname:
                        target_names.add(alias.asname)

        missing: list[str] = []
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = (
                func.id
                if isinstance(func, ast.Name)
                else func.attr
                if isinstance(func, ast.Attribute)
                else None
            )
            if name not in target_names:
                continue
            # Self-defined lookalikes (e.g. seed_kb_gaps._insert_chunk,
            # vendor_coverage_ingest.insert_chunk) still get scanned: an
            # explicit is_private decision is right for them too.
            if "is_private" not in {kw.arg for kw in node.keywords}:
                missing.append(f"{rel_posix}:{node.lineno} {name}(")
        return missing

    def _call_sites_missing_is_private(self) -> list[str]:
        import ast
        import os

        missing: list[str] = []
        py_files: list[Path] = []
        for root, dirs, files in os.walk(REPO_ROOT):
            dirs[:] = [d for d in dirs if d not in self.PRUNE_DIRS]
            py_files.extend(Path(root) / f for f in files if f.endswith(".py"))
        for path in py_files:
            rel = path.relative_to(REPO_ROOT)
            if rel.as_posix() == "mira-crawler/tests/test_write_path_visibility.py":
                # This file's pytest.raises(TypeError) cases deliberately omit
                # is_private — that omission IS the assertion. Only self-exempt.
                continue
            # ingest/store.py is deliberately NOT exempt: its internal
            # store_chunks -> insert_chunk call must pass is_private too.
            try:
                tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"))
            except SyntaxError:
                continue  # non-3.x or vendored oddities — not our call sites
            missing.extend(self._scan_tree(tree, rel.as_posix()))
        return missing

    def test_scanner_catches_import_alias(self) -> None:
        import ast

        src = (
            "from ingest.store import insert_chunk as ic\n"
            "ic(tenant_id='t', content='x', embedding=[0.1])\n"
        )
        flagged = self._scan_tree(ast.parse(src), "synthetic.py")
        assert flagged == ["synthetic.py:2 ic("]

    def test_scanner_rejects_bare_kwargs_forwarding(self) -> None:
        import ast

        src = "insert_chunk(**payload)\n"
        flagged = self._scan_tree(ast.parse(src), "synthetic.py")
        assert flagged == ["synthetic.py:1 insert_chunk("]
        # Explicit is_private alongside forwarding is fine.
        src_ok = "insert_chunk(is_private=False, **payload)\n"
        assert self._scan_tree(ast.parse(src_ok), "synthetic.py") == []

    def test_every_call_site_passes_is_private(self) -> None:
        missing = self._call_sites_missing_is_private()
        assert not missing, (
            "call sites without an explicit is_private decision (I-1): "
            + ", ".join(missing)
        )

    def test_scanner_sees_the_known_population(self) -> None:
        # Honesty check: an AST scan that silently collects nothing would pass
        # vacuously. Assert it actually visits known callers.
        import ast

        found = 0
        for path in [
            CRAWLER_ROOT / "tasks" / "reddit.py",
            CRAWLER_ROOT / "tasks" / "patents.py",
            CRAWLER_ROOT / "ingest" / "store.py",
        ]:
            tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"))
            for node in ast.walk(tree):
                if isinstance(node, ast.Call):
                    func = node.func
                    name = getattr(func, "id", None) or getattr(func, "attr", None)
                    if name in self.TARGETS:
                        found += 1
        assert found >= 3


class TestLearningIngesterPrivate:
    """I-3 audit verdict: conversation-derived FAQ rows are private AND
    unverified.

    Content is distilled from a tenant's production conversations; the write
    law says never make a row more visible than its source. And feedback_log
    carries no actor identity/role/tenant, so a 'good' rating cannot ground
    verified=true — promotion requires a real approval gate that records the
    approver (Gate 9 finding). No production scheduler runs this tool, so
    neither flip has a live retrieval consumer to regress.
    """

    def test_insert_faq_writes_private_and_unverified(self) -> None:
        src = (REPO_ROOT / "mira-bots" / "tools" / "learning_ingester.py").read_text(
            encoding="utf-8", errors="replace"
        )
        # Needle built at runtime so Contract 13's writer scan (raw-text) never
        # sees the contiguous INSERT token in THIS file — we search, not write.
        needle = "INSERT INTO " + "knowledge" + "_entries"
        insert_idx = src.find(needle)
        assert insert_idx != -1
        window = src[insert_idx : insert_idx + 1600]
        assert "true, false, 'faq'" in window
        assert "false, true, 'faq'" not in window
        assert "true, true, 'faq'" not in window


class TestSchemeCaseNormalization:
    """Gate 7 group-A finding: RFC 3986 schemes are case-insensitive; the gate
    must not key on lowercase-only startswith. (Odd-case schemes already failed
    CLOSED via the host branch; normalization removes the class and makes
    FILE:// operator ingest consistent.)"""

    def _gate(self):
        try:
            from tasks.ingest import shared_corpus_source_allowed
        except ImportError:
            from mira_crawler.tasks.ingest import shared_corpus_source_allowed
        return shared_corpus_source_allowed

    def test_uppercase_file_scheme_validated_as_file(self, monkeypatch, tmp_path) -> None:
        monkeypatch.setenv("INGEST_LOCAL_ALLOWED_DIR", str(tmp_path))
        uri = (tmp_path / "m.pdf").as_uri().replace("file://", "FILE://", 1)
        ok, reason = self._gate()(uri)
        assert ok
        assert "operator-initiated" in reason

    def test_uppercase_http_scheme_still_curation_gated(self) -> None:
        ok, _ = self._gate()("HTTPS://evil-uncurated.example/x.pdf")
        assert not ok
        ok, _ = self._gate()("HTTPS://ibiblio.org/x.pdf")
        assert ok

    def test_percent_encoded_traversal_cannot_escape(self, monkeypatch, tmp_path) -> None:
        # url2pathname percent-decodes BEFORE resolve-then-contain, so encoded
        # ../ sequences are normalized away like literal ones (Gate 7 claim
        # disproven by construction; locked here).
        inbox = tmp_path / "inbox"
        inbox.mkdir()
        monkeypatch.setenv("INGEST_LOCAL_ALLOWED_DIR", str(inbox))
        encoded = inbox.as_uri() + "/%2e%2e/etc-passwd"
        ok, _ = self._gate()(encoded)
        assert not ok

    def test_non_http_scheme_refused_at_hop_zero(self) -> None:
        # Gate 9 round 2: ftp:// on a CURATED host must fail at the gate,
        # not later in transport — http/https/file only.
        ok, reason = self._gate()("ftp://ibiblio.org/manual.pdf")
        assert not ok
        assert "unsupported scheme" in reason


class TestIngestUrlVisibilityDeclaration:
    """The TASK boundary above insert_chunk (salvaged from duplicate PR #3274).

    `insert_chunk` requires `is_private`; `ingest_url` cannot, because a Celery
    signature is a wire contract and the queue still holds messages enqueued by
    the previous release at deploy time. So it defaults — and the default must
    fail in the SAFE direction. These lock that, and lock the `file://` floor
    that keeps the Google Drive mirror out of the shared corpus.
    """

    def _run(self, monkeypatch, url: str, **kwargs):
        from unittest.mock import patch

        monkeypatch.setenv("MIRA_TENANT_ID", "test-tenant")
        insert_kwargs: dict = {}

        class _Resp:
            status_code = 200
            headers = {"content-type": "application/pdf"}

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def raise_for_status(self):
                return None

            def iter_bytes(self, chunk_size):
                yield b"%PDF-1.4"

        class _Client:
            def __init__(self, *a, **k):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def stream(self, method, url):
                return _Resp()

        def _fake_insert(**kw):
            insert_kwargs.update(kw)
            return "id-1"

        fake_chunks = [
            {"text": "chunk body long enough", "chunk_index": 0, "chunk_type": "text"}
        ]
        with (
            patch("tasks.ingest.httpx.Client", _Client),
            patch("ingest.converter.extract_from_pdf_with_fallback", return_value=[{"text": "x"}]),
            patch("ingest.chunker.chunk_blocks", return_value=fake_chunks),
            patch("ingest.embedder.embed_text", return_value=[0.1] * 768),
            patch("ingest.store.chunk_exists", return_value=False),
            patch("ingest.store.insert_chunk", side_effect=_fake_insert),
            patch("ingest.quality.quality_gate", return_value=(True, "")),
        ):
            try:
                from tasks.ingest import ingest_url
            except ImportError:
                from mira_crawler.tasks.ingest import ingest_url

            ingest_url.run(url=url, **kwargs)
        return insert_kwargs

    _CURATED = "https://ibiblio.org/manual.pdf"

    def test_undeclared_dispatch_defaults_to_private(self, monkeypatch) -> None:
        """The in-flight-message case: a task enqueued by the previous release
        carries no is_private kwarg. It must drain to the safe side, not raise
        and not share."""
        assert self._run(monkeypatch, self._CURATED)["is_private"] is True

    def test_explicit_shared_declaration_is_threaded(self, monkeypatch) -> None:
        assert self._run(monkeypatch, self._CURATED, is_private=False)["is_private"] is False

    def test_local_file_cannot_reach_the_shared_corpus(self, monkeypatch, tmp_path) -> None:
        """tasks/gdrive.py queues Drive documents as file:// URLs.

        Passing the containment check answers "may we read this path"; it does
        not answer "may every tenant read its contents". Before this floor the
        file:// branch reached is_private=False and Drive documents landed in
        the shared corpus.
        """
        import tasks.ingest as ingest_mod

        base = tmp_path / "inbox"
        base.mkdir()
        pdf = base / "drive-doc.pdf"
        pdf.write_bytes(b"%PDF-1.4 fake")
        monkeypatch.setattr(ingest_mod, "_allowed_base", lambda: base.resolve())

        seen = self._run(monkeypatch, f"file://{pdf}", is_private=False)
        assert seen["is_private"] is True, "file:// must be forced private"

    def test_uppercase_file_scheme_also_forced_private(self, monkeypatch, tmp_path) -> None:
        """The floor is scheme-case-insensitive — FILE:// is still a local file."""
        import tasks.ingest as ingest_mod

        base = tmp_path / "inbox"
        base.mkdir()
        pdf = base / "d.pdf"
        pdf.write_bytes(b"%PDF-1.4 fake")
        monkeypatch.setattr(ingest_mod, "_allowed_base", lambda: base.resolve())

        seen = self._run(monkeypatch, f"FILE://{pdf}", is_private=False)
        assert seen["is_private"] is True


class TestRecrawlPreservesVisibility:
    """A refresh changes CONTENT, never WHO CAN READ IT (salvaged from #3274).

    `_find_stale_entries` re-queues rows that are ALREADY in the corpus. If the
    recrawl let ingest_url's default apply, every refreshed shared row would be
    privatized one cycle at a time — gradual, silent, and invisible in any
    single run. Asserting the opposite constant would leak private rows just as
    quietly. The only correct answer is to carry the row's own value forward.

    Every other test of this module mocks `fetchall` to `[]`, so the row
    unpacking below was previously unexercised.
    """

    def _engine_returning(self, rows):
        from unittest.mock import MagicMock

        def fake_execute(query, params=None):
            result = MagicMock()
            result.fetchall.return_value = rows
            return result

        conn = MagicMock()
        conn.__enter__ = lambda s: s
        conn.__exit__ = MagicMock(return_value=False)
        conn.execute = fake_execute
        engine = MagicMock()
        engine.connect.return_value = conn
        return engine

    def test_stale_query_returns_visibility_for_both_kinds(self, monkeypatch) -> None:
        import tasks.freshness as freshness_mod

        rows = [
            ("id-shared", "https://library.e.abb.com/a.pdf", "equipment_manual", False),
            ("id-private", "https://example.invalid/b.pdf", "equipment_manual", True),
        ]
        monkeypatch.setattr(freshness_mod, "_engine", lambda: self._engine_returning(rows))

        stale = freshness_mod._find_stale_entries("test-tenant-id")
        assert [e["is_private"] for e in stale] == [False, True]

    def test_stale_query_selects_is_private_as_the_fourth_column(self) -> None:
        """row[3] would IndexError, or read the wrong column, without this."""
        import inspect
        import re

        import tasks.freshness as freshness_mod

        # Parse the SELECT clause specifically. A bare `"is_private" in src`
        # check passes against a BROKEN query, because the same function builds
        # a dict key of that name — verified by running this against a
        # deliberately-broken SELECT before trusting it.
        src = inspect.getsource(freshness_mod._find_stale_entries)
        match = re.search(r"SELECT\s+(.+?)\s+FROM\s+knowledge_entries", src, re.S)
        assert match, "could not locate the stale-entry SELECT"
        columns = [c.strip() for c in match.group(1).split(",")]
        assert columns.index("is_private") == 3, f"selected columns: {columns}"

    def test_shared_row_stays_shared_and_private_row_stays_private(self, monkeypatch) -> None:
        from unittest.mock import MagicMock

        import tasks.freshness as freshness_mod

        dispatched: list[dict] = []
        fake_task = MagicMock()
        fake_task.delay = lambda **kw: dispatched.append(kw)

        import sys
        import types

        monkeypatch.setenv("MIRA_TENANT_ID", "test-tenant")
        stub = types.ModuleType("tasks.ingest")
        stub.ingest_url = fake_task
        monkeypatch.setitem(sys.modules, "tasks.ingest", stub)
        monkeypatch.setitem(sys.modules, "mira_crawler.tasks.ingest", stub)

        monkeypatch.setattr(
            freshness_mod,
            "_find_stale_entries",
            lambda tenant_id: [
                {"id": "a", "source_url": "https://x.invalid/a.pdf",
                 "source_type": "equipment_manual", "is_private": False},
                {"id": "b", "source_url": "https://x.invalid/b.pdf",
                 "source_type": "equipment_manual", "is_private": True},
            ],
        )
        monkeypatch.setattr(freshness_mod, "_mark_entries_stale_batch", lambda ids: None)

        freshness_mod.audit_stale_content.run()

        by_url = {d["url"]: d["is_private"] for d in dispatched}
        assert by_url["https://x.invalid/a.pdf"] is False, "shared row must stay shared"
        assert by_url["https://x.invalid/b.pdf"] is True, "private row must stay private"

    def test_visibility_cannot_be_set_positionally(self) -> None:
        """Gate 7 finding: a positional 5th argument must not set visibility.

        `is_private` is keyword-only, so an accidental positional cannot flip
        the corpus a document lands in — and a static contract that scans
        keywords is therefore complete rather than merely usually-right.
        """
        import inspect

        try:
            from tasks.ingest import ingest_url
        except ImportError:
            from mira_crawler.tasks.ingest import ingest_url

        sig = inspect.signature(ingest_url.run if hasattr(ingest_url, "run") else ingest_url)
        param = sig.parameters["is_private"]
        assert param.kind is inspect.Parameter.KEYWORD_ONLY, (
            f"is_private must be keyword-only, got {param.kind}"
        )


class TestLocalFileSchemeCannotReachSharedCorpus:
    """The `file:` bypass, and the invariant that replaced it.

    The floor used to key on `url.lower().startswith("file://")` while the
    download branch keyed on `urlparse(url).scheme == "file"`. The single-slash
    form `file:/allowed/path/doc.pdf` — an empty authority, permitted by
    RFC 8089 — satisfied the second and escaped the first, so a caller-supplied
    `is_private=False` survived to `insert_chunk`. Same URL, two recognizers,
    opposite answers.

    Invariant now: **no URL whose PARSED scheme is `file` can reach persistence
    as shared**, whatever its case, slash count, authority, or the caller's
    declaration. Allowed-directory validation gates ingestion, never privacy.
    """

    # Every form the production parser resolves to scheme "file".
    LOCAL_FORMS = [
        "file:///{p}",            # canonical triple slash
        "file:/{p}",              # single slash — THE BYPASS
        "FILE:///{p}",            # uppercase scheme
        "File:/{p}",              # mixed case + single slash
        "file://localhost/{p}",   # explicit localhost authority
    ]

    def _run(self, monkeypatch, url: str, **kwargs):
        from unittest.mock import patch

        monkeypatch.setenv("MIRA_TENANT_ID", "test-tenant")
        seen: dict = {}

        def _fake_insert(**kw):
            seen.update(kw)
            return "id-1"

        fake_chunks = [{"text": "chunk body long enough", "chunk_index": 0, "chunk_type": "text"}]
        with (
            patch("ingest.converter.extract_from_pdf_with_fallback", return_value=[{"text": "x"}]),
            patch("ingest.chunker.chunk_blocks", return_value=fake_chunks),
            patch("ingest.embedder.embed_text", return_value=[0.1] * 768),
            patch("ingest.store.chunk_exists", return_value=False),
            patch("ingest.store.insert_chunk", side_effect=_fake_insert),
            patch("ingest.quality.quality_gate", return_value=(True, "")),
        ):
            try:
                from tasks.ingest import ingest_url
            except ImportError:
                from mira_crawler.tasks.ingest import ingest_url

            ingest_url.run(url=url, **kwargs)
        return seen

    def _allowed_pdf(self, monkeypatch, tmp_path):
        import tasks.ingest as ingest_mod

        base = tmp_path / "inbox"
        base.mkdir()
        pdf = base / "document.pdf"
        pdf.write_bytes(b"%PDF-1.4 fake")
        monkeypatch.setattr(ingest_mod, "_allowed_base", lambda: base.resolve())
        return pdf

    # --- the classifier itself -------------------------------------------

    def test_classifier_recognises_every_local_form(self, tmp_path):
        from ingest.provenance import is_local_source

        for form in self.LOCAL_FORMS:
            url = form.format(p="a/b/document.pdf")
            assert is_local_source(url) is True, f"not recognised as local: {url}"

    def test_classifier_leaves_remote_sources_remote(self):
        from ingest.provenance import is_local_source

        for url in (
            "https://library.e.abb.com/manual.pdf",
            "http://ibiblio.org/book.pdf",
            "HTTPS://LIBRARY.E.ABB.COM/manual.pdf",
        ):
            assert is_local_source(url) is False, f"wrongly treated as local: {url}"

    def test_classifier_fails_closed_on_bare_paths_and_empty(self):
        """A bare filesystem path and an empty source have no remote origin."""
        from ingest.provenance import is_local_source

        assert is_local_source("/inbox/document.pdf") is True
        assert is_local_source("C:\\inbox\\document.pdf") is True
        assert is_local_source("") is True

    def test_declared_shared_cannot_lower_a_local_file(self):
        from ingest.provenance import visibility_for_source

        assert visibility_for_source("file:/x/doc.pdf", declared_private=False) is True
        assert visibility_for_source("file:///x/doc.pdf", declared_private=False) is True
        # ...and an unknown-provenance remote source also fails closed
        assert visibility_for_source("https://x.invalid/d.pdf", declared_private=None) is True
        # ...while an explicit shared declaration on a remote source is honoured
        assert visibility_for_source("https://x.invalid/d.pdf", declared_private=False) is False

    # --- end to end, at the persistence boundary --------------------------

    def test_no_local_form_reaches_persistence_as_shared(self, monkeypatch, tmp_path):
        """The invariant, asserted where it actually matters: insert_chunk."""
        pdf = self._allowed_pdf(monkeypatch, tmp_path)
        for form in self.LOCAL_FORMS:
            url = form.format(p=str(pdf).lstrip("/"))
            seen = self._run(monkeypatch, url, is_private=False)
            assert seen.get("is_private") is True, (
                f"{url} reached insert_chunk as SHARED — privacy bypass"
            )

    def test_single_slash_form_is_the_regression_case(self, monkeypatch, tmp_path):
        """Pinned separately: this exact form is what the old check missed."""
        pdf = self._allowed_pdf(monkeypatch, tmp_path)
        seen = self._run(monkeypatch, f"file:{pdf}", is_private=False)
        assert seen.get("is_private") is True

    def test_disallowed_local_path_is_refused_outright(self, monkeypatch, tmp_path):
        """Outside the allowed dir: refused, so nothing persists at all.

        Containment governs INGESTION. Privacy is decided separately and
        earlier, which is why both tests exist.
        """
        import tasks.ingest as ingest_mod

        allowed = tmp_path / "inbox"
        allowed.mkdir()
        outside = tmp_path / "elsewhere"
        outside.mkdir()
        pdf = outside / "secret.pdf"
        pdf.write_bytes(b"%PDF-1.4 fake")
        monkeypatch.setattr(ingest_mod, "_allowed_base", lambda: allowed.resolve())

        seen = self._run(monkeypatch, f"file://{pdf}", is_private=False)
        assert seen == {}, "a disallowed local path must not persist anything"

    def test_production_code_has_no_string_prefix_local_check(self):
        """Guard the fix: one parsed answer, never a URL prefix comparison.

        AST, not text. A first draft of this test grepped lines and flagged the
        explanatory COMMENT above the fix — the same false-positive class as
        issue #3281, where a docstring can flip a security classification
        because the checker reads surrounding text instead of syntax. Comments
        and docstrings are discarded by `ast.parse`, so they cannot trip or
        satisfy this.
        """
        import ast
        import pathlib

        root = pathlib.Path(__file__).resolve().parents[1]
        offenders = []
        for py in (root / "tasks").rglob("*.py"):
            try:
                tree = ast.parse(py.read_text(encoding="utf-8", errors="replace"))
            except SyntaxError:
                continue
            for node in ast.walk(tree):
                if (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Attribute)
                    and node.func.attr == "startswith"
                    and node.args
                    and isinstance(node.args[0], ast.Constant)
                    and isinstance(node.args[0].value, str)
                    and node.args[0].value.lower().startswith("file:")
                ):
                    offenders.append(f"{py.name}:{node.lineno}")
        assert not offenders, (
            "local files must be recognised by PARSED SCHEME, not a string prefix "
            "(that mismatch was the bypass): " + "; ".join(offenders)
        )


class TestLocalIngestCallSitesArePrivate:
    """Owner policy (2026-08-18): every local filesystem source is private.

    Both call sites previously passed an unconditional `is_private=False`. They
    now DERIVE the value from `ingest.provenance`, so the policy lives in one
    module rather than being restated per file — which is how the two of them
    drifted from the task-level floor in the first place.
    """

    def test_folder_watcher_derives_visibility_structurally(self):
        """Always-on hermetic lock: main.py must DERIVE, not hardcode.

        The runtime test below needs `apscheduler` (imported at main.py module
        scope) and skips without it. This one has no dependencies, so the
        invariant is still fenced on a bare checkout.
        """
        import ast
        import pathlib

        src = pathlib.Path(__file__).resolve().parents[1] / "main.py"
        tree = ast.parse(src.read_text(encoding="utf-8", errors="replace"))
        calls = [
            n for n in ast.walk(tree)
            if isinstance(n, ast.Call)
            and isinstance(n.func, ast.Name)
            and n.func.id == "store_chunks"
        ]
        assert calls, "store_chunks call not found in main.py — test is stale"
        for call in calls:
            kw = {k.arg: k.value for k in call.keywords}
            assert "is_private" in kw, "folder watcher must state is_private"
            val = kw["is_private"]
            assert not (isinstance(val, ast.Constant) and val.value is False), (
                "folder watcher must not hardcode is_private=False"
            )
            assert isinstance(val, ast.Call) and getattr(val.func, "id", "") == "visibility_for_source", (
                "must DERIVE visibility from ingest.provenance"
            )

    def test_folder_watcher_persists_private(self, monkeypatch, tmp_path):
        import pytest

        pytest.importorskip("apscheduler", reason="main.py imports apscheduler at module scope")
        import main as crawler_main

        seen: dict = {}
        monkeypatch.setattr(
            crawler_main, "store_chunks",
            lambda valid, tenant_id, **kw: (seen.update(kw), len(valid))[1],
        )
        monkeypatch.setattr(crawler_main, "embed_batch", lambda chunks, **kw: [(chunks[0], [0.1])])
        monkeypatch.setattr(crawler_main, "chunk_blocks", lambda blocks, **kw: [{"text": "c", "chunk_index": 0}])
        monkeypatch.setattr(crawler_main, "extract_from_pdf", lambda data, **kw: [{"text": "b"}])

        class _Dedup:
            def __init__(self, **kw): pass
            def is_already_indexed(self, data): return False
            def mark_indexed(self, *a, **kw): pass

        monkeypatch.setattr(crawler_main, "DedupStore", _Dedup)

        pdf = tmp_path / "dropped.pdf"
        pdf.write_bytes(b"%PDF-1.4 fake")
        cfg = crawler_main.CrawlerConfig()
        cfg.use_docling = False
        crawler_main._ingest_file(pdf, cfg)

        assert seen.get("is_private") is True, "a folder-watcher drop must persist private"

    def test_folder_watcher_cannot_be_flipped_by_the_classifier_alone(self):
        """The derivation, isolated: a dropped path always classifies private."""
        from ingest.provenance import visibility_for_source

        for p in ("/incoming/dropped.pdf", "file:///incoming/dropped.pdf", "dropped.pdf"):
            assert visibility_for_source(p) is True

    def test_equipment_photo_ingest_persists_private(self):
        """The photo script derives from the same classifier as the watcher."""
        import ast
        import pathlib

        src = pathlib.Path(__file__).resolve().parents[2] / "mira-core/scripts/ingest_equipment_photos.py"
        tree = ast.parse(src.read_text(encoding="utf-8", errors="replace"))
        calls = [
            n for n in ast.walk(tree)
            if isinstance(n, ast.Call)
            and isinstance(n.func, ast.Name)
            and n.func.id == "store_chunks"
        ]
        assert calls, "store_chunks call not found — test is stale"
        for call in calls:
            kw = {k.arg: k.value for k in call.keywords}
            assert "is_private" in kw, "store_chunks must state is_private"
            val = kw["is_private"]
            assert not (isinstance(val, ast.Constant) and val.value is False), (
                "equipment-photo ingest must not hardcode is_private=False"
            )
            assert isinstance(val, ast.Call) and getattr(val.func, "id", "") == "visibility_for_source", (
                "must DERIVE visibility from ingest.provenance, not restate a constant"
            )
