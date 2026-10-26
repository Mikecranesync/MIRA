"""Same question, messier wording: deterministic rewrites that must not change the answer page.

    python3 v02/robustness.py        (reads oem-fault/ and t4-77-questions.json, writes robust/)

Every variant keeps the base question's accepted pages (the meaning is unchanged by construction). No AI writes
any wording; each rule is a fixed function, so a reviewer can read exactly what changed.

  lower      lowercase, punctuation stripped
  alias      product names swapped for shop-floor short forms (PowerFlex 40 -> pf40, MicroLogix 1100 -> ML1100)
  typo       two adjacent letters swapped in the longest plain word of 6+ letters (never a code or product name)
  code       fault codes rewritten the way people type them (F33 -> fault 33, 0002 -> code 2, 0xF000 -> F000)
  chatter    a realistic preamble before the question
  terse      only the product and the code / key words

Metric: hit retention (base hit at top-5 kept under the variant) and per-variant accuracy, per arm.
"""

from __future__ import annotations

import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.dirname(HERE)
ALIAS = [
    ("PowerFlex 40", "pf40"),
    ("PowerFlex 4M", "pf4m"),
    ("PowerFlex 525", "pf525"),
    ("ABB ACS355", "acs355 drive"),
    ("ACS355", "acs 355"),
    ("Micro820", "micro 820"),
    ("Micro810", "micro810 plc"),
    ("MicroLogix 1100", "ML1100"),
    ("SMC Flex", "smc-flex"),
    ("SMC-50", "smc 50"),
    ("GS10 drive", "gs-10"),
    ("GS10", "gs-10"),
    ("DURApulse GS4", "gs4"),
    ("E3 Plus", "e3+"),
    ("Schneider", "schnieder"),
]
CHATTER = "hey guys line is down and the boss is breathing down my neck, "
STOP = set(
    "a an and are as at be by can do does for from how i in is it me my of on or the to what when where which why with you your".split()
)
CODE = re.compile(r"\b(0x[0-9A-Fa-f]{4}|F\d{1,3}|\d{4}|[A-Za-z]{2,4}\d?)\b")


def lower(q: str) -> str:
    return re.sub(r"[^\w\s/-]", "", q).lower().strip()


def alias(q: str) -> str | None:
    for long, short in ALIAS:
        if long.lower() in q.lower():
            return re.sub(re.escape(long), short, q, count=1, flags=re.I)
    return None


def typo(q: str) -> str | None:
    words = [
        w
        for w in re.findall(r"[A-Za-z]{6,}", q)
        if not any(w.lower() in a.lower() for a, _ in ALIAS)
    ]
    if not words:
        return None
    w = max(words, key=lambda x: (len(x), x))
    i = len(w) // 2
    return q.replace(w, w[: i - 1] + w[i] + w[i - 1] + w[i + 1 :], 1)


def code(q: str, base_code: str | None) -> str | None:
    if not base_code:
        return None
    if re.fullmatch(r"F\d+", base_code):
        if re.search(
            r"(?i)\bfault\s+" + re.escape(base_code), q
        ):  # "fault F33" -> "fault 33", never "fault fault 33"
            return re.sub(re.escape(base_code), str(int(base_code[1:])), q, count=1)
        new = f"fault {int(base_code[1:])}"
    elif re.fullmatch(r"\d{4}", base_code):
        new = f"code {int(base_code)}"
    elif base_code.lower().startswith("0x"):
        new = base_code[2:].upper()
    else:
        new = base_code.upper() if base_code != base_code.upper() else base_code.lower()
    return q.replace(base_code, new, 1) if base_code in q else None


def chatter(q: str) -> str:
    return CHATTER + q[0].lower() + q[1:]


def terse(q: str) -> str:
    return " ".join(w for w in re.findall(r"[\w/.-]+", q) if w.lower() not in STOP)


def variants(row: dict, base_code: str | None) -> dict[str, str]:
    q = row["question"]
    out = {
        "lower": lower(q),
        "alias": alias(q),
        "typo": typo(q),
        "code": code(q, base_code),
        "chatter": chatter(q),
        "terse": terse(q),
    }
    return {k: v for k, v in out.items() if v and v.strip() and v != q}


def main() -> None:
    base = []
    prov = {
        p["id"]: p
        for p in json.load(open(os.path.join(BENCH, "oem-fault", "oem-fault-provenance.json")))
    }
    for r in json.load(open(os.path.join(BENCH, "oem-fault", "oem-fault-questions.json"))):
        base.append((r, prov[r["id"]].get("code")))
    for r in json.load(open(os.path.join(BENCH, "t4-77-questions.json"))):
        base.append((r, None))
    rows, meta = [], []
    for r, c in base:
        for name, q in variants(r, c).items():
            rid = f"{r['id']}~{name}"
            rows.append(
                {
                    "id": rid,
                    "set": "robust",
                    "manual": r["manual"],
                    "pdf": r["pdf"],
                    "question": q,
                    "accepted": r["accepted"],
                }
            )
            meta.append(
                {
                    "id": rid,
                    "base_id": r["id"],
                    "base_set": r["set"],
                    "variant": name,
                    "base_question": r["question"],
                }
            )
    os.makedirs(os.path.join(BENCH, "robust"), exist_ok=True)
    json.dump(rows, open(os.path.join(BENCH, "robust", "robust-questions.json"), "w"), indent=1)
    json.dump(meta, open(os.path.join(BENCH, "robust", "robust-provenance.json"), "w"), indent=1)
    from collections import Counter

    print(
        f"robust: {len(rows)} variants of {len(base)} base questions; {dict(Counter(m['variant'] for m in meta))}"
    )


if __name__ == "__main__":
    main()
