"""`update_candidate` — given a PDF, generate a CANDIDATE pack, grade it, emit a review report. Never promote.

This is the trust-preserving coordinator. It reuses the EXISTING machinery
verbatim (it does not reimplement extraction or grading):

    1. classify the PDF against the registry (registry.classify)
    2. if UNCHANGED -> no-op (nothing to do)
    3. else -> run the manual's declared generator  (subprocess, unchanged tool)
              -> run the grading harness             (subprocess, unchanged tool)
              -> assemble a candidate review report combining the manual's
                 source identity + the grading report + a reviewer checklist
    4. write candidate_report.{json,md} next to the candidate pack

It writes ONLY into the staged ``candidates/`` tree — it can never touch the
live served ``mira-bots/shared/drive_packs/packs/`` tree (guarded). Promotion
to a trusted, deployed pack is a separate, human-gated step
(runbook-drive-manual-update-acceptance.md). A changed manual therefore always
produces a candidate, never an automatic trusted replacement.

Usage:
    python update_candidate.py --manual path/to/manual.pdf --id MANUAL_ID \
        [--out DIR] [--force] [--generated-at STR]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import registry

_TOOL_DIR = Path(__file__).resolve().parent.parent  # tools/drive-pack-extract/
_LIVE_PACKS_MARKER = ("mira-bots", "shared", "drive_packs", "packs")


# --- pure helpers (unit-tested without a real PDF or subprocess) ------------


def decide_action(state: str, *, force: bool) -> str:
    """What to do for a classified manual: 'refuse' / 'noop' / 'regenerate'.

    UNCHANGED is a no-op unless ``--force`` (deliberate re-grade). Everything
    that needs a candidate regenerates. NEW_MANUAL with no matching entry can't
    be generated (nothing declares how) -> refuse with guidance.
    """
    if state == registry.NEW_MANUAL:
        return "refuse"
    if state == registry.UNCHANGED:
        return "regenerate" if force else "noop"
    # CHANGED_BY_HASH, NEEDS_INITIAL_CANDIDATE
    return "regenerate"


def assert_not_live_packs(out_dir: Path) -> None:
    """Fail-closed guard: a candidate must NEVER be written into the live
    served packs tree. This is the structural guarantee that "update" can only
    ever stage a candidate, not silently overwrite a deployed pack."""
    parts = out_dir.resolve().parts
    for i in range(len(parts) - len(_LIVE_PACKS_MARKER) + 1):
        if tuple(parts[i : i + len(_LIVE_PACKS_MARKER)]) == _LIVE_PACKS_MARKER:
            raise RuntimeError(
                f"refusing to write a candidate into the LIVE served packs tree ({out_dir}). "
                "Candidates stage under tools/drive-pack-extract/candidates/; promotion is a "
                "separate human-gated step (runbook-drive-manual-update-acceptance.md)."
            )


def reviewer_checklist() -> list[str]:
    """The human sign-off checklist a reviewer must clear before a candidate
    may be promoted. Mirrors the trust doctrine + PR-B acceptance runbook."""
    return [
        "Trust status is 'beta' (or the residuals below are acceptable for 'internal_only').",
        "Every diagnostic-critical fault/parameter value is citation-backed (cite-integrity passed).",
        "No parameter id appears in any related_faults (domain rule passed).",
        "Gold-set scoring found no fabricated/contradicted value.",
        "Every known_residual is understood and acceptable, or newly declared.",
        "Pack diff vs. previous version reviewed — no expected fields silently dropped.",
        "For 'trusted': bench-verified live_decode present OR an explicit manual-only waiver recorded.",
        "Sign-off (name + date) recorded before promoting into the live packs/ tree.",
    ]


def pack_diff(prev_pack: dict[str, Any] | None, new_pack: dict[str, Any]) -> dict[str, Any]:
    """Shallow, deterministic diff of the two things reviewers care about:
    which fault codes and which parameter ids were added/removed."""

    def _faults(p: dict[str, Any] | None) -> set[str]:
        if not p:
            return set()
        return {str(k) for k in (p.get("live_decode", {}).get("fault_codes", {}) or {})}

    def _params(p: dict[str, Any] | None) -> set[str]:
        if not p:
            return set()
        return {
            str(x.get("parameter_id")) for x in (p.get("parameters") or []) if x.get("parameter_id")
        }

    pf, nf = _faults(prev_pack), _faults(new_pack)
    pp, np_ = _params(prev_pack), _params(new_pack)
    return {
        "faults_added": sorted(nf - pf),
        "faults_removed": sorted(pf - nf),
        "parameters_added": sorted(np_ - pp),
        "parameters_removed": sorted(pp - np_),
        "previous_available": prev_pack is not None,
    }


def assemble_candidate_report(
    *,
    entry: dict[str, Any],
    new_sha256: str,
    state: str,
    grading_report: dict[str, Any],
    diff: dict[str, Any],
) -> dict[str, Any]:
    """Combine the manual's source identity (registry) with the grading report
    (Phase-6 fields) + pack diff + reviewer checklist into ONE candidate review
    record. Never mutates inputs; carries a hard 'promoted: false'."""
    return {
        "kind": "drive_pack_update_candidate",
        "promoted": False,  # a candidate is NEVER auto-promoted
        "manual_source": {
            "manual_id": entry.get("manual_id"),
            "vendor": entry.get("vendor"),
            "product_family": entry.get("product_family"),
            "applicable_drive_models": entry.get("applicable_drive_models"),
            "manual_title": entry.get("manual_title"),
            "publication": entry.get("publication"),
            "revision": entry.get("revision"),
            "source_url": entry.get("source_url"),
            "source_classification": entry.get("source_classification"),
            "retrieved_date": entry.get("retrieved_date"),
        },
        "change_state": state,
        "pdf_sha256": new_sha256,
        "previously_registered_sha256": entry.get("pdf_sha256"),
        "extractor_commit": grading_report.get("extractor_commit"),
        "extraction_command": grading_report.get("extraction_command"),
        "schema_result": _layer_status(grading_report, "schema"),
        "cite_integrity_result": _layer_status(grading_report, "cite"),
        "domain_quality_result": _layer_status(grading_report, "domain"),
        "gold_set_result": _layer_status(grading_report, "gold"),
        "pack_diff_vs_previous": diff,
        "trust_status": grading_report.get("trust_status"),
        "trust_status_reasons": grading_report.get("trust_status_reasons", []),
        "known_residuals": grading_report.get("residuals", entry.get("known_residuals", [])),
        "reviewer_checklist": reviewer_checklist(),
    }


def _layer_status(grading_report: dict[str, Any], name_prefix: str) -> dict[str, Any] | None:
    """Pull a single grading layer's {status, summary} out of the report's
    'layers' list by name prefix (schema/cite/gold/domain)."""
    for layer in grading_report.get("layers", []):
        if str(layer.get("name", "")).lower().startswith(name_prefix):
            return {"status": layer.get("status"), "summary": layer.get("summary")}
    return None


def render_candidate_md(report: dict[str, Any]) -> str:
    ms = report["manual_source"]
    lines = [
        f"# Drive-pack update candidate — {ms.get('manual_id')}",
        "",
        "**CANDIDATE ONLY — NOT PROMOTED.** A human must review + approve this before it can replace a trusted pack.",
        "",
        "## Manual source identity",
        f"- Vendor / family: {ms.get('vendor')} / {ms.get('product_family')}",
        f"- Manual: {ms.get('manual_title')} ({ms.get('publication')}, rev {ms.get('revision')})",
        f"- Source URL: {ms.get('source_url') or '(not recorded)'}",
        f"- Source classification: {', '.join(ms.get('source_classification') or [])}",
        f"- Applicable models: {', '.join(ms.get('applicable_drive_models') or [])}",
        "",
        "## Provenance",
        f"- Change state: `{report['change_state']}`",
        f"- PDF sha256: `{report['pdf_sha256']}`",
        f"- Previously registered sha256: `{report.get('previously_registered_sha256')}`",
        f"- Extractor commit: `{report.get('extractor_commit')}`",
        f"- Extraction command: `{report.get('extraction_command')}`",
        "",
        "## Grading",
        f"- Schema: {_fmt_layer(report.get('schema_result'))}",
        f"- Cite-integrity: {_fmt_layer(report.get('cite_integrity_result'))}",
        f"- Domain quality: {_fmt_layer(report.get('domain_quality_result'))}",
        f"- Gold set: {_fmt_layer(report.get('gold_set_result'))}",
        f"- **Trust status: `{report.get('trust_status')}`**",
    ]
    for r in report.get("trust_status_reasons", []):
        lines.append(f"  - {r}")
    diff = report["pack_diff_vs_previous"]
    lines += [
        "",
        "## Pack diff vs. previous",
        f"- Faults added: {diff['faults_added'] or '—'}",
        f"- Faults removed: {diff['faults_removed'] or '—'}",
        f"- Parameters added: {diff['parameters_added'] or '—'}",
        f"- Parameters removed: {diff['parameters_removed'] or '—'}",
        "",
        "## Known residuals",
    ]
    lines += [f"- {r}" for r in report.get("known_residuals", [])] or ["- (none)"]
    lines += ["", "## Reviewer checklist (all must pass before promotion)"]
    lines += [f"- [ ] {c}" for c in report["reviewer_checklist"]]
    lines += ["", "_Promotion into the live packs/ tree is a separate, human-gated step._", ""]
    return "\n".join(lines)


def _fmt_layer(layer: dict[str, Any] | None) -> str:
    if not layer:
        return "n/a"
    return f"{layer.get('status')} — {layer.get('summary')}"


# --- subprocess orchestration (the CLI) -------------------------------------


def _run(cmd: list[str]) -> int:
    print(f"$ {' '.join(cmd)}")
    return subprocess.run(cmd, cwd=str(_TOOL_DIR), check=False).returncode


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Generate + grade a CANDIDATE drive pack from a manual. Never promotes."
    )
    parser.add_argument("--manual", required=True, type=Path, help="path to the local manual PDF")
    parser.add_argument("--id", dest="manual_id", required=True, help="registered manual_id")
    parser.add_argument(
        "--out", default=None, help="candidate parent dir (default: the entry's candidate_dir)"
    )
    parser.add_argument(
        "--force", action="store_true", help="regenerate even if the PDF is UNCHANGED"
    )
    parser.add_argument("--registry", default=None, help="override sources.json path")
    parser.add_argument(
        "--generated-at", default="unknown", help="timestamp string embedded in the report"
    )
    args = parser.parse_args(argv)

    manual: Path = args.manual.resolve()
    if not manual.is_file():
        print(f"ERROR: manual not found at {manual}", file=sys.stderr)
        return 2

    reg = registry.load_registry(args.registry)
    entry = registry.find_entry(reg, args.manual_id)
    if entry is None:
        print(
            f"ERROR: '{args.manual_id}' is not in the registry — register it first "
            "(docs/drive-commander/workflow-register-a-manual-source.md)",
            file=sys.stderr,
        )
        return 2

    if not entry.get("automatable"):
        print(
            f"REFUSED: '{args.manual_id}' is manual-review-only — no reproducible generator/gold wired. "
            f"Note: {entry.get('approval', {}).get('note', '')}",
            file=sys.stderr,
        )
        return 2

    sha256 = registry.sha256_file(manual)
    cls = registry.classify(entry, sha256)
    action = decide_action(cls.state, force=args.force)
    print(f"state={cls.state} action={action}")
    for r in cls.reasons:
        print(f"  - {r}")

    if action == "refuse":
        print("REFUSED: cannot generate — see the reasons above.", file=sys.stderr)
        return 2
    if action == "noop":
        print("UP TO DATE: PDF matches the approved hash. Nothing to do (use --force to re-grade).")
        return 0

    # --- regenerate a candidate (reuse existing generator + grader) ---------
    candidate_parent = (
        Path(args.out).resolve() if args.out else registry.resolve_tool_path(entry["candidate_dir"])
    )
    assert_not_live_packs(candidate_parent)
    pack_json = candidate_parent / entry["pack_id"] / "pack.json"

    # Snapshot the previous candidate (if any) BEFORE the generator overwrites it.
    prev_pack: dict[str, Any] | None = None
    if pack_json.is_file():
        prev_pack = json.loads(pack_json.read_text(encoding="utf-8"))

    generator = registry.resolve_tool_path(entry["generator"])
    rc = _run(
        [sys.executable, str(generator), "--manual", str(manual), "--out", str(candidate_parent)]
    )
    if rc != 0:
        print(f"ERROR: generator exited {rc}", file=sys.stderr)
        return rc

    new_pack = json.loads(pack_json.read_text(encoding="utf-8"))

    grading_out = candidate_parent / entry["pack_id"] / "grading_out"
    gold = registry.resolve_tool_path(entry["gold_path"])
    grade_cmd = [
        sys.executable,
        str(_TOOL_DIR / "grading" / "grade.py"),
        "--pack",
        entry["pack_id"],
        "--gold",
        str(gold),
        "--manual",
        str(manual),
        "--packs-dir",
        str(candidate_parent),
        "--out",
        str(grading_out),
        "--generated-at",
        args.generated_at,
    ]
    for residual in entry.get("known_residuals", []):
        grade_cmd += ["--residual", residual]
    grade_rc = _run(grade_cmd)  # 1 iff trust_status == rejected

    grading_report = json.loads((grading_out / "grading_report.json").read_text(encoding="utf-8"))
    diff = pack_diff(prev_pack, new_pack)
    report = assemble_candidate_report(
        entry=entry,
        new_sha256=sha256,
        state=cls.state,
        grading_report=grading_report,
        diff=diff,
    )

    report_dir = candidate_parent / entry["pack_id"]
    (report_dir / "candidate_report.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    (report_dir / "candidate_report.md").write_text(render_candidate_md(report), encoding="utf-8")
    print(f"\nCANDIDATE written: {report_dir / 'candidate_report.md'}")
    print(f"trust status: {report['trust_status']}  (CANDIDATE ONLY — not promoted)")
    return grade_rc


if __name__ == "__main__":
    raise SystemExit(main())
