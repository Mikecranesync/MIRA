"""Phase 2 (controls) semantic tests — live-data honesty and the read-only OT boundary.

These assert the ACTUAL CONSTRAINTS, not file existence or class names. Each test builds a
minimal graph in memory and asserts which named shape does or does not fire, so a shape that is
silently relaxed fails here even if every fixture file still parses.

The properties that matter most, and why:

* **Fail-closed on missing metadata.** RDF is open-world: absent is not false. A rule written
  only as "reject the bad value" passes vacuously when the field is missing entirely. Two shapes
  depend on failing closed instead — R13b (`read_only` on a CommandSignal) and R12b (`quality` on
  a measurement backing a numeric claim) — and both are pinned below.
* **Command is not feedback.** A run command asserts intent, never occurrence.
* **Determinism.** Same graph, same verdict, run to run.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

pytest.importorskip("rdflib", reason="ontology toolchain: pip install -r ontology/requirements.txt")
pytest.importorskip("pyshacl", reason="ontology toolchain: pip install -r ontology/requirements.txt")

from rdflib import Graph  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent


def _load_validator():
    spec = importlib.util.spec_from_file_location(
        "validate_ontology", REPO_ROOT / "tools" / "validate_ontology.py"
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules["validate_ontology"] = mod
    spec.loader.exec_module(mod)
    return mod


V = _load_validator()

PREFIX = """
@prefix mira: <https://ontology.factorylm.com/mira#> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .
@prefix ex:   <https://example.org/t#> .
"""

# The 11 shapes the Phase 2 plan names.
PHASE2_SHAPES = {
    "MeasurementCompletenessShape",
    "BooleanNotQuantityShape",
    "QuantityKindNeedsNonBoolShape",
    "CommandNotFeedbackShape",
    "RegisterInterpretationShape",
    "ScalingRuleShape",
    "LiveDiagnosisEligibilityShape",
    "StaleCommsNumericClaimShape",
    "ClockProvenanceShape",
    "ReadOnlyPolicyShape",
    "WritableSignalShape",
}

_GOOD_OBS = """
    mira:value_type mira:valuetype_bool ;
    mira:event_timestamp "2026-07-26T14:03:00Z"^^xsd:dateTime ;
    mira:clock_source mira:clock_plc ;
    mira:quality mira:quality_good ;
    mira:freshness mira:freshness_live ;
    mira:supported_by ex:src
"""


@pytest.fixture(scope="module")
def graphs():
    onto = V.load_graph(V.ontology_files() + V.mapping_files())
    shapes = V.load_graph(V.shape_files())
    return onto, shapes


def fired(ttl: str, graphs) -> set[str]:
    """Named shapes that report a violation for `ttl`."""
    onto, shapes = graphs
    data = Graph()
    data.parse(data=PREFIX + ttl, format="turtle")
    _, results, _ = V.run_shacl(data, onto, shapes)
    return V.violated_shapes(results, shapes)


class TestPhase2ShapesExist:
    def test_all_eleven_shapes_are_discovered(self, graphs) -> None:
        from rdflib import RDF, Namespace

        SH = Namespace("http://www.w3.org/ns/shacl#")
        _, shapes = graphs
        declared = {
            str(s).rsplit("#", 1)[1]
            for s in shapes.subjects(RDF.type, SH.NodeShape)
            if "#" in str(s)
        }
        missing = PHASE2_SHAPES - declared
        assert not missing, f"Phase 2 shapes not found in the shapes graph: {sorted(missing)}"


class TestReadOnlyOTBoundary:
    """The prohibition that must never soften: MIRA does not write to OT."""

    def test_command_signal_without_read_only_FAILS_CLOSED(self, graphs) -> None:
        """A CommandSignal with NO capability metadata must be rejected.

        This is the Phase 2 correction. Before it, `sh:not [ sh:in (false) ]` was evaluated per
        value, so zero values passed vacuously — an undeclared command point read as safe.
        Unknown writability is not permission.
        """
        assert "WritableSignalShape" in fired("ex:c a mira:CommandSignal .", graphs)

    def test_command_signal_marked_writable_is_rejected(self, graphs) -> None:
        assert "WritableSignalShape" in fired(
            "ex:c a mira:CommandSignal ; mira:read_only false .", graphs
        )

    def test_command_signal_explicitly_read_only_is_accepted(self, graphs) -> None:
        assert "WritableSignalShape" not in fired(
            "ex:c a mira:CommandSignal ; mira:read_only true .", graphs
        )

    def test_action_presented_as_permitted_is_rejected(self, graphs) -> None:
        assert "ReadOnlyPolicyShape" in fired(
            "ex:a a mira:ControlActionClaim ; mira:presents_action_as_permitted true .", graphs
        )

    def test_action_explicitly_not_permitted_is_accepted(self, graphs) -> None:
        assert "ReadOnlyPolicyShape" not in fired(
            "ex:a a mira:ControlActionClaim ; mira:presents_action_as_permitted false .", graphs
        )

    def test_action_silent_on_permission_is_accepted_deliberately(self, graphs) -> None:
        """Documents the intentional asymmetry with `read_only`, so it cannot drift unnoticed.

        Silence about an ASSERTION is safe (the claim does not say the action is permitted).
        Silence about a CAPABILITY is not (an undeclared command point might be writable).
        Hence R13 tolerates absence and R13b does not.
        """
        assert "ReadOnlyPolicyShape" not in fired("ex:a a mira:ControlActionClaim .", graphs)


class TestCommandIsNotFeedback:
    def test_claim_backed_only_by_command_is_rejected(self, graphs) -> None:
        assert "CommandNotFeedbackShape" in fired(
            f"""
            ex:src a mira:Citation .
            ex:cmd a mira:CommandSignal ; mira:read_only true .
            ex:o a mira:Observation ; mira:observed_signal ex:cmd ; mira:value true ; {_GOOD_OBS} .
            ex:claim a mira:PhysicalStateClaim ; mira:supported_by ex:o .
            """,
            graphs,
        )

    def test_claim_backed_by_feedback_is_accepted(self, graphs) -> None:
        assert "CommandNotFeedbackShape" not in fired(
            f"""
            ex:src a mira:Citation .
            ex:cmd a mira:CommandSignal ; mira:read_only true .
            ex:fb  a mira:StatusSignal .
            ex:o1 a mira:Observation ; mira:observed_signal ex:cmd ; mira:value true ; {_GOOD_OBS} .
            ex:o2 a mira:Observation ; mira:observed_signal ex:fb  ; mira:value true ; {_GOOD_OBS} .
            ex:claim a mira:PhysicalStateClaim ; mira:supported_by ex:o1 , ex:o2 .
            """,
            graphs,
        )


class TestLiveDataHonesty:
    def test_live_claim_on_stale_observation_is_rejected(self, graphs) -> None:
        assert "LiveDiagnosisEligibilityShape" in fired(
            """
            ex:src a mira:Citation .
            ex:sig a mira:StatusSignal .
            ex:o a mira:Observation ; mira:observed_signal ex:sig ; mira:value true ;
                 mira:quality mira:quality_good ; mira:freshness mira:freshness_stale .
            ex:claim a mira:LiveDiagnosisClaim ; mira:supported_by ex:o .
            """,
            graphs,
        )

    @pytest.mark.parametrize("bad", ["quality_bad", "quality_stale", "quality_uncertain"])
    def test_live_claim_on_unhealthy_quality_is_rejected(self, graphs, bad: str) -> None:
        assert "LiveDiagnosisEligibilityShape" in fired(
            f"""
            ex:src a mira:Citation .
            ex:sig a mira:StatusSignal .
            ex:o a mira:Observation ; mira:observed_signal ex:sig ; mira:value true ;
                 mira:quality mira:{bad} ; mira:freshness mira:freshness_live .
            ex:claim a mira:LiveDiagnosisClaim ; mira:supported_by ex:o .
            """,
            graphs,
        )

    def test_numeric_claim_with_MISSING_quality_FAILS_CLOSED(self, graphs) -> None:
        """Absent quality must not read as good — the cached-value-after-comms-loss case."""
        assert "StaleCommsNumericClaimShape" in fired(
            """
            ex:src a mira:Citation .
            ex:sig a mira:MeasurementSignal .
            ex:o a mira:Observation ; mira:observed_signal ex:sig ; mira:value 12.4 ;
                 mira:freshness mira:freshness_live .
            ex:claim a mira:LiveDiagnosisClaim ; mira:supported_by ex:o .
            """,
            graphs,
        )

    def test_bool_on_measurement_signal_is_rejected(self, graphs) -> None:
        assert "BooleanNotQuantityShape" in fired(
            """
            ex:sig a mira:MeasurementSignal .
            ex:o a mira:Observation ; mira:observed_signal ex:sig ;
                 mira:value_type mira:valuetype_bool .
            """,
            graphs,
        )

    def test_quantity_kind_on_bool_signal_is_rejected(self, graphs) -> None:
        assert "QuantityKindNeedsNonBoolShape" in fired(
            """
            ex:sig a mira:Signal ; mira:quantity_kind mira:qk_current .
            ex:o a mira:Observation ; mira:observed_signal ex:sig ;
                 mira:value_type mira:valuetype_bool .
            """,
            graphs,
        )

    def test_ingest_clock_cannot_carry_event_timestamp(self, graphs) -> None:
        """MIRA's own ingest clock must never be presented as the device's timestamp."""
        assert "ClockProvenanceShape" in fired(
            """
            ex:o a mira:Observation ; mira:clock_source mira:clock_ingest ;
                 mira:event_timestamp "2026-07-26T14:03:00Z"^^xsd:dateTime .
            """,
            graphs,
        )

    def test_ingest_clock_without_event_timestamp_is_accepted(self, graphs) -> None:
        assert "ClockProvenanceShape" not in fired(
            "ex:o a mira:Observation ; mira:clock_source mira:clock_ingest .", graphs
        )

    def test_incomplete_measurement_observation_is_rejected(self, graphs) -> None:
        assert "MeasurementCompletenessShape" in fired(
            """
            ex:sig a mira:MeasurementSignal .
            ex:o a mira:Observation ; mira:observed_signal ex:sig ; mira:value 600 .
            """,
            graphs,
        )


class TestRegisterInterpretation:
    def test_decoding_register_without_scaling_is_rejected(self, graphs) -> None:
        assert "RegisterInterpretationShape" in fired(
            """
            ex:sig a mira:MeasurementSignal .
            ex:r a mira:Register ; mira:decodes ex:sig .
            """,
            graphs,
        )

    def test_catalogued_register_without_decode_is_accepted(self, graphs) -> None:
        """An undocumented address is honest incompleteness, not a violation."""
        assert "RegisterInterpretationShape" not in fired("ex:r a mira:Register .", graphs)

    def test_scaling_rule_without_multiplier_is_rejected(self, graphs) -> None:
        assert "ScalingRuleShape" in fired("ex:s a mira:ScalingRule .", graphs)


class TestNoPhase1Regression:
    """Phase 1 evidence rules must behave exactly as before."""

    def test_inference_still_cannot_self_approve(self, graphs) -> None:
        assert "InferenceCannotSelfApproveShape" in fired(
            """
            ex:llm a mira:SoftwareAgent .
            ex:a a mira:Assertion ; mira:derived_from ex:b ;
                 mira:approval_state mira:approval_verified ; mira:approved_by ex:llm .
            """,
            graphs,
        )

    def test_approver_still_cannot_be_proposer(self, graphs) -> None:
        assert "ApproverIsNotProposerShape" in fired(
            """
            ex:t a mira:Technician .
            ex:a a mira:Assertion ; mira:proposed_by ex:t ; mira:approved_by ex:t .
            """,
            graphs,
        )

    def test_machine_verified_still_not_approved(self, graphs) -> None:
        assert "MachineVerifiedIsNotApprovedShape" in fired(
            """
            ex:a a mira:Assertion ; mira:trust mira:trust_machine_verified ;
                 mira:approval_state mira:approval_verified .
            """,
            graphs,
        )


class TestValidatorContract:
    def test_full_run_exits_zero(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert V.main([]) == 0
        assert "checks passed" in capsys.readouterr().out

    def test_repeated_runs_are_deterministic(self, graphs) -> None:
        ttl = "ex:c a mira:CommandSignal ."
        runs = [frozenset(fired(ttl, graphs)) for _ in range(3)]
        assert len(set(runs)) == 1, f"non-deterministic validation: {runs}"

    def test_coverage_includes_every_phase2_shape(self, capsys: pytest.CaptureFixture[str]) -> None:
        """Coverage must actually count the 11 Phase 2 shapes as pinned, not just total up."""
        V.main([])
        out = capsys.readouterr().out
        uncovered_line = next(
            (ln for ln in out.splitlines() if ln.strip().startswith("uncovered:")), ""
        )
        still_uncovered = PHASE2_SHAPES & {
            s.strip() for s in uncovered_line.replace("uncovered:", "").split(",")
        }
        assert not still_uncovered, f"Phase 2 shapes still uncovered: {sorted(still_uncovered)}"
