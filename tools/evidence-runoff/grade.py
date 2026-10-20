"""Deterministic answer labels from frozen gold facts (zero tokens).

Gold (data/gold.json): per question `gold_pages`, `not_in_manual`, `fact_type`, `key_values` (groups of
alternative spellings; every group must match), `lookalikes`, and a verbatim `quote` that `check_gold`
proves is on the gold page text.

Labels (one per corpus item):
  correct_supported     every key-value group stated AND a gold page (±tolerance) cited
  wrong_page            every key-value group stated, but no gold page cited (incl. uncited)
  wrong_fact            a lookalike stated while a key value is missing, or (typed fact) key value missing
                        while the answer asserts something
  missing_fact          prose fact not stated (incomplete / off-topic answer, no lookalike)
  abstain               the answer declines (status insufficient_evidence, or a refusal phrase and no key value)
  answered_not_in_manual  gold says the manual does not contain it, yet the answer asserts something
  correct_abstain       gold not_in_manual and the answer declines
  (revised after the 2026-10-20 hand audit of 40 labels — see RUNOFF_RESULTS.md §grader audit:
   safety_stop label; declines checked first; typed vs prose_* split; supporting pages widened to every
   page stating the typed value; wrong_fact_unlisted = typed value missing, no listed lookalike)
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

REFUSAL = re.compile(
    r"(do(?:es)? not (?:say|state|include|show|list|name|specify|cover|mention)|not (?:stated|listed|included|shown|covered)|"
    r"can(?:no|')t find|couldn't find|i (?:can't|cannot|don't) (?:find|see|confirm)|not in the (?:loaded |retrieved |provided )?(?:excerpts|pages|manual)|"
    r"excerpts? (?:do|does) not|i'd need|i would need)",
    re.I,
)


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "")
    s = (
        s.replace("…", "...")
        .replace("–", "-")
        .replace("—", "-")
        .replace("−", "-")
        .replace("·", ".")
        .replace("\ufffd", ".")
        .replace("’", "'")
    )
    s = re.sub(r"[*_`]", "", s).lower()
    return re.sub(r"\s+", " ", s)


def compact(s: str) -> str:
    return re.sub(r"[\s()\[\]]", "", norm(s))


def stated(alts: list[str], answer_c: str, answer_n: str = "") -> bool:
    """A short alternative (<= 3 chars, e.g. "4", "29", "F4") must match as a whole word, or any "4"
    in the answer would satisfy it; longer ones match whitespace/bracket-insensitively."""
    for a in alts:
        c = compact(a)
        if not c:
            continue
        if len(c) <= 3:
            if re.search(rf"(?<![\w.]){re.escape(norm(a).strip())}(?![\w])", answer_n):
                return True
        elif c in answer_c:
            return True
    return False


def check_gold(gold: list[dict], page_text) -> list[str]:
    """Every non-abstain gold entry's quote must occur on its quote_page; typed key values in the quote."""
    errors = []
    for g in gold:
        if g.get("not_in_manual"):
            continue
        txt = compact(page_text(g["id"], g["quote_page"]))
        if compact(g["quote"]) not in txt:
            errors.append(f"{g['id']}: quote not on p.{g['quote_page']}")
        if g.get("fact_type") == "typed":
            qc = compact(g["quote"])
            for grp in g["key_values"]:
                if not any(compact(a) in qc for a in grp):
                    errors.append(f"{g['id']}: key group {grp} not in quote")
    return errors


SAFETY_STOP = re.compile(r"^\W*safety stop", re.I)


def typed_groups(g: dict) -> list[list[str]]:
    """Key-value groups that name a value (contain a digit): the part deterministic grading can judge."""
    return [grp for grp in g.get("key_values") or [] if any(re.search(r"\d", a) for a in grp)]


def supporting_pages(g: dict, manual_pages: dict[int, str]) -> set[int]:
    """Gold pages plus hand-reviewed `extra_pages`. NOT widened automatically: a typed value such as
    "bit 12" or "4" also appears on pages about OTHER instructions — value presence is exactly the
    lookalike trap, and binding logic here would make the grader agree with V1 by construction."""
    del manual_pages
    return set(g.get("gold_pages") or []) | set(g.get("extra_pages") or [])


def label(item: dict, g: dict, support: set[int], tolerance: int = 1) -> str:
    """Typed questions get full labels; prose questions get `prose_*` labels (paraphrase makes string
    matching unreliable — hand audit 2026-10-20 — so they are reported but never in the headline)."""
    ans = item["answer"] or ""
    if SAFETY_STOP.search(ans.strip()):
        return "safety_stop"
    declines = (
        item.get("status") == "insufficient_evidence" or REFUSAL.search(norm(ans)) is not None
    )
    if g.get("not_in_manual"):
        return "correct_abstain" if declines or not ans.strip() else "answered_not_in_manual"
    if declines or not ans.strip():
        return "abstain"
    a_c, a_n = compact(ans), norm(ans)
    cited = item.get("cited_pages") or []
    on_page = any(abs(c - p) <= tolerance for c in cited for p in support)
    groups = typed_groups(g) if g.get("fact_type") == "typed" else []
    if not groups:
        allg = g.get("key_values") or []
        if allg and all(stated(grp, a_c, a_n) for grp in allg):
            return "prose_match" if on_page else "prose_wrong_page"
        return "prose_nomatch"
    if all(stated(grp, a_c, a_n) for grp in groups):
        return "correct_supported" if on_page else "wrong_page"
    if any(compact(x) and stated([x], a_c, a_n) for x in g.get("lookalikes") or []):
        return "wrong_fact"
    return "wrong_fact_unlisted"


def main() -> int:
    corpus, gold_path, pages_path, out = sys.argv[1:5]
    gold = {g["id"]: g for g in json.loads(Path(gold_path).read_text())}
    data = Path(corpus).parent
    qman = {
        q["id"]: q["manual"] for q in json.loads((data / "public-50.json").read_text())["questions"]
    }
    qman |= {
        q["id"]: q["manual"] for q in json.loads((data / "real-36.json").read_text())["questions"]
    }
    by_manual: dict[str, dict[int, str]] = {}
    for line in open(pages_path):
        r = json.loads(line)
        by_manual.setdefault(r["manual"], {})[r["page"]] = r["text"]
    support = {q: supporting_pages(g, by_manual.get(qman.get(q, ""), {})) for q, g in gold.items()}
    audit = json.loads((Path(gold_path).parent / "gold-audit.json").read_text())
    overrides = audit.get("label_overrides", {})
    rows, missing = [], set()
    for line in open(corpus):
        it = json.loads(line)
        g = gold.get(it["question_id"])
        if g is None or g.get("doubt"):
            if g is None:
                missing.add(it["question_id"])
            rows.append(
                {"item_id": it["item_id"], "label": "no_gold" if g is None else "gold_doubt"}
            )
            continue
        lab = overrides.get(it["item_id"]) or label(it, g, support[it["question_id"]])
        rows.append({"item_id": it["item_id"], "label": lab})
    Path(out).write_text("".join(json.dumps(r) + "\n" for r in rows))
    counts: dict[str, int] = {}
    for r in rows:
        counts[r["label"]] = counts.get(r["label"], 0) + 1
    widened = {
        q: sorted(support[q] - set(gold[q].get("gold_pages") or []))
        for q in gold
        if support[q] - set(gold[q].get("gold_pages") or [])
    }
    print(
        json.dumps(
            {
                "labels": counts,
                "questions_without_gold": sorted(missing),
                "gold_pages_widened": widened,
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
