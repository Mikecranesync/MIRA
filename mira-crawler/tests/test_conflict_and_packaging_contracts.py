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


class _Rows:
    def __init__(self, rows: list, count: int = 0, returned_id: str | None = None) -> None:
        self.rows = rows
        self.count = count
        self.returned_id = returned_id  # what `INSERT … RETURNING id` yielded (None = no row)

    def scalar(self):
        return self.count

    def scalar_one_or_none(self):
        return self.returned_id

    def fetchall(self):
        return self.rows


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
        self.box.setdefault("all", []).append((str(stmt), dict(params)))
        # The DB decides what `RETURNING id` yields: nothing when the conflict
        # target fired (box["conflict"]), otherwise the row's id — by default the
        # id the statement bound, or an explicit box["returned_id"].
        if self.box.get("conflict"):
            returned = None
        else:
            returned = self.box.get("returned_id") or params.get("id")
        return _Rows(self.box.get("rows", []), self.box.get("count", 0), returned)

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
        # `COPY [--chown=… --from=…] mira-crawler/ <dest>` — flags are allowed;
        # a non-matching COPY makes the caller's assert fail LOUD (dest is
        # None); it can never pass a Dockerfile that omits the directory.
        m = re.match(r"\s*COPY\s+(?:--\S+\s+)*(?:\./)?mira-crawler/?\s+(\S+)\s*$", line)
        if m:
            return m.group(1).rstrip("/")
        m = re.match(
            r'\s*COPY\s+(?:--\S+\s+)*\[\s*"(?:\./)?mira-crawler/?"\s*,\s*"([^"]+)"\s*\]\s*$', line
        )
        if m:
            return m.group(1).rstrip("/")
    return None


@pytest.mark.parametrize(
    "line,expected",
    [
        ("COPY mira-crawler/ /app/mira_crawler/", "/app/mira_crawler"),
        ("COPY ./mira-crawler /app/x", "/app/x"),
        ("COPY --chown=app:app mira-crawler/ /app/", "/app"),
        ("COPY --from=builder --chown=app:app mira-crawler/ /srv/mc/", "/srv/mc"),
        ('COPY ["mira-crawler/", "/app/mc/"]', "/app/mc"),
        ("COPY mira-crawler/tasks/ /app/mira_crawler/tasks/", None),  # subset: manifest absent
        ("COPY mira-crawler/requirements-celery.txt /app/requirements.txt", None),
        ("COPY mira-core/ /app/core/", None),
    ],
)
def test_whole_dir_copy_matcher_accepts_flags_and_rejects_subset_copies(line, expected):
    """Scanner honesty for the packaging contract (follow-up Gate 7 finding):
    flag-bearing COPY forms are recognised, and a subset copy — the shape that
    would leave the manifest out of the image — is never mistaken for a
    whole-directory copy. A miss here is a loud red, never a silent green."""
    assert _whole_dir_copy_dest(line) == expected


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
# The dedup key is exact-match on source_url. Gate 7 on #3481 (round E, code
# F1, SUSTAINED): two casings of one origin stored as two rows. Root fix: ONE
# canonical-source-URL function — scheme and host lower-cased, everything else
# byte-for-byte — applied inside BOTH constructors of the key (chunk_exists,
# insert_chunk), so lookup and write can never disagree.
# ═══════════════════════════════════════════════════════════════════════════


class TestCanonicalSourceUrl:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            (
                "HTTPS://EXAMPLE.COM/Path/File.PDF?Q=A&b=B#Frag",
                "https://example.com/Path/File.PDF?Q=A&b=B#Frag",
            ),
            ("Http://User:Pass@Example.COM:8443/X", "http://User:Pass@example.com:8443/X"),
            ("https://[2001:DB8::1]:8080/A", "https://[2001:db8::1]:8080/A"),
            ("FILE:///C:/Docs/Manual.pdf", "file:///C:/Docs/Manual.pdf"),
            ("file:/Allowed/Doc.pdf", "file:/Allowed/Doc.pdf"),
            ("/inbox/Doc.pdf", "/inbox/Doc.pdf"),
            ("", ""),
            ("https://example.com/x?", "https://example.com/x?"),  # tail is byte-exact
            ("https://example.com", "https://example.com"),
            (
                "X://Service.Local/Resource",
                "x://service.local/Resource",
            ),  # 1-letter scheme WITH authority
            ("C:\\inbox\\Doc.pdf", "C:\\inbox\\Doc.pdf"),  # Windows drive letter, not a scheme
            (
                "https://example.com/a%2Fpath",
                "https://example.com/a%2Fpath",
            ),  # an escape is never decoded; upper-case hex digits are already canonical
        ],
    )
    def test_scheme_and_host_are_lower_cased(self, raw, expected):
        assert store.canonical_source_url(raw) == expected

    # ── Round T (#3481) code F2 + F3, SUSTAINED high ─────────────────────────
    # RFC 3986 §6.2.3 (scheme-based: an explicit default port is the same
    # authority as none) and §6.2.2.1 (the hex digits of a %HH escape are
    # case-insensitive). Either spelling difference stored ONE logical document
    # under TWO dedup keys. Both are folded into the canonical identity in the
    # smallest standards-correct way: nothing is decoded, only http/https carry
    # a default here, and non-default / empty / invalid port text and invalid
    # `%` text stay byte-exact.

    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("https://example.com:443/file.pdf", "https://example.com/file.pdf"),
            ("HTTP://Example.com:80/x", "http://example.com/x"),
            ("https://example.com:0443/x", "https://example.com/x"),  # equivalent digit spelling
            ("http://example.com:00080/x", "http://example.com/x"),
            ("https://user:p%40ss@example.com:443/x", "https://user:p%40ss@example.com/x"),
            ("https://[2001:DB8::1]:443/A", "https://[2001:db8::1]/A"),  # IPv6 + default port
            ("http://[::1]:80/A", "http://[::1]/A"),
            ("https://example.com:443", "https://example.com"),  # no path
            ("https://example.com:443?q=1#f", "https://example.com?q=1#f"),
        ],
    )
    def test_an_explicit_default_port_is_removed_for_http_and_https(self, raw, expected):
        assert store.canonical_source_url(raw) == expected

    @pytest.mark.parametrize(
        "raw",
        [
            "https://example.com:8443/x",  # non-default
            "http://example.com:443/x",  # 443 is not http's default
            "https://example.com:80/x",  # 80 is not https's default
            "https://example.com:/x",  # empty port text
            "https://example.com:44a/x",  # invalid port text
            "https://example.com:4433/x",  # a different number that merely contains 443
            "https://[2001:db8::1]:8080/A",  # IPv6, non-default
            "ftp://example.com:21/x",  # only http/https carry a canonical default here
            "https://example.com:\u0664\u0664\u0663/x",  # non-ASCII digits are not a port
        ],
    )
    def test_non_default_empty_or_invalid_port_text_is_byte_exact(self, raw):
        assert store.canonical_source_url(raw) == raw

    def test_a_very_long_numeric_port_never_crashes_and_is_still_compared_exactly(self):
        """The URL is untrusted text. CPython refuses to convert a decimal
        string longer than its integer digit limit (~4,300 digits — ValueError),
        so the default-port comparison must never go through int(): a run of
        >5,000 leading zeros is still an equivalent spelling of 443 and must be
        removed, while the same run ending in 444 is non-default and must stay
        byte-exact — both without raising."""
        zeros = "0" * 5001
        assert store.canonical_source_url(f"https://example.com:{zeros}443/x") == (
            "https://example.com/x"
        )
        non_default = f"https://example.com:{zeros}444/x"
        assert store.canonical_source_url(non_default) == non_default

    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("https://example.com/a%7apath", "https://example.com/a%7Apath"),  # path
            ("https://example.com/x?q=%e2%82%ac", "https://example.com/x?q=%E2%82%AC"),  # query
            ("https://example.com/x#%aB", "https://example.com/x#%AB"),  # fragment
            ("https://us%2fer:p%2fw@example.com/x", "https://us%2Fer:p%2Fw@example.com/x"),
            ("https://example.com/%7a%7A%7b", "https://example.com/%7A%7A%7B"),
            ("file:/Allowed/Doc%2fx.pdf", "file:/Allowed/Doc%2Fx.pdf"),  # authority-less URL
            ("FILE:///C:/Docs/Manual%c3%a9.pdf", "file:///C:/Docs/Manual%C3%A9.pdf"),
        ],
    )
    def test_percent_escape_hex_digits_are_upper_cased_in_every_component(self, raw, expected):
        assert store.canonical_source_url(raw) == expected

    @pytest.mark.parametrize(
        "raw",
        [
            "https://example.com/a%zzb",  # not hex
            "https://example.com/a%7",  # truncated escape
            "https://example.com/a%",  # bare percent
            "https://example.com/a%7g",  # one hex digit is not an escape
            "https://example.com/100%25",  # already canonical
            "https://example.com/a%2Fb",  # never decoded to `/`
            "https://example.com/%41",  # never decoded to `A`
        ],
    )
    def test_invalid_escape_text_is_byte_exact_and_escapes_are_never_decoded(self, raw):
        assert store.canonical_source_url(raw) == raw

    def test_a_valid_escape_beside_invalid_text_is_normalised_alone(self):
        assert (
            store.canonical_source_url("https://example.com/a%zz%7ab%7?%2fx%")
            == "https://example.com/a%zz%7Ab%7?%2Fx%"
        )

    def test_escape_case_folding_never_decodes(self):
        assert (
            store.canonical_source_url("https://example.com/a%2fb") == "https://example.com/a%2Fb"
        )

    @pytest.mark.parametrize(
        "raw",
        [
            "/inbox/Doc%7a.pdf",  # bare path — not a URL
            "C:\\inbox\\Doc%7a.pdf",  # Windows drive letter — not a scheme
            "",
        ],
    )
    def test_non_urls_are_untouched_by_the_port_and_escape_rules(self, raw):
        assert store.canonical_source_url(raw) == raw

    @pytest.mark.parametrize(
        "raw",
        [
            "HTTPS://EXAMPLE.COM:443/Doc%7a.PDF?q=%e2#%aB",
            "https://us%2fer@[2001:DB8::1]:443/A%7",
            "http://example.com:00080/x%zz",
            "https://example.com:8443/x%2f",
            "file:/Allowed/Doc%2fx.pdf",
            "https://example.com:/x",
        ],
    )
    def test_expanded_canonical_form_is_idempotent(self, raw):
        once = store.canonical_source_url(raw)
        assert store.canonical_source_url(once) == once

    # ── Round U (#3481) code F1, high: the historical-spelling guard belongs at the
    # write boundary. Every production route runs chunk_exists() before
    # insert_chunk() (store_chunks, tasks/ingest.py, tasks/_shared.py), but a
    # boundary that relies on its callers remembering that is the exact shape
    # this file's provenance enforcement was written to replace. insert_chunk
    # itself now refuses to write a second row beside a row that already exists
    # under the exact spelling the caller supplied.

    def test_insert_itself_never_writes_beside_a_historical_raw_spelled_row(self, captured):
        captured["count"] = 1  # the DB already holds the row under the raw spelling
        raw = "HTTPS://EXAMPLE.COM:443/Legacy%7a.PDF"
        assert _insert(True, raw) == ""
        # No INSERT statement at all reached the DB (only the lookup did). The
        # assertion deliberately does not spell the INSERT-INTO-table token
        # sequence, so Contract 13 (tests/test_architecture.py) does not read
        # a mock-SQL assertion as a new writer.
        statements = [s for s, _ in captured["all"]]
        assert not any(s.lstrip().upper().startswith("INSERT") for s in statements)
        sql = re.sub(r"\s+", " ", captured["sql"])  # the last statement is the lookup
        assert "source_url = ANY(:urls)" in sql
        assert captured["params"]["urls"] == [store.canonical_source_url(raw), raw]
        assert captured["params"]["tid"] == "tenant-a"  # tenant-scoped, like every read

    def test_insert_writes_when_neither_spelling_exists(self, captured):
        captured["count"] = 0
        raw = "HTTPS://EXAMPLE.COM:443/Fresh%7a.PDF"
        assert _insert(True, raw) != ""
        assert captured["sql"].lstrip().upper().startswith("INSERT")
        assert "knowledge_entries" in captured["sql"]
        assert captured["params"]["source_url"] == "https://example.com/Fresh%7A.PDF"
        assert captured["params"]["is_private"] is True

    # ── Round V (#3481) code F1 + F2, high: a conflict is not a write. When
    # ON CONFLICT DO NOTHING inserts nothing (a canonical row already exists —
    # a repeat, or the other of two concurrent writers of the same document)
    # insert_chunk must not hand back a freshly minted id as if a row had been
    # written: store_chunks counts a non-empty return as an insert AND links it
    # into the KG (link_chunk_to_equipment, register_fault_code). The id the
    # function reports is the one the DATABASE yields from `RETURNING id` —
    # nothing else, and no driver-metadata fallback.

    def test_insert_reports_the_id_the_database_returned(self, captured):
        captured["returned_id"] = "id-yielded-by-returning"
        assert _insert(True, "https://example.com/Doc%7A.PDF") == "id-yielded-by-returning"
        sql = re.sub(r"\s+", " ", captured["sql"])
        assert sql.lstrip().upper().startswith("INSERT")
        assert re.search(r"DO\s+NOTHING\s+RETURNING\s+id\b", sql, re.I), sql

    def test_insert_returns_empty_when_the_canonical_row_already_exists(self, captured):
        captured["conflict"] = True  # DO NOTHING fired: RETURNING yielded no row
        assert _insert(True, "https://example.com/Doc%7A.PDF") == ""
        assert captured["sql"].lstrip().upper().startswith("INSERT")  # it was attempted

    def test_concurrent_loser_of_the_same_document_reports_no_write(self, captured):
        """Two writers, two spellings of one document, both canonicalise to one
        key, both pass the pre-insert lookup (no historical row): the first
        INSERT wins and yields its id; the second hits the conflict target and
        yields nothing — it must report `""`, never a second success."""
        winner = _insert(True, "https://example.com/Race%7A.PDF")
        assert winner != ""
        captured["conflict"] = True
        loser = _insert(True, "HTTPS://EXAMPLE.COM:443/Race%7a.PDF")
        assert loser == ""
        inserts = [s for s, _ in captured["all"] if s.lstrip().upper().startswith("INSERT")]
        assert len(inserts) == 2  # both attempted; the DB, not the caller, decided

    def test_store_chunks_neither_counts_nor_links_a_conflict(self, captured, monkeypatch):
        try:
            from ingest import kg_writer
        except ImportError:  # container layout
            from mira_crawler.ingest import kg_writer  # type: ignore[no-redef]
        links: list[tuple[str, str]] = []
        faults: list[dict] = []
        monkeypatch.setattr(
            kg_writer, "register_equipment_and_manual", lambda **kw: ("eq-1", "manual-1")
        )
        monkeypatch.setattr(kg_writer, "link_chunk_to_equipment", lambda e, q: links.append((e, q)))
        monkeypatch.setattr(kg_writer, "register_fault_code", lambda **kw: faults.append(kw))
        chunks = [
            (
                {
                    "text": "fault F0004 overcurrent",
                    "chunk_index": 0,
                    "source_url": "https://example.com/Doc.pdf",
                },
                [0.1, 0.2],
            )
        ]

        captured["returned_id"] = "row-1"
        assert store.store_chunks(chunks, "tenant-a", "Rockwell", "525", is_private=True) == 1
        assert links == [("row-1", "eq-1")]  # linked to the id the DB returned
        assert all(f["source_chunk_id"] == "row-1" for f in faults)

        links.clear()
        faults.clear()
        captured["conflict"] = True
        assert store.store_chunks(chunks, "tenant-a", "Rockwell", "525", is_private=True) == 0
        assert links == [] and faults == []  # a conflict is neither counted nor linked

    def test_insert_pays_no_extra_lookup_when_the_spelling_is_already_canonical(self, captured):
        """The common path is unchanged: a canonical spelling has no historical
        twin to look for, and ON CONFLICT DO NOTHING already lets an existing
        canonical row win."""
        captured["count"] = 1
        assert _insert(True, "https://example.com/Doc%7A.PDF") != ""
        assert [s for s, _ in captured["all"] if "SELECT COUNT" in s] == []

    # ── Round Z (#3481) code F1, high: surrounding whitespace is not part of a
    # URL's identity. A padded spelling of a recognised URL canonicalises to the
    # same key; a padded NON-URL (bare path, drive letter) keeps its bytes — its
    # identity is not silently changed.

    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("  https://Example.com:443/x ", "https://example.com/x"),
            ("\thttp://example.com/a%7a\n", "http://example.com/a%7A"),
            ("  FILE:///C:/Docs/x.pdf", "file:///C:/Docs/x.pdf"),
            ("https://example.com/x", "https://example.com/x"),
        ],
    )
    def test_surrounding_whitespace_is_stripped_from_a_recognised_url(self, raw, expected):
        assert store.canonical_source_url(raw) == expected
        assert store.canonical_source_url(expected) == expected  # idempotent

    @pytest.mark.parametrize(
        "raw",
        [
            " /inbox/Doc.pdf",  # padded bare path
            "C:\\inbox\\Doc.pdf ",  # padded Windows drive path
            "  ",
            " not a url ",
            " ftp://Example.com/x ",  # padded, but not an allowed scheme: untouched entirely
            "  mailto:A@B.example ",
            "\tX://Service.Local/Resource\n",
        ],
    )
    def test_a_padded_non_url_or_disallowed_scheme_keeps_its_bytes(self, raw):
        assert store.canonical_source_url(raw) == raw

    def test_an_unpadded_other_scheme_still_canonicalises_as_before(self):
        assert store.canonical_source_url("FTP://Example.com:21/X") == "ftp://example.com:21/X"

    def test_lookup_and_write_share_one_key_across_port_and_escape_spellings(self, captured):
        raw = "HTTPS://EXAMPLE.COM:443/Doc%7a.PDF"
        canon = "https://example.com/Doc%7A.PDF"
        assert store.chunk_exists("tenant-a", raw, 0) is False  # fake DB: 0 rows
        looked_up, historical = captured["params"]["urls"]
        assert historical == raw  # the historical raw-spelling lookup stays
        assert _insert(True, raw) != ""
        written = captured["params"]["source_url"]
        assert looked_up == written == canon == store.canonical_source_url(raw)
        assert captured["params"]["tenant_id"] == "tenant-a"
        assert captured["params"]["is_private"] is True

    def test_store_chunks_sees_one_key_across_port_and_escape_spellings(self, captured):
        for url in (
            "https://example.com:443/Doc%7a.PDF",
            "https://example.com/Doc%7A.PDF",
            "HTTPS://EXAMPLE.COM:0443/Doc%7a.PDF",
        ):
            chunks = [({"text": "c", "chunk_index": 0, "source_url": url}, [0.1, 0.2])]
            store.store_chunks(chunks, "tenant-a", is_private=True)
        keys = {
            (p.get("tid") or p.get("tenant_id"), (p.get("urls") or [p.get("source_url")])[0])
            for _, p in captured["all"]
        }
        assert keys == {("tenant-a", "https://example.com/Doc%7A.PDF")}

    def test_ledger_probe_matches_historical_port_and_escape_spellings(self, captured):
        captured["rows"] = [
            ("https://example.com/New%7A.pdf",),  # landed under the canonical key
            ("https://example.com:443/Old%7a.pdf",),  # historical row, raw spelling
        ]
        asked = [
            "https://example.com:443/New%7a.pdf",
            "https://example.com:443/Old%7a.pdf",
            "https://example.com/Missing.pdf",
        ]
        got = store.ingested_source_urls(asked, "tenant-a")
        assert got == {"https://example.com:443/New%7a.pdf", "https://example.com:443/Old%7a.pdf"}
        queried = set(captured["params"]["urls"])
        assert {
            "https://example.com/New%7A.pdf",
            "https://example.com:443/Old%7a.pdf",
            "https://example.com/Old%7A.pdf",
        } <= queried
        assert captured["params"]["tid"] == "tenant-a"

    def test_port_and_escape_canonicalisation_never_changes_visibility_or_refusal(self):
        for raw in (
            "HTTPS://Unknown.Example.INVALID:443/x%7a.pdf",
            "https://unknown.example.invalid:8443/x.pdf",
            "http://[::1]:80/x%2f.pdf",
            "FILE:///C:/Docs/x%7a.pdf",
        ):
            assert provenance.enforce_visibility(raw, False) == provenance.enforce_visibility(
                store.canonical_source_url(raw), False
            )

    def test_lookup_also_matches_a_historical_row_stored_in_the_callers_spelling(self, captured):
        """Round-F code finding (real): rows written BEFORE canonicalisation keep
        their raw casing, and the freshness recrawl re-supplies exactly that
        stored spelling. A canonical-only lookup would miss such a row and the
        recrawl would write a duplicate. `chunk_exists` therefore asks for the
        canonical key AND the spelling it was given."""
        raw = "HTTPS://EXAMPLE.COM/Legacy.PDF"
        store.chunk_exists("tenant-a", raw, 0)
        params = captured["params"]
        # Round AD (#3481, round-27 scope B F1 SUSTAINED): the two exact spellings
        # are bound as ONE array probe — an index condition by construction — never
        # as an `OR` of two predicates.
        assert params["urls"] == ["https://example.com/Legacy.PDF", raw]
        sql = re.sub(r"\s+", " ", captured["sql"])
        assert "source_url = ANY(:urls)" in sql
        assert " OR " not in sql.upper()
        assert "tenant_id = :tid" in sql

    def test_lookup_binds_one_spelling_when_the_input_is_already_canonical(self, captured):
        store.chunk_exists("tenant-a", "https://example.com/Doc.PDF", 0)
        assert captured["params"]["urls"] == ["https://example.com/Doc.PDF"]

    def test_idempotent(self):
        once = store.canonical_source_url("HTTPS://Example.COM/A?B=c")
        assert store.canonical_source_url(once) == once

    def test_insert_binds_one_canonical_key_for_every_casing(self, captured):
        upper = "HTTPS://LITERATURE.ROCKWELLAUTOMATION.COM/Idc/Lit.PDF"
        lower = "https://literature.rockwellautomation.com/Idc/Lit.PDF"
        assert _insert(True, upper) != ""
        bound_upper = captured["params"]["source_url"]
        assert _insert(True, lower) != ""
        bound_lower = captured["params"]["source_url"]
        assert bound_upper == bound_lower == lower
        assert captured["params"]["tenant_id"] == "tenant-a"  # tenant invariant untouched
        assert captured["params"]["is_private"] is True  # privacy invariant untouched

    def test_lookup_queries_the_same_canonical_key_as_the_write(self, captured):
        upper = "HTTPS://LITERATURE.ROCKWELLAUTOMATION.COM/Idc/Lit.PDF"
        assert store.chunk_exists("tenant-a", upper, 3) is False  # fake DB: 0 rows
        looked_up = captured["params"]["urls"][0]
        _insert(True, upper)
        written = captured["params"]["source_url"]
        assert looked_up == written == store.canonical_source_url(upper)

    def test_store_chunks_cannot_create_a_second_differently_cased_key(self, captured, monkeypatch):
        """The batch path (chunk_exists → insert_chunk) sees ONE key for both casings."""
        for url in ("HTTPS://EXAMPLE.COM/Doc.PDF", "https://example.com/Doc.PDF"):
            chunks = [({"text": "c", "chunk_index": 0, "source_url": url}, [0.1, 0.2])]
            store.store_chunks(chunks, "tenant-a", is_private=True)
        keys = {
            (p.get("tid") or p.get("tenant_id"), (p.get("urls") or [p.get("source_url")])[0])
            for _, p in captured["all"]
        }
        assert keys == {("tenant-a", "https://example.com/Doc.PDF")}

    def test_ledger_probe_matches_canonical_and_historical_rows_in_the_callers_spelling(
        self, captured
    ):
        """`ingested_source_urls` is the ledger's authority for "did it land?".
        Writes are canonical from now on, but historical rows keep their raw
        casing — so the probe must look for BOTH spellings and answer in the
        caller's own spelling, or a mixed-case enqueued URL stays pending forever."""
        captured["rows"] = [("https://example.com/New.pdf",), ("HTTPS://EXAMPLE.COM/Old.pdf",)]
        asked = [
            "HTTPS://EXAMPLE.COM/New.pdf",  # landed under the canonical key
            "HTTPS://EXAMPLE.COM/Old.pdf",  # historical row, raw casing
            "https://example.com/Missing.pdf",
        ]
        got = store.ingested_source_urls(asked, "tenant-a")
        assert got == {"HTTPS://EXAMPLE.COM/New.pdf", "HTTPS://EXAMPLE.COM/Old.pdf"}
        queried = set(captured["params"]["urls"])
        assert {
            "https://example.com/New.pdf",
            "HTTPS://EXAMPLE.COM/Old.pdf",
            "https://example.com/Old.pdf",
        } <= queried
        assert captured["params"]["tid"] == "tenant-a"

    def test_ledger_probe_refuses_to_run_without_a_tenant(self, captured):
        """Gate 7 round M on #3481 (real, pre-existing): `ingested_source_urls`
        took `tenant_id=""` and then dropped the tenant predicate, so an unset
        MIRA_TENANT_ID turned the ledger's did-it-land probe into a cross-tenant
        existence query. Fail closed instead: no tenant → no query, nothing
        reported as ingested (items stay pending, the retryable direction)."""
        captured["rows"] = [("https://example.com/a.pdf",)]
        for bad in ("", None, "   ", "\t\n", 123):
            assert store.ingested_source_urls(["https://example.com/a.pdf"], bad) == set(), bad  # type: ignore[arg-type]
        assert "sql" not in captured, (
            "an invalid tenant (empty, None, whitespace, non-str) must never reach the database"
        )
        # With a tenant the predicate is always present.
        store.ingested_source_urls(["https://example.com/a.pdf"], "tenant-a")
        assert "tenant_id = :tid" in captured["sql"] and captured["params"]["tid"] == "tenant-a"

    def test_canonicalisation_never_changes_visibility_or_refusal(self):
        for raw in (
            "HTTPS://Unknown.Example.INVALID/x.pdf",
            "https://unknown.example.invalid/x.pdf",
            "FILE:///C:/Docs/x.pdf",
        ):
            assert provenance.enforce_visibility(raw, False) == provenance.enforce_visibility(
                store.canonical_source_url(raw), False
            )


# ═══════════════════════════════════════════════════════════════════════════
# Round P (#3481) code F1, SUSTAINED: the write-boundary refusal warning logged
# the source URL (path and query included). Operator logs are not a tenant
# surface, but a URL path can carry a document name or a token; the log needs
# only enough to correlate — the origin and a short hash of the exact URL.
# ═══════════════════════════════════════════════════════════════════════════


class TestUserinfoRefusedAtTheBoundary:
    """Round Z (#3481) code F2, high: a URL whose authority carries userinfo
    (`user:password@host`) is refused at the hop-0 gate and at the store
    boundary — before canonicalisation, before any SQL — and the credential
    never reaches a log. Userinfo is never stripped into another identity and
    never persisted: an authenticated source uses out-of-band, secret-backed
    request headers, not URL userinfo (repository secret policy)."""

    URL = "https://svc:hunter2@Example.com:443/private/doc.pdf"

    @staticmethod
    def _no_credential_reached_sql(captured: dict) -> None:
        """Every statement and every bound parameter value, not just the last."""
        for sql, params in captured.get("all", []):
            blob = f"{sql} {params!r}"
            assert "hunter2" not in blob and "svc" not in blob, blob[:200]

    def test_gate_and_policy_refuse_userinfo(self):
        ok, reason = _ingest_gate()(self.URL)
        assert ok is False and "userinfo" in reason and "hunter2" not in reason
        allowed, is_private, reason = provenance.enforce_visibility(self.URL, False)
        assert (allowed, is_private) == (False, True) and "hunter2" not in reason
        assert provenance.shared_corpus_allowed(self.URL)[0] is False
        assert provenance.url_has_userinfo(self.URL)
        assert provenance.url_has_userinfo("http://u@[::1]/x")
        assert provenance.url_has_userinfo("  HTTPS://u:p@example.com/x")  # padded, upper-case

    def test_an_at_sign_outside_the_authority_is_not_userinfo(self):
        for url in (
            "https://example.com/x?mail=a@b.c",
            "https://example.com/p@th",
            "https://example.com/x#a@b",
            "file:///C:/Docs/a@b.pdf",
        ):
            assert not provenance.url_has_userinfo(url), url
        # The rule never widens: an origin without userinfo classifies exactly as before.
        assert provenance.enforce_visibility("https://unknown.example.invalid/x?u=a@b", False) == (
            True,
            True,
            provenance.enforce_visibility("https://unknown.example.invalid/x", False)[2],
        )

    # ── Round AB (#3481): the policy is ANY URL userinfo, not http/https only.
    # A `scheme://authority` form of every syntactically valid scheme is checked;
    # a direct store call with ftp:// or s3:// credentials must be refused the
    # same way, and `file://user@host/x` fails closed too.

    NON_HTTP = (
        "ftp://svc:hunter2@files.example.com/doc.pdf",
        "s3://AKIAKEY:hunter2@bucket/prefix/key",
        "FTP://SVC:hunter2@Files.Example.COM/x",  # upper-case scheme
        "ftp://svc@files.example.com/x",  # username only
        "ftp://svc:hunter2@[2001:db8::1]:2121/x",  # IPv6 authority
        "sftp://svc:hunter2@files.example.com/x",
        "custom+scheme.v1://svc:hunter2@host/x",
        "file://svc@host/share/x.pdf",  # file with userinfo in the authority
        "  FTP://svc:hunter2@files.example.com/x ",  # padded
    )

    def test_userinfo_is_detected_for_every_scheme_authority_form(self):
        for url in self.NON_HTTP:
            assert provenance.url_has_userinfo(url), url
        for url in (
            "ftp://files.example.com/p@th",  # @ in the path
            "s3://bucket/x?k=a@b",  # @ in the query
            "ftp://files.example.com/x#a@b",  # @ in the fragment
            "file:///C:/Docs/a@b.pdf",  # empty authority; @ in the path
            "file:/share/a@b.pdf",  # no authority at all
            "/inbox/a@b.pdf",  # bare path
            "C:\\inbox\\a@b.pdf",  # drive letter
            "mailto:a@b.example",  # no `//` authority form
            "ftp://files.example.com/x",
        ):
            assert not provenance.url_has_userinfo(url), url

    def test_non_http_userinfo_is_refused_before_any_sql_on_every_route(self, captured, caplog):
        import logging

        try:
            from ingest import kg_writer
        except ImportError:  # container layout
            from mira_crawler.ingest import kg_writer  # type: ignore[no-redef]
        for url in self.NON_HTTP:
            with caplog.at_level(logging.WARNING, logger="mira-crawler.store"):
                assert _insert(True, url) == "", url
                assert store.chunk_exists("tenant-a", url, 0) is False, url
                chunks = [({"text": "c", "chunk_index": 0, "source_url": url}, [0.1, 0.2])]
                assert store.store_chunks(chunks, "tenant-a", is_private=True) == 0, url
                assert store.ingested_source_urls([url], "tenant-a") == set(), url
            assert "sql" not in captured, url  # nothing reached the DB on any route
            assert provenance.enforce_visibility(url, False)[0] is False, url
            assert provenance.shared_corpus_allowed(url)[0] is False, url
        assert "hunter2" not in caplog.text and "AKIAKEY" not in caplog.text
        assert "svc" not in caplog.text
        self._no_credential_reached_sql(captured)
        del kg_writer

    # ── Round AD (#3481, round-27 scope C F1 SUSTAINED): a credential-like QUERY
    # parameter is refused exactly like userinfo — before identity, log or SQL —
    # through the same common boundary rule. Names are matched decoded,
    # case-insensitively and separator-insensitively; values are never inspected
    # (a value that merely contains "token" is an ordinary query).

    CREDENTIAL_QUERY = (
        "https://example.com/doc.pdf?token=abc123",
        "https://example.com/doc.pdf?page=2&access_token=abc123",
        "https://example.com/doc.pdf?ID_TOKEN=abc123",
        "https://example.com/doc.pdf?api_key=abc123",
        "https://example.com/doc.pdf?apikey=abc123",
        "https://example.com/doc.pdf?Api-Key=abc123",
        "https://example.com/doc.pdf?auth=abc123",
        "https://example.com/doc.pdf?Authorization=Bearer%20abc123",
        "https://example.com/doc.pdf?password=abc123",
        "https://example.com/doc.pdf?passwd=abc123",
        "https://example.com/doc.pdf?secret=abc123",
        "https://example.com/doc.pdf?client_secret=abc123",
        "https://example.com/doc.pdf?signature=abc123",
        "https://example.com/doc.pdf?sig=abc123",
        "https://example.com/doc.pdf?credential=abc123",
        "https://example.com/doc.pdf?X-Amz-Signature=abc123",
        "https://example.com/doc.pdf?X-Amz-Credential=abc123",
        "https://example.com/doc.pdf?x-goog-signature=abc123",
        "https://example.com/doc.pdf?X-Goog-Credential=abc123",
        "https://example.com/doc.pdf?q=1;token=abc123",  # `;` separator
        "https://example.com/doc.pdf?%74oken=abc123",  # percent-encoded name
        "https://example.com/doc.pdf?api%5Fkey=abc123",  # encoded separator in the name
        "ftp://files.example.com/doc.pdf?token=abc123",  # any scheme
        "https://example.com/doc.pdf?token=abc123#frag",
    )
    ORDINARY_QUERY = (
        "https://example.com/doc.pdf?q=token",  # the WORD in a value is not a credential
        "https://example.com/doc.pdf?q=api_key+rotation&page=2",
        "https://example.com/doc.pdf?v=3&lc=en&limit=10",
        "https://example.com/doc.pdf?url=https%3A%2F%2Fother.example%2Fx",
        "https://example.com/doc.pdf?tokenizer=bpe",  # not the family (a longer name)
        "https://example.com/doc.pdf?signature_help=1",
        "https://example.com/doc.pdf?",
        "https://example.com/doc.pdf",
    )

    def test_credential_query_parameters_are_detected_and_ordinary_ones_are_not(self):
        for url in self.CREDENTIAL_QUERY:
            assert provenance.url_credential_reason(url), url
            assert "abc123" not in (provenance.url_credential_reason(url) or ""), url
        for url in self.ORDINARY_QUERY:
            assert provenance.url_credential_reason(url) is None, url

    def test_credential_query_is_refused_before_any_sql_on_every_route(self, captured, caplog):
        import logging

        for url in self.CREDENTIAL_QUERY:
            with caplog.at_level(logging.WARNING, logger="mira-crawler.store"):
                assert _insert(True, url) == "", url
                assert store.chunk_exists("tenant-a", url, 0) is False, url
                chunks = [({"text": "c", "chunk_index": 0, "source_url": url}, [0.1, 0.2])]
                assert store.store_chunks(chunks, "tenant-a", is_private=True) == 0, url
                assert store.ingested_source_urls([url], "tenant-a") == set(), url
            assert "sql" not in captured, url
            assert provenance.enforce_visibility(url, False)[0] is False, url
            assert provenance.shared_corpus_allowed(url)[0] is False, url
        assert "abc123" not in caplog.text
        assert "sha256:" not in caplog.text  # nothing derived from a credential URL is hashed
        assert "example.com" in caplog.text and "credential" in caplog.text
        for sql, params in captured.get("all", []):
            assert "abc123" not in f"{sql} {params!r}"

    def test_ordinary_queries_still_write_and_no_refusal_ever_hashes_the_url(
        self, captured, caplog
    ):
        import logging

        assert _insert(True, "https://example.com/doc.pdf?v=3&lc=en") != ""
        assert "v=3&lc=en" in captured["params"]["source_url"]  # identity keeps its query
        # A policy refusal (blocked origin, no credential) names the origin only —
        # no path, no query, and (round AE) no hash of the URL on ANY refusal path.
        policy = provenance.load_policy()
        blocked = next(
            h for h, e in policy["origins"].items() if e.get("classification") == "blocked"
        )
        with caplog.at_level(logging.WARNING, logger="mira-crawler.store"):
            assert _insert(False, f"https://{blocked}/x.pdf?page=2") == ""
        assert blocked in caplog.text
        assert "sha256:" not in caplog.text and "page=2" not in caplog.text

    def test_userinfo_refusal_logs_only_a_safe_origin_and_no_hash(self, caplog):
        import logging

        with caplog.at_level(logging.WARNING, logger="mira-crawler.store"):
            assert _insert(True, self.URL) == ""
        line = [r.getMessage() for r in caplog.records if "credential" in r.getMessage()][-1]
        assert "example.com:443" in line and "sha256:" not in line
        assert "hunter2" not in line and "svc" not in line

    def test_insert_refuses_userinfo_with_no_sql_and_no_credential_in_logs(
        self, captured, caplog, monkeypatch
    ):
        import logging

        # "Before canonicalisation": the store boundary refuses on its own, before
        # the canonical identity is ever computed — not only via enforce_visibility.
        monkeypatch.setattr(
            store,
            "canonical_source_url",
            lambda u: pytest.fail("canonicalised a credential-bearing URL"),
        )
        with caplog.at_level(logging.WARNING, logger="mira-crawler.store"):
            assert _insert(True, self.URL) == ""
        assert "sql" not in captured  # nothing reached the DB — not even the dedup lookup
        assert "hunter2" not in caplog.text and "svc:" not in caplog.text
        assert "userinfo" in caplog.text

    def test_chunk_exists_refuses_userinfo_without_a_query(self, captured):
        assert store.chunk_exists("tenant-a", self.URL, 0) is False
        assert "sql" not in captured

    def test_store_chunks_refuses_userinfo_with_no_sql_and_no_links(self, captured, monkeypatch):
        try:
            from ingest import kg_writer
        except ImportError:  # container layout
            from mira_crawler.ingest import kg_writer  # type: ignore[no-redef]
        links: list = []
        monkeypatch.setattr(
            kg_writer, "register_equipment_and_manual", lambda **kw: ("eq-1", "manual-1")
        )
        monkeypatch.setattr(kg_writer, "link_chunk_to_equipment", lambda e, q: links.append((e, q)))
        chunks = [({"text": "c", "chunk_index": 0, "source_url": self.URL}, [0.1, 0.2])]
        assert store.store_chunks(chunks, "tenant-a", "Rockwell", "525", is_private=True) == 0
        assert "sql" not in captured and links == []
        self._no_credential_reached_sql(captured)

    def test_ledger_probe_never_binds_a_credential_and_never_returns_the_refused_spelling(
        self, captured, caplog
    ):
        import logging

        captured["rows"] = [("https://example.com/safe.pdf",)]
        with caplog.at_level(logging.WARNING, logger="mira-crawler.store"):
            got = store.ingested_source_urls(
                ["https://example.com/safe.pdf", self.URL, "http://a:b@other.example/x"],
                "tenant-a",
            )
        assert got == {"https://example.com/safe.pdf"}  # only the safe value is answered
        queried = captured["params"]["urls"]
        assert "https://example.com/safe.pdf" in queried
        assert not any("@" in u for u in queried)  # the refused spellings were never bound
        self._no_credential_reached_sql(captured)
        assert "hunter2" not in caplog.text and "svc:" not in caplog.text
        assert "userinfo" in caplog.text

    def test_ledger_probe_with_only_userinfo_urls_runs_no_query(self, captured):
        assert (
            store.ingested_source_urls([self.URL, "http://a:b@other.example/x"], "tenant-a")
            == set()
        )
        assert "sql" not in captured

    def test_insert_and_lookup_bind_no_credential_anywhere(self, captured):
        _insert(True, self.URL)
        store.chunk_exists("tenant-a", self.URL, 0)
        assert captured.get("all", []) == []  # no statement at all
        self._no_credential_reached_sql(captured)


class TestRefusalLogging:
    def test_refusal_warning_logs_origin_and_hash_never_the_path_or_query(self, captured, caplog):
        import logging

        policy = provenance.load_policy()
        blocked = next(
            h for h, e in policy["origins"].items() if e.get("classification") == "blocked"
        )
        # An ORDINARY query (no credential-family name): the refusal is the policy's.
        # It names the origin — never the path or query, and (round AE) never a hash
        # of the URL: a hash of a URL is a fingerprint of any secret it might carry.
        url = f"https://{blocked}/private/Secret-Doc-Name.pdf?page=2&dl=1"
        with caplog.at_level(logging.WARNING, logger="mira-crawler.store"):
            assert _insert(False, url) == ""  # refused at the boundary
        text = caplog.text
        assert "Secret-Doc-Name" not in text and "page=2" not in text
        assert blocked in text and "sha256:" not in text
        assert "sql" not in captured
        assert not hasattr(store, "_log_ref")  # the hashing reference is gone, not dormant

    def test_safe_origin_is_stable_and_never_echoes_the_url(self):
        url = "HTTPS://Example.COM/Path/File.PDF?q=1"
        ref = store._safe_origin(url)
        assert ref == store._safe_origin(url) == "example.com"  # host as classified
        assert "/Path/File.PDF" not in ref and "q=1" not in ref
        assert store._safe_origin("") == "<no url>"

    # Round-23 (#3481) code observation, real: `urlsplit(url).netloc` carries the
    # userinfo, so a URL with embedded credentials would have put `user:secret@`
    # into the refusal log. The reference is host[:port] — never the userinfo.

    def test_safe_origin_never_carries_userinfo_or_a_hash(self):
        ref = store._safe_origin("https://user:s3cret@Example.COM:8443/private/x.pdf?token=abc")
        assert ref == "example.com:8443"
        for secret in ("user", "s3cret", "@", "token=abc", "/private", "sha256"):
            assert secret not in ref, secret
        # An IPv6 literal stays bracketed so host and port cannot be confused.
        assert store._safe_origin("https://[2001:DB8::1]:8443/x") == "[2001:db8::1]:8443"
        assert store._safe_origin("https://u:p@[::1]/x") == "[::1]"
        assert store._safe_origin("https://example.com:44a/x") == "<unparseable>"
        assert store._safe_origin("https://example.com/x") == "example.com"

    def test_refusal_warning_never_carries_userinfo(self, captured, caplog):
        import logging

        policy = provenance.load_policy()
        blocked = next(
            h for h, e in policy["origins"].items() if e.get("classification") == "blocked"
        )
        url = f"https://svc:hunter2@{blocked}/private/doc.pdf"
        with caplog.at_level(logging.WARNING, logger="mira-crawler.store"):
            assert _insert(False, url) == ""
        assert "hunter2" not in caplog.text and "svc:" not in caplog.text
        # A credential-bearing refusal logs the safe origin only — and no hash of
        # anything derived from the credential-bearing URL (round AD).
        assert blocked in caplog.text and "sha256:" not in caplog.text


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
