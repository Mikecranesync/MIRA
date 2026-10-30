"""Deterministic parts-breakdown extractor for CAT Pumps data sheets.

Turns the PARTS LIST, OPTIONAL PARTS, SERVICE PARTS, SEAL KITS and VALVE KITS
tables of a CAT Pumps data sheet (PDF text, as pypdf/unpdf extract it) into one
JSON record that an agent, a work packet or an inventory count can use.

Rules (founder directive #4982): nothing is invented. Every row carries the page
it came from, the raw quantity string, and a status that says whether the
quantity could be resolved per model. Anything the sheet does not state is
reported as an unknown, never guessed. No model call anywhere in this file.

Usage:
    python tools/parts-breakdown/catpumps_breakdown.py <datasheet.pdf|datasheet.txt> [--json out.json]
    python tools/parts-breakdown/catpumps_breakdown.py --diff a.json b.json

The .txt form is the per-page text dump (pages separated by
"===== PAGE n =====" lines); the .pdf form needs `pypdf` at run time.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

PAGE_SPLIT = re.compile(r"\n?===== PAGE (\d+) =====\n")
MODEL_TOKEN = re.compile(r"\b\d[A-Z]{1,3}\d{3,4}[A-Z0-9]*\b")
DASHES = "–-—"  # en dash, hyphen, em dash as they appear in extracted text

# A parts-list row: [item] [=] part MATL [R] description qty
# The item number is optional (a second part number for the same item continues
# the row above) and must be followed by whitespace, so "48233 FCM …" is a part,
# never item 4 + part 8233.
PART_ROW = re.compile(
    r"^(?:(?P<item>\d{1,3})\s+)?(?P<prod>=\s*)?(?P<part>\d{4,6})\s+"
    r"(?P<matl>[A-Z]{1,5}|[—-])\s*(?P<rohs>R\b)?\s+"
    r"(?P<desc>.+?)\s+(?P<qty>\d+(?:[–-]\d+)*)$"
)
SIMPLE_ROW = re.compile(r"^(?P<part>\d{4,6})\s+(?P<desc>.+?)\s+(?P<qty>\d+)$")
KIT_TOKEN = re.compile(r"\d{4,6}|—")
KIT_ITEM_TOKEN = re.compile(r"\d{1,3}|—")
TECH_BULLETIN = re.compile(r"\((See Tech Bulletin [0-9]+)\)")
NOT_SHOWN = re.compile(r"\((Not Shown)\)")


@dataclass
class Part:
    item: int | None
    part: str
    description: str
    material: str | None
    qty_raw: str
    qty_by_model: dict[str, int] | None
    qty_status: str  # resolved | ambiguous | single
    applies_to: list[str]
    rohs: bool = False
    production_part_differs: bool = False
    notes: list[str] = field(default_factory=list)
    source_page: int = 0


@dataclass
class SimplePart:
    part: str
    description: str
    qty: int
    notes: list[str]
    source_page: int


@dataclass
class KitItem:
    item: int | None
    description: str
    qty_per_kit: int
    part_by_material: dict[str, str | None]


@dataclass
class Kit:
    kind: str
    required_per_pump: int | None
    models: list[str]
    kit_by_material: dict[str, str | None]
    items: list[KitItem]
    source_page: int
    footnotes: list[str]


@dataclass
class Breakdown:
    source: dict
    models: list[str]
    parts: list[Part]
    optional_parts: list[SimplePart]
    service_parts: list[SimplePart]
    kits: list[Kit]
    checks: list[dict]
    unknowns: list[str]


def split_pages(text: str) -> dict[int, str]:
    chunks = PAGE_SPLIT.split(text)
    if len(chunks) < 3:
        return {1: text}
    return {int(n): body for n, body in zip(chunks[1::2], chunks[2::2])}


def _clean_desc(desc: str) -> tuple[str, list[str]]:
    notes = [m.group(1) for m in TECH_BULLETIN.finditer(desc)]
    notes += [m.group(1) for m in NOT_SHOWN.finditer(desc)]
    desc = TECH_BULLETIN.sub("", desc)
    desc = NOT_SHOWN.sub("", desc)
    return re.sub(r"\s{2,}", " ", desc).strip(" ,"), notes


def _parse_qty(raw: str, models: list[str]) -> tuple[dict[str, int] | None, str]:
    values = [int(v) for v in re.split(f"[{DASHES}]", raw)]
    if len(values) == 1:
        return {m: values[0] for m in models}, "single"
    if len(values) == len(models):
        return dict(zip(models, values)), "resolved"
    return None, "ambiguous"


def _applies_to(desc: str, models: list[str]) -> tuple[str, list[str]]:
    # "Crankshaft, Dual End M18 – 5CP6120" -> applies to the listed models only
    m = re.search(
        rf"\s[{DASHES}]\s*((?:{MODEL_TOKEN.pattern})(?:\s*,\s*{MODEL_TOKEN.pattern})*)\s*$", desc
    )
    if not m:
        return desc, list(models)
    named = [t for t in MODEL_TOKEN.findall(m.group(1)) if t in models]
    return desc[: m.start()].strip(), named or list(models)


def parse_parts_list(page_text: str, page_no: int) -> tuple[list[str], list[Part]]:
    lines = [ln.strip() for ln in page_text.splitlines() if ln.strip()]
    try:
        start = next(i for i, ln in enumerate(lines) if ln.startswith("ITEM PART NUMBERS"))
    except StopIteration:
        return [], []
    models: list[str] = []
    i = start + 1
    while i < len(lines) and not PART_ROW.match(lines[i]):
        models += [t for t in MODEL_TOKEN.findall(lines[i])]
        i += 1
    parts: list[Part] = []
    last_item: int | None = None
    for ln in lines[i:]:
        m = PART_ROW.match(ln)
        if not m:
            continue
        item = int(m["item"]) if m["item"] else last_item
        last_item = item
        desc, notes = _clean_desc(m["desc"])
        desc, applies = _applies_to(desc, models)
        qty_by_model, status = _parse_qty(m["qty"], models)
        # F6 (#4993): a per-model quantity applies only to the models the row
        # names, whether the raw string had one shared value ("single") or
        # one value per model ("resolved"). The old `status != "single"`
        # guard skipped this filter for "single" rows, so a row like
        # "Crankshaft, Dual End ... – 5CP6120" with qty "1" listed that part
        # for every model in the sheet, not just 5CP6120.
        if qty_by_model is not None:
            qty_by_model = {k: v for k, v in qty_by_model.items() if k in applies}
        matl = None if m["matl"] in DASHES else m["matl"]
        parts.append(
            Part(
                item=item,
                part=m["part"],
                description=desc,
                material=matl,
                qty_raw=m["qty"],
                qty_by_model=qty_by_model,
                qty_status=status,
                applies_to=applies,
                rohs=bool(m["rohs"]),
                production_part_differs=bool(m["prod"]),
                notes=notes,
                source_page=page_no,
            )
        )
    return models, parts


def parse_simple_section(page_text: str, heading: str, page_no: int) -> list[SimplePart]:
    lines = [ln.strip() for ln in page_text.splitlines() if ln.strip()]
    out: list[SimplePart] = []
    try:
        start = next(i for i, ln in enumerate(lines) if ln.startswith(heading))
    except StopIteration:
        return out
    pending: list[str] = []
    for ln in lines[start + 1 :]:
        if ln.startswith("PART DESCRIPTION"):
            continue
        if re.match(r"^[A-Z][A-Z ]{6,}$", ln) and not ln.startswith("PART"):
            break  # next heading
        m = SIMPLE_ROW.match(ln)
        if m:
            desc, notes = _clean_desc(m["desc"])
            out.append(SimplePart(m["part"], desc, int(m["qty"]), notes, page_no))
            pending = []
        elif re.match(r"^\d{4,6}\s", ln):
            pending = [ln]  # description wraps onto following lines
        elif pending and re.fullmatch(r"\d+", ln):
            joined = " ".join(pending)
            pm = re.match(r"^(\d{4,6})\s+(.+)$", joined)
            if pm:
                desc, notes = _clean_desc(pm.group(2))
                out.append(SimplePart(pm.group(1), desc, int(ln), notes, page_no))
            pending = []
        elif pending:
            pending.append(ln)
    return out


def _kit_item_row(toks: list[str], materials: list[str]) -> KitItem | None:
    """A kit-contents row: [item] part-per-material… description qty.

    The leading numeric run is counted against the material columns, so a row
    whose item cell is "—" ("— 45153 48429 — — Seal… 3") is not shifted one
    column to the right.
    """
    if not materials or len(toks) < len(materials) + 2 or not toks[-1].isdigit():
        return None
    lead: list[str] = []
    for t in toks:
        if KIT_TOKEN.fullmatch(t) or KIT_ITEM_TOKEN.fullmatch(t):
            lead.append(t)
        else:
            break
    n = len(materials)
    if len(lead) == n + 1 and KIT_ITEM_TOKEN.fullmatch(lead[0]):
        item_tok, parts = lead[0], lead[1:]
    elif len(lead) == n:
        item_tok, parts = "—", lead
    else:
        return None
    if not all(KIT_TOKEN.fullmatch(p) for p in parts):
        return None
    desc = " ".join(toks[len(lead) : -1]).strip()
    if not desc:
        return None
    item = None if item_tok == "—" else int(item_tok)
    return KitItem(
        item, desc, int(toks[-1]), dict(zip(materials, [None if p == "—" else p for p in parts]))
    )


def parse_kits(page_text: str, page_no: int) -> list[Kit]:
    lines = [ln.strip() for ln in page_text.splitlines() if ln.strip()]
    kits: list[Kit] = []
    for idx, ln in enumerate(lines):
        head = re.match(r"^(SEAL|VALVE) KITS\s+(?:One|Two|Three|\w+)\s*\((\d+)\)", ln)
        if not head:
            continue
        kind = head.group(1).lower()
        required = int(head.group(2))
        materials: list[str] = []
        models: list[str] = []
        kit_numbers: list[str | None] = []
        items: list[KitItem] = []
        footnotes: list[str] = []
        j = idx + 1
        while j < len(lines):
            cur = lines[j]
            if cur.startswith("PUMP MODELS"):
                materials = re.findall(r"[A-Z]+ \((?:STD|\.\d{4})\)", cur)
            elif cur.startswith("ITEM (Included"):
                pass
            elif re.match(r"^(SEAL|VALVE) KITS", cur) or cur.startswith("PN "):
                break
            elif cur.startswith(("*", "u ", "u ")) or cur.startswith("◆"):
                footnotes.append(cur.lstrip("*u◆ ").strip())
            else:
                toks = cur.split()
                nums = [t for t in toks if KIT_TOKEN.fullmatch(t)]
                kit_item = _kit_item_row(toks, materials)
                if kit_item is not None:
                    items.append(kit_item)
                elif materials and len(nums) == len(materials) and not items:
                    models += [t for t in MODEL_TOKEN.findall(cur)]
                    kit_numbers = [None if t == "—" else t for t in nums]
                elif MODEL_TOKEN.search(cur) and not items:
                    models += MODEL_TOKEN.findall(cur)
            j += 1
        kits.append(
            Kit(
                kind=kind,
                required_per_pump=required,
                models=list(dict.fromkeys(models)),
                kit_by_material=dict(zip(materials, kit_numbers)) if kit_numbers else {},
                items=items,
                source_page=page_no,
                footnotes=footnotes,
            )
        )
    return kits


def run_checks(
    models: list[str], parts: list[Part], kits: list[Kit]
) -> tuple[list[dict], list[str]]:
    checks: list[dict] = []
    unknowns: list[str] = []
    by_item: dict[int, list[Part]] = {}
    for p in parts:
        if p.item is not None:
            by_item.setdefault(p.item, []).append(p)
    for kit in kits:
        std = next((m for m in kit.kit_by_material if "STD" in m), None)
        for ki in kit.items:
            if ki.item is None:
                continue
            listed = by_item.get(ki.item)
            if not listed:
                checks.append(
                    {
                        "check": "kit_item_in_parts_list",
                        "kit": kit.kind,
                        "item": ki.item,
                        "status": "fail",
                        "detail": "item not in parts list",
                    }
                )
                continue
            std_part = ki.part_by_material.get(std) if std else None
            # F7 (#4994): a kit item whose STD (standard) material has no
            # part number — e.g. the real 5CP6120 item 120, where NBR (STD)
            # is null and only STHT (.3400) carries a part — used to fall
            # straight through to the quantity-only check below and report
            # `pass`, a false assurance that the standard-material kit covers
            # that item. A missing material-specific part is reported as
            # `not_covered` (chosen over `fail` to distinguish "this material
            # simply doesn't supply the part" from a parts-list mismatch),
            # and never reaches the quantity check.
            if std is not None and std_part is None:
                checks.append(
                    {
                        "check": "kit_qty_covers_pump",
                        "kit": kit.kind,
                        "item": ki.item,
                        "material": std,
                        "status": "not_covered",
                        "detail": f"{std} has no part number for item {ki.item} in this kit; "
                        "that material cannot cover this item",
                    }
                )
                continue
            if std_part and std_part not in {p.part for p in listed}:
                checks.append(
                    {
                        "check": "kit_item_in_parts_list",
                        "kit": kit.kind,
                        "item": ki.item,
                        "status": "fail",
                        "detail": f"standard part {std_part} differs from parts list {[p.part for p in listed]}",
                    }
                )
                continue
            expected = ki.qty_per_kit * (kit.required_per_pump or 0)
            qty = listed[0].qty_by_model
            if qty is None:
                checks.append(
                    {
                        "check": "kit_qty_covers_pump",
                        "kit": kit.kind,
                        "item": ki.item,
                        "material": std,
                        "status": "unknown",
                        "detail": f"parts-list qty '{listed[0].qty_raw}' is ambiguous",
                    }
                )
            else:
                got = set(qty.values())
                status = "pass" if got == {expected} else "fail"
                checks.append(
                    {
                        "check": "kit_qty_covers_pump",
                        "kit": kit.kind,
                        "item": ki.item,
                        "material": std,
                        "status": status,
                        "detail": f"{ki.qty_per_kit} per kit x {kit.required_per_pump} kits = {expected}; parts list {sorted(got)}",
                    }
                )
    for p in parts:
        if p.qty_status == "ambiguous":
            unknowns.append(
                f"item {p.item} part {p.part}: qty '{p.qty_raw}' has {len(re.split(f'[{DASHES}]', p.qty_raw))} values for {len(models)} models; not resolved per model"
            )
    if not kits:
        unknowns.append("no seal/valve kit tables found")
    return checks, unknowns


def parse_text(text: str, source: dict | None = None) -> Breakdown:
    pages = split_pages(text)
    models: list[str] = []
    parts: list[Part] = []
    optional: list[SimplePart] = []
    service: list[SimplePart] = []
    kits: list[Kit] = []
    for n, body in sorted(pages.items()):
        if "ITEM PART NUMBERS" in body:
            models, parts = parse_parts_list(body, n)
        if "OPTIONAL PARTS AND ACCESSORIES" in body:
            optional += parse_simple_section(body, "OPTIONAL PARTS AND ACCESSORIES", n)
        if "SERVICE PARTS" in body:
            service += parse_simple_section(body, "SERVICE PARTS", n)
        if "KITS" in body:
            kits += parse_kits(body, n)
    full = "\n".join(pages.values())
    rev = re.search(r"PN\s*(\d{6})\s*Rev\s*([A-Z])\s*\d*\s*(\d{1,2}/\d{2})", full)
    src = dict(source or {})
    src.update(
        {
            "document_part_number": rev.group(1) if rev else None,
            "revision": f"Rev {rev.group(2)} {rev.group(3)}" if rev else None,
            "pages": len(pages),
            "exploded_view_page": next((n for n, b in pages.items() if "EXPLODED VIEW" in b), None),
        }
    )
    checks, unknowns = run_checks(models, parts, kits)
    if not rev:
        unknowns.append("document revision not found in text")
    return Breakdown(src, models, parts, optional, service, kits, checks, unknowns)


def load_text(path: Path) -> tuple[str, dict]:
    data = path.read_bytes()
    source = {"file": path.name, "sha256": hashlib.sha256(data).hexdigest()}
    if path.suffix.lower() == ".pdf":
        from pypdf import PdfReader  # run-time only; tests use .txt fixtures

        reader = PdfReader(str(path))
        text = "".join(
            f"\n===== PAGE {i + 1} =====\n" + re.sub(r"[ \t]+", " ", page.extract_text() or "")
            for i, page in enumerate(reader.pages)
        )
        return text, source
    return data.decode("utf-8"), source


def _kit_item_key(it: dict) -> tuple:
    # An item with no item number (e.g. an unlabeled "SS-Spring" kit-only
    # row) has no stable numeric identity; its description text is the only
    # thing the sheet gives us to match it across revisions. Two such rows
    # that happen to share identical description text are NOT distinguished
    # further — a documented, intentional gap (F11 remediation: "explicitly
    # identify any intentionally unsupported comparison scope").
    if it.get("item") is not None:
        return ("item", it["item"])
    return ("desc", it.get("description"))


def _kit_item_label(key: tuple) -> Any:
    return key[1] if key[0] == "item" else None


def diff_breakdowns(a: dict, b: dict) -> list[dict]:
    """Row-level differences between two breakdowns (e.g. two revisions).

    Compares: parts-list `qty_raw` and `applies_to`; optional/service parts
    `qty`; kit numbers per material; kit-item part-by-material mapping;
    kit-item `qty_per_kit`; kit `required_per_pump`.

    Known, intentionally unsupported scope (F11): kit item ORDER, footnote
    text, and item-less kit rows are matched by description text only (see
    `_kit_item_key`) — two different items that happen to share description
    text collapse into one comparison.
    """

    def key(p: dict) -> tuple:
        return (p.get("item"), p.get("part"))

    pa = {key(p): p for p in a["parts"]}
    pb = {key(p): p for p in b["parts"]}
    out: list[dict] = []
    for k in sorted(set(pa) | set(pb), key=lambda t: (t[0] or 0, t[1] or "")):
        if k not in pb:
            out.append({"item": k[0], "part": k[1], "change": "only_in_a"})
        elif k not in pa:
            out.append({"item": k[0], "part": k[1], "change": "only_in_b"})
        else:
            if pa[k]["qty_raw"] != pb[k]["qty_raw"]:
                out.append(
                    {
                        "item": k[0],
                        "part": k[1],
                        "change": "qty",
                        "a": pa[k]["qty_raw"],
                        "b": pb[k]["qty_raw"],
                    }
                )
            if pa[k]["applies_to"] != pb[k]["applies_to"]:
                out.append(
                    {
                        "item": k[0],
                        "part": k[1],
                        "change": "applies_to",
                        "a": pa[k]["applies_to"],
                        "b": pb[k]["applies_to"],
                    }
                )

    # Optional/service parts: simple (part, qty) rows, keyed by part number.
    for section in ("optional_parts", "service_parts"):
        sa = {s["part"]: s for s in a[section]}
        sb = {s["part"]: s for s in b[section]}
        for part_no in sorted(set(sa) | set(sb)):
            if part_no not in sb:
                out.append({"section": section, "part": part_no, "change": "only_in_a"})
            elif part_no not in sa:
                out.append({"section": section, "part": part_no, "change": "only_in_b"})
            elif sa[part_no]["qty"] != sb[part_no]["qty"]:
                out.append(
                    {
                        "section": section,
                        "part": part_no,
                        "change": "qty",
                        "a": sa[part_no]["qty"],
                        "b": sb[part_no]["qty"],
                    }
                )

    # Kits: indexed by kind. A second kit of the same kind in one breakdown
    # is a documented gap — only the first is addressable here, since `kind`
    # is the only stable cross-revision identity a kit has.
    ka = {kt["kind"]: kt for kt in a["kits"]}
    kb = {kt["kind"]: kt for kt in b["kits"]}
    for kind in sorted(set(ka) | set(kb)):
        if kind not in kb:
            out.append({"kit": kind, "change": "only_in_a"})
            continue
        if kind not in ka:
            out.append({"kit": kind, "change": "only_in_b"})
            continue
        kit_a, kit_b = ka[kind], kb[kind]
        if kit_a["required_per_pump"] != kit_b["required_per_pump"]:
            out.append(
                {
                    "kit": kind,
                    "change": "kit_required_per_pump",
                    "a": kit_a["required_per_pump"],
                    "b": kit_b["required_per_pump"],
                }
            )
        materials = sorted(set(kit_a["kit_by_material"]) | set(kit_b["kit_by_material"]))
        for mat in materials:
            va = kit_a["kit_by_material"].get(mat)
            vb = kit_b["kit_by_material"].get(mat)
            if va != vb:
                out.append({"kit": kind, "material": mat, "change": "kit_number", "a": va, "b": vb})
        ia = {_kit_item_key(it): it for it in kit_a["items"]}
        ib = {_kit_item_key(it): it for it in kit_b["items"]}
        for item_key in sorted(set(ia) | set(ib), key=str):
            if item_key not in ib:
                out.append({"kit": kind, "item": _kit_item_label(item_key), "change": "only_in_a"})
                continue
            if item_key not in ia:
                out.append({"kit": kind, "item": _kit_item_label(item_key), "change": "only_in_b"})
                continue
            ra, rb = ia[item_key], ib[item_key]
            if ra["qty_per_kit"] != rb["qty_per_kit"]:
                out.append(
                    {
                        "kit": kind,
                        "item": _kit_item_label(item_key),
                        "change": "kit_item_qty",
                        "a": ra["qty_per_kit"],
                        "b": rb["qty_per_kit"],
                    }
                )
            item_materials = sorted(set(ra["part_by_material"]) | set(rb["part_by_material"]))
            for mat in item_materials:
                va = ra["part_by_material"].get(mat)
                vb = rb["part_by_material"].get(mat)
                if va != vb:
                    out.append(
                        {
                            "kit": kind,
                            "item": _kit_item_label(item_key),
                            "material": mat,
                            "change": "kit_item_part",
                            "a": va,
                            "b": vb,
                        }
                    )
    return out


def to_dict(b: Breakdown) -> dict:
    return asdict(b)


def main(argv: list[str]) -> int:
    if argv[:1] == ["--diff"]:
        a, b = (json.loads(Path(p).read_text()) for p in argv[1:3])
        print(json.dumps(diff_breakdowns(a, b), indent=1))
        return 0
    if not argv:
        print(__doc__)
        return 2
    text, source = load_text(Path(argv[0]))
    result = to_dict(parse_text(text, source))
    out = json.dumps(result, indent=1, ensure_ascii=False)
    if "--json" in argv:
        Path(argv[argv.index("--json") + 1]).write_text(out)
    else:
        print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
