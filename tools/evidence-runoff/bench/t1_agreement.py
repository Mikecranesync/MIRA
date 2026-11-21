"""T1: cell-level agreement between our gold and a blind transcription (before any adjudication)."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from column_lookup import norm  # noqa: E402

gold_path, blind_path, out_path = sys.argv[1:]
gold = {}
for line in Path(gold_path).read_text().splitlines():
    g = json.loads(line)
    for r in g["rows"]:
        gold[f'{g["manual"]}:{g["page"]}:{r["i"]}'] = {int(k): v for k, v in r["cells"].items()}
blind = {b["task_id"]: b for b in json.loads(Path(blind_path).read_text())}
agree = total = 0
dis = []
for tid, cells in gold.items():
    b = blind.get(tid)
    k0 = min(cells)
    for c, v in cells.items():
        if c == k0:
            continue  # the identifying cell was given to the labeller
        total += 1
        bv = (b or {}).get("cells", {}).get(str(c), None)
        if bv is not None and norm(bv) == norm(v):
            agree += 1
        else:
            dis.append({"task": tid, "col": c, "ours": v, "blind": bv, "blind_notes": (b or {}).get("notes", "")})
summary = {"cells_compared": total, "agree": agree, "rate": round(agree / total, 3), "disagreements": len(dis)}
Path(out_path).write_text(json.dumps({"summary": summary, "disagreements": dis}, indent=1, ensure_ascii=False))
print(json.dumps(summary))
