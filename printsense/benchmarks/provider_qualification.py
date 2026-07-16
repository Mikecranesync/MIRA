"""Permanent 3-probe provider qualification harness (capability-specific).

Probes (a provider is judged per capability, never broadly):

  P1  synthetic obvious-xref sheet — fully committed/reproducible: the sheet
      is RENDERED deterministically here (fictional identifiers only), so no
      binary fixture and no corpus content ever enters the repo.
  P2  real xref-heavy B7 production gate — runtime-only local corpus paths
      (``--index/--rubric/--candidate``); returns ``not_tested`` when absent.
  P3  complete-truth rack sheet for device inventory — runtime-only paths
      (``--photo/--truth``); returns ``not_tested`` when absent.

The harness NEVER writes ``capabilities.json`` — it prints a proposed
registry block; qualification is recorded only by the operator. Provider
transport is injected as ``call_fn(image_bytes) -> graph dict`` so the
harness stays provider-neutral and hermetically testable (no network in CI).

Verdict vocabulary: qualified | disqualified | not_tested (maps to the
registry's ``untested`` until an operator signs a probe run).
"""

from __future__ import annotations

import io
import json
from pathlib import Path

# ---------------------------------------------------------------------------
# P1 — deterministic synthetic sheet (fictional numbering: sheets 91/92/93)
# ---------------------------------------------------------------------------

SYNTH_SHEET = "91"
SYNTH_DEVICES = ["-91/K01", "-91/K02", "-91/X9"]
SYNTH_XREFS = ["92.1 / K911", "93.4 / K912", "/91.6"]
_XREF_NORM = {"92.1/K911", "93.4/K912", "/91.6"}


def render_synthetic_xref_sheet() -> bytes:
    """Render the P1 sheet deterministically (PIL default font, fixed layout)."""
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (1400, 900), "white")
    d = ImageDraw.Draw(img)
    d.rectangle([20, 20, 1380, 880], outline="black", width=3)
    d.text((60, 40), f"SHEET {SYNTH_SHEET}  (SYNTHETIC QUALIFICATION PROBE)",
           fill="black")
    y = 140
    for tag in SYNTH_DEVICES:
        d.rectangle([100, y, 320, y + 70], outline="black", width=2)
        d.text((115, y + 25), tag, fill="black")
        y += 130
    y = 140
    for ref in SYNTH_XREFS:
        d.line([320, y + 35, 1150, y + 35], fill="black", width=2)
        d.polygon([(1150, y + 25), (1180, y + 35), (1150, y + 45)], fill="black")
        d.text((1190, y + 25), ref, fill="black")
        y += 130
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def _norm(s: str) -> str:
    return "".join(str(s).upper().split())


def score_p1(graph: dict) -> dict:
    """Deterministic P1 scoring against the known synthetic truth."""
    if not isinstance(graph, dict):
        return {"schema_valid": False}
    dev = {_norm(x.get("tag") or "") for x in graph.get("devices") or []} - {""}
    truth = {_norm(t) for t in SYNTH_DEVICES}
    xr = set()
    for x in graph.get("xrefs") or []:
        v = _norm(str(x.get("raw") or x.get("sig") or ""))
        if v:
            xr.add(v)
    xr_truth = {_norm(t) for t in _XREF_NORM}
    return {
        "schema_valid": True,
        "device_recall": round(len(dev & truth) / len(truth), 3),
        "device_precision": round(len(dev & truth) / max(1, len(dev)), 3),
        "xref_hits": len(xr & xr_truth),
        "xref_emitted": len(xr),
    }


# ---------------------------------------------------------------------------
# Probe runners (call_fn-injected; runtime paths for P2/P3)
# ---------------------------------------------------------------------------


def run_probes(call_fn, index_path: str | None = None,
               rubric_path: str | None = None,
               candidate_path: str | None = None,
               rack_photo: str | None = None,
               rack_truth: str | None = None) -> dict:
    """Run all three probes; absent inputs yield explicit not_tested."""
    out: dict = {"harness_version": "provider_qualification_v1"}

    # P1 — synthetic (always runnable)
    try:
        g1 = call_fn(render_synthetic_xref_sheet())
        p1 = score_p1(g1)
    except Exception as exc:  # provider/transport failure is a P1 result
        p1 = {"schema_valid": False, "error": f"{type(exc).__name__}: {exc}"}
    out["p1_synthetic_xref"] = p1

    # P2 — real B7 gate (runtime corpus paths only)
    if index_path and rubric_path and candidate_path and \
            all(Path(x).exists() for x in (index_path, rubric_path, candidate_path)):
        import subprocess
        import sys
        r = subprocess.run(
            [sys.executable, "-m", "printsense.benchmarks.system_bench",
             "--grade", "--index", index_path, "--rubric", rubric_path,
             "--candidate", candidate_path, "--name", "qualification_p2"],
            capture_output=True)
        out["p2_b7_gate"] = {"status": "ran", "returncode": r.returncode,
                            "report": r.stdout.decode("utf-8", "replace")[-1200:]}
    else:
        out["p2_b7_gate"] = {"status": "not_tested",
                             "reason": "runtime corpus paths not supplied"}

    # P3 — complete-truth rack sheet (runtime paths only)
    if rack_photo and rack_truth and Path(rack_photo).exists() \
            and Path(rack_truth).exists():
        truth = {_norm(t) for t in
                 json.loads(Path(rack_truth).read_text(encoding="utf-8"))["device_tags"]}
        try:
            g3 = call_fn(Path(rack_photo).read_bytes())
            dev = {_norm(x.get("tag") or "") for x in g3.get("devices") or []} - {""}
            out["p3_rack_inventory"] = {
                "status": "ran",
                "device_recall": round(len(dev & truth) / max(1, len(truth)), 3),
                "device_precision": round(len(dev & truth) / max(1, len(dev)), 3)}
        except Exception as exc:
            out["p3_rack_inventory"] = {"status": "ran", "schema_valid": False,
                                        "error": f"{type(exc).__name__}: {exc}"}
    else:
        out["p3_rack_inventory"] = {"status": "not_tested",
                                    "reason": "runtime corpus paths not supplied"}
    out["proposed_capabilities"] = propose_verdicts(out)
    return out


def propose_verdicts(probes: dict) -> dict:
    """Deterministic verdict proposals — the OPERATOR signs the registry."""
    p1 = probes.get("p1_synthetic_xref", {})
    p3 = probes.get("p3_rack_inventory", {})
    v: dict = {}
    v["schema_reliability"] = ("qualified" if p1.get("schema_valid")
                               else "disqualified")
    # xref capability needs the synthetic hits AND (when run) the real gate
    if not p1.get("schema_valid") or p1.get("xref_hits", 0) < 2:
        v["cross_reference_extraction"] = "disqualified"
    elif probes.get("p2_b7_gate", {}).get("status") == "not_tested":
        v["cross_reference_extraction"] = "not_tested"
    else:
        v["cross_reference_extraction"] = (
            "qualified" if probes["p2_b7_gate"].get("returncode") == 0
            else "disqualified")
    if p3.get("status") == "ran":
        ok = (p3.get("device_recall", 0) >= 0.9
              and p3.get("device_precision", 0) >= 0.8)
        v["device_inventory"] = "qualified" if ok else "disqualified"
    else:
        v["device_inventory"] = "not_tested"
    # system reconstruction is never proposable from probes alone: it needs a
    # full-package B7 run — default conservative
    v["system_reconstruction"] = ("not_tested"
                                  if v["cross_reference_extraction"] != "disqualified"
                                  else "disqualified")
    return v
