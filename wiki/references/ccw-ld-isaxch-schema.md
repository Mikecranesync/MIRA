# CCW `.isaxch` Schema — ISaGRAF Exchange Format

**Status:** ST schema captured from a known-good export. LD schema pending Steps 2-3 of the experiment in `/Users/bravonode/.claude/plans/vectorized-tinkering-kay.md`.

**Purpose:** Document the CCW import/export file format so we can generate ladder logic (and other IEC 61131-3 languages) programmatically and have CCW import them.

## What `.isaxch` Is

CCW's runtime is **ISaGRAF 5** (see `Mira/plc/ccw/controller/Controller.acfproj` — it imports `ISaGRAF.ISaGRAF5.targets`). ISaGRAF supports all five IEC 61131-3 languages: LD, FBD, SFC, ST, IL. The `.isaxch` extension stands for **ISaGRAF Exchange** and is the file format CCW uses for File → Export of an individual *Program* node.

## Known-Good Reference (Structured Text)

Source: `Mira/plc/ccw/drive_test/step1_io_check/PROG_IO.isaxch`. UTF-8, 317 bytes.

```xml
<?xml version="1.0" encoding="utf-8"?>
<ISaGRAF_Export version="1.0">
  <Program>
    <Name>PROG_IO</Name>
    <Language>ST</Language>
    <Description>Step 1 I/O check — toggles heartbeat every scan</Description>
    <SourceCode><![CDATA[heartbeat := NOT heartbeat;
]]></SourceCode>
  </Program>
</ISaGRAF_Export>
```

## ST Schema (Confirmed)

| Element | Required | Notes |
|---------|:--------:|-------|
| XML declaration `<?xml version="1.0" encoding="utf-8"?>` | yes | UTF-8 |
| `<ISaGRAF_Export version="1.0">` root | yes | Single program per file |
| `<Program>` | yes | One per file in this version |
| `<Name>` | yes | Program name as it appears in CCW Project Organizer |
| `<Language>` | yes | `ST` confirmed. Candidates for ladder: `LD`, `LADDER`, `FBD`, `SFC`, `IL` — verify in Step 2 |
| `<Description>` | yes (may be empty) | Free text, non-ASCII OK (em-dash present in reference) |
| `<SourceCode>` | yes | Wraps a CDATA section |
| `<![CDATA[...]]>` body | yes | For ST: literal ST source. **For LD: TBD — likely structured XML, possibly text, possibly base64 binary.** |

**Code generator status:** `Mira/tools/ccw_ld_gen.py::emit_st_isaxch` produces byte-identical output to `PROG_IO.isaxch` (verified via `python tools/ccw_ld_gen.py --self-test`).

## LD Schema — Discovery Protocol (NOT YET DONE)

To capture in Step 2-3 of the experiment:

1. **Manually build a minimal LD program in a lab CCW project.** One rung: one XIC contact on a global BOOL, one OTE coil on another global BOOL. Build to 0 errors.
2. **Export it.** File → Export (or right-click the Program node in Project Organizer → Export). Note the file extension and the dialog options.
3. **Capture verbatim** to `Mira/plc/ccw/lab_exports/minimal_ld_v1.isaxch` (or wherever the lab project lives). Paste the contents back here under "LD Schema — Captured" below.

After the trivial rung is captured, iterate:

| Iteration | Add to LD program | What to learn |
|-----------|-------------------|---------------|
| 1 | One series rung: XIC `A` AND XIO `B` → OTE `C` | How series is encoded |
| 2 | Add a parallel branch: (XIC `A` AND XIO `B`) OR XIC `D` → OTE `C` | How parallel/OR branches nest |
| 3 | Add a TON timer rung | How function-block instances are referenced |
| 4 | Add an EQU comparator rung | How comparison ops with operand pairs are encoded |
| 5 | Add a MSG_MODBUS rung with all four pins wired | How multi-pin FBs serialize |

Each iteration: build clean, export, diff against the prior. The diffs isolate each schema feature.

## LD Schema — Captured

> TBD — populate after Step 2 of the experiment.

## LD Schema — Generator Coverage

> TBD — populate after Step 4. Lists which LD instructions `tools/ccw_ld_gen.py::emit_ld_isaxch` can emit, verified against build-clean round-trip.

## Falsifier Findings

> TBD. If any of the four falsifiers from the plan trigger, record the symptom and the smallest reproducer here so future revisits don't repeat the discovery.

## Verdict

> TBD — Step 5 of the experiment writes a Yes / No / Partial verdict here with an instruction-coverage list.

## Why Not Touch `PrjLibrary.accdb` Instead?

`Mira/plc/populate_variables.py` already proves direct INSERT into CCW's Microsoft Access database works for variables. The same pattern could theoretically be extended to the `POUs` / `RefPOUs` tables for program bodies. We're preferring `.isaxch` because:

- **It's a supported CCW import path.** Rockwell intentionally exposes `File → Export` and `File → Import`. The `.accdb` schema is undocumented internals.
- **Version stability.** CCW 22.0 → CCW 23+ may change the `.accdb` schema; the ISaGRAF Exchange format is a *contract*.
- **No driver dependency.** `.isaxch` is plain XML — no `pyodbc`, no Access ODBC driver, no Windows-only `Microsoft Access Driver (*.mdb, *.accdb)` requirement.

`PrjLibrary.accdb` remains the fallback if `.isaxch` LD round-trip turns out not to work (falsifiers 1-4 in the plan).
