"""Cross-check analyze.py's MRR@10 / nDCG@10 / Success@5 against ir_measures (pytrec_eval backend, the BEIR one).

    uv run --no-project --python 3.12 --with ir-measures --with pytrec-eval-terrier python crosscheck_ir_measures.py

analyze.py ranks CHUNKS (what the model is shown), and one page can fill several chunk slots. TREC runs need
unique doc ids, so each chunk becomes doc "c<i>-p<page>" and every chunk from an accepted page is relevant. RR@10
and Success@5 must then match analyze.py exactly; a mismatch exits 1. The script also prints Success@5 over
DE-DUPLICATED pages (page rank), a different and more lenient definition, for reference. nDCG is printed, not
compared: ir_measures uses graded IDCG over every relevant id, analyze.py uses single-relevance IDCG = 1.
"""

import json

import ir_measures
from ir_measures import RR, Success, nDCG

r = json.load(open("results.json"))["retrieval"]
mismatch = 0
for name, setname, k in (("t4-77 (k6, production call)", "t4-77", 6), ("t4-77 (k10)", "t4-77", 10)):
    for arm, tag in (("pre", "b980d42db"), ("post", "cc0d26c1d"), ("post-lexv2", "cc0d26c1d-lexv2"), ("bm25", "bm25")):
        kk = 10 if arm == "bm25" else k
        rows = [json.loads(x) for x in open(f"raw/{setname}/{setname}-{tag}-k{kk}-r1.jsonl")]
        qrels, run, pq, pr = [], [], [], []
        for row in rows:
            for i, p in enumerate(row["ranked_pages"][:k]):
                did = f"c{i}-p{p}"
                run.append(ir_measures.ScoredDoc(row["id"], did, float(100 - i)))
                if p in row["accepted"]:
                    qrels.append(ir_measures.Qrel(row["id"], did, 1))
            if not any(p in row["accepted"] for p in row["ranked_pages"][:k]):
                qrels.append(ir_measures.Qrel(row["id"], "never-retrieved", 1))
            for p in row["accepted"]:
                pq.append(ir_measures.Qrel(row["id"], str(p), 1))
            seen = list(dict.fromkeys(row["ranked_pages"][:k]))
            pr += [ir_measures.ScoredDoc(row["id"], str(p), float(100 - i)) for i, p in enumerate(seen)]
        page_s5 = ir_measures.calc_aggregate([Success @ 5], pq, pr)[Success @ 5]
        agg = ir_measures.calc_aggregate([RR @ 10, Success @ 5, nDCG @ 10], qrels, run)
        key = {"pre": "b980d42db", "post": "cc0d26c1d"}.get(arm, arm)
        mine = r[name][key]
        ok_rr = abs(agg[RR @ 10] - mine["mrr10"]) < 1e-9
        ok_s5 = abs(agg[Success @ 5] - mine["top5"]["num"] / mine["top5"]["den"]) < 1e-9
        mismatch += (not ok_rr) + (not ok_s5)
        print(f"{name:28s} {arm:10s} RR@10 {agg[RR @ 10]:.4f} vs {mine['mrr10']:.4f} {'OK' if ok_rr else 'MISMATCH'} | "
              f"Success@5 {agg[Success @ 5]:.4f} {'OK' if ok_s5 else 'MISMATCH'} | page-rank Success@5 {page_s5:.4f} | graded nDCG@10 {agg[nDCG @ 10]:.4f}")
print("mismatches:", mismatch)
raise SystemExit(1 if mismatch else 0)
