"""Do the ontology's rules describe what the application actually does?  (#5528, audit #5518)

The ontology validator runs offline against fixtures. Nothing in a live workflow calls it, so a
green validator says nothing about runtime behaviour. This module is the other half:

* ``ontology/mappings/runtime-contract.v1.json`` names, for every shape, whether the application
  enforces it (``runtime``), only the offline validator checks it (``offline_only``), or the
  application does not do it today (``planned``).
* Each ``runtime`` claim points at a contract test below that executes the REAL code path. No
  mocks of the thing under test: the drive-pack resolver, the live-snapshot decoder, the anomaly
  rules, the approval-transition tables and migration 029 on a throwaway PostgreSQL are all the
  shipped code.
* Where the application disagrees with the ontology the test is a STRICT xfail naming the audit
  issue that owns the repair (#5520, #5523). Those repairs are cross-cutting and belong to those
  issues, not here. When one lands, its xfail turns into an unexpected pass and forces this file
  and the mapping to be updated.

Run:  pytest tests/test_ontology_runtime_contract.py -v
"""

from __future__ import annotations

import ast
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
from glob import glob
from pathlib import Path

import pytest

pytest.importorskip("rdflib", reason="ontology toolchain: pip install -r ontology/requirements.txt")
pytest.importorskip(
    "pyshacl", reason="ontology toolchain: pip install -r ontology/requirements.txt"
)

REPO_ROOT = Path(__file__).resolve().parent.parent
MAPPING = REPO_ROOT / "ontology" / "mappings" / "runtime-contract.v1.json"

# tests/conftest.py already puts mira-bots on sys.path. The anomaly rules are loaded by file path
# so this module adds nothing to sys.path that could shadow another suite's imports.


def _load_by_path(name: str, rel: str):
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, REPO_ROOT / rel)
    assert spec is not None and spec.loader is not None, rel
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


V = _load_by_path("validate_ontology", "tools/validate_ontology.py")


def _run_phase(mapping: dict, tmp_path: Path):
    """Run the validator's runtime-contract phase against a (possibly doctored) mapping."""
    path = tmp_path / "runtime-contract.v1.json"
    path.write_text(json.dumps(mapping))
    report = V.Report()
    onto, shapes = V.check_syntax(report)
    V.check_runtime_contract(report, onto, shapes, mapping_path=path)
    return {r.name: r for r in report.results if r.name.startswith(("runtime:", "vocab:"))}


def _real_mapping() -> dict:
    return json.loads(MAPPING.read_text())


# ── The mapping is checked, not just written ──────────────────────────────────


class TestTheMappingIsAGate:
    def test_the_committed_mapping_passes(self, tmp_path):
        results = _run_phase(_real_mapping(), tmp_path)
        failed = {n: r.detail for n, r in results.items() if not r.passed}
        assert not failed, failed
        assert "runtime:shape-mapping" in results
        assert any(n.startswith("vocab:ApprovalState") for n in results)

    def test_a_missing_mapping_file_fails_instead_of_skipping(self, tmp_path):
        report = V.Report()
        onto, shapes = V.check_syntax(report)
        V.check_runtime_contract(report, onto, shapes, mapping_path=tmp_path / "absent.json")
        assert not report.ok

    def test_a_shape_with_no_entry_fails(self, tmp_path):
        m = _real_mapping()
        del m["shapes"]["SelfParentShape"]
        r = _run_phase(m, tmp_path)["runtime:shape-mapping"]
        assert not r.passed and "SelfParentShape" in r.detail

    def test_an_entry_for_a_shape_that_does_not_exist_fails(self, tmp_path):
        m = _real_mapping()
        m["shapes"]["NoSuchShape"] = {"enforcement": "offline_only"}
        r = _run_phase(m, tmp_path)["runtime:shape-mapping"]
        assert not r.passed and "NoSuchShape" in r.detail

    def test_claiming_runtime_enforcement_without_a_contract_fails(self, tmp_path):
        m = _real_mapping()
        m["shapes"]["SelfParentShape"] = {"enforcement": "runtime", "scope": "everywhere"}
        r = _run_phase(m, tmp_path)["runtime:shape-mapping"]
        assert not r.passed and "SelfParentShape" in r.detail

    def test_runtime_enforcement_cannot_rest_on_a_contract_the_app_fails(self, tmp_path):
        m = _real_mapping()
        m["shapes"]["AssetClassInstanceShape"] = {
            "enforcement": "runtime",
            "scope": "x",
            "contracts": ["fault-code-identity-includes-the-model"],
        }
        r = _run_phase(m, tmp_path)["runtime:shape-mapping"]
        assert not r.passed and "AssetClassInstanceShape" in r.detail

    def test_planned_needs_a_tracking_reference(self, tmp_path):
        m = _real_mapping()
        m["shapes"]["AssetClassInstanceShape"].pop("tracking")
        r = _run_phase(m, tmp_path)["runtime:shape-mapping"]
        assert not r.passed and "tracking" in r.detail

    def test_a_contract_pointing_at_a_test_that_does_not_exist_fails(self, tmp_path):
        m = _real_mapping()
        m["contracts"]["command-is-not-feedback"]["test"] = (
            "tests/test_ontology_runtime_contract.py::TestCommandIsNotFeedback::test_gone"
        )
        r = _run_phase(m, tmp_path)["runtime:contracts"]
        assert not r.passed and "test_gone" in r.detail

    def test_a_contract_pointing_at_code_that_does_not_exist_fails(self, tmp_path):
        m = _real_mapping()
        m["contracts"]["command-is-not-feedback"]["code"] = ["plc/no_such_file.py"]
        r = _run_phase(m, tmp_path)["runtime:contracts"]
        assert not r.passed and "no_such_file" in r.detail

    def test_an_agreeing_contract_may_not_be_an_expected_failure(self, tmp_path):
        """'agrees' on a test that is marked xfail would be a green claim on red behaviour."""
        m = _real_mapping()
        m["contracts"]["fault-code-identity-includes-the-model"]["status"] = "agrees"
        r = _run_phase(m, tmp_path)["runtime:contracts"]
        assert not r.passed and "xfail" in r.detail

    def test_a_disagreeing_contract_must_be_a_strict_expected_failure(self, tmp_path):
        m = _real_mapping()
        m["contracts"]["command-is-not-feedback"]["status"] = "disagrees"
        m["contracts"]["command-is-not-feedback"]["tracking"] = "#0"
        r = _run_phase(m, tmp_path)["runtime:contracts"]
        assert not r.passed and "xfail" in r.detail


class TestTheInventoryDocument:
    def test_the_committed_inventory_matches_what_the_validator_generates(self):
        shapes = V.load_graph(V.shape_files())
        wanted = V.render_inventory(shapes, V.FIXTURES_DIR, _real_mapping())
        assert V.INVENTORY_FILE.read_text() == wanted

    def test_a_stale_inventory_fails_the_validator(self, monkeypatch, tmp_path):
        stale = tmp_path / "SHAPE-INVENTORY.md"
        stale.write_text("# old\n")
        monkeypatch.setattr(V, "INVENTORY_FILE", stale)
        monkeypatch.setattr(V, "REPO_ROOT", tmp_path)
        report = V.Report()
        V.check_inventory_current(
            report, V.load_graph(V.shape_files()), V.FIXTURES_DIR, _real_mapping()
        )
        assert not report.ok

    def test_every_shape_has_a_row_with_both_examples_or_a_stated_exclusion(self):
        rows = [r for r in V.INVENTORY_FILE.read_text().splitlines() if r.startswith("| `")]
        shape_rows = [r for r in rows if r.split("|")[1].strip().endswith("Shape`")]
        assert len(shape_rows) == 42
        for row in shape_rows:
            cells = [c.strip() for c in row.split("|")]
            assert "UNMAPPED" not in row
            if cells[3] == "none" or cells[4] == "none":
                assert "Fixture coverage excluded" in row, row


class TestVocabularyDrift:
    def test_an_undeclared_difference_between_ontology_and_database_fails(self, tmp_path):
        """Drop the declared 'relationships cannot be deprecated' difference: must go red."""
        m = _real_mapping()
        for v in m["vocabularies"]:
            for s in v["sources"]:
                if s.get("table") == "kg_relationships":
                    for key in ("ontology_only", "runtime_only", "reason"):
                        s.pop(key)
        results = _run_phase(m, tmp_path)
        bad = [
            r for n, r in results.items() if n.startswith("vocab:ApprovalState") and not r.passed
        ]
        assert bad and "deprecated" in bad[0].detail

    def test_a_declared_difference_that_is_no_longer_true_fails(self, tmp_path):
        m = _real_mapping()
        for v in m["vocabularies"]:
            if v["ontology_class"] == "ValueType":
                v["sources"][0].update(ontology_only=["enum"], runtime_only=[], reason="made up")
        results = _run_phase(m, tmp_path)
        assert any(n.startswith("vocab:ValueType") and not r.passed for n, r in results.items())

    def test_a_declared_difference_needs_a_reason(self, tmp_path):
        m = _real_mapping()
        for v in m["vocabularies"]:
            for s in v["sources"]:
                if s.get("table") == "kg_relationships":
                    s["reason"] = ""
        results = _run_phase(m, tmp_path)
        assert any(n.startswith("vocab:ApprovalState") and not r.passed for n, r in results.items())

    def test_a_source_the_checker_cannot_read_fails_instead_of_passing(self, tmp_path):
        m = _real_mapping()
        m["vocabularies"][0]["sources"][0]["column"] = "no_such_column"
        results = _run_phase(m, tmp_path)
        assert any(n.startswith("vocab:ApprovalState") and not r.passed for n, r in results.items())

    def test_the_ontology_says_which_table_allows_deprecated_the_right_way_round(self):
        """The ontology text used to say 'kg_relationships ONLY'. Migration 029 says the reverse."""
        text = (REPO_ROOT / "ontology" / "mira-evidence.ttl").read_text()
        start = text.index("mira:approval_deprecated")
        block = text[start : start + 600]
        assert "kg_entities only" in block.lower() or "kg_entities ONLY" in block
        assert "kg_relationships ONLY" not in block


# ── Stale data ────────────────────────────────────────────────────────────────


class TestStaleDriveData:
    RAW = {"vfd_fault_code": 4, "vfd_frequency": 300}

    def _snap(self, comm_ok):
        from shared.live_snapshot import normalize

        return normalize(
            {"vfd_comm_ok": comm_ok, **self.RAW}, "enterprise.site.line.cv", source="t", ts="t0"
        )

    def test_lost_comms_marks_every_drive_value_stale_and_withholds_the_fault_card(self):
        from shared.live_snapshot import STALE, build_drive_diagnostic

        snaps = self._snap(False)
        drive_values = [s for s in snaps if s.datapoint != "vfd_comm_ok"]
        assert drive_values and all(s.quality == STALE for s in drive_values)
        assert build_drive_diagnostic(snaps).fault_card is None

    def test_the_same_reading_with_healthy_comms_is_diagnosed(self):
        """The nearby valid case: the withholding above is because of comms, not always."""
        from shared.live_snapshot import GOOD, build_drive_diagnostic

        snaps = self._snap(True)
        assert all(s.quality == GOOD for s in snaps)
        card = build_drive_diagnostic(snaps).fault_card
        assert card is not None and "GFF" in card.fault_or_symptom

    def test_the_summary_says_comms_are_lost_instead_of_naming_the_stale_fault(self):
        from shared.live_snapshot import assess_snapshots

        text = assess_snapshots(self._snap(False))
        assert "LOST" in text and "GFF" not in text

    def test_the_status_block_labels_stale_values(self):
        from shared.live_snapshot import render_status_block

        assert "[STALE]" in render_status_block(self._snap(False))
        assert "[STALE]" not in render_status_block(self._snap(True))


# ── Wrong equipment / fault-family scope ──────────────────────────────────────


class TestFaultFamilyScope:
    def test_the_same_code_means_different_things_and_each_pack_answers_only_its_own(self):
        from shared.drive_packs.ask import answer_fault_code

        gs10 = answer_fault_code("durapulse_gs10", "F4")
        pf525 = answer_fault_code("powerflex_525", "F4")
        assert gs10.answer_source == pf525.answer_source == "drive_pack"
        assert "GS10" in gs10.answer and "PowerFlex" not in gs10.answer
        assert "PowerFlex 525" in pf525.answer and "GS10" not in pf525.answer
        assert gs10.answer != pf525.answer

    def test_a_code_that_belongs_to_another_family_is_refused_not_borrowed(self):
        from shared.drive_packs.ask import answer_fault_code

        assert answer_fault_code("durapulse_gs10", "GFF").answer_source == "drive_pack"
        other = answer_fault_code("powerflex_525", "GFF")
        assert other.answer_source == "none" and not other.matched

    def test_a_question_naming_two_families_is_refused(self):
        from shared.drive_packs.resolver import resolve_service_pack

        r = resolve_service_pack(question="PowerFlex 525 and GS10 fault F4")
        assert r.pack_id is None and r.ambiguous

    def test_a_question_naming_one_family_resolves_to_it(self):
        from shared.drive_packs.resolver import resolve_service_pack

        assert resolve_service_pack(question="GS10 fault F4").pack_id == "durapulse_gs10"

    def test_a_manufacturer_alone_is_not_enough_to_pick_a_family(self):
        from shared.drive_packs.resolver import resolve_service_pack

        r = resolve_service_pack(question="AutomationDirect drive fault")
        assert r.pack_id is None and "model/series" in r.reason


class TestFaultCodeIdentity:
    @pytest.mark.xfail(
        strict=True,
        raises=AssertionError,
        reason="#5520: register_fault_code names a fault 'manufacturer / code', leaving the model "
        "out, so two models' codes collapse onto one (tenant, type, name) graph identity.",
    )
    def test_two_models_sharing_a_code_get_two_graph_identities(self, monkeypatch):
        pytest.importorskip("sqlalchemy", reason="mira-crawler ingest imports sqlalchemy")
        crawler = str(REPO_ROOT / "mira-crawler")
        monkeypatch.syspath_prepend(crawler)
        for name in [n for n in sys.modules if n == "ingest" or n.startswith("ingest.")]:
            monkeypatch.delitem(sys.modules, name)
        import ingest.kg_writer as kw

        keys = []

        def fake_upsert_entity(tenant_id, entity_type, name, *_args, **_kw):
            keys.append((tenant_id, entity_type, name))
            return f"id-{len(keys)}"

        monkeypatch.setattr(kw, "upsert_entity", fake_upsert_entity)
        monkeypatch.setattr(kw, "upsert_relationship", lambda **_: None)
        try:
            for model in ("ModelA", "ModelB"):
                kw.register_fault_code("t", "eq", "SyntheticMfr", "E01", model=model, conn=object())
        finally:
            # Leave no mira-crawler `ingest` package behind for another suite to trip over.
            for name in [n for n in sys.modules if n == "ingest" or n.startswith("ingest.")]:
                sys.modules.pop(name, None)
        assert len(set(keys)) == 2, keys


# ── Relationship names: what approval writes versus what readers look for ─────


class TestRelationshipVocabulary:
    """Source-level contract for #5519. It reads the two TypeScript files; it does NOT run them.

    The proposal writer turns a lowercase relationship name into a canonical uppercase one, and
    approval stores the canonical name. A reader that still filters on the lowercase name can
    never see an edge that was approved through that path.
    """

    WRITER = "mira-hub/src/lib/knowledge-graph/proposals-writer.ts"
    READER = "mira-hub/src/lib/knowledge-graph/traversal.ts"

    def _writer_map(self) -> dict[str, str]:
        import re

        text = (REPO_ROOT / self.WRITER).read_text()
        block = text[text.index("const LOWERCASE_TO_CANONICAL_EDGE") :]
        block = block[: block.index("};")]
        return dict(re.findall(r"^\s*(\w+):\s*\{\s*type:\s*\"(\w+)\"", block, re.MULTILINE))

    def _reader_types(self) -> set[str]:
        import re

        text = (REPO_ROOT / self.READER).read_text()
        return set(re.findall(r"relationship_type\s*=\s*'(\w+)'", text))

    def test_the_parser_really_reads_both_files(self):
        """Guard against a vacuous pass: both sides must yield the names #5519 cites."""
        writer, reader = self._writer_map(), self._reader_types()
        assert writer["feeds"] == "UPSTREAM_OF" and writer["caused_by"] == "CAUSES"
        assert {"feeds", "caused_by"} <= reader

    VIEW = "mira-hub/src/capabilities/kg-relationship-read-view.ts"

    def test_a_reader_accepts_the_name_approval_actually_stores(self):
        """#5519 repaired, checked at SOURCE level only (the executed proof is the Hub
        integration test, which no CI job runs): every name the reader filters on that approval
        stores differently is one the shared read view translates, and the reader never reads
        the bare table — so it cannot go around the view."""
        import re

        writer, reader = self._writer_map(), self._reader_types()
        blind = sorted(t for t in reader if t in writer and writer[t] not in reader)
        assert blind, "expected names that differ between writer and reader"
        text = (REPO_ROOT / self.READER).read_text()
        assert "kg-relationship-read-view" in text
        # ONE bare read is deliberate: fault OCCURRENCES ('had_fault' rows with their own
        # time). Every relationship-fact read must go through the view.
        bare = [m.end() for m in re.finditer(r"(?:FROM|JOIN)\s+kg_relationships\b", text)]
        assert len(bare) == 1, f"{len(bare)} read(s) of the bare table; exactly one is allowed"
        assert "r.relationship_type = 'had_fault'" in text[bare[0] : bare[0] + 500]
        view = (REPO_ROOT / self.VIEW).read_text()
        assert "legacyAliasesOfCanonicalEdges" in view  # derived from the writer's own mapping


# ── Command versus feedback ───────────────────────────────────────────────────


RULE_COPIES = {
    "source": "plc/conv_simple_anomaly/rules_core.py",
    "gateway copy": "ignition/webdev/FactoryLM/api/diagnose/diagnose_core.py",
}


class TestCommandIsNotFeedback:
    """Runs the rule source AND the copy the gateway endpoint would execute.

    Passing here does not mean a live workflow is protected: that endpoint is not installed on
    the bench gateway today, which is why the mapping leaves the shape offline_only.
    """

    def _evaluate(self, which, running):
        rc = _load_by_path("mira_cv101_" + which.replace(" ", "_"), RULE_COPIES[which])
        snap = {rc.T_CMD: 18, rc.T_RUN: running, rc.T_COMM: True}
        return [a.rule_id for a in rc.evaluate(snap, {"cmd_run_for_s": 10.0})]

    def test_run_command_without_run_feedback_is_reported_not_assumed(self):
        for which in RULE_COPIES:
            assert "A6_DRIVE_NOT_RESPONDING" in self._evaluate(which, running=False), which

    def test_run_command_with_run_feedback_is_normal(self):
        for which in RULE_COPIES:
            assert "A6_DRIVE_NOT_RESPONDING" not in self._evaluate(which, running=True), which


# ── Approval ──────────────────────────────────────────────────────────────────


class TestAssetAgentApproval:
    def _path_to_approved(self):
        from shared.asset_agent_transition import LEGAL_TRANSITIONS

        return next(s for s, targets in LEGAL_TRANSITIONS.items() if "approved" in targets)

    def test_approval_without_an_actor_is_refused(self):
        from shared.asset_agent_transition import IllegalTransition, validate_transition

        src = self._path_to_approved()
        for actor in (None, "", "   "):
            with pytest.raises(IllegalTransition):
                validate_transition(src, "approved", actor=actor)

    def test_approval_by_a_named_person_is_accepted(self):
        from shared.asset_agent_transition import validate_transition

        validate_transition(self._path_to_approved(), "approved", actor="tech:someone")


class TestSupersession:
    def test_the_supersede_transition_never_writes_a_state_the_table_would_reject(self):
        """Whatever the mapping emits must be storable in BOTH graph tables."""
        from shared.proposal_transition import KG_APPROVAL_STATES, TRIGGERS, kg_approval_for

        emitted = {kg_approval_for(t) for t in TRIGGERS} - {None}
        assert emitted <= KG_APPROVAL_STATES

    # The throwaway database has only (id, tenant_id, approval_state). These columns and the
    # proposals table are added INSIDE the test's transaction and rolled back with it.
    _FACT_SCHEMA = (
        "ALTER TABLE kg_relationships ADD COLUMN source_id TEXT, ADD COLUMN target_id TEXT, "
        "ADD COLUMN relationship_type TEXT;"
        "CREATE TABLE relationship_proposals (id TEXT PRIMARY KEY, tenant_id TEXT, "
        "source_entity_id TEXT, target_entity_id TEXT, relationship_type TEXT, status TEXT);"
    )

    def _connect(self, pg):
        psycopg2 = pytest.importorskip("psycopg2")
        return psycopg2.connect(host=pg.sockdir, port=pg.port, user="postgres", dbname="postgres")

    @staticmethod
    def _verified(cur):
        cur.execute(
            "SELECT id FROM kg_relationships "
            "WHERE tenant_id = 't' AND approval_state = 'verified' ORDER BY id"
        )
        return [r[0] for r in cur.fetchall()]

    def test_a_superseded_verified_edge_stops_being_served_as_verified(self, pg):
        """#5523 repaired (ADR-0017 amended): supersede takes the row out of the verified set."""
        from shared.proposal_transition import apply_kg_approval

        conn = self._connect(pg)
        try:
            cur = conn.cursor()
            cur.execute(self._FACT_SCHEMA)
            cur.execute(
                "INSERT INTO kg_relationships "
                "(id, tenant_id, approval_state, source_id, target_id, relationship_type) VALUES "
                "('old', 't', 'verified', 'a', 'b', 'UPSTREAM_OF'), "
                "('new', 't', 'verified', 'a', 'c', 'UPSTREAM_OF')"
            )
            cur.execute(
                "INSERT INTO relationship_proposals VALUES "
                "('p-old', 't', 'a', 'b', 'UPSTREAM_OF', 'verified')"
            )
            wrote = apply_kg_approval(
                cur,
                table="kg_relationships",
                row_id="old",
                trigger="supersede",
                tenant_id="t",
                superseded_proposal_id="p-old",
            )
            assert wrote is True
            assert self._verified(cur) == ["new"]
        finally:
            conn.rollback()
            conn.close()

    def test_replaying_an_old_supersede_does_not_reject_a_fact_approved_again(self, pg):
        """Review finding F7 on #5543: supersede, re-approve the SAME stored row under a newer
        proposal, replay the original supersede. The newer approval must survive; superseding
        the newer approval must still retire the row."""
        from shared.proposal_transition import apply_kg_approval

        def supersede(cur, proposal):
            return apply_kg_approval(
                cur,
                table="kg_relationships",
                row_id="e",
                trigger="supersede",
                tenant_id="t",
                superseded_proposal_id=proposal,
            )

        conn = self._connect(pg)
        try:
            cur = conn.cursor()
            cur.execute(self._FACT_SCHEMA)
            cur.execute(
                "INSERT INTO kg_relationships "
                "(id, tenant_id, approval_state, source_id, target_id, relationship_type) "
                "VALUES ('e', 't', 'verified', 'a', 'b', 'UPSTREAM_OF')"
            )
            cur.execute(
                "INSERT INTO relationship_proposals VALUES "
                "('p1', 't', 'a', 'b', 'UPSTREAM_OF', 'verified')"
            )
            assert supersede(cur, "p1") is True
            cur.execute("UPDATE relationship_proposals SET status = 'deprecated' WHERE id = 'p1'")
            assert self._verified(cur) == []

            # a human approves the same fact again: newer proposal, same stored row
            cur.execute(
                "INSERT INTO relationship_proposals VALUES "
                "('p2', 't', 'a', 'b', 'UPSTREAM_OF', 'verified')"
            )
            apply_kg_approval(
                cur, table="kg_relationships", row_id="e", trigger="accept", tenant_id="t"
            )
            assert self._verified(cur) == ["e"]

            assert supersede(cur, "p1") is False  # the replay
            assert self._verified(cur) == ["e"]

            assert supersede(cur, "p2") is True  # the newer approval can still be retired
            assert self._verified(cur) == []
        finally:
            conn.rollback()
            conn.close()

    def test_a_supersede_that_does_not_name_the_approval_it_retires_is_refused(self):
        from shared.proposal_transition import apply_kg_approval

        class _Cur:
            def execute(self, *a):  # pragma: no cover - must not be reached
                raise AssertionError("no statement may run")

        with pytest.raises(ValueError):
            apply_kg_approval(
                _Cur(), table="kg_relationships", row_id="e", trigger="supersede", tenant_id="t"
            )


# ── Migration 029 on a throwaway PostgreSQL ───────────────────────────────────


def _pg_bin(name: str) -> str | None:
    found = shutil.which(name)
    if found:
        return found
    for pattern in ("/usr/lib/postgresql/*/bin", "/opt/homebrew/opt/postgresql*/bin"):
        for d in sorted(glob(pattern), reverse=True):
            if (Path(d) / name).exists():
                return str(Path(d) / name)
    return None


class _Pg:
    def __init__(self, sockdir: str, port: int, psql: str):
        self.sockdir, self.port, self._psql = sockdir, port, psql

    def run(self, sql: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [
                self._psql,
                "-h",
                self.sockdir,
                "-p",
                str(self.port),
                "-U",
                "postgres",
                "-d",
                "postgres",
                "-v",
                "ON_ERROR_STOP=1",
                "-At",
                "-c",
                sql,
            ],
            capture_output=True,
            text=True,
        )


@pytest.fixture(scope="module")
def pg():
    """A private PostgreSQL cluster in a temp dir: unix socket only, deleted afterwards.

    It applies the REAL migration 029 on top of two minimal tables. (The migrations directory is
    incremental and has no base schema in the repo, so the base tables are stubbed to exactly the
    columns 029 touches. Nothing shared is contacted.)
    """
    found = {n: _pg_bin(n) for n in ("initdb", "pg_ctl", "psql")}
    if not all(found.values()):
        pytest.skip(f"no local PostgreSQL binaries ({found}); the database contract is NOT checked")
    bins = {n: str(p) for n, p in found.items()}
    root = tempfile.mkdtemp(prefix="mo")
    # No TCP listener is opened (listen_addresses=''), so this number only names the socket file
    # inside the private directory. It is still made per-process so nothing is shared by name.
    data, port = str(Path(root) / "d"), 20000 + os.getpid() % 40000
    try:
        subprocess.run(
            [
                bins["initdb"],
                "-D",
                data,
                "-U",
                "postgres",
                "-A",
                "trust",
                "-E",
                "UTF8",
                "--locale=C",
                "--no-sync",
            ],
            check=True,
            capture_output=True,
        )
        subprocess.run(
            [
                bins["pg_ctl"],
                "-D",
                data,
                "-w",
                "-l",
                str(Path(root) / "log"),
                "-o",
                f"-c listen_addresses='' -k {root} -p {port}",
                "start",
            ],
            check=True,
            capture_output=True,
        )
        db = _Pg(root, port, bins["psql"])
        base = db.run(
            "CREATE TABLE kg_entities (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL);"
            "CREATE TABLE kg_relationships (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL);"
        )
        assert base.returncode == 0, base.stderr
        mig = (REPO_ROOT / "mira-hub/db/migrations/029_kg_approval_state.sql").read_text()
        applied = db.run(mig)
        assert applied.returncode == 0, applied.stderr
        yield db
    finally:
        if Path(data).exists():
            subprocess.run(
                [bins["pg_ctl"], "-D", data, "-m", "immediate", "stop"], capture_output=True
            )
        shutil.rmtree(root, ignore_errors=True)


class TestApprovalStateInPostgres:
    def _insert(self, pg, table, state):
        return pg.run(
            f"BEGIN; INSERT INTO {table} (id, tenant_id, approval_state) "
            f"VALUES ('x', 't', '{state}'); ROLLBACK;"
        )

    def test_migration_029_rejects_states_outside_each_tables_own_set(self, pg):
        for table in ("kg_entities", "kg_relationships"):
            bad = self._insert(pg, table, "approved_by_vibes")
            assert bad.returncode != 0 and "check constraint" in bad.stderr, (table, bad.stderr)
            for state in ("proposed", "verified", "rejected", "needs_review"):
                ok = self._insert(pg, table, state)
                assert ok.returncode == 0, (table, state, ok.stderr)

    def test_only_an_entity_row_can_be_deprecated(self, pg):
        """The fact the ontology text had backwards, and that #5523's repair must respect."""
        assert self._insert(pg, "kg_entities", "deprecated").returncode == 0
        rel = self._insert(pg, "kg_relationships", "deprecated")
        assert rel.returncode != 0 and "check constraint" in rel.stderr

    def test_a_new_row_starts_proposed_never_verified(self, pg):
        out = pg.run(
            "BEGIN; INSERT INTO kg_relationships (id, tenant_id) VALUES ('d', 't');"
            "SELECT approval_state FROM kg_relationships WHERE id = 'd'; ROLLBACK;"
        )
        assert out.returncode == 0 and "proposed" in out.stdout.split()


# ── Every claimed test really is in a contract file ───────────────────────────

# The only files a mapping entry may point at. The bench file holds the live-data half.
CONTRACT_TEST_FILES = ("test_ontology_runtime_contract.py", "test_ontology_bench_contract.py")


def _tests_defined_in(name: str) -> set[str]:
    tree = ast.parse((Path(__file__).parent / name).read_text())
    return {
        f"{c.name}::{f.name}"
        for c in tree.body
        if isinstance(c, ast.ClassDef)
        for f in c.body
        if isinstance(f, ast.FunctionDef)
    }


def test_every_contract_in_the_mapping_names_a_test_defined_here():
    defined = {f"tests/{n}": _tests_defined_in(n) for n in CONTRACT_TEST_FILES}
    for cid, c in _real_mapping()["contracts"].items():
        path, cls, fn = c["test"].split("::")
        assert path in defined, f"{cid}: {path} is not a contract test file"
        assert f"{cls}::{fn}" in defined[path], cid
