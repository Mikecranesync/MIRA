"""Build the frozen (answer, cited-evidence) corpus for the evidence-verification runoff.

Zero tokens: every answer was produced earlier by staging walks / test turns. Evidence is the text of the
page(s) each answer cites:
  * public-50 walks -> the hashed public PDF, `pdftotext` on the cited 1-based physical page
    (the walk tenants were torn down, so their chunks no longer exist);
  * PLC-5 turns, real-36 Lane A, Schneider replay -> the exact chunk text the Hub stored for that document
    (exported read-only from staging Neon to .planning/evidence-runoff-data/stg_chunks.json).

Outputs (local, gitignored, because they contain manual text):
  .planning/evidence-runoff-data/corpus.jsonl
and the committed manifest of every input hash: tools/evidence-runoff/data/manifest.json
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ROOT = Path("/Users/charlienode/MIRA/.planning")  # durable, gitignored inputs (shared checkout)
P0 = ROOT / "retrieval-phase0"
DATA = ROOT / "evidence-runoff-data"
OUT = DATA / "corpus.jsonl"
MANIFEST = REPO / "tools/evidence-runoff/data/manifest.json"

WALKS = {
    # walk dir -> retrieval configuration (meta.gitSha is read from scored.json and checked)
    "w1": "lexical",
    "w2": "lexical",
    "w3": "lexical",
    "w4": "lexical",
    "w5": "lexical",
    "p1": "hybrid",
    "rr1-1": "lexical+rerank_fp32",
    "rr1-2": "lexical+rerank_fp32",
    "rr1-3": "lexical+rerank_fp32",
    "int8-1": "lexical+rerank_int8",
    "int8-2": "lexical+rerank_int8",
    "int8-3": "lexical+rerank_int8",
}

PLC5_DOC = "47329062-983d-41b8-82f5-6795a16405f1"
# Cited pages of the PLC-5 notebook turns. Turns do not persist cited pages (finding: neither
# equipment_notebook_turns nor decision_traces nor the Langfuse trace records them), so these come from the
# SSE `sources` frames captured live in this session's probe runs; TQ-05 turns whose sources were not captured
# are excluded rather than guessed.
PLC5_CITES = {
    "2026-10-18T21:06:34": [234],
    "2026-10-20T02:34:23": [240, 242],
    "2026-10-20T02:36:05": [238],
    "2026-10-20T05:45:35": [240, 242],
    "2026-10-20T05:46:12": [238, 240],
    "2026-10-20T05:46:22": [],
    "2026-10-20T06:54:13": [],
    "2026-10-20T05:45:45": [],
    "2026-10-20T06:54:23": [],
}


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def split_of(qid: str) -> str:
    return "dev" if int(hashlib.sha256(qid.encode()).hexdigest(), 16) % 10 < 3 else "heldout"


_page_cache: dict[tuple[str, int], str] = {}


def pdf_page(pdf: Path, page: int) -> str:
    key = (str(pdf), page)
    if key not in _page_cache:
        r = subprocess.run(
            ["pdftotext", "-q", "-f", str(page), "-l", str(page), str(pdf), "-"],
            capture_output=True,
            text=True,
            check=False,
        )
        _page_cache[key] = r.stdout
    return _page_cache[key]


def main() -> int:
    manifest: dict[str, str] = {}
    items: list[dict] = []

    # ---- public-50 walks ---------------------------------------------------------------------------
    pub = json.loads((DATA / "public-50.json").read_text())
    manifest["public-50.json"] = sha256(DATA / "public-50.json")
    manuals = {m["id"]: m for m in pub["manuals"]}
    pdf_by_sha = {sha256(p): p for p in (P0 / "manuals").glob("*.pdf")}
    qs = {q["id"]: q for m in pub["manuals"] for q in m.get("questions", [])} or {
        q["id"]: q for q in pub.get("questions", [])
    }
    if not qs:
        qs = {q["id"]: q for q in _collect_questions(pub)}
    for walk, config in WALKS.items():
        wdir = P0 / "walks" / walk
        obs = json.loads((wdir / "observations.json").read_text())
        meta = json.loads((wdir / "scored.json").read_text())["meta"]
        manifest[f"walks/{walk}/observations.json"] = sha256(wdir / "observations.json")
        for o in obs:
            q = qs[o["id"]]
            m = manuals[q["manual"]]
            pdf = pdf_by_sha.get(m["sha256"])
            if pdf is None:
                raise SystemExit(f"missing PDF for {m['id']} sha {m['sha256']}")
            rendered = o.get("rendered") or {}
            pages = sorted(
                {
                    int(c["page"])
                    for c in rendered.get("citations", [])
                    if str(c.get("page", "")).isdigit()
                }
            )
            items.append(
                {
                    "item_id": f"{walk}:{o['id']}",
                    "source": "public-walk",
                    "walk": walk,
                    "config": config,
                    "git_sha": meta["gitSha"],
                    "question_id": o["id"],
                    "question": q["question"],
                    "manual": m["id"],
                    "manual_sha256": m["sha256"],
                    "status": o.get("streamStatus"),
                    "answer": rendered.get("answer") or "",
                    "cited_pages": pages,
                    "evidence": [{"page": p, "text": pdf_page(pdf, p)} for p in pages],
                    "evidence_kind": "pdftotext_page",
                    "split": split_of(o["id"])
                    if walk == "w1"
                    else ("heldout" if split_of(o["id"]) == "heldout" else "heldout_devq"),
                }
            )

    # ---- staging chunk store (PLC-5, real-36, Schneider) -------------------------------------------
    chunks = json.loads((DATA / "stg_chunks.json").read_text())
    manifest["stg_chunks.json"] = sha256(DATA / "stg_chunks.json")
    by_doc: dict[str, list[dict]] = {}
    for c in chunks:
        by_doc.setdefault(c["doc_id"], []).append(c)

    def chunk_pages(doc: str, pages: list[int]) -> list[dict]:
        out = []
        for p in pages:
            texts = [
                c["content"]
                for c in by_doc.get(doc, [])
                if c["page_start"] <= p <= (c["page_end"] or c["page_start"])
            ]
            out.append({"page": p, "text": "\n".join(texts)})
        return out

    turns = json.loads((DATA / "laneb_turns.json").read_text())
    manifest["laneb_turns.json"] = sha256(DATA / "laneb_turns.json")
    for t in turns:
        ts = t["created_at"][:19]
        if ts not in PLC5_CITES:
            continue  # TQ-05 turns whose sources were not captured
        qid = "tq-28" if "DLEN" in t["question"] else "tq-27"
        pages = PLC5_CITES[ts]
        items.append(
            {
                "item_id": f"plc5:{ts}",
                "source": "plc5-turn",
                "walk": None,
                "config": "mixed",
                "git_sha": None,
                "question_id": qid,
                "question": t["question"],
                "manual": "plc5-rm001",
                "manual_sha256": None,
                "status": t["status"],
                "answer": t["answer"] or "",
                "cited_pages": pages,
                "evidence": chunk_pages(PLC5_DOC, pages),
                "evidence_kind": "stored_chunks",
                "split": "dev",
            }
        )

    st = json.loads((DATA / "tq_replay_state.json").read_text())
    manifest["tq_replay_state.json"] = sha256(DATA / "tq_replay_state.json")
    ids = {
        x["question"]: x["id"]
        for x in json.loads((P0 / "manuals-real/tq-with-ids.json").read_text())
    }
    real = {q["id"]: q for q in json.loads((DATA / "real-36.json").read_text())["questions"]}
    manifest["real-36.json"] = sha256(DATA / "real-36.json")
    for qtext, res in st["results"].items():
        qid = ids.get(qtext)
        if qid not in real:
            continue
        doc = st["notebooks"][res["group"]]["docId"]
        pages = sorted(
            {int(c["page"]) for c in res.get("cites") or [] if c.get("page") is not None}
        )
        items.append(
            {
                "item_id": f"realA:{qid}",
                "source": "real-laneA",
                "walk": None,
                "config": "lexical",
                "git_sha": "eaa4de988",
                "question_id": qid,
                "question": qtext,
                "manual": real[qid]["manual"],
                "manual_sha256": None,
                "status": res.get("answer_status"),
                "answer": res.get("text") or "",
                "cited_pages": pages,
                "evidence": chunk_pages(doc, pages),
                "evidence_kind": "stored_chunks",
                "split": "dev" if qid in ("tq-27", "tq-28") else "heldout",
            }
        )

    se = json.loads((DATA / "se_replay_hybrid.json").read_text())
    manifest["se_replay_hybrid.json"] = sha256(DATA / "se_replay_hybrid.json")
    for i, (qtext, res) in enumerate(se.items()):
        doc = st["notebooks"][res["group"]]["docId"]
        pages = sorted(
            {int(c["page"]) for c in res.get("cites") or [] if c.get("page") is not None}
        )
        qid = ids.get(qtext) or f"se-{i}"
        items.append(
            {
                "item_id": f"seH:{qid}",
                "source": "schneider-hybrid",
                "walk": None,
                "config": "hybrid",
                "git_sha": None,
                "question_id": qid,
                "question": qtext,
                "manual": res["group"],
                "manual_sha256": None,
                "status": res.get("status"),
                "answer": res.get("text") or "",
                "cited_pages": pages,
                "evidence": chunk_pages(doc, pages),
                "evidence_kind": "stored_chunks",
                "split": "heldout",
            }
        )

    for p in sorted((P0 / "manuals").glob("*.pdf")):
        manifest[f"manuals/{p.name}"] = sha256(p)

    OUT.write_text("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in items))
    manifest["corpus.jsonl"] = sha256(OUT)
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=1, sort_keys=True) + "\n")
    by_src: dict[str, int] = {}
    for x in items:
        by_src[x["source"]] = by_src.get(x["source"], 0) + 1
    print(
        json.dumps(
            {"items": len(items), "by_source": by_src, "corpus_sha256": manifest["corpus.jsonl"]}
        )
    )
    return 0


def _collect_questions(pub: dict) -> list[dict]:
    return [q for q in pub.get("questions", [])]


if __name__ == "__main__":
    sys.exit(main())
