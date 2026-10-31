"""T5a: attribute every failed frozen answer to retrieval, extraction or generation (zero tokens).

Order (first that applies wins):
  retrieval  - no accepted page (gold_pages + hand-read extra_pages) was cited;
  extraction - an accepted page was cited, but some gold fact has no alternative present in MIRA's stored text
               for the cited accepted page(s) (walks: unpdf+chunkText of the PDF page; staging items: stored chunks);
  generation - an accepted page was cited and every gold fact is present in that stored text.
Limit: turns record cited pages, not the full retrieved set, so "retrieval" means "not cited".
"""

from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from column_lookup import norm  # noqa: E402

HERE = Path(__file__).resolve().parents[1]
D = Path("/Users/charlienode/MIRA/.planning/evidence-runoff-data")
CLASSES = {"wrong_fact": "wrong", "wrong_fact_unlisted": "wrong", "typed_incomplete": "wrong", "abstain": "abstain", "prose_nomatch": "prose_nomatch"}


def main() -> None:
    gold = {g["id"]: g for g in json.loads((HERE / "data/gold.json").read_text())}
    labels = {x["item_id"]: x["label"] for x in map(json.loads, (D / "labels.jsonl").read_text().splitlines())}
    corpus = {x["item_id"]: x for x in map(json.loads, (D / "corpus.jsonl").read_text().splitlines())}
    pub = json.loads((D / "public-50.json").read_text())
    qman = {q["id"]: q["manual"] for q in pub["questions"]}
    rows, table = [], defaultdict(Counter)
    for iid, lab in labels.items():
        cls = CLASSES.get(lab)
        if cls is None:
            continue
        it = corpus[iid]
        g = gold.get(it["question_id"])
        if g is None or g.get("not_in_manual"):
            continue
        accepted = set(g["gold_pages"]) | set(g.get("extra_pages") or [])
        cited_ok = sorted(accepted & set(it["cited_pages"]))
        if not cited_ok:
            cause = "retrieval"
        else:
            if it["source"] == "public-walk":
                texts = []
                for p in cited_ok:
                    f = D / "t5/mira_goldpages" / f"{qman[it['question_id']]}_p{p}.json"
                    texts.append(json.loads(f.read_text())["page_text"] if f.exists() else "")
                stored = "\n".join(texts)
            else:
                stored = "\n".join(e["text"] for e in it["evidence"] if e["page"] in cited_ok)
            s = norm(stored)
            present = all(any(norm(a) in s for a in fact) for fact in g["key_values"])
            cause = "generation" if present else "extraction"
        table[cls][cause] += 1
        table["all"][cause] += 1
        rows.append({"item_id": iid, "label": lab, "class": cls, "cause": cause, "config": it["config"], "source": it["source"]})
    out = {k: dict(v) for k, v in table.items()}
    by_cfg = defaultdict(Counter)
    for r in rows:
        if r["class"] != "prose_nomatch":
            by_cfg[r["config"]][r["cause"]] += 1
    out["hard_failures_by_config"] = {k: dict(v) for k, v in by_cfg.items()}
    (HERE / "results/oracle_attribution.json").write_text(json.dumps({"summary": out, "items": rows}, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
