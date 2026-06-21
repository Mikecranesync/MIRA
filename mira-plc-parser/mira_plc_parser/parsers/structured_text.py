"""IEC 61131-3 Structured Text (.st / .scl / .exp) parser -> MIRA PLC IR.

ST is vendor-neutral and is the "reasoning bridge": it is the lowest-common-denominator export that
CODESYS / OpenPLC / TwinCAT / Siemens-SCL can all produce, and it is plain text. We extract the
structural facts only (HIGH confidence) -- interpretation stays in the analysis layer:

  * VAR ... END_VAR declarations  -> IR Tags (VAR_GLOBAL -> controller scope; others -> program scope)
  * each POU (PROGRAM / FUNCTION_BLOCK / FUNCTION) -> a Program with one ST Routine
  * the POU body is preserved verbatim as Routine.st_text, AND each `LHS := expr;` assignment is
    lifted into a synthetic Rung (output = LHS, condition refs = the tags in the statement) so the
    existing rung-based analysis (output dependencies, usage x-ref) works on ST too.

Read-only: parses text, never writes. No vendor SDK, no network -- stdlib only.
"""
from __future__ import annotations

import re

from ..ir import (
    Confidence,
    Controller,
    PLCProject,
    Program,
    Provenance,
    Routine,
    RoutineType,
    Rung,
    Tag,
    TagScope,
)

FORMAT = "structured_text"

# POU block: PROGRAM/FUNCTION_BLOCK/FUNCTION <name> ... END_<kind>
_POU_RE = re.compile(
    r"\b(PROGRAM|FUNCTION_BLOCK|FUNCTION)\b\s+([A-Za-z_]\w*).*?\bEND_\1\b",
    re.IGNORECASE | re.DOTALL,
)
# a VAR section (any flavour) up to its END_VAR
_VAR_BLOCK_RE = re.compile(
    r"\b(VAR(?:_INPUT|_OUTPUT|_IN_OUT|_GLOBAL|_TEMP|_EXTERNAL|_ACCESS)?)\b"
    r"(?:\s+(?:CONSTANT|RETAIN|PERSISTENT))?\s*(.*?)\bEND_VAR\b",
    re.IGNORECASE | re.DOTALL,
)
# one declaration line:  name : TYPE [:= init] ;  [(* comment *) | // comment]
_DECL_RE = re.compile(
    r"^\s*([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*(?:\s*\[[^\]]*\])?)\s*"
    r"(?::=\s*(.*?))?\s*;\s*(?:\(\*(.*?)\*\)|//(.*))?\s*$",
    re.DOTALL,
)
_BLOCK_COMMENT_RE = re.compile(r"\(\*.*?\*\)", re.DOTALL)
_LINE_COMMENT_RE = re.compile(r"//[^\n]*")
_IDENT_RE = re.compile(r"[A-Za-z_]\w*")
_LHS_TAIL_RE = re.compile(r"([A-Za-z_][\w.\[\]]*)\s*$")

# ST control keywords, boolean literals, and elementary types -- never IR tag references.
_STOPWORDS = {
    "IF", "THEN", "ELSE", "ELSIF", "END_IF", "CASE", "OF", "END_CASE", "FOR", "TO", "BY", "DO",
    "END_FOR", "WHILE", "END_WHILE", "REPEAT", "UNTIL", "END_REPEAT", "RETURN", "EXIT", "CONTINUE",
    "AND", "OR", "XOR", "NOT", "MOD", "TRUE", "FALSE", "NULL", "AT",
    "BOOL", "SINT", "INT", "DINT", "LINT", "USINT", "UINT", "UDINT", "ULINT", "REAL", "LREAL",
    "TIME", "DATE", "STRING", "WSTRING", "BYTE", "WORD", "DWORD", "LWORD",
    "TON", "TOF", "TP", "CTU", "CTD", "CTUD", "R_TRIG", "F_TRIG",
}


def _prov(src: str, locator: str) -> Provenance:
    return Provenance(source_file=src, source_format=FORMAT, locator=locator, confidence=Confidence.HIGH)


def parse(text: str, source_file: str = "") -> PLCProject:
    """Parse ST text into a PLCProject. No POU found -> a project with a warning (no crash)."""
    proj = PLCProject(source_format=FORMAT, source_files=[source_file] if source_file else [])
    pous = list(_POU_RE.finditer(text or ""))
    if not pous:
        proj.warnings.append("no PROGRAM/FUNCTION_BLOCK/FUNCTION block found in ST source")
        return proj

    ctrl = Controller(
        name=pous[0].group(2),
        vendor="IEC 61131-3",
        software="Structured Text (IEC 61131-3)",
        provenance=_prov(source_file, "POU[%s]" % pous[0].group(2)),
    )
    inferred = 0
    for m in pous:
        inferred += _parse_pou(m.group(1), m.group(2), m.group(0), ctrl, source_file)
    if inferred:
        proj.warnings.append(
            "%d variable(s) inferred from ST assignments (no VAR block in this export); "
            "types/addresses unknown -- supply the CCW Controller-Variables CSV to enrich them"
            % inferred
        )
    proj.controllers.append(ctrl)
    return proj


def _parse_pou(kind: str, name: str, block: str, ctrl: Controller, src: str) -> int:
    """Parse one POU into ctrl. Returns the count of tags synthesized from undeclared assignments."""
    prog = Program(name=name)
    body = block
    for vm in _VAR_BLOCK_RE.finditer(block):
        section = vm.group(1).upper()
        is_global = section == "VAR_GLOBAL"
        scope = TagScope.CONTROLLER.value if is_global else TagScope.PROGRAM.value
        for tag in _parse_var_block(vm.group(2), scope, name, src):
            (ctrl.tags if is_global else prog.tags).append(tag)
        body = body.replace(vm.group(0), "\n")   # drop declarations from the executable body

    routine = Routine(
        name=name, type=RoutineType.ST.value,
        st_text=_body_text(kind, name, body),
        provenance=_prov(src, "%s/Routine[%s]" % (name, name)),
    )
    routine.rungs = _statements_to_rungs(routine.st_text, name, src)
    prog.routines.append(routine)
    inferred = _synthesize_undeclared_tags(prog, ctrl, name, src)
    ctrl.programs.append(prog)
    return inferred


def _synthesize_undeclared_tags(prog: Program, ctrl: Controller, pou: str, src: str) -> int:
    """Recover variables that the ST body assigns to but never declares (the CCW case).

    Real Allen-Bradley CCW (Micro8xx) exports keep the variable table OUT of the .st -- it lives in
    CCW's Controller Variables grid (a separate CSV). So a declared-VAR pass finds nothing and the
    whole analysis comes back empty. The assignment targets ARE the controlled variables, so we lift
    each undeclared one into a tag with unknown type and MEDIUM confidence (it's a real symbol, but
    we don't have its declaration). Supply the companion CCW variables CSV for types/addresses.

    No-op when every assigned symbol is already declared (the full-VAR case) -- so declared-VAR
    fixtures, and their golden reports, are unaffected.
    """
    declared = {t.name for t in ctrl.tags} | {t.name for t in prog.tags}
    assigned: list[str] = []
    seen: set[str] = set(declared)
    for routine in prog.routines:
        for rung in routine.rungs:
            for out in rung.outputs:
                if out and out not in seen:
                    seen.add(out)
                    assigned.append(out)
    for sym in assigned:
        prog.tags.append(Tag(
            name=sym, data_type="", scope=TagScope.PROGRAM.value,
            description="(inferred from ST assignment; not declared in this export)",
            provenance=Provenance(source_file=src, source_format=FORMAT,
                                  locator="%s/AssignedSymbol[%s]" % (pou, sym),
                                  confidence=Confidence.MEDIUM),
        ))
    return len(assigned)


def _parse_var_block(block: str, scope: str, pou: str, src: str) -> list[Tag]:
    """One declaration per line (`name : TYPE [:= init];  (* comment *)`), as ST exports emit them.

    Parsed line-by-line, NOT by splitting on ';': the inline comment sits *after* the ';' on the
    same line, so a ';'-split would mis-attach each comment to the following declaration.
    """
    tags: list[Tag] = []
    for raw in block.splitlines():
        line = raw.strip()
        if not line or line.startswith("(*") or line.startswith("//"):
            continue
        m = _DECL_RE.match(line)
        if not m:
            continue
        comment = (m.group(4) or m.group(5) or "").strip()
        tags.append(Tag(
            name=m.group(1),
            data_type=re.sub(r"\s+", "", m.group(2)),
            scope=scope,
            description=comment,
            initial_value=(m.group(3) or "").strip(),
            provenance=_prov(src, "%s/Var[%s]" % (pou, m.group(1))),
        ))
    return tags


def _body_text(kind: str, name: str, body: str) -> str:
    """The executable statements of a POU: strip the POU header/footer keywords, keep the logic."""
    txt = re.sub(r"^\s*%s\s+%s\b" % (kind, re.escape(name)), "", body, count=1, flags=re.IGNORECASE)
    txt = re.sub(r"\bEND_%s\b\s*$" % kind, "", txt, count=1, flags=re.IGNORECASE)
    return txt.strip()


def _strip_comments(text: str) -> str:
    return _LINE_COMMENT_RE.sub("", _BLOCK_COMMENT_RE.sub(" ", text))


def _top_level_assign_lhs(stmt: str) -> str | None:
    """The assigned variable of a real `LHS := RHS` statement, or None.

    Only a `:=` at parenthesis depth 0 is a statement assignment. ST function-block calls use
    NAMED-ARGUMENT syntax -- `mb_read(IN := x, LocalCfg := y)` -- whose `:=` sit inside the call
    parens; treating those as assignments would mint bogus signals (IN, LocalCfg, Cmd, ...) and
    bogus dependency edges. Skipping depth>0 `:=` keeps only genuine assignments.
    """
    depth = 0
    for i in range(len(stmt) - 1):
        ch = stmt[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        elif ch == ":" and stmt[i + 1] == "=" and depth == 0:
            m = _LHS_TAIL_RE.search(stmt[:i])
            return m.group(1) if m else None
    return None


def _statements_to_rungs(st_text: str, pou: str, src: str) -> list[Rung]:
    """Lift `LHS := expr;` assignments into synthetic rungs so rung-based analysis works on ST.

    LHS is the driven output; every other identifier in the statement is a condition ref. This is a
    deliberate, conservative model -- IF/CASE wrappers contribute their guard tags as refs, which is
    exactly what the output-dependency view wants ("MotorRun true when: StartPB, EStopOK, ...").
    """
    code = _strip_comments(st_text)
    rungs: list[Rung] = []
    n = 0
    for stmt in code.split(";"):
        lhs = _top_level_assign_lhs(stmt)
        if lhs is None:
            continue
        output = lhs.split(".")[0].split("[")[0]
        refs: list[str] = []
        seen: set[str] = set()
        for im in _IDENT_RE.finditer(stmt):
            tok = im.group(0)
            if tok.upper() in _STOPWORDS or tok in seen:
                continue
            seen.add(tok)
            refs.append(tok)
        rungs.append(Rung(
            number=n, text=stmt.strip(), refs=refs, outputs=[output], instructions=[":="],
            provenance=_prov(src, "%s/Rung[%d]" % (pou, n)),
        ))
        n += 1
    return rungs
