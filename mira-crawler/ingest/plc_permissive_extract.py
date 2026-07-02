"""Extract permissive / interlock relationships from IEC-61131 Structured Text.

This is the INGEST source step of the interlock flywheel
(`docs/north-star/interlock-flywheel-audit.md`). It turns the *hidden machine
logic* a SCADA/HMI never exposes — the run-permissive chain in the PLC program —
into explicit, citable edges that can be proposed, human-approved, and later
consumed by MIRA to explain *why a machine will not move*.

Scope (deliberately small): boolean assignment lines of the form

    LHS := <operand> [AND|OR] [NOT] <operand> ... ;

Each operand on the right becomes a `USED_IN_LOGIC` edge `operand -> LHS`. An
operand under a logical `NOT` in a *permissive* (a signal whose name reads like
an enable/permit/ready/run) is additionally flagged as a **blocker**: when it is
TRUE the permissive goes FALSE, which is exactly the "hidden condition blocks
motion" failure. We do NOT build a general ST interpreter — only enough to lift
the causal operands and keep the rung text as evidence (`relationship_evidence`
`plc_rung`).

Deterministic and offline: no DB, no LLM. Reused by the proposal step which
writes through the real `proposal_writer.propose_relationship`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Tokens that are operators / literals, never signal operands.
_ST_KEYWORDS = frozenset(
    {"AND", "OR", "XOR", "NOT", "TRUE", "FALSE", "MOD", "DIV"}
)

# A signal whose name reads like a permissive / enable. Used only to decide
# whether a NOT-ed operand is a "blocker" (TRUE inhibits motion).
_PERMISSIVE_NAME = re.compile(
    r"(permit|permissive|enable|_ok\b|ready|run|allow|interlock)", re.IGNORECASE
)

# `LHS := <rhs> ;`  — capture a single boolean assignment statement.
_ASSIGN = re.compile(r"^\s*([A-Za-z_]\w*)\s*:=\s*(.+?);", re.MULTILINE)


@dataclass(frozen=True)
class InterlockEdge:
    """One extracted causal edge `source -> target` lifted from PLC logic.

    `relation` is the lowercase ingest edge type fed to
    `proposal_writer.propose_relationship` (mapped to USED_IN_LOGIC / CAUSES).
    `negated`/`blocker` mark the "NOT pe_latched" case: pe_latched blocks the
    target permissive when TRUE. `rung_line` + `rung_text` are the citable
    `plc_rung` evidence.
    """

    source: str          # operand signal, e.g. "pe_latched"
    target: str          # assigned signal, e.g. "vfd_run_permit"
    relation: str        # "used_in_logic" | "causes"
    rung_line: int       # 1-based line in the source file
    rung_text: str       # the verbatim assignment statement
    source_file: str
    negated: bool = False
    blocker: bool = False
    properties: dict = field(default_factory=dict)


def _operands(rhs: str) -> list[tuple[str, bool]]:
    """Return (identifier, negated) for each signal operand in an RHS expression.

    `negated` is True when the operand is immediately preceded by `NOT`.
    Keywords and numeric literals are skipped. Order preserved, de-duped on
    first occurrence (an operand used twice in one rung is one edge).
    """
    out: list[tuple[str, bool]] = []
    seen: set[str] = set()
    pending_not = False
    for tok in re.findall(r"NOT\b|[A-Za-z_]\w*", rhs, re.IGNORECASE):
        up = tok.upper()
        if up == "NOT":
            pending_not = True
            continue
        if up in _ST_KEYWORDS:
            pending_not = False
            continue
        # real signal operand
        if tok not in seen:
            out.append((tok, pending_not))
            seen.add(tok)
        pending_not = False
    return out


def extract_permissive_edges(
    st_text: str, source_file: str = "plc_program.st"
) -> list[InterlockEdge]:
    """Lift `USED_IN_LOGIC` edges from boolean assignments in Structured Text.

    Only assignments whose RHS contains a logical operator (AND/OR/NOT) are
    treated as permissive/derived logic — plain `x := TRUE;` latch lines are
    skipped (they carry no operand causality). Returns edges in source order.
    """
    lines = st_text.splitlines()
    # Pre-compute a line index for each match via offset → line number.
    edges: list[InterlockEdge] = []
    for m in _ASSIGN.finditer(st_text):
        target, rhs = m.group(1), m.group(2).strip()
        # Skip pure literal / arithmetic assignments — no boolean logic.
        if not re.search(r"\b(AND|OR|NOT)\b", rhs, re.IGNORECASE):
            continue
        line_no = st_text.count("\n", 0, m.start()) + 1
        rung_text = lines[line_no - 1].strip() if 0 < line_no <= len(lines) else m.group(0).strip()
        target_is_permissive = bool(_PERMISSIVE_NAME.search(target))
        for ident, negated in _operands(rhs):
            if ident == target:
                continue  # self-reference guard
            blocker = negated and target_is_permissive
            # Encode blocker-ness in the relation TYPE so it survives the Hub
            # decide route (which copies relationship_type + evidence_summary
            # into kg_relationships, but NOT properties): a NOT-ed permissive
            # operand is a causal blocker -> CAUSES; everything else is a
            # structural dependency -> USED_IN_LOGIC.
            relation = "causes" if blocker else "used_in_logic"
            edges.append(
                InterlockEdge(
                    source=ident,
                    target=target,
                    relation=relation,
                    rung_line=line_no,
                    rung_text=rung_text,
                    source_file=source_file,
                    negated=negated,
                    blocker=blocker,
                    properties={
                        "negated": negated,
                        "blocker": blocker,
                        "rung": f"{source_file}:{line_no}",
                    },
                )
            )
    return edges


def blockers_for(edges: list[InterlockEdge], target: str) -> list[InterlockEdge]:
    """The blocker edges that inhibit `target` (NOT-ed operands of a permissive)."""
    return [e for e in edges if e.target == target and e.blocker]
