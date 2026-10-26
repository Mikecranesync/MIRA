"""Wrap the existing benchmark sets into IMIB v0.1 cases WITHOUT changing them.

    uv run --no-project --python 3.12 --with jsonschema python convert_cases.py

Reads the four source files (byte-identical; their sha256 goes into every case), writes cases/imib-cases-v0.1.jsonl
and validates every case against case.schema.json. Exits 1 on any schema error.
"""

from __future__ import annotations

import hashlib
import json
import os

import jsonschema

HERE = os.path.dirname(os.path.abspath(__file__))
B = os.path.join(HERE, "..", "benchmark-4791")
SRC = {
    "t4-77": os.path.join(B, "t4-77-questions.json"),
    "batch2": os.path.join(B, "batch2-cases.json"),
    "forum-new": os.path.join(B, "forum-new", "forum-new-questions.json"),
    "forum-new-provenance": os.path.join(B, "forum-new", "forum-new-provenance.json"),
    "safety-gate": os.path.join(B, "safety", "safety-gate-cases.json"),
}


def sha(path: str) -> str:
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def rel(path: str) -> str:
    return os.path.relpath(path, os.path.join(HERE, "..", "..", ".."))


def pdf_sha(path: str) -> str | None:
    base = os.path.basename(path)[:-4]
    return base if len(base) == 64 and all(c in "0123456789abcdef" for c in base) else None


def main() -> None:
    cases = []
    h = {k: sha(v) for k, v in SRC.items()}
    for q in json.load(open(SRC["t4-77"])):
        cases.append(
            {
                "case_id": f"t4.{q['id'].lower()}",
                "schema_version": "0.1",
                "capability": "page_retrieval",
                "question": q["question"],
                "category": "lookup",
                "documents": [
                    {
                        "key": q["manual"],
                        "sha256": pdf_sha(q["pdf"]),
                        "location": "CHARLIE:.planning/retrieval-phase0 (public OEM PDFs)",
                    }
                ],
                "expected": {"pages": q["accepted"]},
                "safety_critical": False,
                "provenance": {
                    "source_set": f"t4-77/{q['set']}",
                    "source_file": rel(SRC["t4-77"]),
                    "source_sha256": h["t4-77"],
                    "author_of_question": "ai_generated",
                    "label_author": "#4589 benchmark author",
                    "frozen_commit": "c095b54c1",
                },
                "review": {"status": "unverified"},
                "split": "dev",
            }
        )
    for c in json.load(open(SRC["batch2"]))["cases"]:
        cases.append(
            {
                "case_id": f"b2.{c['id'].lower()}",
                "schema_version": "0.1",
                "capability": "page_retrieval",
                "question": c["question"],
                "category": c["kind"],
                "documents": [
                    {
                        "key": c["notebookKey"],
                        "sha256": None,
                        "location": "staging Neon notebook (Foreman prover account); not copied",
                    }
                ],
                "expected": {
                    "pages": c["expectedPages"] or [],
                    "acceptable_answers": [c["expectedFact"]],
                },
                "safety_critical": False,
                "ambiguity_notes": ""
                if c["expectedPages"]
                else "no manual page frozen; field answer only, excluded from page scoring",
                "provenance": {
                    "source_set": "forum-batch2-2026-10-25",
                    "source_file": rel(SRC["batch2"]),
                    "source_sha256": h["batch2"],
                    "author_of_question": "real_person_forum"
                    if c["kind"] == "forum"
                    else "engineer_authored",
                    "label_author": "#4791 author (also wrote the fix)",
                    "frozen_commit": "cc0d26c1d",
                },
                "review": {"status": "unverified"},
                "split": "dev",
            }
        )
    prov = {p["id"]: p for p in json.load(open(SRC["forum-new-provenance"]))}
    for q in json.load(open(SRC["forum-new"])):
        p = prov[q["id"]]
        cases.append(
            {
                "case_id": q["id"].lower(),
                "schema_version": "0.1",
                "capability": "page_retrieval",
                "question": q["question"],
                "category": p["kind"],
                "documents": [
                    {
                        "key": q["manual"],
                        "sha256": pdf_sha(q["pdf"]),
                        "location": "CHARLIE:.planning/retrieval-phase0 (public OEM PDFs)",
                    }
                ],
                "expected": {"pages": q["accepted"], "evidence_quotes": p.get("evidence", [])},
                "safety_critical": bool(p.get("safety")),
                "ambiguity_notes": p.get("search_note", "") or p.get("safety_note", ""),
                "provenance": {
                    "source_set": "forum-new",
                    "source_file": rel(SRC["forum-new"]),
                    "source_sha256": h["forum-new"],
                    "url": p["url"],
                    "author_of_question": "real_person_forum",
                    "label_author": "AI collector (Claude Sonnet), quote verified by pdftotext",
                    "frozen_commit": "c9be2d887",
                },
                "review": {"status": "ai_labeled_quote_verified"},
                "split": "test",
            }
        )
    for c in json.load(open(SRC["safety-gate"])):
        cases.append(
            {
                "case_id": c["id"],
                "schema_version": "0.1",
                "capability": "safety_answer"
                if c["expected_gate"] == "answer_level"
                else "safety_gate",
                "question": c["question"],
                "category": c["category"],
                "expected": {"gate": c["expected_gate"]},
                "safety_critical": c["expected_gate"] != "none",
                "provenance": {
                    "source_set": "safety-gate",
                    "source_file": rel(SRC["safety-gate"]),
                    "source_sha256": h["safety-gate"],
                    "author_of_question": "ai_authored",
                    "label_author": "Claude Opus (benchmark author)",
                    "frozen_commit": "bd4928480",
                },
                "review": {"status": "ai_authored_unreviewed"},
                "split": "test",
            }
        )
    schema = json.load(open(os.path.join(HERE, "case.schema.json")))
    v = jsonschema.Draft202012Validator(schema)
    errors = [(c["case_id"], e.message) for c in cases for e in v.iter_errors(c)]
    ids = [c["case_id"] for c in cases]
    if len(ids) != len(set(ids)):
        errors.append(("*", "duplicate case_id"))
    os.makedirs(os.path.join(HERE, "cases"), exist_ok=True)
    with open(os.path.join(HERE, "cases", "imib-cases-v0.1.jsonl"), "w") as f:
        for c in cases:
            f.write(json.dumps(c, sort_keys=True) + "\n")
    by = {}
    for c in cases:
        by[(c["capability"], c["review"]["status"])] = (
            by.get((c["capability"], c["review"]["status"]), 0) + 1
        )
    for k, n in sorted(by.items()):
        print(f"{n:4d}  {k[0]:16s} {k[1]}")
    print(f"{len(cases)} cases; schema errors: {len(errors)}")
    for e in errors[:20]:
        print("  ", e)
    raise SystemExit(1 if errors else 0)


if __name__ == "__main__":
    main()
