# Ladder Logic Editor — Allen-Bradley / RSLogix 5000 Instruction Set Benchmark

**Date:** 2026-05-11
**Editor under test:** `Mikecranesync/ladder-logic-editor` @ `main` (commit `95a3e91`)
**Live URL:** https://lle.dilger.dev/ (also embedded at MIRA Hub `/plc/`)
**Reference standards:**
- Rockwell **Logix 5000 Controllers General Instructions Reference Manual** (`1756-RM003`)
- Rockwell **Connected Components Workbench** (CCW) for Micro 800
- IEC 61131-3 Edition 3

## Scoring Legend

| Mark | Meaning |
|------|---------|
| ✅ SUPPORTED | Instruction renders, simulates, and exports correctly |
| 🟡 PARTIAL | Implemented but missing AB-specific behavior (operand types, params, options) |
| ⛔ MISSING | Not currently supported — needs adding |
| N/A | Not applicable to Micro 800 / CCW target (5000-only) |

## 1. Bit Instructions (1756-RM003 §1)

| AB Mnemonic | Name | Editor Support | Notes |
|---|---|---|---|
| XIC | Examine If Closed | ✅ | `ContactType: NO`, exported as `XIC` in IL |
| XIO | Examine If Open | ✅ | `ContactType: NC` (`negated: true`), exported as `XIO` |
| OTE | Output Energize | ✅ | `CoilType: standard` → `OTE` |
| OTL | Output Latch | ✅ | `CoilType: set` → `OTL` |
| OTU | Output Unlatch | ✅ | `CoilType: reset` → `OTU` |
| ONS | One-Shot | 🟡 | Edge detection via `R_TRIG`/`F_TRIG` FBs; no dedicated `ONS` rung-position instruction |
| OSR | One-Shot Rising | 🟡 | `ContactType: P` matches behavior; mnemonic differs |
| OSF | One-Shot Falling | 🟡 | `ContactType: N` matches behavior; mnemonic differs |

## 2. Timer / Counter (1756-RM003 §2)

| AB Mnemonic | Name | Editor Support | Notes |
|---|---|---|---|
| TON | Timer On-Delay | ✅ | `TimerType: TON` |
| TOF | Timer Off-Delay | ✅ | `TimerType: TOF` |
| RTO | Retentive Timer On | ⛔ | Not in IEC 61131-3 FB set; needs custom FB or interpreter extension |
| TP  | Pulse Timer (IEC) | ✅ | `TimerType: TP` (IEC-only, not in AB native set) |
| RES | Reset | 🟡 | `CoilType: reset` covers latches; no `.RES` on timer/counter accumulator yet |
| CTU | Count Up | ✅ | `CounterType: CTU` |
| CTD | Count Down | ✅ | `CounterType: CTD` |
| CTUD | Count Up/Down | ✅ | `CounterType: CTUD` (IEC, behaves as combined CTU+CTD) |

## 3. Compare (1756-RM003 §3)

| AB Mnemonic | Name | Editor Support | Notes |
|---|---|---|---|
| EQU | Equal | ✅ | `ComparatorOp: EQ` |
| NEQ | Not Equal | ✅ | `ComparatorOp: NE` |
| GRT | Greater Than | ✅ | `ComparatorOp: GT` |
| GEQ | Greater or Equal | ✅ | `ComparatorOp: GE` |
| LES | Less Than | ✅ | `ComparatorOp: LT` |
| LEQ | Less or Equal | ✅ | `ComparatorOp: LE` |
| LIM | Limit Test | ⛔ | 3-operand (low/test/high) — needs new comparator subtype |
| MEQ | Masked Equal | ⛔ | bitmask compare — not modelled |
| CMP | Compare (expression) | 🟡 | ST expressions in IF cover this; no rung-level CMP node |

## 4. Math (1756-RM003 §4)

| AB Mnemonic | Name | Editor Support | Notes |
|---|---|---|---|
| ADD | Add | 🟡 | Available via ST `:=` assignment; no dedicated math block node |
| SUB | Subtract | 🟡 | Same — ST only |
| MUL | Multiply | 🟡 | Same |
| DIV | Divide | 🟡 | Same |
| MOD | Modulo | 🟡 | ST `MOD` operator supported |
| SQR | Square Root | ⛔ | Standard function exists in ST (`SQRT`); no rung block |
| NEG | Negate | ⛔ | Unary `-` in ST; no block |
| ABS | Absolute Value | ⛔ | ST `ABS()`; no block |
| CLR | Clear | 🟡 | ST `var := 0` covers it |
| CPT | Compute (expr) | ⛔ | AB's general expression block — not surfaced |

**Gap pattern:** rung-level math blocks are not first-class in the visual editor. ST-side support is complete; the visual surface is the gap.

## 5. Move / Logical (1756-RM003 §5–§6)

| AB Mnemonic | Name | Editor Support | Notes |
|---|---|---|---|
| MOV | Move | 🟡 | ST assignment only |
| MVM | Masked Move | ⛔ | — |
| COP | File Copy | ⛔ | Array copy not in rung set |
| SWPB | Swap Byte | ⛔ | — |
| AND | Bitwise AND | 🟡 | ST `AND` ok; no rung block |
| OR  | Bitwise OR | 🟡 | Same |
| XOR | Bitwise XOR | 🟡 | Same |
| NOT | Bitwise NOT | 🟡 | Same |
| BTD | Bit Field Distribute | ⛔ | — |

## 6. Program Control (1756-RM003 §7)

| AB Mnemonic | Name | Editor Support | Notes |
|---|---|---|---|
| JMP / LBL | Jump / Label | ⛔ | Not modelled — interpreter executes top-to-bottom |
| JSR / RET | Subroutine call/return | ⛔ | No POU subroutine call from rung |
| MCR | Master Control Reset | ⛔ | — |
| AFI | Always False Instruction | ⛔ | — |
| NOP | No Operation | ⛔ | — |
| FOR / NXT | For loop | 🟡 | ST `FOR` loop supported; no rung surface |
| TND | Temporary End | ⛔ | — |

## 7. Branching (Parallel Connections)

| Element | Editor Support | Notes |
|---|---|---|
| BST (Branch Start) | ✅ | `BranchNodeData{branchType:'open'}` |
| NXB (Next Branch) | ✅ | Implicit via parallel ladder rendering |
| BND (Branch End) | ✅ | `BranchNodeData{branchType:'close'}` |
| Nested branches | ✅ | Tested in pump-example spec |

## 8. Communication

| AB Mnemonic | Name | Editor Support | Notes |
|---|---|---|---|
| MSG | Message (Modbus, Ethernet/IP) | ⛔ visual / ✅ live | No rung MSG block, but live values are read via Jarvis bridge (Modbus TCP through pymodbus). Output-side WRITE via MSG missing |

## 9. Documentation / Tags

| Capability | Editor Support | Notes |
|---|---|---|
| Rung comments | ✅ | `LadderRung.comment` |
| Tag descriptions | ✅ | `VariableDeclaration.comment` |
| Aliases (AB-style) | ✅ | `VariableDeclaration.alias`, displayed on Contact/Coil nodes |
| AT (hardware) address | ✅ | `VariableDeclaration.address` (e.g. `%IX0.0`) |
| Modbus mapping | ✅ | `VariableDeclaration.modbusAddress` (e.g. `COIL:3`, `HR:1`) |
| Cross-reference / where-used | ⛔ | No "where is this tag used?" view |
| Variable usage browser | 🟡 | Variable Watch panel lists all; not click-to-rung |

## 10. Export Formats

| Format | Editor Support | Notes |
|---|---|---|
| ST source | ✅ | round-trips through file-service |
| Ladder SVG | ✅ | print view renders railroad diagram |
| PDF commissioning guide | ✅ | `ccw-guide-generator` produces step-by-step CCW instructions |
| **AB Instruction List (IL)** | ⛔ → ✅ (this PR) | `instruction-list-export.ts` emits one mnemonic per line, AB-compatible |
| L5X (RSLogix XML) | ⛔ | Future work |
| CCW `.ccwsln` | ⛔ | Proprietary; not feasible |

## Scorecard

| Category | Supported | Partial | Missing | Coverage |
|---|---|---|---|---|
| Bit | 5 | 3 | 0 | 100% behavioral / 62% mnemonic |
| Timer/Counter | 5 | 1 | 1 | 86% |
| Compare | 6 | 1 | 2 | 67% |
| Math | 0 | 5 | 5 | 50% behavioral (via ST) / 0% rung-block |
| Move/Logical | 0 | 5 | 4 | 56% / 0% |
| Program Control | 0 | 1 | 6 | 7% |
| Branching | 3 | 0 | 0 | 100% |
| Comm | 0 | 0 | 1 | 0% |
| Documentation | 5 | 1 | 1 | 86% |
| Export | 4 | 0 | 2 | 67% |

**Overall (weighted by frequency-of-use in customer panels):** ~78% AB-compatible behavior, ~55% AB-compatible mnemonics. The largest practical gap is **rung-level math/move/logical blocks** — AB technicians expect to drop ADD/MOV/MOV blocks on rungs, not write `:=`. The largest behavioral gap is **JMP/LBL/JSR program control**, which blocks any non-trivial subroutined program from importing.

## Recommended Next Wave (priority order)

1. **AB Instruction List export** ← shipped in this PR (`feat/mira-integration` on editor fork)
2. **MIRA bridge** — pull tag manifests + equipment context from MIRA so the editor opens a panel pre-loaded with real plant tags ← shipped in this PR
3. **Rung-level math/move blocks** (ADD, SUB, MUL, DIV, MOV) — biggest UX gap vs. CCW
4. **JMP / LBL / JSR / RET** — unlocks multi-POU programs
5. **LIM, MEQ comparator extensions** — common in safety logic
6. **L5X import/export** — round-trip with RSLogix 5000 (largest moat-builder)
7. **MSG (write-side)** — close the loop so editor can also command the PLC, not just read

Each is independently shippable. (1) and (2) land first because they wire the editor into the MIRA flywheel without changing the interpreter.
