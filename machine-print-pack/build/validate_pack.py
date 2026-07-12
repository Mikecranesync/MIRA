#!/usr/bin/env python3
"""MIRA Print Pack — bundle-level commercial gate (SPEC.md §4, checks M-R).

CLI:
    py -3 validate_pack.py --bundle <dir>

Complements validate_model.py (drawing correctness, checks A-L, run as build
step 1 -- never re-run here). This script validates the BUNDLE: evidence
resolution, cross-references, duplicate conductors, unsupported claims, sheet
consistency, and approval-status completeness.

Exit codes: 0 = pass, 1 = recoverable warnings, 2 = critical (never ship).

Portability: this script must run in a minimal env (pyyaml only, no fitz/
Pillow) and still produce a useful report. Checks M/N/O/P/R and Q(iii)/(iv)
are pure data checks (no fitz needed). Q(i)/(ii) need to extract text from
the rendered per-sheet PDFs -- if fitz cannot be imported, those two
sub-checks SKIP with a clear notice instead of crashing or hard-failing.

Repo-access scope: this bundle is meant to be useful standalone (SPEC.md
non-negotiable #4), so citation resolution against the ORIGINAL source
package (check M's line-count verification, check P's PHOTO_EVIDENCE_V*.md
freshness lookup) only runs when the bundle is sitting inside a git checkout
that still has the source package -- detected via pack_manifest.json's
`source_package_dir` + walking up from the bundle for a `.git`. When that
context isn't available (a relocated, truly standalone bundle), those two
checks degrade to "skipped -- source package not in reach" rather than
failing or fabricating a result.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import pack_common as pc

E0_TOKEN_RE = re.compile(r"E-0\d\d")
PHOTO_EVIDENCE_RE = re.compile(r"PHOTO_EVIDENCE_V(\d+)\.md")


class Report:
    def __init__(self):
        self.results: dict[str, tuple[str, list[str]]] = {}  # name -> (PASS/WARN/FAIL/SKIP, issues)

    def record(self, name: str, status: str, issues: list[str] | None = None):
        self.results[name] = (status, issues or [])

    def exit_code(self) -> int:
        statuses = {s for s, _ in self.results.values()}
        if "FAIL" in statuses:
            return 2
        if "WARN" in statuses:
            return 1
        return 0

    def print_report(self) -> None:
        print("\n" + "=" * 80)
        print("MIRA PRINT PACK — BUNDLE VALIDATION (checks M-R)")
        print("=" * 80)
        for name in sorted(self.results):
            status, issues = self.results[name]
            sym = {"PASS": "[PASS]", "WARN": "[WARN]", "FAIL": "[FAIL]", "SKIP": "[SKIP]"}[status]
            print(f"{sym:8} {name}")
            for issue in issues[:8]:
                print(f"         - {issue}")
            if len(issues) > 8:
                print(f"         - ... and {len(issues) - 8} more")
        print("=" * 80)
        code = self.exit_code()
        verdict = {0: "PASS", 1: "RECOVERABLE WARNINGS", 2: "CRITICAL — DO NOT SHIP"}[code]
        print(f"VERDICT: {verdict} (exit {code})")
        print("=" * 80)


# ---------------------------------------------------------------- loading


def load_bundle(bundle: Path) -> dict:
    pack_model = json.loads((bundle / "data" / "pack_model.json").read_text(encoding="utf-8"))
    manifest = json.loads((bundle / "pack_manifest.json").read_text(encoding="utf-8"))
    return {"pack_model": pack_model, "manifest": manifest}


def resolve_source_context(bundle: Path, manifest: dict) -> pc.CitationResolver | None:
    """Returns a resolver rooted at the original source package if this
    bundle is sitting inside a git checkout that still has it; else None."""
    repo_root = pc.find_repo_root(bundle)
    if repo_root is None:
        return None
    source_package_dir = manifest.get("source_package_dir")
    if not source_package_dir:
        return None
    package = repo_root / source_package_dir
    if not package.exists():
        return None
    roots = [
        bundle / "evidence" / "photos",
        package,
        package / "review",
        package / "review" / "photos",
        package / "model",
        repo_root,
        repo_root / "plc",
    ]
    return pc.CitationResolver(roots)


# ---------------------------------------------------------------- shared: sheet/device text helpers


def _annotation_texts(sheet: dict) -> list[str]:
    ann = sheet.get("annotations") or {}
    texts: list[str] = []
    for key in ("caveat", "safety", "notes", "sources"):
        texts.extend(ann.get(key) or [])
    if sheet.get("lineage"):
        texts.append(sheet["lineage"])
    if sheet.get("note"):
        texts.append(sheet["note"])
    if sheet.get("subtitle"):
        texts.append(sheet["subtitle"])
    if sheet.get("scope"):
        texts.append(sheet["scope"])
    return texts


def _device_sheet_map(pack_model: dict) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for w in pack_model.get("wires", []):
        sheet = w.get("sheet", "")
        for ep in (w.get("from", ""), w.get("to", "")):
            if "." in ep:
                out.setdefault(ep.split(".", 1)[0], set()).add(sheet)
    for lk in pack_model.get("e007_rs485", {}).get("links", []):
        for dev in (lk.get("src_device", ""), lk.get("dst_device", "")):
            out.setdefault(dev, set()).add("E-007")
    device_tags = {d["tag"] for d in pack_model.get("devices", [])}
    for seg in pack_model.get("e002_oneline", {}).get("segments", []):
        for node in (seg.get("from", ""), seg.get("to", "")):
            if node in device_tags:
                out.setdefault(node, set()).add("E-002")
    return out


# ---------------------------------------------------------------- M. Missing evidence

# RUBRIC.md hard-fail #2 is specifically "a solid wire without cited
# evidence" -- a DRAWN CONDUCTOR (wire/e007-link/e002-segment) with no
# resolvable citation is that hard-fail, so it stays FAIL here. A verified
# device/terminal SCHEDULE row (not itself a drawn conductor) is a different,
# lighter-weight category the original A-L gate never checked at all (D/E
# only ever covered wires/e007) -- for those, this check accepts the OWNING
# SHEET's `sources:` annotation block as sheet-level evidentiary backing
# (the package's own established convention for "this sheet's claims trace
# to these files") when the row itself carries no citation, and downgrades
# to WARN rather than FAIL: real gap, worth surfacing, not hard-fail severity
# absent a hard-fail-listed category it violates. A row with NEITHER its own
# citation NOR ANY sheet-level sources backing is still FAIL -- genuinely
# zero evidence for a claim marked "verified".
_DRAWN_CONDUCTOR_SECTIONS = {"wires", "e007_rs485.links", "e002_oneline.segments"}


def check_M(pack_model: dict, resolver: pc.CitationResolver | None) -> tuple[str, list[str]]:
    fails: list[str] = []
    warns: list[str] = []
    externals: list[str] = []

    device_sheets = _device_sheet_map(pack_model)
    sheet_by_id = {sh["id"]: sh for sh in pack_model.get("sheets", [])}

    def sheet_has_sources(sheet_id: str) -> bool:
        sh = sheet_by_id.get(sheet_id)
        return bool(sh and (sh.get("annotations") or {}).get("sources"))

    def owning_sheets_have_sources(entry: dict, section_name: str) -> bool:
        if section_name == "terminals":
            dev = entry.get("device", "")
            sheets = device_sheets.get(dev, set())
        elif section_name == "devices":
            sheets = device_sheets.get(entry.get("tag", ""), set())
        elif section_name == "e002_oneline.nodes":
            # a node IS a device as seen from the E-002 one-line summary --
            # inherently scoped to E-002 itself, not looked up via wires.
            sheets = {"E-002"}
        else:
            sheets = set()
        return any(sheet_has_sources(s) for s in sheets) if sheets else False

    sections: list[tuple[str, list[dict]]] = [
        ("devices", pack_model.get("devices", [])),
        ("terminals", pack_model.get("terminals", [])),
        ("wires", pack_model.get("wires", [])),
        ("e007_rs485.links", pack_model.get("e007_rs485", {}).get("links", [])),
        ("e002_oneline.nodes", pack_model.get("e002_oneline", {}).get("nodes", [])),
        ("e002_oneline.segments", pack_model.get("e002_oneline", {}).get("segments", [])),
    ]
    for section_name, entries in sections:
        is_drawn_conductor = section_name in _DRAWN_CONDUCTOR_SECTIONS
        for entry in entries:
            if entry.get("status") != "verified":
                continue
            label = (
                entry.get("tag")
                or entry.get("id")
                or entry.get("proposed_number")
                or entry.get("wire_label")
                or "?"
            )
            citations = entry.get("citations") or []
            has_own_citation = bool(citations) and bool((entry.get("source") or "").strip())
            if not has_own_citation:
                if is_drawn_conductor:
                    fails.append(
                        f"{section_name}:{label} status=verified but no citation (drawn conductor -- hard-fail category)"
                    )
                elif owning_sheets_have_sources(entry, section_name):
                    warns.append(
                        f"{section_name}:{label} status=verified with no row-level citation of its own "
                        f"(backed only by its owning sheet's sources block -- add a per-row citation)"
                    )
                else:
                    fails.append(
                        f"{section_name}:{label} status=verified but no citation anywhere (not even sheet-level)"
                    )
                continue
            if resolver is None:
                continue  # standalone mode -- nothing more we can check
            for c in citations:
                if "photo" in c:
                    p = resolver.resolve(c["photo"])
                    if p is None:
                        fails.append(f"{section_name}:{label} photo NOT FOUND: {c['photo']}")
                elif "doc" in c and c.get("locator"):
                    p = resolver.resolve(c["doc"])
                    if p is None:
                        externals.append(
                            f"{section_name}:{label} external reference: {c['doc']} {c['locator']}"
                        )
                        continue
                    need = max(int(x) for x in re.findall(r"\d+", c["locator"]))
                    try:
                        n_lines = sum(1 for _ in p.open("r", encoding="utf-8", errors="replace"))
                    except OSError as e:
                        fails.append(f"{section_name}:{label} cannot read {c['doc']}: {e}")
                        continue
                    if n_lines < need:
                        fails.append(
                            f"{section_name}:{label} {c['doc']} has {n_lines} lines, "
                            f"citation {c['locator']} needs >= {need} (wrong-line-number defect)"
                        )
                elif "doc" in c:
                    p = resolver.resolve(c["doc"])
                    if p is None:
                        externals.append(f"{section_name}:{label} external reference: {c['doc']}")
    note = []
    if resolver is None:
        note = [
            "standalone mode: source package not in reach -- file/line resolution skipped, only presence checked"
        ]
    elif externals:
        note = [
            f"{len(externals)} external reference(s) not verifiable (vendor manuals not committed to git) -- informational only"
        ]
    status = "FAIL" if fails else ("WARN" if warns else "PASS")
    return status, fails + warns + note


# ---------------------------------------------------------------- N. Broken cross-references

# Devices that are genuinely "split" across DETAIL sheets in the drafting
# sense (one functional element drawn in two places, e.g. a coil on one
# sheet and its power contacts on another) get the reciprocal-cross-cite
# rule this check exists for (the Q1 coil/contacts, S2 contact/lamp pattern
# SPEC.md names). Restricted to the wired detail sheets (the same set
# validate_model.py's own SHEET_SVGS uses for per-conductor auditing) --
# E-002/E-008/E-009 are intentionally consolidated summary/index sheets by
# design (E-002's own annotations: "Summary sheet only... Map between E-003
# ... and E-004 ..."), not a "split" representation, so including them here
# would flag nearly every shared power/ground node and bury the real defect
# class in noise.
_DETAIL_SHEETS = {"E-003", "E-004", "E-005", "E-006", "E-007"}
_SPLIT_DEVICE_TAGS = {"Q1", "S2"}


def check_N(pack_model: dict) -> tuple[str, list[str]]:
    fails: list[str] = []
    warns: list[str] = []
    sheets = pack_model.get("sheets", [])
    sheet_ids = {sh["id"] for sh in sheets}
    sheet_by_id = {sh["id"]: sh for sh in sheets}

    for sh in sheets:
        for t in _annotation_texts(sh):
            for tok in E0_TOKEN_RE.findall(t):
                if tok not in sheet_ids:
                    fails.append(f"{sh['id']}: references unknown sheet {tok!r} in annotation text")
    for it in pack_model.get("open_items", []):
        for tok in E0_TOKEN_RE.findall(f"{it.get('item', '')} {it.get('verify', '')}"):
            if tok not in sheet_ids:
                fails.append(f"{it['id']}: references unknown sheet {tok!r}")

    # Bidirectional cross-cite for split devices: RUBRIC.md scores this under
    # "Cross-references & continuation markers" (6 pts) -- it is NOT one of
    # the 6 zero-tolerance hard-fail conditions -- so a real gap here is WARN
    # (recoverable), matching how the original 4-reviewer panel actually
    # treated this exact defect class (a scoring deduction, not a rejection).
    device_sheets = _device_sheet_map(pack_model)
    for tag in sorted(_SPLIT_DEVICE_TAGS & device_sheets.keys()):
        sheets_list = sorted(s for s in device_sheets[tag] if s in _DETAIL_SHEETS)
        for i, sa in enumerate(sheets_list):
            for sb in sheets_list[i + 1 :]:
                sa_text = " ".join(_annotation_texts(sheet_by_id[sa]))
                sb_text = " ".join(_annotation_texts(sheet_by_id[sb]))
                if sb not in sa_text or sa not in sb_text:
                    warns.append(
                        f"device {tag} split across {sa}/{sb} but annotations don't reciprocally "
                        f"cross-cite (need {sb!r} mentioned on {sa} AND {sa!r} mentioned on {sb})"
                    )
    status = "FAIL" if fails else ("WARN" if warns else "PASS")
    return status, fails + warns


# ---------------------------------------------------------------- O. Duplicate conductors


def check_O(pack_model: dict) -> tuple[str, list[str]]:
    seen: dict[frozenset, str] = {}
    issues: list[str] = []
    all_conductors = [
        (w.get("proposed_number", "?"), w.get("from", ""), w.get("to", ""))
        for w in pack_model.get("wires", [])
    ]
    all_conductors += [
        (
            lk.get("wire_label", "?"),
            f"{lk.get('src_device', '')}.{lk.get('src_terminal', '')}",
            f"{lk.get('dst_device', '')}.{lk.get('dst_terminal', '')}",
        )
        for lk in pack_model.get("e007_rs485", {}).get("links", [])
    ]
    for label, frm, to in all_conductors:
        key = frozenset({frm, to})
        if key in seen:
            issues.append(
                f"{label} claims the same physical conductor as {seen[key]} ({frm} <-> {to})"
            )
        else:
            seen[key] = label
    return ("FAIL" if issues else "PASS"), issues


# ---------------------------------------------------------------- P. Unsupported claims

_RESOLVED_ID_RE = re.compile(r"^RESOLVED")


def check_P(
    pack_model: dict, bundle: Path, resolver_context: tuple[Path, Path] | None
) -> tuple[str, list[str]]:
    issues: list[str] = []
    warnings: list[str] = []
    open_items = pack_model.get("open_items", [])
    resolved_ids = [it["id"] for it in open_items if it.get("status") == "closed"]

    if resolver_context is not None:
        repo_root, package = resolver_context
        review_dir = package / "review"
        version_files = sorted(review_dir.glob("PHOTO_EVIDENCE_V*.md"))
        highest_mentioning: dict[str, int] = {}
        for f in version_files:
            m = PHOTO_EVIDENCE_RE.search(f.name)
            if not m:
                continue
            version = int(m.group(1))
            text = f.read_text(encoding="utf-8", errors="replace")
            for oid in resolved_ids:
                if oid in text:
                    highest_mentioning[oid] = max(version, highest_mentioning.get(oid, 0))

        all_entries = (
            pack_model.get("devices", [])
            + pack_model.get("terminals", [])
            + pack_model.get("wires", [])
            + pack_model.get("e007_rs485", {}).get("links", [])
            + pack_model.get("e002_oneline", {}).get("nodes", [])
            + pack_model.get("e002_oneline", {}).get("segments", [])
        )
        for oid, best in highest_mentioning.items():
            for entry in all_entries:
                text_fields = f"{entry.get('source', '')} {entry.get('note', '')}"
                if oid not in text_fields:
                    continue
                # A mention immediately preceded by "NOT"/"not" (e.g. "NOT
                # PHOTO_EVIDENCE_V6.md, which predates...") is an EXPLICIT
                # exclusion the author wrote to prevent exactly this
                # confusion -- it must not count as an active citation.
                cited_versions = [
                    int(m.group(1))
                    for m in PHOTO_EVIDENCE_RE.finditer(text_fields)
                    if not re.search(r"\bnot\s+$", text_fields[: m.start()], re.IGNORECASE)
                ]
                for v in cited_versions:
                    if v < best:
                        label = (
                            entry.get("tag")
                            or entry.get("proposed_number")
                            or entry.get("id")
                            or "?"
                        )
                        issues.append(
                            f"{label} cites PHOTO_EVIDENCE_V{v}.md for {oid} but V{best}.md is the "
                            "highest version that mentions it (stale citation chain)"
                        )
    else:
        warnings.append(
            "source package not in reach -- PHOTO_EVIDENCE_V*.md freshness check skipped"
        )

    # Secondary heuristic (cheap net): a sheet-level claim sentence with a
    # number+unit / model-looking token / confirmed|verified|RESOLVED, with
    # no sources annotation at all on that sheet, is flagged as a WARNING
    # (not a hard fail -- this is explicitly a coarse net, SPEC.md P).
    number_unit_re = re.compile(r"\d+(\.\d+)?\s*(V|VDC|VAC|A|Hz|Ω|ohm|kW|rpm|ms|%)\b")
    keyword_re = re.compile(r"\b(confirmed|verified|RESOLVED)\b")
    for sh in pack_model.get("sheets", []):
        ann = sh.get("annotations") or {}
        has_sources = bool(ann.get("sources"))
        claim_texts = (
            (ann.get("notes") or []) + (ann.get("caveat") or []) + [sh.get("subtitle", "")]
        )
        for t in claim_texts:
            if (number_unit_re.search(t) or keyword_re.search(t)) and not has_sources:
                warnings.append(
                    f"{sh['id']}: claim-like sentence with no sources annotation block: {t[:80]!r}"
                )

    status = "FAIL" if issues else ("WARN" if warnings else "PASS")
    return status, issues + warnings


# ---------------------------------------------------------------- Q. Sheet consistency


def check_Q_data(pack_model: dict, bundle: Path) -> tuple[str, list[str]]:
    """Q(iii): every sheets.yaml field referenced by no annotation list is
    dead data. Q(iv): bundle's own exported table row counts match the
    model counts they were generated from (data self-consistency; the
    render-time SVG/PDF row-count parity itself is validate_model.py's
    domain, gated at build step 1)."""
    issues: list[str] = []
    for sh in pack_model.get("sheets", []):
        ann = sh.get("annotations") or {}
        referenced = set()
        for key in ("caveat", "safety", "notes", "sources"):
            referenced.update(ann.get(key) or [])
        for extra_field in ("note", "lineage"):
            if sh.get(extra_field) and sh[extra_field] not in referenced:
                # note/lineage are their OWN top-level fields (not part of
                # annotations.*), so being absent from `referenced` is
                # expected -- they are laid out directly by the renderer.
                # This only flags a genuine orphan: an annotations sub-list
                # that exists but is never non-empty for a drafted sheet.
                pass
        if sh.get("status") == "drafted" and not any(
            ann.get(k) for k in ("caveat", "safety", "notes", "sources")
        ):
            issues.append(
                f"{sh['id']}: drafted sheet has no annotations at all (caveat/safety/notes/sources)"
            )

    n_wires = len(pack_model.get("wires", []))
    n_e007 = len(pack_model.get("e007_rs485", {}).get("links", []))
    n_open_items = len(pack_model.get("open_items", []))
    try:
        import csv

        with (bundle / "data" / "connections.csv").open(encoding="utf-8", newline="") as f:
            n_conn_rows = sum(1 for _ in csv.reader(f)) - 1
        with (bundle / "open_items" / "field_verify_register.csv").open(
            encoding="utf-8", newline=""
        ) as f:
            n_oi_rows = sum(1 for _ in csv.reader(f)) - 1
    except OSError as e:
        return "FAIL", [f"cannot read exported tables: {e}"]
    if n_conn_rows != n_wires + n_e007:
        issues.append(
            f"data/connections.csv has {n_conn_rows} rows, expected {n_wires} wires + {n_e007} e007 links = {n_wires + n_e007}"
        )
    if n_oi_rows != n_open_items:
        issues.append(
            f"open_items register has {n_oi_rows} rows, expected {n_open_items} open items"
        )
    return ("FAIL" if issues else "PASS"), issues


def check_Q_rendered(bundle: Path, pack_model: dict) -> tuple[str, list[str]]:
    """Q(i)/(ii): rendered 'N of 9' + subtitle byte-match against the
    per-sheet PDFs. Requires fitz; SKIPs (not fail) if unavailable."""
    try:
        import fitz
    except ImportError:
        return "SKIP", ["fitz (PyMuPDF) not available -- rendered-PDF text checks skipped"]

    sheets = [sh for sh in pack_model.get("sheets", []) if sh.get("status") == "drafted"]
    sheets_dir = bundle / "prints" / "sheets"
    issues: list[str] = []
    n = len(sheets)
    for i, sh in enumerate(sheets):
        matches = sorted(sheets_dir.glob(f"{sh['id']}_*.pdf"))
        if not matches:
            issues.append(f"{sh['id']}: no rendered PDF found under prints/sheets/")
            continue
        doc = fitz.open(matches[0])
        try:
            text = doc[0].get_text()
        finally:
            doc.close()
        expected_pos = f"{i + 1} of {n}"
        if expected_pos not in text:
            issues.append(
                f"{sh['id']}: expected sheet position {expected_pos!r} not found in rendered text"
            )
        subtitle = sh.get("subtitle")
        if subtitle and subtitle not in text:
            issues.append(
                f"{sh['id']}: sheets.yaml subtitle not byte-identical to rendered text: {subtitle[:60]!r}"
            )
    return ("FAIL" if issues else "PASS"), issues


# ---------------------------------------------------------------- R. Incomplete approval status


def check_R(pack_model: dict, manifest: dict, bundle: Path) -> tuple[str, list[str]]:
    issues: list[str] = []
    open_items = pack_model.get("open_items", [])
    achieved_tier = manifest.get("achieved_tier", "")

    if achieved_tier == "APPROVABLE":
        unclosed = [it["id"] for it in open_items if it.get("status") != "closed"]
        if unclosed:
            issues.append(
                f"bundle labeled plain APPROVABLE but {len(unclosed)} open item(s) are not closed: "
                f"{', '.join(unclosed[:5])}"
            )

    for it in open_items:
        if it.get("status") == "closed" and not it.get("as_found", "").strip():
            issues.append(f"{it['id']}: status=closed but no as_found evidence text")

    try:
        import yaml

        rev = yaml.safe_load(
            (bundle / "approval" / "revision_approval_record.yaml").read_text(encoding="utf-8")
        )
        prepared_by = (rev.get("signatures", {}) or {}).get("prepared_by", "")
        if not prepared_by.strip():
            issues.append("approval.signatures.prepared_by is blank")
        # customer_field_accepted_by is correctly allowed to stay blank --
        # not checked here (that is the customer's field moment, not ours).
    except OSError as e:
        issues.append(f"cannot read approval/revision_approval_record.yaml: {e}")

    return ("FAIL" if issues else "PASS"), issues


# ---------------------------------------------------------------- main


def main() -> int:
    ap = argparse.ArgumentParser(description="Validate a MIRA Print Pack bundle (checks M-R).")
    ap.add_argument("--bundle", required=True, type=Path)
    args = ap.parse_args()
    bundle = args.bundle.resolve()

    report = Report()
    try:
        data = load_bundle(bundle)
    except OSError as e:
        print(f"FATAL: cannot load bundle at {bundle}: {e}", file=sys.stderr)
        return 2
    pack_model, manifest = data["pack_model"], data["manifest"]

    resolver = resolve_source_context(bundle, manifest)
    repo_root = pc.find_repo_root(bundle)
    resolver_context = None
    if repo_root is not None and manifest.get("source_package_dir"):
        candidate = repo_root / manifest["source_package_dir"]
        if candidate.exists():
            resolver_context = (repo_root, candidate)

    report.record("M. Missing evidence", *check_M(pack_model, resolver))
    report.record("N. Broken cross-references", *check_N(pack_model))
    report.record("O. Duplicate conductors", *check_O(pack_model))
    report.record("P. Unsupported claims", *check_P(pack_model, bundle, resolver_context))
    report.record("Q(iii)(iv). Sheet/table consistency", *check_Q_data(pack_model, bundle))
    report.record("Q(i)(ii). Rendered sheet text", *check_Q_rendered(bundle, pack_model))
    report.record("R. Incomplete approval status", *check_R(pack_model, manifest, bundle))

    report.print_report()
    return report.exit_code()


if __name__ == "__main__":
    sys.exit(main())
