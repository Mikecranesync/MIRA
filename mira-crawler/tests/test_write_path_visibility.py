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
