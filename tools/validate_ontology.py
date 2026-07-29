#!/usr/bin/env python3
"""Deterministic, offline validator for the MIRA ontology (ADR-0032).

Zero paid calls, zero network after `pip install -r ontology/requirements.txt`, hermetic.

What it does, in order:
  1. Parses every ontology module and shape file (Turtle syntax check).
  2. Enforces the grounding rule: every mira: term declares mira:grounded_in.
  3. Enforces inverse completeness: every ObjectProperty either declares owl:inverseOf
     or documents in rdfs:comment why no inverse is modeled.
  4. Runs each fixture under `fixtures/valid/` and expects conformance.
  5. Runs each fixture under `fixtures/invalid/` and expects the SPECIFIC shapes named
     in that fixture's `# EXPECT-VIOLATION:` header lines to fire.

Exit codes:
  0  everything passed
  1  a validation expectation failed
  2  a usage / IO / parse error

Usage:
  python tools/validate_ontology.py                       # human-readable
  python tools/validate_ontology.py --format json         # machine-readable
  python tools/validate_ontology.py --fixtures path/      # alternate fixture root
  python tools/validate_ontology.py --only invalid        # one phase
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

try:
    from pyshacl import validate as shacl_validate
    from rdflib import OWL, RDF, RDFS, Graph, Namespace, URIRef
except ImportError:  # pragma: no cover - environment guard
    sys.stderr.write(
        "ERROR: rdflib/pyshacl not installed.\n"
        "  python -m venv .venv && .venv/bin/pip install -r ontology/requirements.txt\n"
    )
    raise SystemExit(2)

REPO_ROOT = Path(__file__).resolve().parent.parent
ONTOLOGY_DIR = REPO_ROOT / "ontology"
SHAPES_DIR = ONTOLOGY_DIR / "shapes"
FIXTURES_DIR = ONTOLOGY_DIR / "fixtures"

MIRA = Namespace("https://ontology.factorylm.com/mira#")
GROUNDED_IN = MIRA["grounded_in"]
TERM_STATUS = MIRA["term_status"]

# A `# EXPECT-VIOLATION: mirash:SomeShape` header line in an invalid fixture.
EXPECT_RE = re.compile(r"^#\s*EXPECT-VIOLATION:\s*(\S+)\s*$", re.MULTILINE)
# Comments that legitimately explain an absent inverse.
NO_INVERSE_RE = re.compile(r"no inverse (is )?modeled|its own inverse", re.IGNORECASE)


@dataclass
class Result:
    """One check outcome. `skipped` results don't count toward pass/fail totals or exit code —
    they exist for deliberately-not-yet-built phases (see `check_valid_fixtures` /
    `check_invalid_fixtures`), not for silently swallowing a real failure."""

    name: str
    passed: bool
    detail: str = ""
    skipped: bool = False


@dataclass
class Report:
    results: list[Result] = field(default_factory=list)

    def add(self, name: str, passed: bool, detail: str = "", skipped: bool = False) -> None:
        self.results.append(Result(name, passed, detail, skipped))

    @property
    def ok(self) -> bool:
        return all(r.passed or r.skipped for r in self.results)

    def to_json(self) -> str:
        counted = [r for r in self.results if not r.skipped]
        return json.dumps(
            {
                "ok": self.ok,
                "passed": sum(1 for r in counted if r.passed),
                "failed": sum(1 for r in counted if not r.passed),
                "skipped": sum(1 for r in self.results if r.skipped),
                "results": [
                    {"name": r.name, "passed": r.passed, "detail": r.detail, "skipped": r.skipped}
                    for r in self.results
                ],
            },
            indent=2,
        )

    def to_text(self) -> str:
        lines = []
        for r in self.results:
            mark = "SKIP" if r.skipped else ("PASS" if r.passed else "FAIL")
            lines.append(f"[{mark}] {r.name}")
            if r.detail and (not r.passed or r.skipped):
                for dl in r.detail.rstrip().splitlines():
                    lines.append(f"         {dl}")
        counted = [r for r in self.results if not r.skipped]
        n_ok = sum(1 for r in counted if r.passed)
        n_skip = len(self.results) - len(counted)
        lines.append("")
        suffix = f" ({n_skip} skipped)" if n_skip else ""
        lines.append(f"{n_ok}/{len(counted)} checks passed{suffix}")
        return "\n".join(lines)


def load_graph(paths: list[Path]) -> Graph:
    """Parse a set of Turtle files into one graph."""
    g = Graph()
    for p in paths:
        g.parse(p.as_posix(), format="turtle")
    return g


def ontology_files() -> list[Path]:
    return sorted(ONTOLOGY_DIR.glob("mira-*.ttl"))


def shape_files() -> list[Path]:
    return sorted(SHAPES_DIR.glob("*.shacl.ttl"))


def mapping_files() -> list[Path]:
    return sorted((ONTOLOGY_DIR / "mappings").glob("*.ttl"))


# ── Phase 1: syntax ────────────────────────────────────────────────────


def check_syntax(report: Report) -> tuple[Graph | None, Graph | None]:
    onto: Graph | None = None
    shapes: Graph | None = None

    files = ontology_files() + mapping_files()
    if not files:
        report.add("ontology:syntax", False, f"no ontology modules found under {ONTOLOGY_DIR}")
        return None, None
    try:
        parsed_onto = load_graph(files)
        onto = parsed_onto
        report.add(
            "ontology:syntax",
            True,
            f"{len(files)} modules, {len(parsed_onto)} triples",
        )
    except Exception as exc:  # noqa: BLE001 - report any parse failure verbatim
        report.add("ontology:syntax", False, str(exc))

    sfiles = shape_files()
    if not sfiles:
        report.add("shapes:syntax", False, f"no shape files found under {SHAPES_DIR}")
        return onto, None
    try:
        parsed_shapes = load_graph(sfiles)
        shapes = parsed_shapes
        report.add(
            "shapes:syntax", True, f"{len(sfiles)} shape files, {len(parsed_shapes)} triples"
        )
    except Exception as exc:  # noqa: BLE001
        report.add("shapes:syntax", False, str(exc))

    return onto, shapes


# ── Phase 2: ontology hygiene ──────────────────────────────────────────


def check_grounding(report: Report, onto: Graph) -> None:
    """Every mira: DOMAIN term must declare what repository artifact it abstracts.

    Annotation properties are exempt: mira:grounded_in / mira:term_status / mira:maps_to are the
    ontology's own metadata vocabulary, not claims about the factory, so there is no repository
    artifact for them to abstract. (Requiring `mira:grounded_in mira:grounded_in` would be circular.)
    """
    ungrounded: list[str] = []
    for subj in set(onto.subjects()):
        if not isinstance(subj, URIRef) or not str(subj).startswith(str(MIRA)):
            continue
        # Only terms the ontology DECLARES (has an rdf:type here) need grounding.
        if (subj, RDF.type, None) not in onto:
            continue
        if (subj, RDF.type, OWL.AnnotationProperty) in onto:
            continue
        if (subj, GROUNDED_IN, None) not in onto:
            ungrounded.append(str(subj).replace(str(MIRA), "mira:"))
    report.add(
        "ontology:every-term-is-grounded",
        not ungrounded,
        "terms missing mira:grounded_in: " + ", ".join(sorted(ungrounded)),
    )


def check_term_status(report: Report, onto: Graph) -> None:
    bad: list[str] = []
    for subj in set(onto.subjects(TERM_STATUS, None)):
        for val in onto.objects(subj, TERM_STATUS):
            if str(val) not in {"canonical", "proposed"}:
                bad.append(f"{subj} -> {val}")
    report.add(
        "ontology:term-status-vocabulary",
        not bad,
        "term_status must be 'canonical' or 'proposed': " + ", ".join(bad),
    )


def check_inverse_completeness(report: Report, onto: Graph) -> None:
    """Every directional RELATIONSHIP declares an inverse or documents why not.

    Attribute-style properties — those whose rdfs:range is a mira:ControlledVocabulary subclass
    (quality, value_type, approval_state, trust, …) — are exempt. They point at a closed enumeration
    mirroring a production CHECK constraint, not at another entity, so "the inverse of quality=good"
    is not a meaningful traversal.
    """
    vocab_classes = set(onto.subjects(RDFS.subClassOf, MIRA["ControlledVocabulary"]))
    missing: list[str] = []
    for prop in onto.subjects(RDF.type, OWL.ObjectProperty):
        if (prop, OWL.inverseOf, None) in onto:
            continue
        if any(rng in vocab_classes for rng in onto.objects(prop, RDFS.range)):
            continue
        comments = " ".join(str(c) for c in onto.objects(prop, RDFS.comment))
        if NO_INVERSE_RE.search(comments):
            continue
        missing.append(str(prop).replace(str(MIRA), "mira:"))
    report.add(
        "ontology:inverse-completeness",
        not missing,
        "object properties with neither owl:inverseOf nor a documented reason: "
        + ", ".join(sorted(missing)),
    )


def check_inverse_symmetry(report: Report, onto: Graph) -> None:
    """If A owl:inverseOf B then B owl:inverseOf A must also be declared."""
    asym: list[str] = []
    for a, b in onto.subject_objects(OWL.inverseOf):
        if (b, OWL.inverseOf, a) not in onto:
            asym.append(f"{a} -> {b} (reverse not declared)")
    report.add(
        "ontology:inverse-symmetry",
        not asym,
        "; ".join(sorted(asym)),
    )


# ── Phase 3: fixtures ──────────────────────────────────────────────────


def run_shacl(data: Graph, onto: Graph, shapes: Graph) -> tuple[bool, Graph, str]:
    """Validate `data` against `shapes`, with the ontology as background knowledge.

    `ont_graph` supplies rdfs:subClassOf so sh:class checks see the hierarchy;
    `advanced=True` enables SPARQL-based constraints and SPARQL targets.
    NOTE: no inference is requested (`inference="none"`) — MIRA runs no OWL reasoner.
    """
    conforms, results_graph, results_text = shacl_validate(
        data_graph=data,
        shacl_graph=shapes,
        ont_graph=onto,
        inference="rdfs",
        advanced=True,
        abort_on_first=False,
        meta_shacl=False,
        debug=False,
    )
    return conforms, results_graph, results_text


SH = Namespace("http://www.w3.org/ns/shacl#")


def _local_name(node: URIRef) -> str | None:
    name = str(node)
    return name.rsplit("#", 1)[1] if "#" in name else None


def _named_ancestors(node, shapes: Graph, _seen: set | None = None) -> set[str]:
    """Local names of the nearest NAMED shape(s) that own `node`.

    SHACL reports `sh:sourceShape` as the shape that actually failed — and for the common
    `mirash:X sh:property [ sh:path … ; sh:minCount 1 ]` idiom that is the BLANK property shape,
    not `mirash:X`. Attributing a violation to the named shape a fixture declares in its
    `# EXPECT-VIOLATION:` header therefore requires walking UP the shapes graph from the blank
    node to whatever named shape contains it (through sh:property, sh:node, sh:not, and the RDF
    list cells of sh:or / sh:and / sh:xone).

    Without this, EXPECT-VIOLATION could only ever match the handful of shapes whose constraints
    sit directly on the named node shape — every property-shape rule would be unassertable.
    """
    if _seen is None:
        _seen = set()
    if node in _seen:
        return set()
    _seen.add(node)

    if isinstance(node, URIRef):
        name = _local_name(node)
        return {name} if name else set()

    out: set[str] = set()
    for parent in shapes.subjects(None, node):
        out |= _named_ancestors(parent, shapes, _seen)
    return out


def violated_shapes(results_graph: Graph, shapes: Graph) -> set[str]:
    """Local names of the named shapes that reported a violation.

    A blank source shape is resolved to its owning named shape — see `_named_ancestors`.
    """
    out: set[str] = set()
    for _, src in results_graph.subject_objects(SH.sourceShape):
        out |= _named_ancestors(src, shapes)
    return out


def check_fixture_coverage(report: Report, shapes: Graph, root: Path) -> None:
    """Report how many named shapes have at least one invalid fixture pinning them.

    Informational (never fails the run) but ALWAYS printed, because the dangerous failure mode
    here is silent: a fixture directory holding 2 fixtures makes every phase green and reads as
    "the shapes are covered" when 40 rules have never been exercised. Naming the number keeps the
    gap visible until the fixture phase closes it (ADR-0032 §8).
    """
    declared = {
        n for n in (_local_name(s) for s in shapes.subjects(RDF.type, SH.NodeShape)) if n
    }
    if not declared:
        return
    invalid_dir = root / "invalid"
    exercised: set[str] = set()
    if invalid_dir.is_dir():
        for f in invalid_dir.glob("*.ttl"):
            exercised |= {
                m.split(":")[-1] for m in EXPECT_RE.findall(f.read_text(encoding="utf-8"))
            }
    covered = declared & exercised
    uncovered = sorted(declared - exercised)
    report.add(
        "shapes:fixture-coverage",
        True,
        f"{len(covered)}/{len(declared)} shapes have an invalid fixture pinning them; "
        f"{len(uncovered)} uncovered (ADR-0032 §8 follow-up).\n"
        f"uncovered: {', '.join(uncovered)}",
        skipped=True,
    )


def check_valid_fixtures(report: Report, onto: Graph, shapes: Graph, root: Path) -> None:
    valid_dir = root / "valid"
    if not valid_dir.is_dir():
        report.add(
            "fixtures:valid:present",
            True,
            f"{valid_dir} does not exist yet — fixtures are a follow-up phase (ADR-0032 §8), "
            "not a regression. An empty (but present) directory still FAILs.",
            skipped=True,
        )
        return
    files = sorted(valid_dir.glob("*.ttl"))
    if not files:
        report.add("fixtures:valid:present", False, f"no valid fixtures under {valid_dir}")
        return
    for f in files:
        try:
            data = Graph()
            data.parse(f.as_posix(), format="turtle")
        except Exception as exc:  # noqa: BLE001
            report.add(f"fixtures:valid:{f.name}", False, f"parse error: {exc}")
            continue
        conforms, _, text = run_shacl(data, onto, shapes)
        report.add(
            f"fixtures:valid:{f.name}",
            conforms,
            "" if conforms else text,
        )


def check_invalid_fixtures(report: Report, onto: Graph, shapes: Graph, root: Path) -> None:
    invalid_dir = root / "invalid"
    if not invalid_dir.is_dir():
        report.add(
            "fixtures:invalid:present",
            True,
            f"{invalid_dir} does not exist yet — fixtures are a follow-up phase (ADR-0032 §8), "
            "not a regression. An empty (but present) directory still FAILs.",
            skipped=True,
        )
        return
    files = sorted(invalid_dir.glob("*.ttl"))
    if not files:
        report.add("fixtures:invalid:present", False, f"no invalid fixtures under {invalid_dir}")
        return
    for f in files:
        source = f.read_text(encoding="utf-8")
        expected = {m.split(":")[-1] for m in EXPECT_RE.findall(source)}
        if not expected:
            report.add(
                f"fixtures:invalid:{f.name}",
                False,
                "fixture declares no `# EXPECT-VIOLATION: mirash:ShapeName` header — "
                "an invalid fixture must fail for a SPECIFIC documented reason",
            )
            continue
        try:
            data = Graph()
            data.parse(f.as_posix(), format="turtle")
        except Exception as exc:  # noqa: BLE001
            report.add(f"fixtures:invalid:{f.name}", False, f"parse error: {exc}")
            continue

        conforms, results_graph, text = run_shacl(data, onto, shapes)
        if conforms:
            report.add(
                f"fixtures:invalid:{f.name}",
                False,
                f"expected violations {sorted(expected)} but the graph CONFORMED — "
                "the rule this fixture exercises is not actually enforced",
            )
            continue
        fired = violated_shapes(results_graph, shapes)
        unmet = expected - fired
        report.add(
            f"fixtures:invalid:{f.name}",
            not unmet,
            ""
            if not unmet
            else (
                f"expected shapes did not fire: {sorted(unmet)}\n"
                f"shapes that DID fire: {sorted(fired)}\n{text}"
            ),
        )


# ── main ───────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Validate the MIRA ontology, shapes and fixtures.")
    ap.add_argument("--format", choices=["text", "json"], default="text")
    ap.add_argument("--fixtures", type=Path, default=FIXTURES_DIR, help="fixture root directory")
    ap.add_argument(
        "--only",
        choices=["syntax", "hygiene", "valid", "invalid"],
        action="append",
        help="run only the named phase(s); repeatable",
    )
    args = ap.parse_args(argv)
    phases = set(args.only or ["syntax", "hygiene", "valid", "invalid"])

    report = Report()
    onto, shapes = check_syntax(report)
    if onto is None or shapes is None:
        print(report.to_json() if args.format == "json" else report.to_text())
        return 1

    if "hygiene" in phases:
        check_grounding(report, onto)
        check_term_status(report, onto)
        check_inverse_completeness(report, onto)
        check_inverse_symmetry(report, onto)

    if "valid" in phases:
        check_valid_fixtures(report, onto, shapes, args.fixtures)
    if "invalid" in phases:
        check_invalid_fixtures(report, onto, shapes, args.fixtures)
        check_fixture_coverage(report, shapes, args.fixtures)

    print(report.to_json() if args.format == "json" else report.to_text())
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
