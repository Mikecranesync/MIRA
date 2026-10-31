"""Make result rows agree with the registered question file (Codex F5 on #5003).

The harness derives a row's `kind` from `accepted`; a question registered as unanswerable must carry no accepted
page and must never enter the answerable denominator. This rewrites `kind` and `accepted` on every row from the
question file and refuses rows whose id is not registered.

    python3 relabel_kinds.py <questions.json> <rows.jsonl>...
"""

import json
import sys


def main() -> None:
    qpath, *rows_paths = sys.argv[1:]
    qs = {q["id"]: q for q in json.load(open(qpath))}
    for rp in rows_paths:
        out, changed = [], 0
        for line in open(rp):
            if not line.strip():
                continue
            r = json.loads(line)
            q = qs.get(r["id"])
            if q is None:
                sys.exit(f"{rp}: row {r['id']} is not a registered question in {qpath}")
            kind = "answerable" if q["accepted"] else "unanswerable"
            if r.get("kind") != kind or r.get("accepted") != q["accepted"]:
                changed += 1
            r["kind"], r["accepted"] = kind, q["accepted"]
            out.append(json.dumps(r))
        open(rp, "w").write("\n".join(out) + "\n")
        print(f"{rp}: {len(out)} rows, {changed} relabelled")


if __name__ == "__main__":
    main()
