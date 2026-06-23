"""One-command Phase 0 verification path.

Runs the deterministic interrogation against the committed SYNTHETIC fixture, writes/updates the
generated report under ``reports/``, runs the Phase 0 pytest suite, and exits NONZERO on any failure
(a failing claim, a failing test, or a parser warning). This is the gate the North Star asks for:

    python discovery_corpus/run_phase0.py        # from the worktree root
    make discovery-phase0                         # convenience wrapper

It never touches the licensed corpus -- only the committed synthetic fixture. Read-only except for
the two generated report files under ``discovery_corpus/reports/``.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

CORPUS = Path(__file__).resolve().parent           # discovery_corpus/
sys.path.insert(0, str(CORPUS / "scripts"))

import interrogate_ignition_export as iie  # noqa: E402


def main() -> int:
    fixture = iie.DEFAULT_FIXTURE
    project = iie.load(fixture)
    report = iie.interrogate(project)
    claims = iie.assess_claims(project, report)

    reports_dir = CORPUS / "reports"
    reports_dir.mkdir(exist_ok=True)
    rel = "discovery_corpus/fixtures/" + Path(fixture).name
    md = iie.render(report, claims, rel)
    (reports_dir / "phase0_synthetic.md").write_text(md + "\n", encoding="utf-8")
    (reports_dir / "phase0_synthetic.json").write_text(
        json.dumps({"source": rel, "report": report, "claims": claims}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    # Echo the report (ASCII-safe: the report carries no unit glyphs).
    print(md)
    print("\nwrote: discovery_corpus/reports/phase0_synthetic.md (+ .json)")

    failures = []
    if project.warnings:
        failures.append("parser warnings: %s" % project.warnings)
    failed_claims = [c["id"] for c in claims if not c["verdict"]]
    if failed_claims:
        failures.append("failed claims: %s" % failed_claims)

    print("\nrunning Phase 0 pytest ...")
    rc = subprocess.call([sys.executable, "-m", "pytest", str(CORPUS / "tests"), "-q"])
    if rc != 0:
        failures.append("pytest exit %d" % rc)

    if failures:
        print("\nPHASE 0: FAIL")
        for f in failures:
            print("  - %s" % f)
        return 1
    print("\nPHASE 0: OK (all claims pass, tests green, no parser warnings)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
