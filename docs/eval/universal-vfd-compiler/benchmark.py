"""Full-manual benchmark: before (current extractor) vs after (universal).

Writes raw artifacts under evidence/ and a benchmark_summary.json. Offline.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

TOOL = "/Users/bravonode/Mira/.claude/worktrees/universal-vfd-compiler/tools/drive-pack-extract"
sys.path.insert(0, TOOL)

import extractor  # noqa: E402
from universal_extract import extract_manual  # noqa: E402

M = "/Users/bravonode/drive-manuals/"
MANUALS = {
    "yaskawa_ga500": "yaskawa_ga500_prog.pdf",
    "abb_acs580": "abb_acs580_fw.pdf",
    "schneider_atv320": "schneider_atv320_prog_nve41295.pdf",
    "siemens_g120x": "siemens_g120x.pdf",
    "delta_vfd_e": "delta_vfd_e.pdf",
}
EVID = "/Users/bravonode/drive-manuals/analysis/evidence"


def baseline(pdf: str) -> dict:
    """Current extractor whole-doc (the 0/0 the task starts from)."""
    t = time.time()
    try:
        faults = extractor.parse_faults(pdf)
    except Exception as e:
        faults = []
        print("  baseline faults err:", e)
    try:
        params = extractor.parse_parameters(pdf)
    except Exception as e:
        params = []
        print("  baseline params err:", e)
    return {"faults": len(faults), "parameters": len(params), "seconds": round(time.time() - t, 1)}


def main():
    only = sys.argv[1:] or list(MANUALS)
    out = {}
    for key in only:
        pdf = M + MANUALS[key]
        print(f"=== {key} ===", flush=True)
        t = time.time()
        before = baseline(pdf)
        print(f"  before: {before}", flush=True)
        res = extract_manual(pdf, evidence_dir=EVID, doc_id=key)
        cov = res.get("coverage", {})
        after = {
            "status": res["status"],
            "faults": cov.get("fault_count", 0),
            "parameters": cov.get("parameter_count", 0),
            "candidate_pages": cov.get("candidate_table_pages", 0),
            "parsed_pages": len(cov.get("parsed_pages", [])),
            "by_route": cov.get("by_route", {}),
            "rejected_records": cov.get("rejected_record_count", 0),
        }
        print(f"  after:  {after}", flush=True)
        out[key] = {"pdf": MANUALS[key], "sha256": res["document"].get("sha256", ""),
                    "before": before, "after": after,
                    "total_seconds": round(time.time() - t, 1)}
        Path("/Users/bravonode/drive-manuals/analysis/benchmark_summary.json").write_text(
            json.dumps(out, indent=2))
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
