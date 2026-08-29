"""Repository-visible contracts for the CU-03 round-10 group A findings.

Gate 9 follow-up to PR #3268. The three group-A findings (`round-10-groupA-
crawler-prod.md`) were disputed on the record but never closed by a
deterministic, repo-visible lock — a rebuttal is prose, and a merge is not a
proof. Each contract below is mutation-sensitive: flip the invariant it names
and the test goes red (verified by hand before this file landed; see the PR).

F1  "Private-visibility flag never updated on conflict."
    A colliding insert can never expose newly-private content: the conflict
    target is the migration's UNIQUE index (which includes ``tenant_id``, so a
    collision is only ever the SAME tenant re-writing its OWN row), the action
    is ``DO NOTHING`` (no ``EXCLUDED.*`` write of ``content`` or ``is_private``
    into the existing row — the colliding content is simply not written), and
    no crawler ``UPDATE`` statement assigns ``is_private`` after the fact.

F2  "Mis-location of the manifest causing universal ingest rejection."
    The provenance manifest is packaged where the module resolves it, in every
    crawler image, and the build context does not exclude it. If it is missing
    or malformed anyway, the shared write is REFUSED at both the ingest gate and
    the store boundary — the designed fail-closed posture, never allow-all.

F3  "Undeclared runtime dependency on PyYAML."
    Every production ``import yaml`` under mira-crawler is backed by a declared
    ``PyYAML`` requirement that every crawler image (and the CI slice) installs;
    and a missing PyYAML is a refused write, not a task abort.
"""

from __future__ import annotations

import ast
import fnmatch
import re
import sys
from pathlib import Path

import pytest
from ingest import provenance, store

CRAWLER_DIR = Path(store.__file__).resolve().parents[1]
REPO_ROOT = CRAWLER_DIR.parent
MIGRATION = REPO_ROOT / "mira-hub" / "db" / "migrations" / "003_kb_hardening.sql"
REQUIREMENTS = CRAWLER_DIR / "requirements-celery.txt"
DOCKERFILES = sorted(CRAWLER_DIR.glob("Dockerfile*"))
CI_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "ci.yml"

_SKIP_PARTS = {"tests", "__pycache__", "venv", "node_modules", "build", "dist"}


def _canon(sql: str) -> str:
    """Whitespace- and paren-insensitive form for comparing SQL fragments."""
    return re.sub(r"[\s()]", "", sql)


def _production_py_files() -> list[Path]:
    out = []
    for p in CRAWLER_DIR.rglob("*.py"):
        parts = p.relative_to(CRAWLER_DIR).parts
        if any(part.startswith(".") or part in _SKIP_PARTS for part in parts):
            continue
        out.append(p)
    return sorted(out)


def _ingest_gate():
    try:
        from tasks import ingest as ingest_mod
    except ImportError:  # container layout
        from mira_crawler.tasks import ingest as ingest_mod
    return ingest_mod.shared_corpus_source_allowed


# ── fake engine: capture the exact statement + bound params, zero DB calls ──


class _FakeConn:
    def __init__(self, box: dict) -> None:
        self.box = box

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, stmt, params):
        self.box["sql"] = str(stmt)
        self.box["params"] = params

    def commit(self):
        pass


class _FakeEngine:
    def __init__(self, box: dict) -> None:
        self.box = box

    def connect(self):
        return _FakeConn(self.box)


@pytest.fixture
def captured(monkeypatch) -> dict:
    box: dict = {}
    monkeypatch.setattr(store, "_engine", lambda: _FakeEngine(box))
    return box


def _insert(is_private: bool, url: str = "https://example.invalid/manual.pdf") -> str:
    return store.insert_chunk(
        "tenant-a",
        "newly private content",
        [0.1, 0.2, 0.3],
        source_url=url,
        chunk_index=0,
        is_private=is_private,
    )


# ═══════════════════════════════════════════════════════════════════════════
# F1 — conflict behaviour cannot expose newly-private content
# ═══════════════════════════════════════════════════════════════════════════


class TestConflictVisibility:
    def _conflict_clause(self, captured: dict) -> tuple[str, str, str]:
        assert _insert(True) != "", "the (unclassified → forced-private) insert must reach the DB"
        sql = captured["sql"]
        m = re.search(
            r"ON CONFLICT\s*\((.*?)\)\s*WHERE\s*(.*?)\s*DO\s+(NOTHING|UPDATE)",
            re.sub(r"\s+", " ", sql),
            re.I | re.S,
        )
        assert m, f"no ON CONFLICT clause in the insert statement:\n{sql}"
        return m.group(1), m.group(2), m.group(3).upper()

    def test_conflict_target_is_exactly_the_migration_unique_index(self, captured):
        """The conflict key the INSERT names must be the UNIQUE index the DB
        enforces (migration 003 ``idx_ke_chunk_dedup``), and it must include
        ``tenant_id`` — so a collision is, by construction, one tenant colliding
        with its OWN earlier row. No cross-tenant row can ever be involved."""
        cols, pred, _ = self._conflict_clause(captured)
        mig = MIGRATION.read_text(encoding="utf-8")
        m = re.search(
            r"idx_ke_chunk_dedup\s+ON\s+knowledge_entries\s*\((.*?)\)\s*WHERE\s*(.*?);",
            re.sub(r"\s+", " ", mig),
            re.I | re.S,
        )
        assert m, "migration 003 no longer defines idx_ke_chunk_dedup"
        assert _canon(cols) == _canon(m.group(1)), (cols, m.group(1))
        assert _canon(pred) == _canon(m.group(2)), (pred, m.group(2))
        assert _canon(cols).split(",")[0] == "tenant_id"

    def test_conflict_action_never_writes_the_colliding_row(self, captured):
        """DO NOTHING: the existing row's ``content`` and ``is_private`` are left
        untouched and the colliding (newly private) content is never written.
        A DO UPDATE that copied ``EXCLUDED.content`` without ``EXCLUDED.is_private``
        is the exact leak shape the finding described; a DO UPDATE that copied
        both would let a later PUBLIC re-ingest flip a private row to shared.
        Neither exists, and this lock keeps it that way."""
        _, _, action = self._conflict_clause(captured)
        assert action == "NOTHING"
        upper = captured["sql"].upper()
        assert "DO UPDATE" not in upper
        assert "EXCLUDED." not in upper

    def test_private_declaration_is_bound_as_the_row_visibility(self, captured):
        """The visibility the INSERT binds is the enforced one — a private
        declaration reaches the row as ``is_private=True`` (and a public
        declaration on an unclassified origin is forced private, per the write
        law). Nothing between the caller and the statement can widen it."""
        _insert(True)
        assert captured["params"]["is_private"] is True
        _insert(False)
        assert captured["params"]["is_private"] is True  # unclassified origin → forced private

    def test_no_crawler_update_statement_assigns_is_private(self):
        """The only mutation paths on ``knowledge_entries`` in the crawler are
        ``freshness._mark_entries_stale_batch`` (``metadata.is_stale``) and
        ``kg_writer.link_chunk_to_equipment`` (``equipment_entity_id``). None may
        ever assign ``is_private`` — a row's visibility is decided once, at the
        write boundary (``enforce_visibility``), and can only be made MORE private
        by a recrawl that carries the stored value (``freshness.py``)."""
        updates: dict[str, list[str]] = {}
        for path in _production_py_files():
            text = path.read_text(encoding="utf-8", errors="replace")
            found = _update_set_clauses(text)
            if found:
                updates[path.relative_to(CRAWLER_DIR).as_posix()] = found
        assert updates, "population check: the crawler's UPDATE statements were not found"
        offenders = {f: s for f, sets in updates.items() for s in sets if _assigns_is_private(s)}
        assert not offenders, f"an UPDATE assigns is_private: {offenders}"

    @pytest.mark.parametrize(
        "sql",
        [
            "UPDATE knowledge_entries SET is_private = false WHERE id = :id",
            "UPDATE knowledge_entries AS ke SET ke.is_private = TRUE WHERE ke.id = :id",
            "update knowledge_entries ke set content = :c, is_private=:p where id = :id",
            "UPDATE knowledge_entries\n   SET metadata = :m,\n       is_private = :p\n WHERE id = :id",
            "UPDATE knowledge_entries SET is_private = false",  # no WHERE at all
        ],
    )
    def test_update_scanner_catches_aliased_lowercase_and_multiline_forms(self, sql):
        """Scanner honesty (follow-up Gate 7 finding): the lock above is only as
        good as its scanner. The capture runs from the table name to the WHERE
        (or end of text), so an alias, lowercase keywords, line breaks, or a
        missing WHERE cannot hide an `is_private` assignment."""
        clauses = _update_set_clauses(sql)
        assert clauses and any(_assigns_is_private(c) for c in clauses), sql

    def test_update_scanner_ignores_benign_updates(self):
        benign = "UPDATE knowledge_entries SET metadata = jsonb_set(metadata, '{is_stale}', 'true') WHERE id = :id"
        assert not any(_assigns_is_private(c) for c in _update_set_clauses(benign))


# ═══════════════════════════════════════════════════════════════════════════
# F2 — the manifest is packaged where the module resolves it; failure is closed
# ═══════════════════════════════════════════════════════════════════════════


def _update_set_clauses(text: str) -> list[str]:
    """Everything between `UPDATE knowledge_entries` and its WHERE (or the end of
    the text) — alias, SET list and all — for every UPDATE in ``text``."""
    return [
        m.group(1)
        for m in re.finditer(
            r"UPDATE\s+knowledge_entries\b(.*?)(?:\bWHERE\b|\Z)", text, re.I | re.S
        )
    ]


def _assigns_is_private(set_clause: str) -> bool:
    return re.search(r"\bis_private\b", set_clause, re.I) is not None


def _whole_dir_copy_dest(dockerfile_text: str) -> str | None:
    """The destination of a whole-directory copy of ``mira-crawler`` — shell form
    (`COPY mira-crawler/ /app/x/`, `COPY ./mira-crawler /app/x`) or JSON form
    (`COPY ["mira-crawler/", "/app/x/"]`). A subset copy (`COPY mira-crawler/tasks/`)
    deliberately does NOT match: it would not ship the manifest."""
    for line in dockerfile_text.splitlines():
        m = re.match(r"\s*COPY\s+(?:\./)?mira-crawler/?\s+(\S+)\s*$", line)
        if m:
            return m.group(1).rstrip("/")
        m = re.match(r'\s*COPY\s+\[\s*"(?:\./)?mira-crawler/?"\s*,\s*"([^"]+)"\s*\]\s*$', line)
        if m:
            return m.group(1).rstrip("/")
    return None


class TestManifestPackaging:
    def test_manifest_resolves_to_a_tracked_file_inside_the_crawler_dir(self):
        """``POLICY_PATH`` is computed from the module's own location — parents[1]
        of ``ingest/provenance.py`` — so it is correct wherever the ``mira-crawler``
        directory is copied as a whole. The file it names exists in the repo."""
        assert provenance.POLICY_PATH == CRAWLER_DIR / "provenance_policy.yaml"
        assert provenance.POLICY_PATH.is_file()
        assert provenance.POLICY_PATH.parent == Path(provenance.__file__).resolve().parents[1]

    @pytest.mark.parametrize("dockerfile", DOCKERFILES, ids=lambda p: p.name)
    def test_every_crawler_image_copies_the_whole_directory_onto_the_import_path(self, dockerfile):
        """Each image does ``COPY mira-crawler/ <dest>`` (the manifest rides along
        at ``<dest>/provenance_policy.yaml``) and puts ``<dest>`` on PYTHONPATH,
        so ``ingest/provenance.py`` in the image resolves parents[1] == <dest>."""
        text = dockerfile.read_text(encoding="utf-8")
        dest = _whole_dir_copy_dest(text)
        assert dest, (
            f"{dockerfile.name}: no whole-directory `COPY mira-crawler/ <dest>` — the manifest would not ship"
        )
        # Quoted or bare `ENV PYTHONPATH=...` — the contract is the import path,
        # not the quoting style (follow-up Gate 7 hardening).
        env = re.search(r'PYTHONPATH="([^"]+)"|PYTHONPATH=([^\s"]+)', text)
        assert env, f"{dockerfile.name}: no PYTHONPATH"
        pythonpath = env.group(1) or env.group(2)
        assert dest in pythonpath.split(":"), (
            f"{dockerfile.name}: {dest} not on PYTHONPATH {pythonpath}"
        )

    def test_build_context_does_not_exclude_the_manifest(self):
        """All crawler images build from the repo root, so the root
        ``.dockerignore`` governs what ``COPY mira-crawler/`` can see."""
        rel = provenance.POLICY_PATH.relative_to(REPO_ROOT).as_posix()
        candidates = [rel] + ["/".join(rel.split("/")[:i]) for i in range(1, len(rel.split("/")))]
        for raw in (REPO_ROOT / ".dockerignore").read_text(encoding="utf-8").splitlines():
            pat = raw.strip()
            if not pat or pat.startswith("#"):
                continue
            variants = {pat, pat[3:] if pat.startswith("**/") else pat}
            for c in candidates:
                for v in variants:
                    assert not fnmatch.fnmatchcase(c, v), f".dockerignore `{raw}` excludes {c}"

    @pytest.mark.parametrize("shape", ["missing", "malformed"])
    def test_unusable_manifest_refuses_the_shared_write_at_gate_and_boundary(
        self, shape, tmp_path, monkeypatch, captured
    ):
        """The finding's own trigger ("deploy where the manifest is not found")
        produces the DESIGNED outcome: every shared write is refused, loudly,
        at the ingest gate AND at the store boundary — never allow-all, never
        a task abort. Exercised against the real resolver, not a mocked loader."""
        target = tmp_path / "provenance_policy.yaml"
        if shape == "malformed":
            target.write_text("version: 1\norigins: {}\n", encoding="utf-8")
        monkeypatch.setattr(provenance, "_POLICY", None)
        monkeypatch.setattr(provenance, "POLICY_PATH", target)
        url = "https://literature.rockwellautomation.com/idc/groups/literature/x.pdf"

        ok, reason = _ingest_gate()(url)
        assert ok is False and "fail closed" in reason, (ok, reason)

        allowed, is_private, reason = provenance.enforce_visibility(url, False)
        assert (allowed, is_private) == (False, True), reason
        assert "unreadable" in reason

        assert _insert(False, url) == ""
        assert "sql" not in captured, "a refused write must never reach the database"


# ═══════════════════════════════════════════════════════════════════════════
# F3 — PyYAML is declared, installed everywhere the crawler runs, and its
#      absence is a refused write rather than a task abort
# ═══════════════════════════════════════════════════════════════════════════


def _imports_yaml(path: Path) -> bool:
    tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"), filename=str(path))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            if any(a.name == "yaml" or a.name.startswith("yaml.") for a in node.names):
                return True
        elif isinstance(node, ast.ImportFrom):
            if node.module == "yaml" or (node.module or "").startswith("yaml."):
                return True
    return False


class TestPyYAMLDeclared:
    def test_every_production_yaml_import_is_backed_by_a_declared_requirement(self):
        importers = sorted(
            p.relative_to(CRAWLER_DIR).as_posix()
            for p in _production_py_files()
            if _imports_yaml(p)
        )
        assert "ingest/provenance.py" in importers, importers  # population: the gate itself
        req = REQUIREMENTS.read_text(encoding="utf-8")
        # Accepts extras and trailing markers/comments — `PyYAML[libyaml]>=6.0 ; …` —
        # but still demands a version floor (follow-up Gate 7 hardening).
        assert re.search(r"^PyYAML(?:\[[^\]]*\])?\s*(?:===|==|>=|~=)\s*\d", req, re.I | re.M), (
            f"{len(importers)} production modules import yaml ({importers}) but "
            f"requirements-celery.txt declares no versioned PyYAML"
        )

    @pytest.mark.parametrize("dockerfile", DOCKERFILES, ids=lambda p: p.name)
    def test_every_crawler_image_installs_the_declared_requirements(self, dockerfile):
        text = dockerfile.read_text(encoding="utf-8")
        copy = re.search(r"COPY\s+mira-crawler/requirements-celery\.txt\s+(\S+)", text)
        assert copy, f"{dockerfile.name}: requirements-celery.txt is not copied into the image"
        installed = copy.group(1)
        assert re.search(
            rf"pip install[^\n]*-r\s+(?:{re.escape(installed)}|{re.escape(Path(installed).name)})\b",
            text,
        ), f"{dockerfile.name}: copied {installed} but never `pip install -r` it"

    def test_ci_slice_installs_the_same_requirements(self):
        assert "pip install -r mira-crawler/requirements-celery.txt" in CI_WORKFLOW.read_text(
            encoding="utf-8"
        )

    def test_missing_pyyaml_is_a_refused_write_not_a_task_abort(self, monkeypatch, captured):
        """``import yaml`` is lazy inside ``load_policy``; both consumers wrap it
        in the fail-closed handler. Simulate an image without PyYAML: the gate
        refuses, the boundary refuses, nothing reaches the database, nothing
        raises out to the Celery task."""
        monkeypatch.setattr(provenance, "_POLICY", None)
        monkeypatch.setitem(sys.modules, "yaml", None)  # `import yaml` → ImportError
        url = "https://literature.rockwellautomation.com/idc/groups/literature/x.pdf"

        ok, reason = _ingest_gate()(url)
        assert ok is False and "fail closed" in reason, (ok, reason)

        allowed, is_private, reason = provenance.enforce_visibility(url, False)
        assert (allowed, is_private) == (False, True), reason

        assert _insert(False, url) == ""
        assert "sql" not in captured


# ═══════════════════════════════════════════════════════════════════════════
# The gate itself is case-insensitive on scheme AND host — so widening the
# manifest DISCOVERY to uppercase schemes (R12-F3 fix) cannot open anything:
# an uppercase-scheme origin is classified exactly like its lowercase twin.
# ═══════════════════════════════════════════════════════════════════════════


class TestCaseInsensitiveGate:
    def test_uppercase_scheme_unclassified_origin_is_refused_and_forced_private(self, captured):
        url = "HTTPS://Unknown.Example.INVALID/manual.pdf"
        ok, reason = _ingest_gate()(url)
        assert ok is False, reason
        allowed, is_private, _ = provenance.enforce_visibility(url, False)
        assert (allowed, is_private) == (True, True)  # ingestible, never shared
        _insert(False, url)
        assert captured["params"]["is_private"] is True

    def test_uppercase_scheme_curated_origin_classifies_like_lowercase(self):
        policy = provenance.load_policy()
        curated = next(
            h for h, e in policy["origins"].items() if e.get("classification") == "curated"
        )
        upper = f"HTTPS://{curated.upper()}/doc.pdf"
        lower = f"https://{curated}/doc.pdf"
        assert _ingest_gate()(upper) == _ingest_gate()(lower)
        assert provenance.classify_origin(upper) == provenance.classify_origin(lower)
        assert provenance.enforce_visibility(upper, False) == provenance.enforce_visibility(
            lower, False
        )
