"""TRH v2 — synthesis, the failure→regression pipeline, and the report.

The committed fixtures are the end-to-end assertions: `trh_reset_procedure`
(RETRIEVAL) and `trh_reset_procedure_gs10` (INGEST) are the two real failures
this arc measured, replayed through the whole harness offline and $0.
"""

from __future__ import annotations

import json
import os
import sys


sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from tests.regime1_telethon.campaign import fabrication  # noqa: E402
from tests.regime1_telethon.campaign.trh import oracles as om  # noqa: E402
from tests.regime1_telethon.campaign.trh import pipeline, report, synthesize  # noqa: E402

REGISTRY = om.load()
CACHE = pipeline.FIXTURE_DIR.parent / "corpus-cache.json"
PARAM_CACHE = pipeline.FIXTURE_DIR.parents[1] / "param-corpus-cache.json"


def _corpus():
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    tokens = fabrication.CorpusIndex(PARAM_CACHE) if PARAM_CACHE.exists() else None
    return om.HarnessCorpus(om.PhraseCorpus(fetch=None, cache=cache), tokens=tokens)


# ---------------------------------------------------------------------------
# Synthesis
# ---------------------------------------------------------------------------


class TestSynthesize:
    def test_is_deterministic(self):
        a = synthesize.generate(REGISTRY["reset_procedure"], seed=7)
        b = synthesize.generate(REGISTRY["reset_procedure"], seed=7)
        assert [c.turns for c in a] == [c.turns for c in b]

    def test_covers_the_requested_registers(self):
        got = {c.register for c in synthesize.generate(REGISTRY["reset_procedure"])}
        assert {"apprentice", "experienced", "wrong_terminology", "multi_turn"} <= got
        assert "polysemy_trap" in got, "the oracle records traps; the probe must use them"

    def test_every_variant_stays_bound_to_its_oracle(self):
        """The evidence is the invariant — that is what makes a failure attributable."""
        for c in synthesize.generate_all(REGISTRY):
            assert c.oracle_id in REGISTRY

    def test_apprentice_removes_the_model_and_expects_an_identity_question(self):
        cases = {c.register: c for c in synthesize.generate(REGISTRY["reset_procedure"])}
        app = cases["apprentice"]
        assert "525" not in app.turns[0]["send"]
        assert app.expect_behaviour == "ask_for_identity"

    def test_safety_variant_is_graded_by_policy_not_by_answering(self):
        cases = {c.register: c for c in synthesize.generate(REGISTRY["reset_procedure"])}
        assert cases["safety_sensitive"].expect_behaviour == "safety_disposition"

    def test_every_variant_carries_a_rationale(self):
        """Without it a reviewer cannot tell a real defect from an unfair probe."""
        for c in synthesize.generate_all(REGISTRY):
            assert c.rationale.strip(), c.id

    def test_oracle_without_traps_simply_skips_the_trap_register(self):
        cases = synthesize.generate(REGISTRY["fault_code_pf525"])
        assert all(c.register != "polysemy_trap" for c in cases)

    def test_neighbours_are_bounded(self):
        """A defect report with twenty cases is ignored."""
        n = synthesize.neighbours_for_failure(REGISTRY["reset_procedure"], count=3)
        assert len(n) == 3


# ---------------------------------------------------------------------------
# The committed fixtures — end to end
# ---------------------------------------------------------------------------


class TestCapturedFixtures:
    def _classify(self, name):
        path = pipeline.FIXTURE_DIR / name
        conv = pipeline.load_fixture(path)
        cap = pipeline.capture(conv, source="test", corpus=_corpus())
        return cap

    def test_pf525_fixture_round_trips_and_classifies_RETRIEVAL(self):
        cap = self._classify("trh_reset_procedure.json")
        assert cap.classification["primary"] == "RETRIEVAL"
        assert "neon_recall" in cap.classification["subsystem"]
        assert "GROUNDING" in cap.classification["secondary"], (
            "the fabricated P0594 must be recorded as a DOWNSTREAM symptom"
        )

    def test_gs10_fixture_classifies_INGEST_and_forbids_retrieval_tuning(self):
        cap = self._classify("trh_reset_procedure_gs10.json")
        assert cap.classification["primary"] == "INGEST"
        assert "do not tune retrieval" in cap.classification["explanation"].lower()

    def test_the_two_fixtures_do_not_collapse(self):
        a = self._classify("trh_reset_procedure.json")
        b = self._classify("trh_reset_procedure_gs10.json")
        assert a.classification["primary"] != b.classification["primary"]

    def test_defect_report_leads_with_class_and_subsystem(self):
        """A reader who stops after two lines must still know what to open."""
        body = pipeline.defect_report(self._classify("trh_reset_procedure.json"))
        head = body.splitlines()[:4]
        assert "RETRIEVAL" in head[0]
        assert "Subsystem to repair" in "\n".join(head)

    def test_defect_report_marks_unobserved_as_not_a_pass(self):
        body = pipeline.defect_report(self._classify("trh_reset_procedure.json"))
        assert "NOT passes" in body


class TestFixtureRoundTrip:
    def test_capture_save_reload_preserves_the_retrieval_snapshot(self, tmp_path, monkeypatch):
        """The snapshot is the only thing that makes RETRIEVAL decidable offline.

        If it did not survive the round trip, every reloaded fixture would grade
        RETRIEVAL as NOT_OBSERVED and the harness would quietly stop diagnosing
        the layer it was built for.
        """
        original = pipeline.load_fixture(pipeline.FIXTURE_DIR / "trh_reset_procedure.json")
        monkeypatch.setattr(pipeline, "FIXTURE_DIR", tmp_path)
        cap = pipeline.capture(original, source="round-trip test", corpus=_corpus())
        reloaded = pipeline.load_fixture(cap.save())

        assert len(reloaded.turns) == len(original.turns)
        assert reloaded.turns[1].retrieved_meta == original.turns[1].retrieved_meta
        assert reloaded.turns[1].retrieval_embedded is True


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------


class TestReport:
    def _render(self):
        corpus = _corpus()
        ds, cs = [], []
        for f in sorted(pipeline.FIXTURE_DIR.glob("*.json")):
            conv = pipeline.load_fixture(f)
            d, c = pipeline.diagnose(
                conv, oracle=om.for_case(conv.conv_id, REGISTRY), corpus=corpus
            )
            ds.extend(d)
            cs.extend(c)
        return report.render("test", ds, cs, mutation_summary="| m | p | **PROVEN** |")

    def test_has_every_section_the_directive_requires(self):
        body = self._render()
        for heading in (
            "## 1. Overall",
            "## 2. Failures by root cause",
            "## 3. Stage-by-stage grades",
            "## 4. Ingest coverage problems",
            "## 5. Retrieval misses and expected-evidence ranks",
            "## 6. Unsupported / hallucinated claims",
            "## 7. Dialogue failures",
            "## 8. Mutation-test status",
            "## 9. Recommended subsystem to repair",
        ):
            assert heading in body, f"missing section: {heading}"

    def test_reports_both_reference_classes(self):
        body = self._render()
        assert "INGEST" in body and "RETRIEVAL" in body

    def test_separates_undecided_from_pass(self):
        body = self._render()
        assert "undecided" in body
        assert "A pass is not a proof of correctness" in body

    def test_names_a_concrete_subsystem_to_repair(self):
        """The success criterion: point at a module, not at a vibe."""
        body = self._render()
        tail = body.split("## 9.")[1]
        assert "mira-" in tail

    def test_says_so_when_mutations_were_not_run(self):
        ds, cs = [], []
        body = report.render("empty", ds, cs)
        assert "Not run" in body
