"""Customer-facing technician report (commercial PR-1).

Renders the degraded-mode evidence contracts into a plain-English, cited
report a technician can act on. Deterministic by construction: identical
inputs produce byte-identical markdown. Optional model assistance is
accepted ONLY through an injected ``explain_fn`` and ONLY when the provider
registry qualifies it (``schema_reliability``); absent that, the explanation
is a deterministic template. Reconstruction is never implied while the
capability stays unqualified — the gate state is shown verbatim.
"""

from __future__ import annotations

import json

from .modes import SCOUT_BANNER, full_reconstruction_entry

POSITIONING = ("PrintSense turns existing electrical prints into searchable, "
               "cited troubleshooting knowledge. It does not replace "
               "engineering review or claim complete reconstruction.")
CTA = "Analyze my complete machine package"
SAFETY_NOTE = ("Safety: a drawing or photo never proves energization, "
               "isolation, or contact state. Verify physically per your "
               "site procedure before touching anything.")

REPORT_VERSION = "customer_report_v1"


def _dev_rows(payloads: dict) -> list[dict]:
    rows = []
    for sha, pay in sorted(payloads.items()):
        for d in pay.get("devices", []):
            if d.get("tag"):
                rows.append({"tag": d["tag"], "page_sha": sha,
                             "bbox": d.get("bbox")})
    return sorted(rows, key=lambda r: (r["tag"], r["page_sha"]))


def _xref_rows(records: list[dict]) -> dict:
    out = {"proven": [], "cables": [], "open": []}
    for r in sorted(records, key=lambda r: (str(r.get("source_page")),
                                            r.get("raw_reference", ""))):
        row = {"raw": r.get("raw_reference"),
               "from_page": r.get("source_page"),
               "to_page": r.get("target_page"),
               "evidence_bbox": r.get("evidence_bbox"),
               "confidence": r.get("confidence"),
               "status": r.get("resolution")}
        if r.get("resolution") == "resolved":
            (out["cables"] if r.get("pattern_class") == "CABLE_CONT"
             else out["proven"]).append(row)
        elif r.get("pattern_class") == "CABLE_CONT":
            out["cables"].append(row)
        elif r.get("resolution") in ("ambiguous", "missing_target",
                                     "contradictory"):
            out["open"].append(row)
    return out


def _deterministic_explanation(purpose: str | None, devices: list[dict],
                               xrefs: dict) -> str:
    n_dev, n_ref = len(devices), len(xrefs["proven"])
    head = (f"This page appears to be a {purpose}. " if purpose
            else "Page purpose could not be classified from this capture. ")
    body = (f"We identified {n_dev} labeled device(s) and proved "
            f"{n_ref} cross-page reference(s) from the visible text and "
            f"geometry alone. Devices connect across sheets where the "
            f"proven references indicate; anything not listed as proven "
            f"was NOT assumed.")
    return head + body


def build_customer_report(question: str, payloads: dict,
                          xref_records: list[dict],
                          purposes: dict | None = None,
                          explain_fn=None, registry: dict | None = None) -> dict:
    """Assemble the report object (see render_markdown for the document)."""
    from .providers import CapabilityUnavailable, select_provider

    devices = _dev_rows(payloads)
    xrefs = _xref_rows(xref_records)
    purpose = None
    if purposes:
        vals = [v for v in purposes.values() if v]
        purpose = vals[0] if vals else None

    explanation = _deterministic_explanation(purpose, devices, xrefs)
    explanation_source = "deterministic"
    if explain_fn is not None:
        try:
            select_provider("schema_reliability", registry=registry)
            explanation = explain_fn(devices, xrefs) or explanation
            explanation_source = "qualified_model_assist"
        except CapabilityUnavailable:
            explanation_source = "deterministic (no qualified provider)"

    gate = full_reconstruction_entry(registry=registry)
    unavailable = []
    if gate["state"] != "available":
        unavailable.append({
            "capability": "full system reconstruction",
            "state": gate["state"],
            "note": "Not performed and not implied. Available as a managed "
                    "package pilot with human review."})

    return {"report_version": REPORT_VERSION,
            "positioning": POSITIONING,
            "banner": SCOUT_BANNER,
            "question": question,
            "probable_page_purpose": purpose,
            "devices": devices,
            "proven_cross_references": xrefs["proven"],
            "cable_continuations": xrefs["cables"],
            "unresolved_or_contradictory": xrefs["open"],
            "circuit_explanation": explanation,
            "explanation_source": explanation_source,
            "safety_note": SAFETY_NOTE,
            "uncertainty_note": (
                "Items under 'unresolved or contradictory' need the "
                "complete package or a human confirmation to settle."),
            "unavailable_capabilities": unavailable,
            "call_to_action": CTA}


def render_markdown(report: dict) -> str:
    r = report
    L = [f"# PrintSense report — {r['question']}",
         "", f"> {r['positioning']}", "", f"**{r['banner']}**", ""]
    L += [f"**Probable page purpose:** {r['probable_page_purpose'] or 'not classified (see uncertainty)'}", ""]
    L += ["## Devices found", ""]
    if r["devices"]:
        L += ["| Tag | Page | Evidence bbox |", "|---|---|---|"]
        L += [f"| `{d['tag']}` | {d['page_sha'][:12]} | {d['bbox']} |"
              for d in r["devices"]]
    else:
        L += ["_No device labels were readable on this capture._"]
    L += ["", "## Proven cross-references", ""]
    if r["proven_cross_references"]:
        L += ["| Reference | From page | To page | Confidence | Evidence bbox |",
              "|---|---|---|---|---|"]
        L += [f"| `{x['raw']}` | {x['from_page']} | {x['to_page']} | "
              f"{x['confidence']} | {x['evidence_bbox']} |"
              for x in r["proven_cross_references"]]
    else:
        L += ["_None proven on this capture._"]
    if r["cable_continuations"]:
        L += ["", "**Cable continuations:** "
              + ", ".join(f"`{c['raw']}`" for c in r["cable_continuations"])]
    L += ["", "## What this means", "", r["circuit_explanation"],
          "", f"_Explanation source: {r['explanation_source']}_", ""]
    L += ["## Safety & uncertainty", "", r["safety_note"], "",
          r["uncertainty_note"], ""]
    if r["unresolved_or_contradictory"]:
        L += ["## Unresolved / contradictory references", ""]
        L += [f"- `{x['raw']}` — {x['status']}"
              for x in r["unresolved_or_contradictory"]]
        L += [""]
    L += ["## Not performed on this request", ""]
    L += [f"- {u['capability']}: `{u['state']}` — {u['note']}"
          for u in r["unavailable_capabilities"]] or ["- (none)"]
    L += ["", "---", "", f"### ➜ {r['call_to_action']}",
          "", "Reply to this report or use the request link to have the "
              "complete print package analyzed as a managed pilot "
              "(human-reviewed, cited, confidential).", ""]
    return "\n".join(L)


def stable_report_json(report: dict) -> str:
    return json.dumps(report, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False)
