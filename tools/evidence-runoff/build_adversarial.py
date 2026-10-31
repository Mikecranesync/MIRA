"""Adversarial (answer, cited page) pairs by VALUE SWAP — zero tokens, deterministic.

For every typed question that has gold lookalikes and at least one real `correct_supported` answer, take the
first such answer (walk order w1, w2, … then the rest) and replace the first occurrence of its gold key value
with each lookalike (≤3). Evidence and cited pages stay exactly as the real answer had them. The swapped
answer is wrong by construction (`adv_wrong_fact`); the unswapped original is its matched control
(`correct_supported`, already in the corpus).

Split inherits from the question: DEV questions' swaps are dev; HELD-OUT questions' swaps are scored as
`adv_heldout` and never used for threshold tuning. (Deviation from RUNOFF_PLAN §3, which put the whole
adversarial set in dev — recorded in RUNOFF_RESULTS.md.)
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from grade import compact, norm, stated, typed_groups  # noqa: E402

DATA = Path("/Users/charlienode/MIRA/.planning/evidence-runoff-data")
GOLD = Path(__file__).parent / "data/gold.json"
ORDER = [
    "w1",
    "w2",
    "w3",
    "w4",
    "w5",
    "p1",
    "rr1-1",
    "rr1-2",
    "rr1-3",
    "int8-1",
    "int8-2",
    "int8-3",
]


def find_span(answer: str, alts: list[str]) -> tuple[int, int] | None:
    """Character span of the first alternative as written in the answer (case-insensitive, flexible spaces)."""
    for a in sorted(alts, key=len, reverse=True):
        pat = r"\s*".join(re.escape(ch) for ch in norm(a).strip().replace(" ", ""))
        m = re.search(pat, answer, re.I)
        if m:
            return m.start(), m.end()
    return None


def main() -> int:
    gold = {g["id"]: g for g in json.loads(GOLD.read_text())}
    corpus = [json.loads(x) for x in (DATA / "corpus.jsonl").open()]
    labels = {
        r["item_id"]: r["label"] for r in (json.loads(x) for x in (DATA / "labels.jsonl").open())
    }
    rank = {w: i for i, w in enumerate(ORDER)}
    out = []
    for qid, g in sorted(gold.items()):
        if g.get("doubt") or g.get("fact_type") != "typed" or not g.get("lookalikes"):
            continue
        groups = typed_groups(g)
        good = [
            it
            for it in corpus
            if it["question_id"] == qid and labels.get(it["item_id"]) == "correct_supported"
        ]
        if not good or not groups:
            continue
        good.sort(key=lambda it: rank.get(it.get("walk") or "", 99))
        base = good[0]
        span = None
        for grp in groups:
            span = find_span(base["answer"], grp)
            if span:
                break
        if not span:
            continue
        for k, look in enumerate(g["lookalikes"][:3]):
            look1 = re.sub(r"\s+", " ", look).strip()
            # A swap must put a different VALUE in the same slot: a digit-bearing token, short, and not
            # itself an accepted gold spelling (e.g. GS10 "FIVE minutes" became gold after the audit).
            if not re.search(r"\d", look1) or len(look1) > 40:
                continue
            if compact(look1) == compact(base["answer"][span[0] : span[1]]):
                continue
            if any(compact(look1) == compact(a) for grp in g["key_values"] for a in grp):
                continue
            if stated([look1], compact(base["answer"]), norm(base["answer"])):
                continue  # the real answer already mentions it (e.g. as context) — a swap would be ambiguous
            swapped = base["answer"][: span[0]] + look1 + base["answer"][span[1] :]
            if all(stated(grp, compact(swapped), norm(swapped)) for grp in groups):
                continue  # the gold value is still stated elsewhere in the answer: not wrong by construction
            split = "dev" if base["split"] == "dev" else "adv_heldout"
            out.append(
                {
                    **base,
                    "item_id": f"adv:{qid}:{k}",
                    "source": "adversarial-swap",
                    "answer": swapped,
                    "split": split,
                    "swap": {
                        "from_item": base["item_id"],
                        "gold": base["answer"][span[0] : span[1]],
                        "to": look1,
                    },
                }
            )
    # PAGE SWAP: the correct answer's text, paired with up to 2 pages of the SAME manual that show a
    # lookalike value but none of the gold key values — the "cited the neighbouring row's page" error.
    qman = {
        q["id"]: q["manual"] for q in json.loads((DATA / "public-50.json").read_text())["questions"]
    }
    qman |= {
        q["id"]: q["manual"] for q in json.loads((DATA / "real-36.json").read_text())["questions"]
    }
    pages: dict[str, dict[int, str]] = {}
    for line in (DATA / "pages.jsonl").open():
        r = json.loads(line)
        pages.setdefault(r["manual"], {})[r["page"]] = r["text"]
    for qid, g in sorted(gold.items()):
        if g.get("doubt") or g.get("fact_type") != "typed" or not g.get("lookalikes"):
            continue
        groups = typed_groups(g)
        good = [
            it
            for it in corpus
            if it["question_id"] == qid and labels.get(it["item_id"]) == "correct_supported"
        ]
        if not good or not groups:
            continue
        good.sort(key=lambda it: rank.get(it.get("walk") or "", 99))
        base = good[0]
        support = set(g.get("gold_pages") or []) | set(g.get("extra_pages") or [])
        n = 0
        for pno, text in sorted(pages.get(qman.get(qid, ""), {}).items()):
            if n >= 2 or any(abs(pno - sp) <= 1 for sp in support):
                continue
            tc, tn = compact(text), norm(text)
            if any(stated(grp, tc, tn) for grp in groups):
                continue
            if not any(re.search(r"\d", lk) and stated([lk], tc, tn) for lk in g["lookalikes"]):
                continue
            split = "dev" if base["split"] == "dev" else "adv_heldout"
            out.append(
                {
                    **base,
                    "item_id": f"advpage:{qid}:{pno}",
                    "source": "adversarial-page-swap",
                    "cited_pages": [pno],
                    "evidence": [{"page": pno, "text": text}],
                    "split": split,
                    "swap": {"from_item": base["item_id"], "page": pno},
                }
            )
            n += 1
    (DATA / "corpus_adv.jsonl").write_text(
        "".join(json.dumps(x, ensure_ascii=False) + "\n" for x in out)
    )
    print(
        json.dumps(
            {
                "adversarial_items": len(out),
                "dev": sum(x["split"] == "dev" for x in out),
                "adv_heldout": sum(x["split"] == "adv_heldout" for x in out),
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
