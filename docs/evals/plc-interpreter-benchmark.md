# PLC Interpreter / Ladder Output Benchmark

**Date:** 2026-05-11
**Subject:** Quality of MIRA's PLC ladder-instruction output vs. Allen-Bradley / Rockwell professional format
**Scope:** `plc/specs/Prog2_ladder.md`, `plc/specs/phase1_ladder.md` (current artifacts); `plc/Prog2.stf`, `plc/specs/phase1_conveyor.iecst` (ST sources)

---

## 0. Honest framing — what exists today

There is **no automated ST→Ladder parser/interpreter script** in the repo. Git log confirms the ladder docs are hand-authored:

```
fbe5fa17 feat(plc): add Prog2 complete ladder reference (50 rungs)
23fb7279 feat(plc): add Phase1 ladder reference doc
c864a097 feat(plc): add Phase1 ST source for ladder-logic-editor
```

What we *do* have is a **ladder-output format spec** (the markdown notation used in `Prog2_ladder.md`) plus the ST source files it was authored from. This benchmark scores **that format** as if it were the output of a future interpreter. The same scorecard tells us what an interpreter would need to emit to be considered professional-grade.

Existing PLC-related Python tooling (`create_mira_plc.py`, `create_ld_project.py`, `populate_variables.py`) handles CCW project scaffolding only — none parse ST or emit ladder instructions.

---

## 1. The two "Allen-Bradley standards"

| Family | Tooling | Target | Tag format | File format |
|---|---|---|---|---|
| **Micro800** | Connected Components Workbench (CCW) | Micro810/820/830/850 (Mike's PLC) | `_IO_EM_DI_00`, free-form symbol names | `.stf` (Structured Text), `.ld` |
| **CompactLogix / ControlLogix** | RSLogix 5000 / Studio 5000 | 1756/5069 chassis controllers | `Program:MainProgram.tag`, `Local:1:I.Data.0` | `.ACD` (binary), `.L5X` (XML) |

The Micro800 instruction set is a **subset** of the Studio 5000 set. "Professional AB format" means different things in each family. This benchmark scores against **both** so MIRA's output can target either market.

---

## 2. Instruction-set inventory (RSLogix 5000 reference)

Categories from the Studio 5000 Instruction Set Reference Manual (1756-RM003).

### 2.1 Bit instructions
XIC, XIO, OTE, OTL, OTU, ONS, OSR, OSF

### 2.2 Timer / Counter
TON, TOF, RTO, CTU, CTD, RES

### 2.3 Compare
CMP, EQU, NEQ, LES, GRT, LEQ, GEQ, LIM, MEQ

### 2.4 Compute / Math
ADD, SUB, MUL, DIV, MOD, SQR, NEG, ABS, CPT, CLR, SQI, SQO, SQL

### 2.5 Move / Logical
MOV, MVM, COP, CPS, FLL, BTD, MSK, AND, OR, XOR, NOT, SWPB

### 2.6 Program-control
JSR, SBR, RET, JMP, LBL, MCR, AFI, NOP, TND, UID, UIE, EOT, FOR, NXT, BRK

### 2.7 Branching (rung structure)
BST (Branch Start), NXB (Next Branch), BND (Branch End)

### 2.8 File / Array
FAL, FSC, FLL, COP, CPS, AVE, STD, SRT, SIZE

### 2.9 Communication
MSG, GSV, SSV

### 2.10 Special / FBD
PID, PIDE, SCL, ALM, TOT, DEDT, RMPS, FGEN

### 2.11 Add-On Instructions (AOI)
User-defined; must support EnableIn / EnableInFalse / EnableOut params + local tags.

### 2.12 User-Defined Types (UDT)
Structured tag types with nested members and per-member data type.

---

## 3. Scorecard — MIRA's current ladder output vs. AB standard

Scoring: **✅ Full** / **🟡 Partial** / **🔴 Missing** / **N/A** (not in Micro800 subset).

| Category | Item | Studio 5000 | Micro800 | MIRA current | Notes |
|---|---|---|---|---|---|
| **Bit** | XIC, XIO, OTE | ✅ | ✅ | ✅ Full | Used + documented in notation legend |
| | OTL, OTU | ✅ | ✅ | 🟡 Partial | OTL used (`(L)`); OTU documented but not used in current rungs |
| | ONS | ✅ | ✅ | ✅ Full | Used 5× in Prog2_ladder.md |
| | OSR, OSF (rising/falling-edge functions) | ✅ | 🟡 (R_TRIG/F_TRIG) | 🔴 Missing | Not in notation legend; if generated from ST `R_TRIG` it should map to OSR |
| **Timer** | TON, TOF | ✅ | ✅ | ✅ Full | TON used 16×, TOF 1× |
| | RTO, RES | ✅ | 🔴 (use `TON.IN := FALSE`) | 🔴 Missing | Add to notation as N/A-Micro800 |
| **Counter** | CTU, CTD | ✅ | ✅ | 🔴 Missing | No counter rungs; benchmark covers cycle_count via ADD — should use CTU |
| **Compare** | EQU, NEQ, GRT, GEQ, LES, LEQ | ✅ | ✅ | 🟡 Partial | EQU 39×, GRT 4× — NEQ/GEQ/LES/LEQ documented but unused |
| | LIM, MEQ | ✅ | 🟡 | 🔴 Missing | Useful for range checks; add |
| | CMP (free-form expression) | ✅ | 🔴 | 🔴 Missing | Micro800 has no CMP — N/A |
| **Math** | ADD, SUB, MUL, DIV | ✅ | ✅ | 🟡 Partial | ADD 9×, MUL 3× — SUB/DIV documented |
| | MOD, SQR, NEG, ABS, CLR | ✅ | ✅ | 🔴 Missing from legend | Add to notation legend |
| | CPT (compute expression) | ✅ | 🔴 | 🔴 Missing | N/A in Micro800 |
| **Move** | MOV, COP | ✅ | ✅ | ✅ Full | MOV 66×, COP 8× |
| | MVM, CPS, FLL, BTD | ✅ | 🟡 | 🔴 Missing | Add MVM for masked moves |
| **Logical** | AND, OR, XOR, NOT | ✅ | ✅ | ✅ Full | All four used |
| | MSK, SWPB | ✅ | 🟡 | 🔴 Missing | Useful for Modbus byte-swap; add |
| **Program control** | JSR, RET | ✅ | ✅ | 🔴 Missing | Prog2 uses sequential ST blocks — JSR would replace cross-program calls |
| | JMP, LBL | ✅ | ✅ | 🔴 Missing | Add for skip-on-fault patterns |
| | MCR | ✅ | 🔴 | 🔴 Missing | N/A in Micro800 |
| | AFI, NOP | ✅ | ✅ | 🔴 Missing | Useful for debug/comment placeholders |
| | FOR/NXT/BRK | ✅ | ✅ | 🔴 Missing | Add to notation for array loops |
| **Branching** | BST / NXB / BND explicit | ✅ Studio 5000 export uses these mnemonics | 🔴 (CCW uses graphical only) | 🟡 Partial | MIRA uses `+--..--+` ASCII branches — readable but not L5X-portable |
| **File/Array** | FAL, FSC, FLL, AVE, STD, SRT | ✅ | 🔴 mostly | 🔴 Missing | N/A Micro800; add for Studio 5000 target |
| **Comm** | MSG (generic) | ✅ | 🟡 (MSG_MODBUS, MSG_CIPGENERIC) | 🟡 Partial | Used 5× as `MSG_MODBUS` function block — correct for Micro800; document the mapping to Studio 5000 `MSG` for portability |
| | GSV, SSV | ✅ | 🔴 | 🔴 Missing | N/A Micro800 |
| **PID/Process** | PID, PIDE, SCL, ALM | ✅ | 🟡 (IPIDCONTROLLER FB) | 🔴 Missing | Document the FB mapping |
| **AOI** | EnableIn/Out, local tags | ✅ | 🟡 (UDFB) | 🔴 Missing | Notation has no FB-internal structure |
| **UDT** | Nested member types | ✅ | 🟡 (Data Types editor) | 🔴 Missing | All tags in current docs are scalars; no UDT examples |

**Rung-structure / metadata items:**

| Item | MIRA current | AB standard |
|---|---|---|
| Rung comment per rung | ✅ Full (`**Comment:**` line on every rung in Prog2_ladder.md — `<rung type="N" number="N"><comment>...`) | ✅ matches L5X convention |
| Instruction list per rung | ✅ Full (`**Instructions:**` bullet list mirrors L5X `<text>` element) | ✅ better than minimum |
| Per-instruction operand description | 🟡 Partial — operand names listed, but no operand data type or scope tag | ✅ Studio 5000 export shows `Local Tags`/`Parameters` block |
| Tag declaration table | ✅ Full (`## Variable summary` table with name, type, initial, purpose) | ✅ exceeds CCW default |
| Tag addressing | 🟡 CCW `_IO_EM_DI_00` style only — no `Program:MainProgram.tag` form | 🔴 Studio 5000 not addressed |
| Module / I/O map | 🟡 Partial — embedded in variable table comments | ✅ Studio 5000 has dedicated I/O Configuration tree |
| Cross-reference (tag → rung uses) | 🔴 Missing | ✅ RSLogix has Cross Reference view |
| Power-rail / rung-number visualization | ✅ Each rung is its own `### Rung N.M` heading | ✅ |
| Branch instructions (BST/NXB/BND) | 🟡 ASCII `+--..--+` only — readable, not L5X-portable | 🔴 No L5X export possible |
| Routine / program containment | 🟡 Sections under `## SECTION N` headings | ✅ Matches L5X `<Routine>` |
| Task / Program scheduling | 🔴 Missing | ✅ L5X `<Tasks>` element |
| L5X export | 🔴 Missing | ✅ Gold standard for import into Studio 5000 |
| Cross-rung dependency graph | 🔴 Missing | 🟡 Studio 5000 doesn't ship this either — value-add opportunity |

**Aggregate:**
- Micro800 / CCW conformance: **~75% complete**. Strong on bit/timer/move/compare/logical, weak on counter and program-control.
- Studio 5000 (full RSLogix 5000) conformance: **~35% complete**. Missing UDT, AOI, BST/NXB/BND, L5X export, GSV/SSV, file/array ops, PID.

---

## 4. Gap analysis — what's missing

### 4.1 P0 (block "professional" claim — required for any AB target)

1. **Explicit `BST` / `NXB` / `BND` branch mnemonics** alongside the ASCII art. Currently a rung like
   ```
        A    B
     +--[ ]--[/]--+--( )--
     |            |
     +--[/]--[ ]--+
        A    B
   ```
   has no machine-parseable equivalent. RSLogix L5X requires:
   ```
   BST XIC(A) XIO(B) NXB XIO(A) XIC(B) BND OTE(out)
   ```
   This single addition makes the whole document import-ready.

2. **Counter instructions (CTU/CTD/RES).** `Prog2_ladder.md` currently increments `cycle_count` via `ADD cycle_count 1 cycle_count` — an AB engineer would write this as a CTU on a rising edge.

3. **Notation legend is incomplete.** OSR/OSF, NEG, ABS, CLR, MOD, SQR, MVM, LIM, MEQ, JSR, JMP/LBL, AFI, NOP are not in the legend. Add them with their Micro800 availability flag.

### 4.2 P1 (raises quality, optional for Micro800-only deployments)

4. **L5X export companion.** Add `tools/plc/ladder_to_l5x.py` that emits Studio 5000-importable XML from the same source. Even a minimal exporter (bits + timers + math + branching) is a major credibility lift.

5. **Cross-reference table.** For every tag, list the rungs where it's read vs. written. RSLogix has this as a built-in view; emitting it in markdown would be a differentiator.

6. **Operand type annotation.** Every operand in the per-rung Instructions bullet list should carry its data type (`MOV cycle_count [DINT] 0`).

7. **UDT examples.** Even the simple `xor_ok / estop_wiring_fault / fault_alarm` set is a candidate for a `Type_EStop` UDT with `.healthy / .wiring_fault / .latched` members. Demonstrates structured tag handling.

### 4.3 P2 (nice-to-have, Studio-5000 territory)

8. **AOI demonstration.** Rewrite the e-stop XOR pattern as an Add-On Instruction so it can be reused.
9. **Task/Program scheduling metadata** at document top.
10. **PID example** with `IPIDCONTROLLER` (Micro800) and Studio 5000 `PID`/`PIDE` mapping.

---

## 5. Recommended build order

| # | Deliverable | Effort | Where it lives | Unlock |
|---|---|---|---|---|
| 1 | Expand notation legend in `plc/specs/Prog2_ladder.md` with all P0 mnemonics + Micro800 availability column | 30 min | edit existing doc | covers gaps 3 + start of 1 |
| 2 | Emit explicit `BST/NXB/BND` lines next to ASCII branches in every multi-branch rung | 2 h | edit existing doc | gap 1 — L5X-import readiness |
| 3 | Replace `cycle_count` ADD pattern with CTU + document the pattern as the canonical counter idiom | 30 min | edit existing doc | gap 2 |
| 4 | Build `tools/plc/ladder_to_l5x.py` — markdown → L5X minimal exporter | 1–2 days | new tool | gap 4 — biggest credibility win |
| 5 | Add `tools/plc/xref.py` to generate cross-reference table appendix | 4 h | new tool | gap 5 |
| 6 | Build `tools/plc/st_to_ladder.py` — true ST→ladder parser (the "interpreter" the brief originally asked about) | 3–5 days | new tool | replaces hand-authoring; closes the original prompt |

Deliverable #6 is the real "PLC interpreter tool." Once it exists, this benchmark becomes the regression spec for it.

---

## 6. Reference sources

- Rockwell Automation pub **1756-RM003** — *Logix 5000 Controllers General Instructions Reference Manual*
- Rockwell Automation pub **2080-RM001** — *Micro800 Programmable Controllers General Instructions Reference Manual*
- Rockwell **L5X format** — exporter format documented in Studio 5000 help; community spec: https://github.com/dmroeder/pylogix and https://github.com/ottowayi/pycomm3 (read paths only)
- IEC 61131-3 — ST and LD semantics; what CCW Micro800 actually implements

---

## 7. How to use this benchmark

- Treat the scorecard in §3 as the regression spec for any future ST→ladder generator.
- When a new ladder doc is authored or generated, run it through the same scorecard and record the date + score at the top of the doc.
- When `tools/plc/st_to_ladder.py` lands, this file becomes its acceptance test: every category must reach ✅ or be explicitly marked N/A for the Micro800 target.
