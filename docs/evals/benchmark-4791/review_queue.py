"""AI-AI label agreement for forum-new, then the human review queue. Run after analyze.py. No model calls.

    python3 review_queue.py

Agreement: the primary (collector) labels vs a blinded second labeler that saw only the question and the PDF
(forum-new/blind-labels.json). Per row, "agree" means both call it answerable with at least one shared page, or
both call it unanswerable. Cohen's kappa is computed on the answerable/unanswerable call. Writes
forum-new/label-agreement.json; analyze.py reads its `agreed_ids` for the pre-registered sensitivity analysis.

Queue (review/queue.csv): every case a human must look at before its label can move up the review ladder.
"""

from __future__ import annotations

import csv
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def kappa(pairs: list[tuple[bool, bool]]) -> float | None:
    n = len(pairs)
    if not n:
        return None
    po = sum(a == b for a, b in pairs) / n
    pa, pb = sum(a for a, _ in pairs) / n, sum(b for _, b in pairs) / n
    pe = pa * pb + (1 - pa) * (1 - pb)
    return None if pe == 1 else (po - pe) / (1 - pe)


def agreement() -> dict:
    prim = {q["id"]: q for q in json.load(open(f"{HERE}/forum-new/forum-new-questions.json"))}
    blind = {b["id"]: b for b in json.load(open(f"{HERE}/forum-new/blind-labels.json"))}
    rows, pairs = [], []
    for i, q in prim.items():
        b = blind.get(i)
        if b is None:
            rows.append({"id": i, "status": "no blind label"})
            continue
        pa, ba = bool(q["accepted"]), bool(b["answerable"] and b["pages"])
        pairs.append((pa, ba))
        shared = sorted(set(q["accepted"]) & set(b["pages"]))
        agree = (pa and ba and bool(shared)) or (not pa and not ba)
        rows.append(
            {
                "id": i,
                "primary": q["accepted"],
                "blind": b["pages"],
                "blind_confidence": b.get("confidence"),
                "shared": shared,
                "agree": agree,
            }
        )
    labelled = [r for r in rows if "agree" in r]
    out = {
        "n_labelled": len(labelled),
        "agree": sum(r["agree"] for r in labelled),
        "answerability_kappa": kappa(pairs),
        "answerable_both_with_shared_page": sum(
            1 for r in labelled if r["primary"] and r["shared"]
        ),
        "answerable_primary": sum(1 for r in labelled if r["primary"]),
        "agreed_ids": [r["id"] for r in labelled if r["agree"]],
        "rows": rows,
    }
    json.dump(out, open(f"{HERE}/forum-new/label-agreement.json", "w"), indent=1)
    return out


def main() -> None:
    ag = agreement()
    q = []
    prim = {x["id"]: x for x in json.load(open(f"{HERE}/forum-new/forum-new-questions.json"))}
    for r in ag["rows"]:
        if not r.get("agree", False):
            q.append(
                (
                    "forum-new",
                    r["id"],
                    "AI-AI label disagreement",
                    prim[r["id"]]["question"],
                    r.get("primary"),
                    f"blind labeler: {r.get('blind')}",
                )
            )
    for row in csv.DictReader(open(f"{HERE}/matrix.csv")):
        if (
            row["kind"] == "answerable"
            and not row["post_rank"]
            and row["set"].startswith(("forum-new", "batch2"))
        ):
            q.append(
                (
                    row["set"].split(" ")[0],
                    row["id"],
                    "candidate missed the labelled page: check whether a retrieved page also answers",
                    "",
                    row["accepted"],
                    f"candidate top6 {row['post_top6']}",
                )
            )
    for c in json.load(open(f"{HERE}/safety/safety-gate-cases.json")):
        q.append(
            (
                "safety-gate",
                c["id"],
                f"ai_authored_unreviewed, written by an author who had read the gate's phrase lists; expected {c['expected_gate']}",
                c["question"],
                "",
                "",
            )
        )
    q.append(
        (
            "batch2",
            "S3/F5",
            "frozen label p.64 says DHCP default; askers say 'default IP' — is p.64 the only answering page?",
            "",
            "[64]",
            "",
        )
    )
    os.makedirs(f"{HERE}/review", exist_ok=True)
    with open(f"{HERE}/review/queue.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "set",
                "case_id",
                "reason",
                "question",
                "labelled_pages",
                "context",
                "reviewer",
                "verdict",
                "notes",
            ]
        )
        for r in q:
            w.writerow([*r, "", "", ""])
    print(
        json.dumps({k: v for k, v in ag.items() if k not in ("rows", "agreed_ids")}),
        f"| queue: {len(q)} rows",
    )


if __name__ == "__main__":
    main()
