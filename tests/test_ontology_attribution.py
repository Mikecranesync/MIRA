"""Regression tests for the MIRA ontology validator's shape-attribution logic (ADR-0032).

WHY THIS FILE EXISTS
--------------------
SHACL reports `sh:sourceShape` as the shape that actually failed. For the overwhelmingly common
idiom

    mirash:MyShape sh:property [ sh:path mira:x ; sh:minCount 1 ] .

that is the **blank** inner property shape — NOT `mirash:MyShape`. The validator's first
`violated_shapes()` extracted a local name from the URI, so a blank node yielded nothing, and a
fixture's `# EXPECT-VIOLATION: mirash:MyShape` header could never be satisfied. That silently
made the invalid-fixture contract unassertable for ~36 of the 42 shapes: a fixture would be
reported as failing-to-fire even though the rule worked perfectly.

`_named_ancestors()` fixes it by walking UP the shapes graph from the blank node to the named
shape that owns it. These tests lock that behaviour down.

The fixtures under `ontology/fixtures/invalid/` are themselves a strong regression net (if the
walk regressed, every one of them would fail). This file adds what the fixtures do NOT cover:

  * the `sh:or` / `sh:and` / `sh:xone` RDF-list-cell path, which `_named_ancestors` handles but
    no current fixture exercises (the one shape using it, FaultCodeScopeTargetShape, is Phase 3);
  * a direct assertion that a WRONG expectation still fails, so the contract cannot go vacuous;
  * cycle-safety, so a malformed shapes graph cannot hang the validator.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

pytest.importorskip("rdflib", reason="ontology toolchain: pip install -r ontology/requirements.txt")
pytest.importorskip("pyshacl", reason="ontology toolchain: pip install -r ontology/requirements.txt")

from rdflib import BNode, Graph, URIRef  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent


def _load_validator():
    """Import tools/validate_ontology.py by path (it is a script, not an installed package)."""
    spec = importlib.util.spec_from_file_location(
        "validate_ontology", REPO_ROOT / "tools" / "validate_ontology.py"
    )
    assert spec is not None and spec.loader is not None, "cannot load tools/validate_ontology.py"
    mod = importlib.util.module_from_spec(spec)
    sys.modules["validate_ontology"] = mod
    spec.loader.exec_module(mod)
    return mod


V = _load_validator()

SHAPES_TTL = """
@prefix sh:     <http://www.w3.org/ns/shacl#> .
@prefix mirash: <https://ontology.factorylm.com/mira/shapes#> .
@prefix ex:     <https://example.org/t#> .

mirash:PropShape a sh:NodeShape ;
    sh:targetClass ex:Thing ;
    sh:property [ sh:path ex:name ; sh:minCount 1 ] .

mirash:SparqlShape a sh:NodeShape ;
    sh:targetClass ex:Thing ;
    sh:sparql [ sh:select "SELECT $this WHERE { $this ex:bad true }" ] .

mirash:OrShape a sh:NodeShape ;
    sh:targetClass ex:Thing ;
    sh:or ( [ sh:class ex:A ] [ sh:class ex:B ] ) .

mirash:NestedShape a sh:NodeShape ;
    sh:targetClass ex:Thing ;
    sh:property [ sh:path ex:child ; sh:node [ sh:property [ sh:path ex:deep ; sh:minCount 1 ] ] ] .
"""


@pytest.fixture(scope="module")
def shapes() -> Graph:
    g = Graph()
    g.parse(data=SHAPES_TTL, format="turtle")
    return g


def _blank_under(shapes: Graph, named: str, pred: URIRef) -> BNode:
    """The blank node hanging off <named> via <pred>."""
    subj = URIRef(f"https://ontology.factorylm.com/mira/shapes#{named}")
    node = next(shapes.objects(subj, pred), None)
    assert isinstance(node, BNode), f"expected a blank node at {named} {pred}"
    return node


SH_PROPERTY = URIRef("http://www.w3.org/ns/shacl#property")
SH_SPARQL = URIRef("http://www.w3.org/ns/shacl#sparql")
SH_OR = URIRef("http://www.w3.org/ns/shacl#or")
RDF_FIRST = URIRef("http://www.w3.org/1999/02/22-rdf-syntax-ns#first")


class TestNamedAncestors:
    """The core of the fix: a blank source shape resolves to the named shape that owns it."""

    def test_uriref_resolves_to_its_own_local_name(self, shapes: Graph) -> None:
        node = URIRef("https://ontology.factorylm.com/mira/shapes#PropShape")
        assert V._named_ancestors(node, shapes) == {"PropShape"}

    def test_property_shape_blank_node_resolves_to_owner(self, shapes: Graph) -> None:
        """THE original bug: sh:property blank node → the named shape. Was {} before the fix."""
        blank = _blank_under(shapes, "PropShape", SH_PROPERTY)
        assert V._named_ancestors(blank, shapes) == {"PropShape"}

    def test_sparql_constraint_blank_node_resolves_to_owner(self, shapes: Graph) -> None:
        blank = _blank_under(shapes, "SparqlShape", SH_SPARQL)
        assert V._named_ancestors(blank, shapes) == {"SparqlShape"}

    def test_or_list_cell_blank_node_resolves_to_owner(self, shapes: Graph) -> None:
        """sh:or members live in RDF list cells — two hops up (rdf:first, then sh:or).

        No fixture exercises this path yet (FaultCodeScopeTargetShape is Phase 3), so this test
        is the only thing standing between the list-walk and an untested regression.
        """
        head = next(shapes.objects(URIRef(
            "https://ontology.factorylm.com/mira/shapes#OrShape"), SH_OR))
        member = next(shapes.objects(head, RDF_FIRST))
        assert isinstance(member, BNode)
        assert V._named_ancestors(member, shapes) == {"OrShape"}

    def test_doubly_nested_blank_node_resolves_to_owner(self, shapes: Graph) -> None:
        """sh:property → sh:node → sh:property. The walk must recurse, not peek one level."""
        outer = _blank_under(shapes, "NestedShape", SH_PROPERTY)
        inner_node = next(shapes.objects(outer, URIRef("http://www.w3.org/ns/shacl#node")))
        deep = next(shapes.objects(inner_node, SH_PROPERTY))
        assert V._named_ancestors(deep, shapes) == {"NestedShape"}

    def test_cycle_does_not_hang(self) -> None:
        """A malformed shapes graph must not send the walk into infinite recursion."""
        g = Graph()
        a, b = BNode(), BNode()
        g.add((a, SH_PROPERTY, b))
        g.add((b, SH_PROPERTY, a))
        assert V._named_ancestors(a, g) == set()  # no named ancestor, terminates


class TestRealShapesAndFixtures:
    """Integration: the shipped shapes + fixtures, through the real validator."""

    def test_every_invalid_fixture_fires_its_declared_shape(self) -> None:
        """The invalid-fixture contract, asserted directly.

        This is what would go red if the attribution walk regressed — for EVERY fixture, across
        all three attribution paths (property shape, SPARQL constraint, SPARQL target).
        """
        onto = V.load_graph(V.ontology_files() + V.mapping_files())
        shapes = V.load_graph(V.shape_files())
        invalid = sorted((V.FIXTURES_DIR / "invalid").glob("*.ttl"))
        assert invalid, "no invalid fixtures found — the contract would pass vacuously"

        for path in invalid:
            expected = {
                m.split(":")[-1] for m in V.EXPECT_RE.findall(path.read_text(encoding="utf-8"))
            }
            assert expected, f"{path.name} declares no # EXPECT-VIOLATION header"

            data = Graph()
            data.parse(path.as_posix(), format="turtle")
            conforms, results, text = V.run_shacl(data, onto, shapes)

            assert not conforms, f"{path.name} conformed — its rule is not actually enforced"
            fired = V.violated_shapes(results, shapes)
            missing = expected - fired
            assert not missing, (
                f"{path.name}: declared {sorted(expected)} but those did not fire.\n"
                f"fired instead: {sorted(fired)}\n{text}"
            )

    def test_wrong_expectation_is_rejected(self) -> None:
        """Anti-vacuity: naming a shape the fixture does NOT violate must NOT pass.

        Without this, a bug that made `violated_shapes` return every shape name would turn the
        whole suite green while checking nothing.
        """
        onto = V.load_graph(V.ontology_files() + V.mapping_files())
        shapes = V.load_graph(V.shape_files())

        path = V.FIXTURES_DIR / "invalid" / "evidence_r9b_citation_incomplete.ttl"
        data = Graph()
        data.parse(path.as_posix(), format="turtle")
        _, results, _ = V.run_shacl(data, onto, shapes)
        fired = V.violated_shapes(results, shapes)

        assert "CitationCompletenessShape" in fired  # the real reason
        assert "SupersededStateShape" not in fired  # an unrelated shape must stay silent

    def test_every_valid_fixture_conforms(self) -> None:
        onto = V.load_graph(V.ontology_files() + V.mapping_files())
        shapes = V.load_graph(V.shape_files())
        valid = sorted((V.FIXTURES_DIR / "valid").glob("*.ttl"))
        assert valid, "no valid fixtures found"

        for path in valid:
            data = Graph()
            data.parse(path.as_posix(), format="turtle")
            conforms, _, text = V.run_shacl(data, onto, shapes)
            assert conforms, f"{path.name} should conform but did not:\n{text}"


class TestValidatorExitContract:
    def test_full_run_exits_zero(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert V.main([]) == 0
        assert "checks passed" in capsys.readouterr().out

    def test_coverage_line_is_always_reported(self, capsys: pytest.CaptureFixture[str]) -> None:
        """Partial fixture coverage must never be able to read as full coverage."""
        V.main([])
        assert "shapes:fixture-coverage" in capsys.readouterr().out
