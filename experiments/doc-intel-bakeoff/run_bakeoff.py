"""Phase 1.5 bake-off runner.

Lanes (each produces QResult JSONL rows in out/results.jsonl):

  RETRIEVAL lanes (held-constant FTS5; measure the REPRESENTATION):
    pymupdf          plain per-page text through the #3185-shaped chunker
    pymupdf-tables   + pymupdf find_tables() row-context chunks
    docling          Docling IR, tables flattened inline
    docling-tables   Docling IR, tables as row-context chunks
    (factorylm baseline rows come from the mira-hub vitest runner, same schema)

  ANSWER lanes (end-to-end; measure the SYSTEM):
    gemini           native-PDF document QA (whole manual attached)
    textqa           docling-tables retrieval top-6 → Groq/Cerebras gpt-oss-120b

Usage (from experiments/doc-intel-bakeoff):
  py run_bakeoff.py --lane pymupdf,pymupdf-tables --run-id r1
  py run_bakeoff.py --lane docling,docling-tables --run-id r1     # needs out/ir/*.docling.json
  doppler run -p factorylm -c dev -- py run_bakeoff.py --lane gemini --run-id r1
  doppler run -p factorylm -c dev -- py run_bakeoff.py --lane textqa --run-id r1

IRs are built once by the parse adapters into out/ir/ (see README).
Repeatability: --repeat-id <question_id> asks that question twice in answer
lanes and records both rows (rep=1/2 in versions).
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).parent))

from common import Fts5Index, QResult, index_expdoc, now_ts, score, write_results
from ir import ExpDoc, sha256_file

ROOT = Path(__file__).parent
OUT = ROOT / "out"


def load_questions() -> tuple[dict, list[dict]]:
    data = yaml.safe_load((ROOT / "questions.yaml").read_text(encoding="utf-8"))
    return data["docs"], data["questions"]


def doc_sha(docs: dict, doc_id: str) -> str:
    meta = docs[doc_id]
    if meta.get("sha256"):
        return meta["sha256"]
    return sha256_file(ROOT / meta["file"])


# ── Retrieval lanes ──────────────────────────────────────────────────────────

RETRIEVAL_LANES = {
    # lane → (ir suffix, table_aware)
    "pymupdf": ("pymupdf", False),
    "pymupdf-tables": ("pymupdf-tables", True),
    "docling": ("docling", False),
    "docling-tables": ("docling", True),
    "docling-scanned": ("docling-ocr", True),   # OCR IR for the scanned fixture
}


def run_retrieval_lane(lane: str, run_id: str, docs: dict, questions: list[dict]) -> list[QResult]:
    suffix, table_aware = RETRIEVAL_LANES[lane]
    index = Fts5Index()
    versions: dict = {"retrieval": "sqlite-fts5-bm25", "chunker": "node-ingest-port-1000/120"}
    loaded: set[str] = set()
    for doc_id in {q["doc"] for q in questions}:
        ir_path = OUT / "ir" / f"{docs[doc_id]['file'].split('/')[-1].removesuffix('.pdf')}.{suffix}.json"
        if not ir_path.exists():
            continue
        exp = ExpDoc.load(ir_path)
        exp.doc_id = doc_id  # IRs carry the file stem; questions use the doc key
        versions[f"parser:{doc_id}"] = f"{exp.parser} {exp.parser_version}"
        index.add(index_expdoc(exp, table_aware=table_aware))
        loaded.add(doc_id)

    results: list[QResult] = []
    for q in questions:
        r = QResult(
            run_id=run_id,
            adapter=lane,
            adapter_kind="retrieval",
            backend="fts5",
            versions=versions,
            doc_id=q["doc"],
            doc_sha256=doc_sha(docs, q["doc"]),
            question_id=q["id"],
            question_class=q["class"],
            question=q["q"],
            expected={k: q.get(k) for k in ("expect_all", "expect_any", "expect_page", "abstain")},
            ts=now_ts(),
        )
        if q["doc"] not in loaded:
            r.error = f"no IR for doc '{q['doc']}' in lane {lane}"
            results.append(r)
            continue
        t0 = time.monotonic()
        hits = index.query(q["doc"], q["q"], k=6)
        r.latency_s = round(time.monotonic() - t0, 4)
        r.evidence = [
            {"doc_id": h.doc_id, "page": h.page, "kind": h.kind, "snippet": h.text[:600]}
            for h in hits
        ]
        r.abstained = len(hits) == 0
        score(r, q)
        results.append(r)
    return results


# ── Answer lanes ─────────────────────────────────────────────────────────────

def run_gemini_lane(run_id: str, docs: dict, questions: list[dict], repeat_id: str | None) -> list[QResult]:
    import httpx

    from adapters.native_gemini import ask, est_cost, pick_model, upload_pdf

    results: list[QResult] = []
    with httpx.Client() as client:
        model = pick_model(client)
        uris: dict[str, str] = {}
        for doc_id in sorted({q["doc"] for q in questions}):
            path = ROOT / docs[doc_id]["file"]
            uris[doc_id] = upload_pdf(client, str(path))
        for q in questions:
            reps = 2 if repeat_id and q["id"] == repeat_id else 1
            for rep in range(1, reps + 1):
                r = QResult(
                    run_id=run_id,
                    adapter="gemini-native",
                    adapter_kind="answer",
                    backend=model,
                    versions={"api": "v1beta files+generateContent", "rep": rep},
                    doc_id=q["doc"],
                    doc_sha256=doc_sha(docs, q["doc"]),
                    question_id=q["id"],
                    question_class=q["class"],
                    question=q["q"],
                    expected={k: q.get(k) for k in ("expect_all", "expect_any", "expect_page", "abstain")},
                    ts=now_ts(),
                )
                try:
                    parsed, usage, latency = ask(client, model, q["q"], file_uri=uris[q["doc"]])
                    r.answer_text = str(parsed.get("answer", ""))
                    r.cited_pages = [int(p) for p in parsed.get("pages", []) if str(p).isdigit()]
                    r.abstained = bool(parsed.get("abstain"))
                    r.latency_s = round(latency, 2)
                    r.tokens = usage
                    r.cost_usd = round(est_cost(model, usage), 6)
                    score(r, q)
                except Exception as e:  # noqa: BLE001 — record, never fabricate
                    r.error = f"{type(e).__name__}: {e}"
                results.append(r)
                time.sleep(1.5)  # free-tier RPM politeness
    return results


def run_textqa_lane(run_id: str, docs: dict, questions: list[dict], repeat_id: str | None) -> list[QResult]:
    from adapters.textqa_llm import ask

    suffix, table_aware = RETRIEVAL_LANES["docling-tables"]
    index = Fts5Index()
    parser_versions: dict = {}
    loaded: set[str] = set()
    for doc_id in {q["doc"] for q in questions}:
        ir_path = OUT / "ir" / f"{docs[doc_id]['file'].split('/')[-1].removesuffix('.pdf')}.{suffix}.json"
        ocr_path = OUT / "ir" / f"{docs[doc_id]['file'].split('/')[-1].removesuffix('.pdf')}.docling-ocr.json"
        use = ir_path if ir_path.exists() else ocr_path
        if not use.exists():
            continue
        exp = ExpDoc.load(use)
        exp.doc_id = doc_id  # IRs carry the file stem; questions use the doc key
        parser_versions[doc_id] = f"{exp.parser} {exp.parser_version}"
        index.add(index_expdoc(exp, table_aware=table_aware))
        loaded.add(doc_id)

    results: list[QResult] = []
    for q in questions:
        reps = 2 if repeat_id and q["id"] == repeat_id else 1
        for rep in range(1, reps + 1):
            r = QResult(
                run_id=run_id,
                adapter="textqa-docling",
                adapter_kind="answer",
                backend="",
                versions={"retrieval": "docling-tables+fts5", "rep": rep, **parser_versions},
                doc_id=q["doc"],
                doc_sha256=doc_sha(docs, q["doc"]),
                question_id=q["id"],
                question_class=q["class"],
                question=q["q"],
                expected={k: q.get(k) for k in ("expect_all", "expect_any", "expect_page", "abstain")},
                ts=now_ts(),
            )
            if q["doc"] not in loaded:
                r.error = f"no docling IR for doc '{q['doc']}'"
                results.append(r)
                continue
            hits = index.query(q["doc"], q["q"], k=6)
            evidence = [{"doc_id": h.doc_id, "page": h.page, "snippet": h.text} for h in hits]
            try:
                t0 = time.monotonic()
                parsed, backend, usage, latency = ask(q["q"], evidence)
                r.backend = backend
                r.answer_text = str(parsed.get("answer", ""))
                r.cited_pages = [int(p) for p in parsed.get("pages", []) if str(p).isdigit()]
                r.abstained = bool(parsed.get("abstain"))
                r.latency_s = round(time.monotonic() - t0, 2)
                r.tokens = usage
                r.evidence = [
                    {"doc_id": e["doc_id"], "page": e["page"], "snippet": e["snippet"][:300]}
                    for e in evidence
                ]
                score(r, q)
            except Exception as e:  # noqa: BLE001
                r.error = f"{type(e).__name__}: {e}"
            results.append(r)
            time.sleep(1.0)
    return results


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lane", required=True, help="comma list: pymupdf,pymupdf-tables,docling,docling-tables,docling-scanned,gemini,textqa")
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--repeat-id", default="pf525-fault-f004")
    ap.add_argument("--only", default="", help="comma list of question ids to (re)run")
    ap.add_argument("--out", default=str(OUT / "results.jsonl"))
    args = ap.parse_args()

    docs, questions = load_questions()
    if args.only:
        wanted = {x.strip() for x in args.only.split(",")}
        questions = [q for q in questions if q["id"] in wanted]
    all_results: list[QResult] = []
    for lane in args.lane.split(","):
        lane = lane.strip()
        if lane in RETRIEVAL_LANES:
            all_results += run_retrieval_lane(lane, args.run_id, docs, questions)
        elif lane == "gemini":
            all_results += run_gemini_lane(args.run_id, docs, questions, args.repeat_id)
        elif lane == "textqa":
            all_results += run_textqa_lane(args.run_id, docs, questions, args.repeat_id)
        else:
            raise SystemExit(f"unknown lane: {lane}")

    write_results(Path(args.out), all_results)
    ok = sum(1 for r in all_results if r.correct)
    err = sum(1 for r in all_results if r.error)
    print(f"wrote {len(all_results)} rows → {args.out}  (correct={ok}, errors={err})")


if __name__ == "__main__":
    main()
