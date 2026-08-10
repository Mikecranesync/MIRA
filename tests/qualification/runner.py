"""FactoryLM Technician Qualification Battery — loader, freeze hash, scorer.

    py -3 -m tests.qualification.runner --freeze     # recompute the freeze hash
    py -3 -m tests.qualification.runner --list       # inventory
    py -3 -m tests.qualification.runner --score <replies.json>

## Why a freeze hash

The audit's sharpest finding was not a regression — it was that the
2026-05-20 and 2026-05-21 staging benchmarks asked the **same 10 questions**
under **different rubrics** (`avg_score` over five 1-5 dimensions vs a single
`quality_score`), and the resulting 3.64 → 2.30 looks exactly like a 37%
collapse. It is not one; it is a scale change. Nothing in either artifact says
so, and nothing prevented it.

So this battery makes the item set tamper-evident. `freeze_hash()` canonicalises
every scored field and hashes it; `test_battery_frozen.py` asserts the value.
Change a question, an expectation or an id and that test fails until you bump
the version. **Scores are comparable only within a version** — stated in the
YAML, enforced here.

## Scoring

Deterministic and offline. `must_include` is a list of ANY-OF groups: an item
scores 1.0 only when every group has at least one member present, and no
`must_not_include` term appears. Grouping is what keeps this from degrading
into vocabulary policing — the CIT-005 lesson, where demanding the literal words
"manufacturer/model" scored the *better* reply as a failure.

A reply that is missing (no run, no capture) scores **UNKNOWN**, never 0 and
never 1. An absent answer is not a wrong answer, and a battery that conflates
them produces a number that moves when the harness breaks.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
BATTERY = HERE / "battery_v1.yaml"

PASS = "PASS"
FAIL = "FAIL"
UNKNOWN = "UNKNOWN"


def load(path: Path | None = None) -> dict:
    return yaml.safe_load((path or BATTERY).read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Freeze
# ---------------------------------------------------------------------------


def scored_items(battery: dict) -> list[dict]:
    """Every item that carries an expectation, across all sections."""
    out: list[dict] = []
    for sec in battery.get("sections", []):
        for item in sec.get("items", []) or []:
            out.append({**item, "_section": sec["id"]})
    return out


def canonical(battery: dict) -> str:
    """The exact bytes the freeze hash covers.

    Deliberately EXCLUDES prose that carries no grading weight (`rationale`,
    `area`, comments) so a clarifying note does not read as a battery change,
    and INCLUDES everything that can move a score.
    """
    rows = []
    for item in scored_items(battery):
        rows.append(
            {
                "id": item["id"],
                "prompt": item.get("prompt") or item.get("turns"),
                "must_include": item.get("must_include") or [],
                "must_not_include": item.get("must_not_include") or [],
                "layer": item.get("layer"),
            }
        )
    rows.sort(key=lambda r: r["id"])
    return json.dumps(rows, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def freeze_hash(battery: dict) -> str:
    return hashlib.sha256(canonical(battery).encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


def _norm(text: str) -> str:
    return " ".join((text or "").lower().replace("’", "'").split())


@dataclass
class ItemResult:
    item_id: str
    section: str
    verdict: str
    layer: str | None = None
    missing_groups: list[list[str]] = field(default_factory=list)
    forbidden_hit: list[str] = field(default_factory=list)
    note: str = ""


def score_item(item: dict, reply: str | None) -> ItemResult:
    section = item.get("_section", "?")
    if reply is None:
        return ItemResult(
            item["id"],
            section,
            UNKNOWN,
            item.get("layer"),
            note="no reply captured — not a wrong answer, and not a right one",
        )
    low = _norm(reply)
    missing = [g for g in (item.get("must_include") or []) if not any(_norm(t) in low for t in g)]
    forbidden = [t for t in (item.get("must_not_include") or []) if _norm(t) in low]
    verdict = PASS if (not missing and not forbidden) else FAIL
    return ItemResult(item["id"], section, verdict, item.get("layer"), missing, forbidden)


def score_all(battery: dict, replies: dict[str, str]) -> list[ItemResult]:
    return [score_item(i, replies.get(i["id"])) for i in scored_items(battery)]


def scorecard(battery: dict, results: list[ItemResult]) -> str:
    by_sec: dict[str, list[ItemResult]] = {}
    for r in results:
        by_sec.setdefault(r.section, []).append(r)

    lines = [
        f"# FactoryLM Technician Qualification Battery — v{battery['version']}",
        "",
        f"freeze `{battery['freeze']['sha256'][:16]}…`  ·  items scored: {len(results)}",
        "",
        "| section | pass | fail | unknown | scored % |",
        "|---|---|---|---|---|",
    ]
    for sec, rs in sorted(by_sec.items()):
        p = sum(1 for r in rs if r.verdict == PASS)
        f = sum(1 for r in rs if r.verdict == FAIL)
        u = sum(1 for r in rs if r.verdict == UNKNOWN)
        denom = p + f
        pct = f"{100 * p / denom:.0f}%" if denom else "—"
        lines.append(f"| **{sec}** | {p} | {f} | {u} | {pct} |")

    tot_p = sum(1 for r in results if r.verdict == PASS)
    tot_f = sum(1 for r in results if r.verdict == FAIL)
    tot_u = sum(1 for r in results if r.verdict == UNKNOWN)
    lines += [
        "",
        f"**Scored {tot_p}/{tot_p + tot_f}**"
        + (f"  ·  {tot_u} UNKNOWN (excluded from the denominator)" if tot_u else ""),
        "",
        "> UNKNOWN is excluded rather than counted as failure. A battery that "
        "scores absent evidence as 0 drops when the *harness* breaks, which is "
        "the failure mode this whole audit exists to separate out.",
    ]

    # Per-layer roll-up — maps a score onto a subsystem, not a vibe.
    by_layer: dict[str, list[ItemResult]] = {}
    for r in results:
        if r.layer:
            by_layer.setdefault(r.layer, []).append(r)
    if by_layer:
        lines += [
            "",
            "## By TRH layer",
            "",
            "| layer | pass | fail | unknown |",
            "|---|---|---|---|",
        ]
        for layer, rs in sorted(by_layer.items()):
            lines.append(
                f"| {layer} | {sum(1 for r in rs if r.verdict == PASS)} | "
                f"{sum(1 for r in rs if r.verdict == FAIL)} | "
                f"{sum(1 for r in rs if r.verdict == UNKNOWN)} |"
            )

    fails = [r for r in results if r.verdict == FAIL]
    if fails:
        lines += ["", "## Failures", ""]
        for r in fails:
            why = []
            if r.missing_groups:
                why.append(f"missing any-of {r.missing_groups}")
            if r.forbidden_hit:
                why.append(f"FORBIDDEN present: {r.forbidden_hit}")
            lines.append(f"- `{r.item_id}` ({r.layer or '—'}) — {'; '.join(why)}")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(prog="qualification")
    ap.add_argument("--freeze", action="store_true", help="recompute and print the freeze hash")
    ap.add_argument("--write-freeze", action="store_true", help="write the hash into the YAML")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--score", help="path to {item_id: reply} JSON")
    args = ap.parse_args()

    battery = load()

    if args.freeze or args.write_freeze:
        h = freeze_hash(battery)
        print(h)
        if args.write_freeze:
            text = BATTERY.read_text(encoding="utf-8")
            text = re.sub(r'(\n  sha256: ")[^"]*(")', rf"\g<1>{h}\g<2>", text, count=1)
            BATTERY.write_text(text, encoding="utf-8")
            print(f"[written] {BATTERY}")
        return 0

    if args.list:
        items = scored_items(battery)
        print(f"v{battery['version']} frozen {battery['frozen']} — {len(items)} scored items")
        for sec in battery["sections"]:
            n = len(sec.get("items") or [])
            kind = sec["kind"]
            extra = (
                f", {len(sec.get('suites') or [])} delegated suite(s)"
                if kind == "delegated"
                else ""
            )
            print(f"  {sec['id']:7} {sec['name']:34} weight={sec['weight']}  items={n}{extra}")
        return 0

    if args.score:
        replies = json.loads(Path(args.score).read_text(encoding="utf-8"))
        print(scorecard(battery, score_all(battery, replies)))
        return 0

    ap.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
