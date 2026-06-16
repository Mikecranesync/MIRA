# Cowork Prompt — MIRA_PLC PR #6 (Conv_Simple_1.4 Modbus debug + Typst port): higher-level review

**Authored:** 2026-05-23 (CHARLIE) · for a peer Claude on ALPHA / BRAVO or for an
adversarial second-opinion pass (ChatGPT / Gemini / advisor model).

**Your role:** You are a strategic reviewer, not an executor. Do not edit
files. Read the artifacts below, then answer the **Insight Questions**. Be
opinionated — Mike doesn't need consensus, he needs the load-bearing risks
named.

---

## Background you need before reading anything else

**MIRA_PLC** is the private repo `Mikecranesync/MIRA_PLC` (not the `plc/`
subdirectory of the public MIRA monorepo — that's an older, unrelated
artifact). It holds the **conveyor PLC firmware** for Mike's bench rig:

- **Controller:** Allen-Bradley **Micro 820** (firmware rev 14), CCW 22.
- **Drive:** Delta **GS10** VFD on **Modbus RTU** RS-485, slave 1, 38400 8N2,
  FC 03, addr 0x2100, valid CRC.
- **Adjacent deliverables:** an Ignition project + a Typst work-instruction
  PDF generator (the technician-facing doc).
- **Demo target:** Florida Automation Expo, 2026-05-21 (already past).

The repo is a hardware bring-up artifact: the goal is a working bench rig
that demonstrates a Micro 820 talking to a GS10 over Modbus RTU, with a
clean work-instruction PDF that customers can take home.

---

## What PR #6 actually is

URL: <https://github.com/Mikecranesync/MIRA_PLC/pull/6>
Title: **"Conv_Simple_1.4 PLC project + Typst work-instruction port"**
Branch: `docs/typst-work-instruction` → `main`
Size: **310 files, +12,959 / -0** — most of which is CCW IDE binary/cache
output, plus three full snapshots of the project (`Conv_Simple_1.2`, `1.3`,
`1.4`).
Status: **OPEN, no checks configured.**

It bundles two strands:

### Strand A — Typst work-instruction port (commits `650bed1` → `bfed6e4`)

New parallel directory `specs/work-instruction-typst/` alongside the existing
LaTeX shipping doc. The LaTeX version remains the source of truth until the
Typst port ships a complete PDF and the deploy flips. Key files:

- `specs/work-instruction-typst/main.typ`, `lib/styles.typ`, `Makefile`
- `sections/00-cover.typ` … `06-modbus-comms.typ` (§1 missing — index)
- `sections/06-modbus-comms.typ` — full port, 1364 → 820 lines (compaction)
- `ladder-sheet.typ` — standalone landscape MSG_MODBUS2 setup sheet
- Plus three typst-syntax fixes (heading numbering, asterisk escaping,
  italic→`#emph[]`).

### Strand B — Conv_Simple_1.4 PLC project (commit `7576aa9`)

The actual PLC-side work that motivated §6. Conv_Simple_1.4 is the working
CCW project; 1.2 and 1.3 snapshots are included as history.

**Software state — confirmed by Mike:**

- CCW Build → 0 errors / 0 warnings on Conv_Simple_1.4.
- PLC enters Run mode after download.
- ModbusTerm sniffer on COM3 confirms PLC transmits well-formed RTU frames
  to slave 1, FC 03, addr 0x2100, valid CRC.
- GS10 health independently verified: laptop ModbusTerm in **Master** mode
  reads GS10 holding registers successfully on the same physical bus.

**Compile fixes 1.3 → 1.4 (Prog_init.stf, three surgical edits):**

| Line | Before | After | Root cause |
|---|---|---|---|
| 21 | `LocalAddr := READDATA` | `LocalAddr := read_data` | scalar→array (`MSG_MODBUS.LocalAddr` requires the `[1..125]` array `read_data`, not the scalar global `READDATA`) |
| 30 | `ReadStatusWord := READDATA[1]` | `ReadStatusWord := read_data[1]` | same root cause |
| 34 | `END_IF` | `END_IF;` | consistency with rest of file |

**The hardware blocker — still open:**

GS10 **does not reply** to the PLC despite:
- Valid PLC frames on the wire (sniffer confirmed)
- GS10 healthy (laptop master test confirmed)
- All software / CCW config checks passing

Recommended next action in the PR body: **2080-SERIALISOL plug-in** per
Rockwell KB 455668 — hypothesis is an RX-side hardware fault on the
non-isolated embedded RS-485 port. A 9600-baud sanity test is also mentioned
as a cheaper precursor.

Full debug log in local memory: `project_modbus_debug_session_2026_05_23`
(not in the index I can see from this session, but the PR body cites it).

### Test-plan checklist from the PR body

| Item | State |
|---|---|
| CCW Build 0/0 on Conv_Simple_1.4 | ✓ |
| Download → PLC enters Run | ✓ |
| Sniffer confirms valid TX | ✓ |
| GS10 responds in master test | ✓ |
| 2080-SERIALISOL plug-in test → ErrorID 55 clears, ReadStatusWord populates | ⏳ pending hardware |
| Typst PDF builds clean | ⏳ pending (existing CI/timer rebuild) |

---

## Artifacts to read

1. <https://github.com/Mikecranesync/MIRA_PLC/pull/6> — the PR itself.
2. `Conv_Simple_1.4/Controller/Controller/Micro820/Micro820/Prog_init.stf` —
   the file the three compile-fix edits landed in.
3. `Conv_Simple_1.4/Controller/Controller/Micro820/Micro820/Prog1.stf` —
   the main scan-cycle program (62 added lines).
4. `specs/work-instruction-typst/sections/06-modbus-comms.typ` — the full
   §6 port.
5. `specs/work-instruction-typst/sections/05-sequence-of-operations.typ` —
   the operational context that §6 supports.
6. `specs/work-instruction-typst/ladder-sheet.typ` — standalone
   MSG_MODBUS2 setup sheet.
7. The PR body, especially the **"Snapshots included"** list — three full
   CCW projects are in the diff.
8. Rockwell KB 455668 (referenced for the SERIALISOL recommendation) and
   Publication 2080-QS004E-EN-E (Dec 2025) — Micro800 + PanelView 800 Quick
   Start, ingested locally at `/Users/charlienode/Downloads/2080-qs004_-en-e.pdf`.

---

## Insight Questions — answer in order, with real opinions

### 1. Is 2080-SERIALISOL really the right next step, or is it a $150 guess?

The current theory is "RX-side hardware fault on the non-isolated embedded
RS-485 port." Before recommending a hardware purchase, audit cheaper
diagnostics that haven't been ruled out:

- **Termination + biasing.** The PR doesn't list whether 120Ω terminators
  are present at both ends and whether fail-safe bias is enabled. RS-485
  half-duplex without proper bias frequently *transmits* fine but *receives*
  garbage because the line floats during the silent interval — which exactly
  matches the symptom (valid TX, no RX).
- **Turnaround timing.** Micro 820 embedded port has a hard-coded
  RTS-to-TX-end latency; if the GS10 responds inside the PLC's
  pre-receive deadband, the PLC sees nothing. The MSG_MODBUS2 walkthrough
  in §6 mentions pacing patterns — is there an inter-frame delay knob
  Mike could tune before buying a card?
- **Polarity.** A/B swapped on one end is symptomless on TX (the other end
  decides what's a 1) but kills RX. Cheap test: swap A↔B on the GS10 side,
  see if anything changes.
- **Scope the line.** A $30 USB oscilloscope or even a logic analyzer in
  RS-485 mode will show whether the GS10 is replying at all (and the PLC
  RX is deaf) vs. the GS10 truly not replying. The PR conflates the two.

**Tell Mike which of these to try before he orders 2080-SERIALISOL** —
and which to skip because they're already obviously ruled out by what's
in the debug log.

### 2. PR shape — should this be merged as one PR, or split?

310 files, +12,959 / -0, two distinct strands (Typst port + Conv_Simple_1.4),
three full project snapshots, **no CI checks**, no diff-able binary review.

- Is bundling the two strands defensible (the §6 work documents the
  Conv_Simple_1.4 Modbus debug)? Or are they better as two PRs (`docs/...`
  + `fix(plc)/...`) for review hygiene and bisect-ability?
- Are three project snapshots (1.2, 1.3, 1.4) all needed in the diff, or
  should 1.2 and 1.3 be a single `git tag` or an archive zip referenced
  in `docs/`? The CCW IDE binary churn alone (`.rtc`, `.mtc`, `.xtc`,
  `.accdb`) is most of the +12,959.
- The PR has **no required checks**. For a hardware-bring-up repo that's
  defensible, but a `typst build` smoke (the existing "CI/timer rebuild"
  mentioned in the test plan) is one line of Action and would catch
  regressions in the §6 port forever.

### 3. Compile fixes — are the three edits actually right, or papering over a worse bug?

The fix renamed `READDATA` (scalar) → `read_data` (array). That works, but
it implies the previous code was **declaring two different globals with
near-identical names**. That's a Type-3 footgun: every future maintainer
will trip on which one is which.

- Should `READDATA` (the scalar) be **deleted** in the same PR, with all
  call sites migrated to `read_data[1]` for the status word? If not,
  the bug will recur in v1.5.
- The `END_IF` → `END_IF;` change is "consistency" — is it actually a CCW
  parse requirement at that statement nesting depth, or did the compiler
  accept it before? If the former, the PR description should say so; if
  the latter, the change is cosmetic and shouldn't be in a debug PR.
- The Prog_init.stf changes are 35 added lines but the diff doesn't show a
  delete count, which means this is a *new* file in the snapshot, not an
  edit. Verify: was the prior `Prog_init.stf` in `Conv_Simple` or
  `Conv_Simple_1.2`, and what's the actual three-line diff?

### 4. Demo was 2026-05-21. What does this PR mean post-demo?

The repo description says "Demo: Florida Automation Expo 2026-05-21." That
date is past. So this PR is **post-demo cleanup**, not pre-demo block.
That changes the cost/value calculus:

- If the bench rig didn't work at the demo (GS10 silent), what did Mike
  show instead? The simulator? A pre-recorded video? Has that gap been
  named anywhere in the repo, or is the demo state in someone's head?
- Should this PR sit open until SERIALISOL ships, then close with the
  hardware-verified test plan all green? Or should it merge now (Typst +
  software compile fixes are independent value), and the hardware blocker
  live in a separate tracking issue?
- Is the *real* gap a missing **post-mortem** for the demo — what worked,
  what failed publicly, what we tell the next customer who saw it?

### 5. How does this connect to MIRA proper, and is the link healthy?

The MIRA monorepo (the public one, where this prompt lives) has its own
`plc/` directory with a *different* set of artifacts: `create_mira_plc.py`,
`Micro820_v4.1.8_Program.st`, `MIRA_Ladder_Program.md`, etc. **Those files
are not the same as the MIRA_PLC repo content.**

- Is the `plc/` directory in MIRA dead code now that MIRA_PLC is a separate
  repo? Last modified date is 2026-05-18 (`Micro820_v4.1.8_Program.st`).
  If dead, it should be deleted or marked archived in `CLAUDE.md`.
- The MIRA monorepo has a `.claude/skills/plc-tag-mapper/` skill and a
  `.claude/mcp/mira-plc-map-mcp-spec.md`. Are those wired to MIRA_PLC or
  to the dead `plc/`? If the former, MIRA depends on a private repo —
  call that out as a deployment concern.
- The work-instruction PDF generator in MIRA_PLC could become a
  customer-facing artifact in MIRA's namespace-builder onboarding flow
  (Phase 4 of `docs/plans/2026-05-15-maintenance-namespace-builder.md`).
  Is that integration explicit anywhere, or is it just in Mike's head?
- The 2080-qs004 PDF Mike tried to ingest this morning (`b6401734` session)
  is the exact reference doc for the Conv_Simple_1.4 work. Did that ingest
  ever land in the KB? If yes — MIRA can now cite it back to Mike in PLC
  sessions; if no — MIRA_PLC PR #6 is being reviewed by a Claude with no
  Micro800 reference material.

---

## Output format expected from this cowork

A single markdown response with five sections (`### 1.` through `### 5.`),
each with a direct opinion, 2–4 sentences of reasoning, and a concrete
recommendation. No restating the problem. No "great question" preamble.

If you find a real bug in the diff — wrong variable, missing semicolon,
swapped polarity in the §6 doc, a Modbus addr that doesn't match what the
GS10 manual says — flag it inline with the file path and line number.

If you think the PR shouldn't merge as-is, say so with the specific
fix that would make it mergeable.

---

## Constraints on the reviewer

- **Do not** push to the branch, do not merge, do not change Mike's
  `MbSrvConf_target.xml` or any `.xtc/.rtc/.mtc` binaries.
- **Do not** suggest Anthropic as a provider — out of scope here, but the
  MIRA repo's PRD §4 ban applies.
- **Cite files + line numbers** when making code claims. CCW STF files
  use 1-based line numbering.
- If you disagree with the PR body's diagnosis (RX hardware fault →
  SERIALISOL), say so on the record with the evidence that contradicts it.
- Don't propose a sixth strand of work. The two existing strands plus the
  hardware blocker are the bounded scope.
