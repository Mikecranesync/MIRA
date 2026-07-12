#!/usr/bin/env python3
"""MIRA Print Pack — deterministic build command (SPEC.md §2).

CLI:
    py -3 build_pack.py --package <dir> --intake <manifest.yaml> \
        --as-of <YYYY-MM-DD> --out <bundle_dir> [--redact]

`--as-of` is the ONLY source of "now" anywhere in this pipeline. Same inputs
+ same --as-of => byte-identical bundle (proven by CHECKSUMS.txt stability).

Ordered steps (SPEC.md §2):
  1. Gate       — validate_model.py (checks A-L); abort on failure.
  2. Render     — render_sheet.py E-001..E-009, then SET.
  3. Matrices   — emit_matrices.py.
  4. Data export — data/*.csv + pack_model.{json,yaml} from model/*.yaml.
  5. Documents  — evidence/provenance report, open-items register, worksheet,
                  revision/approval record (from model + matrices).
  6. Manifests + cover — pack_manifest.{json,yaml}, cover/status, README.md.
  7. Checksums  — CHECKSUMS.txt, computed LAST over every other bundle file.
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).parent))

import pack_common as pc
import pack_docs as docs
import redact as redact_mod

REQUESTED_TIER_LABEL = {
    "field_verification": "APPROVABLE WITH FIELD VERIFICATION",
    "approvable": "APPROVABLE",
}
TIER_RANK = {"NOT APPROVABLE": 0, "APPROVABLE WITH FIELD VERIFICATION": 1, "APPROVABLE": 2}

# The complete set of paths this build owns inside --out. --out may be the
# SAME directory that also hosts --intake (the CV-101 example bundle IS
# built into examples/cv-101/, which also holds intake_manifest.yaml) -- so
# "the bundle" is defined as exactly this owned set, never "everything under
# --out". Both cleanup (never destroy a co-located input) and CHECKSUMS.txt
# (never checksum a file the build didn't produce) key off this same list.
BUNDLE_OWNED_DIRS = ("prints", "data", "evidence", "open_items", "worksheets", "approval")
BUNDLE_OWNED_FILES = ("README.md", "pack_manifest.json", "pack_manifest.yaml", "CHECKSUMS.txt")


def _run(cmd: list[str], cwd: Path, step: str) -> None:
    print(f"--- {step}: {' '.join(cmd)} (cwd={cwd})")
    result = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True)
    if result.stdout:
        print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)
    if result.returncode != 0:
        raise SystemExit(f"FAILED at step '{step}' (exit {result.returncode}): {' '.join(cmd)}")


def _source_model_ref(package: Path) -> str:
    """Deterministic identity of the source model this pack is built from.

    A content hash of ``model/*.yaml`` (line endings normalized to LF), NOT
    ``git rev-parse HEAD``. HEAD is circular here — committing the bundle changes
    it, so a rebuilt bundle would never match the committed one — and it is
    unreliable on the shallow clones CI uses. A content hash is stable across git
    history, checkouts, and platforms: same model content => same ref.
    """
    model_dir = package / "model"
    h = hashlib.sha256()
    for f in sorted(model_dir.glob("*.yaml")):
        h.update(f.name.encode("utf-8"))
        h.update(b"\x00")
        h.update(f.read_bytes().replace(b"\r\n", b"\n"))
        h.update(b"\x00")
    return f"model-sha256:{h.hexdigest()[:16]}"


def _counts(model: dict, terminal_rows: list[dict]) -> dict:
    wires = model["wires"].get("wires", [])
    e007_links = model["e007_rs485"].get("links", [])
    open_items = model["open_items"].get("items", [])
    devices = model["devices"].get("devices", [])
    n_conductors = len(wires) + len(e007_links)
    n_conductors_fv = sum(1 for w in wires if pc.normalize_status(w) != "verified") + sum(
        1 for lk in e007_links if pc.normalize_status(lk) != "verified"
    )
    n_terminals = len(terminal_rows)
    n_terminals_fv = sum(1 for t in terminal_rows if t["status"] != "verified")
    derived_items = [pc.derive_open_item_fields(it) for it in open_items]
    return {
        "devices": len(devices),
        "conductors": n_conductors,
        "conductors_field_verify": n_conductors_fv,
        "terminals": n_terminals,
        "terminals_field_verify": n_terminals_fv,
        "open_items": len(open_items),
        "open_items_closed": sum(1 for it in derived_items if it["status"] == "closed"),
    }


def build(package: Path, intake: Path, as_of: str, out: Path, redact: bool) -> None:
    package = package.resolve()
    intake = intake.resolve()
    out = out.resolve()

    manifest = yaml.safe_load(intake.read_text(encoding="utf-8"))
    if manifest.get("build", {}).get("as_of") != as_of:
        raise SystemExit(
            f"--as-of {as_of!r} does not match intake manifest build.as_of "
            f"{manifest.get('build', {}).get('as_of')!r}"
        )
    pack_format_version = (
        (Path(__file__).parent.parent / "VERSION").read_text(encoding="utf-8").strip()
    )
    if manifest.get("pack_format_version") != pack_format_version:
        raise SystemExit(
            f"manifest pack_format_version {manifest.get('pack_format_version')!r} != "
            f"machine-print-pack/VERSION {pack_format_version!r}"
        )

    py = sys.executable

    # ---- 1. Gate ----
    _run([py, "validate_model.py"], cwd=package, step="1/7 gate (validate_model.py)")

    # ---- 2. Render ----
    for sheet_id in (
        "E-001",
        "E-002",
        "E-003",
        "E-004",
        "E-005",
        "E-006",
        "E-007",
        "E-008",
        "E-009",
    ):
        _run([py, "render_sheet.py", sheet_id], cwd=package, step=f"2/7 render {sheet_id}")
    _run([py, "render_sheet.py", "SET"], cwd=package, step="2/7 render SET")

    # ---- 3. Matrices ----
    _run([py, "emit_matrices.py"], cwd=package, step="3/7 matrices (emit_matrices.py)")

    # ---- load model + review artifacts freshly regenerated above ----
    model = pc.load_model(package)
    terminal_rows = pc.flatten_terminals(model["terminals"])
    devices = model["devices"].get("devices", [])
    wires = model["wires"].get("wires", [])
    e007_links = model["e007_rs485"].get("links", [])
    open_items = model["open_items"].get("items", [])
    sheets_meta = model["sheets"].get("sheets", [])
    asset = manifest.get("asset", {})
    tag = asset.get("tag", "")

    evidence_matrix_md = (package / "review" / "EVIDENCE_MATRIX.md").read_text(encoding="utf-8")
    crossref_matrix_md = (package / "review" / "CROSSREF_MATRIX.md").read_text(encoding="utf-8")
    grades_final_text = (package / "review" / "GRADES_FINAL.md").read_text(encoding="utf-8")
    grades = docs.parse_grades_final(grades_final_text)

    achieved_tier = pc.compute_achieved_tier(open_items, grades["verdict"])
    requested = manifest.get("build", {}).get("requested_tier", "field_verification")
    requested_label = REQUESTED_TIER_LABEL.get(requested, requested)
    if TIER_RANK.get(achieved_tier, -1) < TIER_RANK.get(requested_label, 99):
        raise SystemExit(
            f"achieved tier {achieved_tier!r} is below requested tier {requested_label!r} "
            "-- build refuses to label up"
        )

    source_ref = _source_model_ref(package)
    repo_root = pc.find_repo_root(package)
    source_package_dir = package.relative_to(repo_root).as_posix() if repo_root else str(package)

    counts = _counts(model, terminal_rows)

    # ---- bundle tree ----
    # Never rmtree(out) wholesale -- see BUNDLE_OWNED_DIRS/FILES docstring
    # above (it would destroy a co-located intake manifest). Clean only the
    # known bundle sub-artifacts this build owns.
    for sub in BUNDLE_OWNED_DIRS:
        d = out / sub
        if d.exists():
            shutil.rmtree(d)
    for fname in BUNDLE_OWNED_FILES:
        f = out / fname
        if f.exists():
            f.unlink()
    for sub in ("prints/sheets", "data", "evidence/photos", "open_items", "worksheets", "approval"):
        (out / sub).mkdir(parents=True, exist_ok=True)

    # ---- copy per-sheet PDFs/PNGs (SPEC §3a) ----
    sheet_order = [sh["id"] for sh in sheets_meta if sh.get("status") == "drafted"]
    sheet_pdf_paths: dict[str, Path] = {}
    for sheet_id in sheet_order:
        basename = docs.SHEET_BASENAMES[sheet_id]
        src_pdf = package / "sheets" / f"{basename}.pdf"
        src_png = package / "sheets" / f"{basename}.png"
        dst_pdf = out / "prints" / "sheets" / f"{basename}.pdf"
        dst_png = out / "prints" / "sheets" / f"{basename}.png"
        shutil.copyfile(src_png, dst_png)
        # Metadata-patch straight from src -> dst (never copy-then-reopen-in-
        # place -- see _patch_sheet_metadata's docstring for why).
        _patch_sheet_metadata(src_pdf, dst_pdf, sheet_id, tag, as_of, achieved_tier)
        sheet_pdf_paths[sheet_id] = dst_pdf

    # ---- evidence photos (per-item redact flag; independent of --redact) ----
    photo_basenames = redact_mod.process_evidence_photos(
        manifest.get("evidence", []) or [], package, out / "evidence" / "photos"
    )

    # ---- (a) cover page + assembled print set ----
    cover_doc = docs.build_cover_page_pdf(manifest, achieved_tier, counts, as_of)
    out_print_set = out / "prints" / f"{tag}_print_set.pdf"
    _ok, warnings = docs.assemble_print_set(
        sheet_pdf_paths, sheet_order, cover_doc, manifest, achieved_tier, as_of, out_print_set
    )
    for w in warnings:
        print(f"WARNING (degraded gracefully): {w}")

    expected_substrings = [
        sh.get("subtitle", "") for sh in sheets_meta if "·" in (sh.get("subtitle") or "")
    ]
    ok, problems = docs.verify_middot_extraction(out_print_set, expected_substrings)
    if ok:
        print(
            f"[OK] middot text-extraction guard: {len(expected_substrings)} separator string(s) verified clean"
        )
    else:
        print(
            f"WARNING (degraded gracefully): middot text-extraction guard found issues: {problems}"
        )

    # ---- (b)+(g) data export ----
    docs.build_components_csv(devices, out / "data" / "components.csv")
    docs.build_connections_csv(wires, e007_links, out / "data" / "connections.csv")
    docs.build_terminals_csv(terminal_rows, out / "data" / "terminals.csv")
    pack_model = docs.build_pack_model(model, manifest, pack_format_version, source_ref)
    pc.write_json(out / "data" / "pack_model.json", pack_model)
    pc.write_yaml(out / "data" / "pack_model.yaml", pack_model)

    # ---- (c) evidence & provenance ----
    # (citation *resolution* against real files is validate_pack.py's job --
    # check M, run as a separate step; this report only narrates citations.)
    docs.build_evidence_matrix_csv(evidence_matrix_md, out / "evidence" / "evidence_matrix.csv")
    docs.build_crossref_matrix_csv(crossref_matrix_md, out / "evidence" / "crossref_matrix.csv")
    docs.build_provenance_report_md(
        model, manifest, grades, photo_basenames, out / "evidence" / "provenance_report.md"
    )

    # ---- (d) open items register ----
    docs.build_open_items_register(
        open_items,
        out / "open_items" / "field_verify_register.csv",
        out / "open_items" / "field_verify_register.md",
    )

    # ---- (e) field verification worksheet ----
    docs.build_field_verification_worksheet_pdf(
        open_items, asset, as_of, out / "worksheets" / "field_verification_worksheet.pdf"
    )

    # ---- (f) approval record + cover status ----
    rev_record = docs.build_revision_approval_record(model, manifest, grades, achieved_tier, as_of)
    pc.write_yaml(out / "approval" / "revision_approval_record.yaml", rev_record)
    cover_status_text = docs.build_cover_status_md(manifest, achieved_tier, counts, as_of, redact)
    pc.write_text(out / "approval" / "cover_status.md", cover_status_text)

    # ---- bundle README ----
    pc.write_text(out / "README.md", docs.build_bundle_readme(manifest, achieved_tier, counts))

    # ---- manifests ----
    manifest_for_bundle = (
        redact_mod.redact_manifest_customer_fields(manifest) if redact else manifest
    )
    pack_manifest = {
        "pack_format_version": pack_format_version,
        "source_ref": source_ref,
        "source_package_dir": source_package_dir,
        "built_as_of": as_of,
        "redacted": redact,
        "asset": asset,
        "customer": manifest_for_bundle.get("customer", {}),
        "requested_tier": requested_label,
        "achieved_tier": achieved_tier,
        "counts": counts,
        "signoff": manifest.get("signoff", {}),
    }
    pc.write_json(out / "pack_manifest.json", pack_manifest)
    pc.write_yaml(out / "pack_manifest.yaml", pack_manifest)

    # ---- 7. checksums LAST ----
    _write_checksums(out)
    print(f"\n[DONE] bundle written to {out}")


def _patch_sheet_metadata(
    src_pdf: Path, dst_pdf: Path, sheet_id: str, tag: str, as_of: str, achieved_tier: str
) -> None:
    """Open the RENDERED source sheet fresh and save the metadata-patched
    copy straight to dst_pdf (never copy-then-reopen the same path with
    saveIncr() -- verified empirically that PyMuPDF's incremental save always
    mints a fresh, time/process-seeded trailer /ID on this toolchain, which
    broke same-machine determinism; a plain save(..., no_new_id=1) to a path
    the doc was never opened from does not)."""
    import fitz

    doc = fitz.open(src_pdf)
    docs.pin_pdf_metadata(
        doc,
        title=f"{tag} {sheet_id} — {docs.SHEET_TITLES.get(sheet_id, '')}",
        subject=f"MIRA Print Pack sheet — {achieved_tier}",
        as_of=as_of,
        author="FactoryLM / MIRA",
        keywords=f"{tag}, {sheet_id}, electrical",
    )
    doc.save(dst_pdf, garbage=4, deflate=True, no_new_id=1)
    doc.close()


def _write_checksums(out: Path) -> None:
    """Checksum exactly the bundle-owned set (BUNDLE_OWNED_DIRS/FILES minus
    CHECKSUMS.txt itself, which cannot checksum its own final content) --
    never out.rglob("*"), which would also pick up a co-located
    intake_manifest.yaml when --out happens to share --intake's directory
    (as the committed CV-101 example does) and make the bundle's own
    checksum file depend on something outside what the build produced."""
    paths: list[Path] = []
    for sub in BUNDLE_OWNED_DIRS:
        paths.extend(p for p in (out / sub).rglob("*") if p.is_file())
    for fname in BUNDLE_OWNED_FILES:
        if fname == "CHECKSUMS.txt":
            continue
        p = out / fname
        if p.exists():
            paths.append(p)
    lines = []
    for p in sorted(paths, key=lambda p: p.relative_to(out).as_posix()):
        rel = p.relative_to(out).as_posix()
        lines.append(f"{pc.sha256_file(p)}  {rel}")
    (out / "CHECKSUMS.txt").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def main() -> None:
    ap = argparse.ArgumentParser(description="Build a deterministic MIRA Print Pack bundle.")
    ap.add_argument("--package", required=True, type=Path)
    ap.add_argument("--intake", required=True, type=Path)
    ap.add_argument("--as-of", required=True, dest="as_of")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--redact", action="store_true")
    args = ap.parse_args()
    build(args.package, args.intake, args.as_of, args.out, args.redact)


if __name__ == "__main__":
    main()
