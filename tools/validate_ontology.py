#!/usr/bin/env python3
"""Deterministic, offline validator for the MIRA ontology (ADR-0032).

Zero paid calls, zero network after `pip install -r ontology/requirements.txt`, hermetic.

What it does, in order:
  1. Parses every ontology module and shape file (Turtle syntax check).
  2. Enforces the grounding rule: every mira: term declares mira:grounded_in.
  3. Enforces inverse completeness: every ObjectProperty either declares owl:inverseOf
     or documents in rdfs:comment why no inverse is modeled.
  4. Runs each fixture under `fixtures/valid/` and expects conformance.
  5. Runs each fixture under `fixtures/invalid/` and expects EXACTLY the shapes named in that
     fixture's `# EXPECT-VIOLATION:` header lines to fire. A shape that fires without being
     declared fails the fixture; one that co-fires unavoidably is declared with `# ALSO-FIRES:`.
  6. Fixture coverage (a GATE, issue #5528): every named shape needs an invalid fixture that
     pins it AND a valid fixture, declared with `# PROTECTS:`, that the shape actually targets.
     The only way to leave a shape uncovered is an entry in `fixtures/coverage-exclusions.json`
     carrying a reason and a tracking reference.

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
import ast
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
# `# ALSO-FIRES: mirash:OtherShape <why>` — a shape that unavoidably fires alongside the expected
# one (a rule that is subsumed by a neighbour cannot be violated alone). It is checked both ways:
# an undeclared co-firing shape fails the fixture, and so does a declared one that stays silent.
ALSO_RE = re.compile(r"^#\s*ALSO-FIRES:\s*(\S+)(?:[ \t].*)?$", re.MULTILINE)
# `# PROTECTS: mirash:SomeShape` in a VALID fixture names the shape whose legitimate case it is.
PROTECTS_RE = re.compile(r"^#\s*PROTECTS:\s*(\S+)\s*$", re.MULTILINE)
EXCLUSIONS_FILE = "coverage-exclusions.json"
# Comments that legitimately explain an absent inverse.
NO_INVERSE_RE = re.compile(r"no inverse (is )?modeled|its own inverse", re.IGNORECASE)


@dataclass
class Result:
    """One check outcome. `skipped` results don't count toward pass/fail totals or exit code.
    Nothing in this tool emits one any more (#5528 turned the last two into failures); the field
    stays so the JSON shape is stable and a future skip is visible in the `skipped` count."""

    name: str
    passed: bool
    detail: str = ""
    skipped: bool = False


@dataclass
class Report:
    results: list[Result] = field(default_factory=list)
    coverage_summary: str = ""
    runtime_summary: str = ""

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
                "coverage": self.coverage_summary,
                "runtime": self.runtime_summary,
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
        if self.coverage_summary:
            lines.append(f"coverage: {self.coverage_summary}")
        if self.runtime_summary:
            lines.append(f"runtime:  {self.runtime_summary}")
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
    NOTE: RDFS inference IS applied (`inference="rdfs"`): rdfs:domain / rdfs:range / subClassOf
    add types to data nodes before any shape runs. No OWL reasoner runs, so owl:inverseOf is not
    expanded. Both facts shape what a rule can and cannot see (#5528).
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
MIRASH = Namespace("https://ontology.factorylm.com/mira/shapes#")


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


def _headers(regex: re.Pattern[str], source: str) -> set[str]:
    """Shape names from a header. Only the `mirash:` prefix names a shape; any other token is
    kept whole so it can never equal a real shape name and is reported as unknown."""
    prefix = "mirash:"
    return {m[len(prefix) :] if m.startswith(prefix) else m for m in regex.findall(source)}


def declared_shapes(shapes: Graph) -> set[str]:
    return {n for n in (_local_name(s) for s in shapes.subjects(RDF.type, SH.NodeShape)) if n}


PROBE = Namespace("urn:mira-coverage-probe:")
_TARGET_PREDICATES = (
    SH.targetClass,
    SH.targetNode,
    SH.targetObjectsOf,
    SH.targetSubjectsOf,
    SH.target,
)


def targeted_shapes(data: Graph, onto: Graph, shapes: Graph) -> set[str]:
    """Local names of the named shapes that select at least one focus node in `data`.

    A valid fixture proves nothing about a shape that never looks at it: a graph with no
    FaultCode in it "conforms" to every fault-code rule. So for each named shape we build a probe
    shape with the SAME target declarations and one constraint no node can satisfy
    (`sh:in` over a single impossible value), then run pyshacl exactly as the real validation
    does. A probe that reports a result means its shape had a focus node. Reusing pyshacl's own
    target resolution — rather than re-implementing targetClass / targetObjectsOf / SPARQL targets
    here — keeps this honest under the RDFS inference the real run applies.
    """
    from rdflib import BNode
    from rdflib.collection import Collection

    probe_shapes = Graph()
    for t in shapes:
        probe_shapes.add(t)
    for shape in shapes.subjects(RDF.type, SH.NodeShape):
        name = _local_name(shape) if isinstance(shape, URIRef) else None
        if not name:
            continue
        targets = [(p, o) for p in _TARGET_PREDICATES for o in shapes.objects(shape, p)]
        if not targets:
            continue
        probe = PROBE[name]
        probe_shapes.add((probe, RDF.type, SH.NodeShape))
        for p, o in targets:
            probe_shapes.add((probe, p, o))
        impossible = BNode()
        Collection(probe_shapes, impossible, [PROBE["__never__"]])
        probe_shapes.add((probe, SH["in"], impossible))

    _, results, _ = run_shacl(data, onto, probe_shapes)
    return {
        str(src)[len(str(PROBE)) :]
        for src in results.objects(None, SH.sourceShape)
        if str(src).startswith(str(PROBE))
    }


@dataclass
class Coverage:
    """What the fixture tree proves about each named shape.

    pinned     an invalid fixture names it in EXPECT-VIOLATION
    protected  a CONFORMING valid fixture names it in PROTECTS and the shape targets a node in it
    covered    both of the above
    excluded   uncovered on purpose, with a reason and a tracking reference
    missing    neither covered nor excluded — this is what fails the gate
    problems   anything that makes the bookkeeping itself untrustworthy
    """

    declared: set[str] = field(default_factory=set)
    pinned: set[str] = field(default_factory=set)
    protected: set[str] = field(default_factory=set)
    excluded: dict[str, dict] = field(default_factory=dict)
    problems: list[str] = field(default_factory=list)

    @property
    def covered(self) -> set[str]:
        return self.pinned & self.protected

    @property
    def missing(self) -> list[str]:
        return sorted(self.declared - self.covered - set(self.excluded))


def fixture_coverage(onto: Graph, shapes: Graph, root: Path) -> Coverage:
    cov = Coverage(declared=declared_shapes(shapes))

    invalid_dir = root / "invalid"
    if invalid_dir.is_dir():
        for f in sorted(invalid_dir.glob("*.ttl")):
            for name in sorted(_headers(EXPECT_RE, f.read_text(encoding="utf-8"))):
                if name in cov.declared:
                    cov.pinned.add(name)
                else:
                    cov.problems.append(
                        f"invalid/{f.name}: EXPECT-VIOLATION names unknown shape {name}"
                    )

    valid_dir = root / "valid"
    if valid_dir.is_dir():
        for f in sorted(valid_dir.glob("*.ttl")):
            claimed = sorted(_headers(PROTECTS_RE, f.read_text(encoding="utf-8")))
            if not claimed:
                cov.problems.append(
                    f"valid/{f.name}: declares no `# PROTECTS: mirash:ShapeName` header — a valid "
                    "fixture must say which rule's legitimate case it is"
                )
                continue
            try:
                data = Graph()
                data.parse(f.as_posix(), format="turtle")
            except Exception as exc:  # noqa: BLE001
                cov.problems.append(f"valid/{f.name}: parse error: {exc}")
                continue
            conforms, _, _ = run_shacl(data, onto, shapes)
            targeted = targeted_shapes(data, onto, shapes)
            for name in claimed:
                if name not in cov.declared:
                    cov.problems.append(f"valid/{f.name}: PROTECTS names unknown shape {name}")
                elif not conforms:
                    cov.problems.append(
                        f"valid/{f.name}: does not conform, so it cannot protect {name}"
                    )
                elif name not in targeted:
                    cov.problems.append(
                        f"valid/{f.name}: claims to protect {name}, but that shape targets no node "
                        "in this graph — it conforms only because the rule never looked at it"
                    )
                else:
                    cov.protected.add(name)

    exclusions = root / EXCLUSIONS_FILE
    if exclusions.is_file():
        try:
            entries = json.loads(exclusions.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            cov.problems.append(f"{EXCLUSIONS_FILE}: not valid JSON: {exc}")
            entries = []
        for entry in entries if isinstance(entries, list) else []:
            name = str(entry.get("shape", "")) if isinstance(entry, dict) else ""
            reason = str(entry.get("reason", "")).strip() if isinstance(entry, dict) else ""
            tracking = str(entry.get("tracking", "")).strip() if isinstance(entry, dict) else ""
            if name not in cov.declared:
                cov.problems.append(f"{EXCLUSIONS_FILE}: excludes unknown shape {name!r}")
            elif len(reason) < 40 or not tracking:
                cov.problems.append(
                    f"{EXCLUSIONS_FILE}: exclusion of {name} needs a written reason (40+ chars) "
                    "and a tracking reference"
                )
            elif name in cov.covered:
                cov.problems.append(
                    f"{EXCLUSIONS_FILE}: stale exclusion — {name} now has a valid+invalid pair; "
                    "delete the entry"
                )
            else:
                cov.excluded[name] = entry
    return cov


def check_fixture_coverage(report: Report, onto: Graph, shapes: Graph, root: Path) -> None:
    """GATE: every named shape has a targeted invalid fixture AND a valid fixture it targets.

    This was an informational SKIP until #5528. The failure mode it now closes is silent: a
    fixture directory holding two files made every phase green and read as "the shapes are
    covered" while forty rules had never been exercised. A shape may be left uncovered only by a
    written exclusion (reason + tracking) in `coverage-exclusions.json`.
    """
    cov = fixture_coverage(onto, shapes, root)
    if not cov.declared:
        report.add("shapes:fixture-coverage", False, "no named shapes declared")
        return
    lines = [
        f"{len(cov.covered)}/{len(cov.declared)} shapes covered by a valid+invalid pair; "
        f"{len(cov.excluded)} explicitly excluded; {len(cov.missing)} missing."
    ]
    if cov.missing:
        no_invalid = sorted(set(cov.missing) - cov.pinned)
        no_valid = sorted(set(cov.missing) - cov.protected)
        if no_invalid:
            lines.append("no invalid fixture (EXPECT-VIOLATION): " + ", ".join(no_invalid))
        if no_valid:
            lines.append("no valid fixture (PROTECTS): " + ", ".join(no_valid))
    for name in sorted(cov.excluded):
        lines.append(f"excluded: {name} — {cov.excluded[name].get('tracking')}")
    lines.extend(cov.problems)
    passed = not cov.missing and not cov.problems
    report.add("shapes:fixture-coverage", passed, "\n".join(lines))
    report.coverage_summary = lines[0]


def check_valid_fixtures(report: Report, onto: Graph, shapes: Graph, root: Path) -> None:
    valid_dir = root / "valid"
    if not valid_dir.is_dir():
        report.add("fixtures:valid:present", False, f"{valid_dir} does not exist")
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
        report.add("fixtures:invalid:present", False, f"{invalid_dir} does not exist")
        return
    files = sorted(invalid_dir.glob("*.ttl"))
    if not files:
        report.add("fixtures:invalid:present", False, f"no invalid fixtures under {invalid_dir}")
        return
    for f in files:
        source = f.read_text(encoding="utf-8")
        expected = _headers(EXPECT_RE, source)
        also = _headers(ALSO_RE, source)
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
        silent_also = also - fired
        undeclared = fired - expected - also
        problems: list[str] = []
        if unmet:
            problems.append(f"expected shapes did not fire: {sorted(unmet)}")
        if undeclared:
            problems.append(
                f"shapes fired that the fixture does not declare: {sorted(undeclared)} — an "
                "invalid fixture must fail for its declared reason ONLY. Remove the unrelated "
                "violation, or if the co-firing is unavoidable declare it with "
                "`# ALSO-FIRES: mirash:ShapeName <why>`"
            )
        if silent_also:
            problems.append(
                f"declared ALSO-FIRES shapes did not fire: {sorted(silent_also)} — the header "
                "is a stale statement about the shapes; delete it"
            )
        report.add(
            f"fixtures:invalid:{f.name}",
            not problems,
            ""
            if not problems
            else "\n".join(problems) + f"\nshapes that DID fire: {sorted(fired)}\n{text}",
        )


# ── main ───────────────────────────────────────────────────────────────


# ── Phase 5: runtime contract (#5528) ──────────────────────────────────
#
# The phases above prove the ontology is self-consistent. They say nothing about whether the
# application agrees with it — nothing in a live workflow calls this validator. This phase
# checks the one file that records that relationship, ontology/mappings/runtime-contract.v1.json:
#
#   * every named shape states whether the application enforces it (runtime), only this tool
#     checks it (offline_only), or the application does not do it today (planned);
#   * a `runtime` claim must rest on a contract whose test exists and is not an expected failure;
#   * each controlled vocabulary is compared, by reading the source, with the database CHECK
#     constraints and Python constants it is "grounded in". A difference must be declared with a
#     reason, and a declared difference that is no longer real fails too.
#
# It reads files only: no database, no imports of application code, no network.

RUNTIME_CONTRACT = ONTOLOGY_DIR / "mappings" / "runtime-contract.v1.json"
ENFORCEMENT_VALUES = ("runtime", "offline_only", "planned")
_TABLE_RE = re.compile(r"(?:CREATE TABLE(?: IF NOT EXISTS)?|ALTER TABLE)\s+(\w+)", re.IGNORECASE)


def _sql_check_values(path: Path, table: str, column: str) -> set[str]:
    """The literals in `CHECK (<column> [IS NULL OR <column>] IN (...))` under `table`."""
    text = path.read_text(encoding="utf-8")
    check_re = re.compile(
        rf"CHECK\s*\(\s*{re.escape(column)}\s+(?:IS NULL OR\s+{re.escape(column)}\s+)?IN\s*\(([^)]*)\)",
        re.IGNORECASE,
    )
    found: list[set[str]] = []
    for m in check_re.finditer(text):
        owners = _TABLE_RE.findall(text[: m.start()])
        if owners and owners[-1].lower() == table.lower():
            found.append(set(re.findall(r"'([^']*)'", m.group(1))))
    if len(found) != 1:
        raise ValueError(f"{len(found)} CHECK constraints on {table}.{column} in {path.name}")
    return found[0]


def _python_values(path: Path, source: dict) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    kind = source["kind"]
    if kind == "python_enum":
        for node in tree.body:
            if isinstance(node, ast.ClassDef) and node.name == source["name"]:
                return {
                    ast.literal_eval(st.value)
                    for st in node.body
                    if isinstance(st, ast.Assign) and isinstance(st.value, ast.Constant)
                }
        raise ValueError(f"no class {source['name']} in {path.name}")
    wanted = [source["name"]] if kind == "python_set" else list(source["names"])
    values: dict[str, set[str]] = {}
    for node in ast.walk(tree):
        target = None
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            target = node.targets[0]
        elif isinstance(node, ast.AnnAssign):
            target = node.target
        if not isinstance(target, ast.Name) or target.id not in wanted or node.value is None:
            continue
        value = node.value
        if isinstance(value, ast.Call) and value.args:  # frozenset({...})
            value = value.args[0]
        literal = ast.literal_eval(value)
        values[target.id] = {literal} if isinstance(literal, str) else set(literal)
    missing = [n for n in wanted if n not in values]
    if missing:
        raise ValueError(f"no literal assignment for {missing} in {path.name}")
    return set().union(*values.values())


def _source_values(source: dict) -> set[str]:
    path = REPO_ROOT / source["file"]
    if source["kind"] == "sql_check":
        return _sql_check_values(path, source["table"], source["column"])
    if source["kind"] in ("python_set", "python_constants", "python_enum"):
        return _python_values(path, source)
    raise ValueError(f"unknown source kind {source['kind']!r}")


def _source_label(source: dict) -> str:
    where = source.get("table") or source.get("name") or "+".join(source.get("names", []))
    return f"{Path(source['file']).name}:{where}"


def check_vocabulary_drift(report: Report, onto: Graph, mapping: dict) -> None:
    for vocab in mapping.get("vocabularies", []):
        cls = vocab["ontology_class"]
        labels = {
            str(o) for s in onto.subjects(RDF.type, MIRA[cls]) for o in onto.objects(s, RDFS.label)
        }
        for source in vocab["sources"]:
            name = f"vocab:{cls}:{_source_label(source)}"
            if not labels:
                report.add(name, False, f"mira:{cls} has no labelled members in the ontology")
                continue
            try:
                runtime = _source_values(source)
            except (OSError, ValueError, SyntaxError, KeyError) as exc:
                report.add(name, False, f"cannot read the runtime vocabulary: {exc}")
                continue
            only_onto, only_run = sorted(labels - runtime), sorted(runtime - labels)
            want_onto = sorted(source.get("ontology_only", []))
            want_run = sorted(source.get("runtime_only", []))
            problems = []
            if (only_onto, only_run) != (want_onto, want_run):
                problems.append(
                    f"ontology-only {only_onto} / runtime-only {only_run}; "
                    f"the mapping declares {want_onto} / {want_run}"
                )
            if (want_onto or want_run) and len(str(source.get("reason", "")).strip()) < 20:
                problems.append("a declared difference needs a reason (20+ characters)")
            report.add(name, not problems, "; ".join(problems))


def _test_markers(test_id: str) -> tuple[bool, bool, bool]:
    """(exists, is_xfail, is_strict) for a `path::Class::function` test id, read with ast."""
    try:
        rel, cls_name, fn_name = test_id.split("::")
        tree = ast.parse((REPO_ROOT / rel).read_text(encoding="utf-8"))
    except (ValueError, OSError, SyntaxError):
        return False, False, False
    for cls in tree.body:
        if not (isinstance(cls, ast.ClassDef) and cls.name == cls_name):
            continue
        for fn in cls.body:
            if isinstance(fn, ast.FunctionDef) and fn.name == fn_name:
                decorators = [ast.unparse(d) for d in fn.decorator_list]
                xfail = [d for d in decorators if "xfail" in d]
                return True, bool(xfail), any("strict=True" in d for d in xfail)
    return False, False, False


def check_runtime_contract(
    report: Report, onto: Graph, shapes: Graph, mapping_path: Path = RUNTIME_CONTRACT
) -> None:
    try:
        mapping = json.loads(mapping_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        report.add("runtime:mapping-file", False, f"{mapping_path}: {exc}")
        return

    contracts: dict = mapping.get("contracts", {})
    problems = []
    for cid, c in sorted(contracts.items()):
        for rel in c.get("code", []):
            if not (REPO_ROOT / rel).is_file():
                problems.append(f"{cid}: code path {rel} does not exist")
        if not c.get("call_path"):
            problems.append(f"{cid}: no call_path — an unused adapter is not enforcement")
        exists, xfail, strict = _test_markers(c.get("test", ""))
        if not exists:
            problems.append(f"{cid}: test {c.get('test')!r} not found")
        elif c.get("status") == "agrees" and xfail:
            problems.append(f"{cid}: status 'agrees' but its test is marked xfail")
        elif c.get("status") == "disagrees":
            if not (xfail and strict):
                problems.append(f"{cid}: status 'disagrees' needs a strict xfail test")
            if not c.get("tracking"):
                problems.append(f"{cid}: status 'disagrees' needs a tracking reference")
        elif c.get("status") not in ("agrees", "disagrees"):
            problems.append(f"{cid}: status must be agrees|disagrees")
    report.add("runtime:contracts", not problems, "\n".join(problems))

    declared = declared_shapes(shapes)
    entries: dict = mapping.get("shapes", {})
    problems = [f"{s}: no entry in {mapping_path.name}" for s in sorted(declared - set(entries))]
    problems += [
        f"{s}: entry for a shape that does not exist" for s in sorted(set(entries) - declared)
    ]
    counts = dict.fromkeys(ENFORCEMENT_VALUES, 0)
    for shape, entry in sorted(entries.items()):
        status = entry.get("enforcement")
        if status not in ENFORCEMENT_VALUES:
            problems.append(f"{shape}: enforcement must be one of {ENFORCEMENT_VALUES}")
            continue
        counts[status] += 1
        refs = entry.get("contracts", [])
        unknown = [r for r in refs if r not in contracts]
        if unknown:
            problems.append(f"{shape}: unknown contract(s) {unknown}")
        if status == "runtime":
            if not refs:
                problems.append(f"{shape}: 'runtime' needs at least one contract test")
            if any(contracts.get(r, {}).get("status") != "agrees" for r in refs):
                problems.append(f"{shape}: 'runtime' rests on a contract the application fails")
            if not entry.get("scope"):
                problems.append(f"{shape}: 'runtime' must state its scope")
        if status == "planned" and not entry.get("tracking"):
            problems.append(f"{shape}: 'planned' needs a tracking reference")
    report.runtime_summary = (
        f"{counts['runtime']} enforced at runtime (within a stated scope), "
        f"{counts['offline_only']} offline-only, {counts['planned']} not done by the application"
    )
    report.add("runtime:shape-mapping", not problems, "\n".join(problems))
    check_vocabulary_drift(report, onto, mapping)


# ── Shape inventory (generated document) ───────────────────────────────

INVENTORY_FILE = ONTOLOGY_DIR / "SHAPE-INVENTORY.md"
_ENFORCEMENT_TEXT = {
    "runtime": "**Runtime**",
    "offline_only": "Offline only",
    "planned": "Not done by the app",
}


def _shape_rule(shapes: Graph, name: str) -> str:
    node = MIRASH[name]
    label = shapes.value(node, RDFS.label)
    if label is None:
        for holder in [node, *shapes.objects(node, SH.property), *shapes.objects(node, SH.sparql)]:
            label = shapes.value(holder, SH.message)
            if label is not None:
                break
    text = re.sub(r"\s+", " ", str(label or "")).replace("|", "/").strip()
    return text if len(text) <= 110 else text[:107] + "..."


def render_inventory(shapes: Graph, root: Path, mapping: dict) -> str:
    """One row per shape: rule, fixtures both ways, and what the application really does."""
    by_shape: dict[str, dict[str, list[str]]] = {}
    for kind, regex in (("valid", PROTECTS_RE), ("invalid", EXPECT_RE)):
        for f in sorted((root / kind).glob("*.ttl")):
            for shape in _headers(regex, f.read_text(encoding="utf-8")):
                by_shape.setdefault(shape, {}).setdefault(kind, []).append(f.stem)
    excluded = {}
    exclusions = root / EXCLUSIONS_FILE
    if exclusions.is_file():
        excluded = {e["shape"]: e for e in json.loads(exclusions.read_text(encoding="utf-8"))}
    contracts = mapping.get("contracts", {})
    lines = [
        "# MIRA ontology: shape inventory",
        "",
        "Generated by `python tools/validate_ontology.py --write-inventory`. Do not edit by hand:",
        "the validator fails when this file is out of date. Sources: the shape files, the fixture",
        "headers, `fixtures/coverage-exclusions.json` and `mappings/runtime-contract.v1.json`.",
        "",
        "**Runtime** means a contract test runs the real application code and it rejects the bad",
        "case, within the scope stated. **Offline only** means nothing but the validator checks",
        "the rule, against fixtures; no live workflow calls the validator. **Not done by the app**",
        "means the application behaves differently today (the tracking issue owns the repair).",
        "",
        "| Shape | Rule | Valid example | Invalid example | Enforcement | Runtime counterpart / gap |",
        "|---|---|---|---|---|---|",
    ]
    for name in sorted(declared_shapes(shapes)):
        entry = mapping.get("shapes", {}).get(name, {})
        fx = by_shape.get(name, {})
        cell = lambda items: "<br>".join(f"`{i}`" for i in items) or "none"  # noqa: E731
        notes = []
        if entry.get("scope"):
            notes.append(f"Scope: {entry['scope']}.")
        for cid in entry.get("contracts", []):
            c = contracts.get(cid, {})
            verdict = (
                "agrees" if c.get("status") == "agrees" else f"DISAGREES ({c.get('tracking')})"
            )
            notes.append(f"Contract `{cid}`: app {verdict}.")
        if entry.get("reason"):
            notes.append(f"{entry['reason']} ({entry.get('tracking')})")
        if entry.get("nearest_runtime"):
            notes.append(f"Nearest runtime check: {entry['nearest_runtime']}.")
        if name in excluded:
            notes.append(f"Fixture coverage excluded: {excluded[name]['reason']}")
        row = [
            f"`{name}`",
            _shape_rule(shapes, name),
            cell(fx.get("valid", [])),
            cell(fx.get("invalid", [])),
            _ENFORCEMENT_TEXT.get(entry.get("enforcement", ""), "UNMAPPED"),
            " ".join(notes).replace("|", "/") or "none",
        ]
        lines.append("| " + " | ".join(row) + " |")
    lines += [
        "",
        "## Runtime contracts",
        "",
        "| Contract | Rule | App | Call path | Test |",
        "|---|---|---|---|---|",
    ]
    for cid, c in sorted(contracts.items()):
        verdict = "agrees" if c.get("status") == "agrees" else f"disagrees ({c.get('tracking')})"
        lines.append(
            f"| `{cid}` | {c.get('rule', '')} | {verdict} | {c.get('call_path', '')} "
            f"| `{c.get('test', '').split('::', 1)[-1]}` |"
        )
    return "\n".join(lines) + "\n"


def check_inventory_current(report: Report, shapes: Graph, root: Path, mapping: dict) -> None:
    wanted = render_inventory(shapes, root, mapping)
    current = INVENTORY_FILE.read_text(encoding="utf-8") if INVENTORY_FILE.is_file() else ""
    report.add(
        "runtime:inventory-current",
        current == wanted,
        f"{INVENTORY_FILE.relative_to(REPO_ROOT)} is out of date; "
        "run: python tools/validate_ontology.py --write-inventory",
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Validate the MIRA ontology, shapes and fixtures.")
    ap.add_argument("--format", choices=["text", "json"], default="text")
    ap.add_argument("--fixtures", type=Path, default=FIXTURES_DIR, help="fixture root directory")
    ap.add_argument(
        "--only",
        choices=["syntax", "hygiene", "valid", "invalid", "runtime"],
        action="append",
        help="run only the named phase(s); repeatable",
    )
    ap.add_argument(
        "--write-inventory",
        action="store_true",
        help=f"regenerate {INVENTORY_FILE.name} from the shapes, fixtures and runtime mapping",
    )
    args = ap.parse_args(argv)
    phases = set(args.only or ["syntax", "hygiene", "valid", "invalid", "runtime"])

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
        check_fixture_coverage(report, onto, shapes, args.fixtures)
    if "runtime" in phases:
        check_runtime_contract(report, onto, shapes)
        if RUNTIME_CONTRACT.is_file() and args.fixtures == FIXTURES_DIR:
            mapping = json.loads(RUNTIME_CONTRACT.read_text(encoding="utf-8"))
            if args.write_inventory:
                INVENTORY_FILE.write_text(
                    render_inventory(shapes, args.fixtures, mapping), encoding="utf-8"
                )
            check_inventory_current(report, shapes, args.fixtures, mapping)

    print(report.to_json() if args.format == "json" else report.to_text())
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
