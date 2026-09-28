"""Build the grader packet from batch artefacts.

Every grader — a Claude session or `answer_radar.model_grader` — grades from
this packet and MUST copy each entry's `answer_sha256` into its grade file.
`score.py` only counts a grade whose `answer_sha256` equals
`score.answer_identity(row)` for the row it is scoring, and only promotes a
pair when BOTH grades carry it. Building the packet here, from the same row
and the same function, is what makes the two sides agree.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from answer_radar.score import answer_identity

CONDITION_MEANING = {
    "new_chat": "a blank chat: no machine selected",
    "machine_selected": "chat bound to the named manufacturer+model (user-confirmed)",
}


def build_packet(batch_paths: list[Path], references: dict | None = None) -> dict:
    """{"<seed>__<condition>": entry} for every row of every batch."""
    packet: dict = {}
    for path in batch_paths:
        for item in json.loads(path.read_text(encoding="utf-8")):
            q, e, hub = item["question"], item["evaluation"], item.get("hub") or {}
            condition = hub.get("condition") or ""
            sid = q["question_id"]
            entry = {
                "seed_id": sid,
                "condition": condition,
                "condition_meaning": CONDITION_MEANING.get(condition, condition),
                "question": q.get("normalized_question") or "",
                "manufacturer": q.get("manufacturer") or "",
                "model": q.get("model") or "",
                "mira_answer": e.get("answer_text") or "",
                "server_turn_status": hub.get("turn_status"),
                "answer_basis": hub.get("basis"),
                "manual_search": hub.get("retrieval") or {},
                "citations": list(e.get("citations") or []),
                "source_documents": list(e.get("source_documents") or []),
                "answer_sha256": answer_identity(item),
            }
            if references and sid in references:
                entry["reference_notes"] = references[sid]
            packet[f"{sid}__{condition}"] = entry
    return packet


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--batch", action="append", required=True, help="batch-*.json (repeatable)")
    ap.add_argument("--references", default=None, help="optional JSON {seed_id: reference notes}")
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    refs = (
        json.loads(Path(args.references).read_text(encoding="utf-8")) if args.references else None
    )
    packet = build_packet([Path(b) for b in args.batch], refs)
    Path(args.out).write_text(
        json.dumps(packet, indent=1, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"{len(packet)} entries -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
