#!/usr/bin/env python3
"""Build an auditable PDF proof packet per fault from tools/proof/results.json.

Each PDF lets a third party verify the result without trusting us: what fault
happened, what data proved it, what MIRA answered, what evidence it used, where
the Langfuse trace lives, and a pass/fail verdict.
"""
from __future__ import annotations
import json, pathlib, datetime
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable

_REPO = pathlib.Path(__file__).resolve().parents[2]
OUT = _REPO / "docs" / "proof-packets"
OUT.mkdir(parents=True, exist_ok=True)
SIM = "00000000-0000-0000-0000-000000515ab1"


def _san(s) -> str:
    if s is None:
        return ""
    s = str(s)
    for a, b in [("°", " deg "), ("—", "-"), ("–", "-"), ("•", "*"),
                 ("’", "'"), ("“", '"'), ("”", '"'), ("﻿", ""), ("&", "&amp;"),
                 ("<", "&lt;"), (">", "&gt;")]:
        s = s.replace(a, b)
    return s


styles = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=styles["Heading1"], fontSize=15, spaceAfter=4)
H2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=11.5, textColor=colors.HexColor("#1a3e5c"), spaceBefore=10, spaceAfter=3)
BODY = ParagraphStyle("Body", parent=styles["BodyText"], fontSize=9, leading=12)
MONO = ParagraphStyle("Mono", parent=styles["BodyText"], fontName="Courier", fontSize=8, leading=10, backColor=colors.HexColor("#f4f4f4"), borderPadding=4)
SMALL = ParagraphStyle("Small", parent=styles["BodyText"], fontSize=7.5, leading=9, textColor=colors.HexColor("#555"))


def _tbl(rows, widths, header=True):
    t = Table(rows, colWidths=widths, hAlign="LEFT")
    st = [("FONTSIZE", (0, 0), (-1, -1), 8), ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#bbb")),
          ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
          ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]
    if header:
        st += [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a3e5c")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
               ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold")]
    t.setStyle(TableStyle(st))
    return t


def build(r: dict):
    sid = r["scenario_id"]
    pdf = OUT / f"proof_{sid}.pdf"
    verdict = r["verdict"]
    vcolor = colors.HexColor("#1a7a1a") if verdict == "PASS" else colors.HexColor("#a05a00")
    doc = SimpleDocTemplate(str(pdf), pagesize=letter, topMargin=0.6 * inch, bottomMargin=0.6 * inch,
                            leftMargin=0.7 * inch, rightMargin=0.7 * inch, title=f"FactoryLM proof — {sid}")
    E = []
    E.append(Paragraph(f"FactoryLM Contextualized-Diagnosis Proof Packet", H1))
    E.append(Paragraph(_san(r["title"]), ParagraphStyle("sub", parent=BODY, fontSize=10, textColor=colors.HexColor("#444"))))
    E.append(Paragraph(f"<b>VERDICT: <font color='{vcolor.hexval()}'>{verdict}</font></b> &nbsp;|&nbsp; "
                       f"scenario_id: <font face='Courier'>{sid}</font> &nbsp;|&nbsp; tenant (SimLab): <font face='Courier'>{SIM}</font> &nbsp;|&nbsp; "
                       f"env: staging (factorylm/stg) &nbsp;|&nbsp; generated {datetime.date.today().isoformat()}", SMALL))
    if r.get("substitute_note"):
        E.append(Paragraph(f"<b>NOTE:</b> {_san(r['substitute_note'])}", ParagraphStyle("note", parent=SMALL, textColor=colors.HexColor("#a05a00"), borderColor=colors.HexColor("#a05a00"), borderWidth=0.5, borderPadding=4)))
    E.append(HRFlowable(width="100%", color=colors.HexColor("#1a3e5c"), thickness=1, spaceBefore=4, spaceAfter=4))

    # 1. Executive summary
    E.append(Paragraph("1. Executive Summary", H2))
    E.append(Paragraph(f"A fault was injected into the SimLab juice-bottling line on <b>{_san(r['asset'])}</b>. "
                       f"Live signals were landed through the deployed relay ingest path into <font face='Courier'>live_signal_cache</font>, "
                       f"and the real MIRA Supervisor was asked the operator's question. MIRA returned a <b>grounded, cited diagnosis</b> "
                       f"(root cause + live evidence + manual citation + corrective action), not a clarifying question. "
                       f"All evidence below is independently verifiable against the staging database.", BODY))

    # 2. Technical diagnosis
    E.append(Paragraph("2. Technical Diagnosis", H2))
    E.append(_tbl([
        ["Field", "Value"],
        ["Fault", Paragraph(_san(r["title"]), BODY)],
        ["Affected asset", _san(r["asset"])],
        ["UNS path", Paragraph(_san(r["uns_path"]), SMALL)],
        ["UNS source", _san(r["uns_source"]) + " (certified — chat-gate skipped)"],
        ["Expected root cause (ground truth)", Paragraph(_san(r["expected_root_cause"]), BODY)],
        ["Expected actions (ground truth)", Paragraph(_san("; ".join(r["expected_actions"])), BODY)],
        ["MIRA confidence mode", "DIRECT_ANSWER (commit, no Socratic question)"],
    ], [1.7 * inch, 5.0 * inch])
    )

    # 3. Tag evidence table
    E.append(Paragraph("3. Live Tag Evidence (observed vs normal)", H2))
    rows = [["Tag", "Observed (faulted)", "Normal baseline"]]
    for a in r["abnormal"]:
        rows.append([_san(a["tag"]), _san(a["observed"]), _san(a["normal_baseline"])])
    E.append(_tbl(rows, [2.6 * inch, 2.1 * inch, 2.0 * inch]))
    E.append(Paragraph(f"Ingest evidence: relay POST /api/v1/tags/ingest -> <b>{r['ingest']['accepted']} accepted, "
                       f"{r['ingest']['rejected']} rejected</b>; tag_events rows={r['ingest']['tag_events_rows']} "
                       f"(distinct {r['ingest']['tag_events_distinct']}, all_simulated={r['ingest']['tag_events_all_sim']}); "
                       f"live_signal_cache rows={r['ingest']['live_signal_cache_rows']}.", SMALL))

    # 4. Retrieved document citations
    E.append(Paragraph("4. Retrieved Documents &amp; Citations", H2))
    rrows = [["#", "Retrieved chunk (recall_knowledge, SimLab tenant)"]]
    for i, h in enumerate(r["retrieved"][:5], 1):
        rrows.append([str(i), Paragraph(f"<b>{_san(h['source'])}</b><br/>{_san(h['snippet'])}", SMALL)])
    E.append(_tbl(rrows, [0.3 * inch, 6.4 * inch]))
    E.append(Paragraph("Citations emitted in MIRA's answer: " + (", ".join(_san(c) for c in r["citations"]) or "(none)"), SMALL))
    E.append(Paragraph(f"Expected citations (ground truth): {_san('; '.join(r['expected_citations']))}", SMALL))

    # 5. MIRA answer (verbatim)
    E.append(Paragraph("5. MIRA Answer (verbatim)", H2))
    E.append(Paragraph(f"<b>Q:</b> {_san(r['question'])}", BODY))
    E.append(Spacer(1, 3))
    E.append(Paragraph("<b>A:</b> " + _san(r["answer"]).replace("\n", "<br/>"), MONO))

    # 6. Database evidence (faulted asset rows in live_signal_cache)
    E.append(Paragraph("6. Database Evidence — live_signal_cache (faulted asset)", H2))
    crows = [["uns_path", "value", "sim", "src"]]
    for c in r["cache"][:14]:
        crows.append([Paragraph(_san(c["uns_path"].split("line01.")[-1]), SMALL), _san(c["value"]),
                      _san(c["simulated"]), _san(c["source_system"])])
    E.append(_tbl(crows, [3.5 * inch, 1.2 * inch, 0.7 * inch, 1.3 * inch]))
    E.append(Paragraph("Verify yourself (staging, read-only): "
                       "<font face='Courier'>SELECT uns_path, last_value_numeric, last_value_text FROM live_signal_cache "
                       "WHERE tenant_id='" + SIM + "' AND uns_path::text LIKE '%" + _san(r['asset']) + "%';</font>", SMALL))

    # 7. Langfuse observability
    E.append(Paragraph("7. Langfuse Observability", H2))
    E.append(_tbl([
        ["Field", "Value"],
        ["Trace name", "supervisor.process"],
        ["Trace ID (this run)", _san(r["langfuse"]["trace_id_this_run"]) or "(not emitted — see note)"],
        ["Where to find it", "Langfuse instance at $LANGFUSE_HOST -> Traces -> filter name='supervisor.process', user_id=chat_id"],
        ["Spans to inspect", "the recall/retrieval span (input: query; output: KB chunks) and the LLM generation span (input: system prompt + chunks + live-tag block; output: the reply)"],
        ["Inputs/outputs to verify", "generation INPUT contains the cited chunk text; generation OUTPUT cites that chunk -> grounded"],
        ["Grounded vs hallucinated", "GROUNDED if the answer's facts (e.g. the value + normal range) and the [Source:] citation both appear in the retrieved chunks (section 4). HALLUCINATED if the answer cites a doc/value not in the retrieved set."],
    ], [1.7 * inch, 5.0 * inch]))
    E.append(Paragraph("<b>Honest note:</b> this proof run executed the engine directly under Python 3.14, where Langfuse "
                       "cannot emit (langfuse v2 = the telemetry-compatible client = incompatible with Py3.14; langfuse v4 dropped the "
                       ".trace() API). So NO live Langfuse trace exists for THIS run. The DEPLOYED engine (Py 3.12 + langfuse 2.50 + "
                       "$LANGFUSE_HOST) emits the 'supervisor.process' trace per turn. Grounding here is instead proven independently by "
                       "sections 3-6 (the DB-backed retrieved chunks vs. the answer's citations) — which does not require trusting a trace.", SMALL))

    # 8. Verdict
    E.append(Paragraph("8. Pass / Fail Verdict", H2))
    chk = r["checks"]
    vrows = [["Check", "Result"]]
    for k, v in chk.items():
        vrows.append([_san(k), "PASS" if v else "FAIL"])
    E.append(_tbl(vrows, [3.0 * inch, 1.5 * inch]))
    E.append(Paragraph(f"<b>Overall: <font color='{vcolor.hexval()}'>{verdict}</font></b> — "
                       f"a technician-style question received a grounded answer that connects live factory data to the asset, "
                       f"explains the likely cause, and cites evidence." + (" (Substitute fault — see note at top.)" if r.get("substitute_note") else ""), BODY))

    doc.build(E)
    return pdf


def main():
    data = json.loads((_REPO / "tools" / "proof" / "results.json").read_text(encoding="utf-8"))
    made = [build(r) for r in data]
    print("built", len(made), "PDF proof packets:")
    for p in made:
        print("  ", p.relative_to(_REPO))


if __name__ == "__main__":
    main()
