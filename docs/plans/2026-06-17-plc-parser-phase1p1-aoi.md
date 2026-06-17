# PLC Parser Phase 1.1 — AOI Export Support

**Date:** 2026-06-17  
**Status:** SPEC (no code yet)  
**GitHub issues:** #2086 (AOI — P1), #2087 (Modules — P3), #2088 (FBD — P2)  
**Branch target:** `feat/plc-parser-phase1p1-aoi`  
**Parent plan:** Phase 1 = `feat/vfd-analyzer-rebased` (merged via PR #2065)

---

## Problem Statement

Phase 1 of the PLC Parser handles full Rockwell Studio 5000 controller exports — L5X files
that contain `<Controller><Tags>`, `<Controller><Programs>`, and `<Controller><DataTypes>`.

**5 of 8 real-world L5X files from public GitHub repos returned all-zero counts.** All five
are AOI-only exports (`TargetType="AddOnInstructionDefinition"`), which is the dominant
format for community-shared, reusable logic blocks. The parser has no branch for
`<AddOnInstructionDefinitions>` and silently ignores them.

This spec covers Phase 1.1: AOI export parsing (issue #2086). It also identifies two lower-
priority blind spots (#2087 modules, #2088 FBD) but does not spec those.

---

## What AOIs Are

An **Add-On Instruction (AOI)** is Rockwell's main code-reuse pattern. An AOI is a named,
versioned routine template with explicit I/O parameters and local state. The AOI definition
lives in the controller, and rungs call it like an opaque instruction.

### AOI-only L5X export structure

When an engineer exports _just_ an AOI definition (for sharing / version control / import
into another project), the L5X looks like:

```xml
<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="34.00"
    TargetName="VFD_Control" TargetType="AddOnInstructionDefinition" ...>
  <AddOnInstructionDefinitions>
    <AddOnInstructionDefinition Name="VFD_Control" Revision="1.7"
        ExecutePrescan="false" ExecutePostscan="false" ExecuteEnableInFalse="false">
      <Description><![CDATA[Controls a GS-Series VFD via Modbus]]></Description>

      <Parameters>
        <!-- Required fixed parameters (always present) -->
        <Parameter Name="EnableIn"   Usage="Input"  DataType="BOOL"
            Radix="Decimal" Required="false" Visible="false" ExternalAccess="None">
          <Description><![CDATA[Enable Input]]></Description>
        </Parameter>
        <Parameter Name="EnableOut"  Usage="Output" DataType="BOOL" ... />
        <!-- Application parameters -->
        <Parameter Name="RunCmd"     Usage="Input"  DataType="BOOL"
            Radix="Decimal" Required="true" Visible="true">
          <Description><![CDATA[Run command to VFD]]></Description>
        </Parameter>
        <Parameter Name="FaultCode"  Usage="Output" DataType="INT"
            Radix="Decimal" Required="false" Visible="true">
          <Description><![CDATA[Active fault code from drive]]></Description>
        </Parameter>
        <Parameter Name="FreqCmd"    Usage="InOut"  DataType="REAL" ... />
      </Parameters>

      <LocalTags>
        <LocalTag Name="Ramp_Timer" DataType="TIMER" ExternalAccess="None" />
        <LocalTag Name="Prev_Fault" DataType="INT"   ExternalAccess="None" />
      </LocalTags>

      <Routines>
        <Routine Name="Logic" Type="RLL">
          <RLLContent>
            <Rung Number="0" Type="N">
              <Text><![CDATA[XIC(RunCmd)OTE(EnableOut);]]></Text>
            </Rung>
          </RLLContent>
        </Routine>
        <Routine Name="Prescan" Type="RLL"> ... </Routine>
      </Routines>
    </AddOnInstructionDefinition>
  </AddOnInstructionDefinitions>
</RSLogix5000Content>
```

### Full-controller export (Phase 1 — already handled)

A full export has no `<AddOnInstructionDefinitions>` at the root level. AOIs defined in a
full project live under `<Controller><AddOnInstructionDefinitions>` (inside the controller
element) — the parser currently skips these too, but that is a lower priority since the
controller tags/programs are still parsed.

---

## IR Changes (`ir.py`)

### New: `TagScope` values

```python
class TagScope(str, Enum):
    CONTROLLER = "controller"
    PROGRAM = "program"
    AOI_PARAMETER = "aoi_parameter"   # NEW: AOI input/output/inout parameter
    AOI_LOCAL = "aoi_local"           # NEW: AOI local variable
```

### New: `AOIDefinition` dataclass

```python
@dataclass
class AOIDefinition:
    """A single Add-On Instruction definition parsed from an AOI-only or full-controller L5X."""
    name: str
    revision: str = ""
    description: str = ""
    parameters: list[Tag] = field(default_factory=list)   # scope="aoi_parameter", usage set
    local_tags: list[Tag] = field(default_factory=list)   # scope="aoi_local"
    routines: list[Routine] = field(default_factory=list)
    provenance: Provenance | None = None
```

**Parameter → Tag mapping:**

| L5X `<Parameter>` attribute | `Tag` field |
|---|---|
| `Name` | `name` |
| `DataType` | `data_type` |
| `Usage` (Input / Output / InOut) | `external_access` (reuse field; values: "Input", "Output", "InOut") |
| `Radix` | `radix` |
| `<Description>` CDATA | `description` |
| always `"aoi_parameter"` | `scope` |

**LocalTag → Tag mapping:**

| L5X `<LocalTag>` attribute | `Tag` field |
|---|---|
| `Name` | `name` |
| `DataType` | `data_type` |
| always `"aoi_local"` | `scope` |

### `PLCProject` extension

```python
@dataclass
class PLCProject:
    controllers: list[Controller] = field(default_factory=list)
    aoi_definitions: list[AOIDefinition] = field(default_factory=list)   # NEW
    source_format: str = ""
    source_files: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
```

### `PLCProject` accessor changes

`all_tags()` must include AOI parameters and local tags:

```python
def all_tags(self) -> list[Tag]:
    out: list[Tag] = []
    for c in self.controllers:
        out.extend(c.tags)
        for p in c.programs:
            out.extend(p.tags)
    for aoi in self.aoi_definitions:           # NEW
        out.extend(aoi.parameters)
        out.extend(aoi.local_tags)
    return out
```

`all_routines()` must include AOI routines (surfaced as `("AOI:<name>", routine)` pairs):

```python
def all_routines(self) -> list[tuple[str, Routine]]:
    out: list[tuple[str, Routine]] = []
    for c in self.controllers:
        for p in c.programs:
            for r in p.routines:
                out.append((p.name, r))
    for aoi in self.aoi_definitions:           # NEW
        for r in aoi.routines:
            out.append(("AOI:" + aoi.name, r))
    return out
```

---

## Parser Changes (`parsers/rockwell_l5x.py`)

### 1. `parse()` — detect AOI-only exports

```python
def parse(text: str, source_file: str = "") -> PLCProject:
    proj = PLCProject(...)
    ...
    # AOI-only export: root-level <AddOnInstructionDefinitions>
    aoi_defs_el = _first(root, "AddOnInstructionDefinitions")
    if aoi_defs_el is not None:
        for aoi_el in aoi_defs_el.findall("AddOnInstructionDefinition"):
            proj.aoi_definitions.append(_parse_aoi_definition(aoi_el, source_file))

    # Full controller export: <Controller>
    for ctrl_el in root.iter("Controller"):
        proj.controllers.append(_parse_controller(ctrl_el, software, source_file))
        break
    ...
```

### 2. `_parse_aoi_definition()` — new function

```python
def _parse_aoi_definition(el: ET.Element, src: str) -> AOIDefinition:
    name = el.get("Name", "")
    desc_el = _first(el, "Description")
    aoi = AOIDefinition(
        name=name,
        revision=el.get("Revision", ""),
        description=_txt(desc_el),
        provenance=_prov(src, "AddOnInstructionDefinition[@Name='%s']" % name),
    )
    # Parameters
    params_el = _first(el, "Parameters")
    if params_el is not None:
        for p_el in params_el.findall("Parameter"):
            aoi.parameters.append(_parse_aoi_parameter(p_el, name, src))
    # LocalTags
    local_el = _first(el, "LocalTags")
    if local_el is not None:
        for lt_el in local_el.findall("LocalTag"):
            aoi.local_tags.append(_parse_aoi_local_tag(lt_el, name, src))
    # Routines (reuse existing _parse_routine)
    routines_el = _first(el, "Routines")
    if routines_el is not None:
        for r_el in routines_el.findall("Routine"):
            aoi.routines.append(_parse_routine(r_el, "AOI:" + name, src))
    return aoi
```

### 3. `_parse_aoi_parameter()` — new function

```python
def _parse_aoi_parameter(el: ET.Element, aoi_name: str, src: str) -> Tag:
    pname = el.get("Name", "")
    desc_el = _first(el, "Description")
    return Tag(
        name=pname,
        data_type=el.get("DataType", ""),
        scope=TagScope.AOI_PARAMETER.value,
        description=_txt(desc_el),
        external_access=el.get("Usage", ""),   # "Input" | "Output" | "InOut"
        radix=el.get("Radix", ""),
        provenance=_prov(src, "AddOnInstructionDefinition[@Name='%s']/Parameter[@Name='%s']"
                         % (aoi_name, pname)),
    )
```

### 4. `_parse_aoi_local_tag()` — new function

```python
def _parse_aoi_local_tag(el: ET.Element, aoi_name: str, src: str) -> Tag:
    ltname = el.get("Name", "")
    return Tag(
        name=ltname,
        data_type=el.get("DataType", ""),
        scope=TagScope.AOI_LOCAL.value,
        provenance=_prov(src, "AddOnInstructionDefinition[@Name='%s']/LocalTag[@Name='%s']"
                         % (aoi_name, ltname)),
    )
```

### 5. `_parse_controller()` — also walk in-controller AOIs (full exports)

When parsing a full controller export, the `<Controller>` element may itself contain an
`<AddOnInstructionDefinitions>` child. Extend `_parse_controller()`:

```python
def _parse_controller(el: ET.Element, software: str, src: str) -> Controller:
    ctrl = Controller(...)
    # ... existing datatypes, tags, programs ...

    # In-controller AOIs (defined but not separately exported)
    in_ctrl_aois = _first(el, "AddOnInstructionDefinitions")
    if in_ctrl_aois is not None:
        for aoi_el in in_ctrl_aois.findall("AddOnInstructionDefinition"):
            # Store on the PLCProject; Controller doesn't hold AOIs in the IR.
            # Pass back via a return value extension OR accumulate on a thread-local.
            # Simplest: return a list of AOIDefinitions alongside the Controller and
            # let parse() extend proj.aoi_definitions.
            pass   # TODO: decide accumulation pattern in implementation

    return ctrl
```

> **Implementation note:** The cleanest option is to have `_parse_controller()` return
> `(Controller, list[AOIDefinition])` and have `parse()` extend `proj.aoi_definitions`
> with the second element. Avoids global state.

---

## analyze.py Changes

The existing pattern-matching in `analyze.py` already operates on `proj.all_tags()` and
`proj.all_rungs()`. Once the IR accessor changes above are in place, the following work
**automatically with no code changes**:

- `_build_usage_index()` — cross-references AOI rung tags
- `_annotate_roles()` — assigns fault/mode/safety/vfd roles to AOI parameters
- `_fault_candidates()` — surfaces `FaultCode`, `Alarm`, `Trip` AOI parameters
- `_asset_candidates()` — surfaces AOI name + parameter keywords as asset hints
- `_vfd_signal_candidates()` — matches `FreqCmd`, `CurrentOut`, `FaultCode` by name
- `_review_required()` — flags safety-pattern parameters and routine names

The only **required change** to `analyze.py` is in `_tag_dictionary()` display and counts.

### Scope labelling in tag dictionary

`_tag_dictionary()` already emits `t.scope` — this just needs the two new values to be
meaningful when displayed by the CLI.

### AOI-aware `counts`

Add AOI-specific counts to `AnalysisReport.counts`:

```python
rep.counts = {
    ...
    "aoi_definitions": len(proj.aoi_definitions),                           # NEW
    "aoi_parameters": sum(len(a.parameters) for a in proj.aoi_definitions), # NEW
    "aoi_local_tags": sum(len(a.local_tags) for a in proj.aoi_definitions), # NEW
}
```

### `_routine_summaries()` — already works

`all_routines()` returns `("AOI:VFD_Control", routine)` pairs. The existing summary
already emits `program` (the AOI prefix) and `routine` name — no change needed.

---

## CLI / `__main__.py` Changes

The CLI `analyze` command calls `analyze(proj)` and pretty-prints `AnalysisReport`.
Add one section to the output:

```
AOI Definitions (3)
  VFD_Control (v1.7): 7 parameters, 2 local tags, 3 routines
    Parameters: RunCmd [BOOL/Input], FaultCode [INT/Output], FreqCmd [REAL/InOut] ...
  ...
```

The `summary` command should include `aoi_definitions` in its one-liner.

---

## `__main__.py` (detect changes)

`detect.py` currently identifies a file as `rockwell_l5x` based on the root tag
`RSLogix5000Content`. This still works for AOI exports. **No change needed.**

The `TargetType` attribute is informational only — the parser now handles both
`"Controller"` and `"AddOnInstructionDefinition"` TargetTypes. A warning is emitted
if neither `<Controller>` nor `<AddOnInstructionDefinitions>` is found.

---

## Tests

### Fixtures to add

1. **`tests/fixtures/vfd_aoi.L5X`** — minimal synthetic AOI export with:
   - AOI named `VFD_Control`, revision `1.2`
   - 5 parameters: EnableIn (BOOL/Input), EnableOut (BOOL/Output), RunCmd (BOOL/Input),
     FaultCode (INT/Output), FreqCmd (REAL/InOut)
   - 2 local tags: Ramp_Timer (TIMER), Prev_Fault (INT)
   - 1 RLL routine (`Logic`) with 2 rungs using `RunCmd` and `FaultCode`

2. **`tests/fixtures/conveyor_with_aoi.L5X`** — the existing `conveyor.L5X` extended with
   an in-controller `<AddOnInstructionDefinitions>` section (one AOI, 3 parameters)

### Test cases to add (`tests/test_rockwell_aoi.py`)

```python
def test_aoi_only_export_parsed():
    """AOI-only L5X yields non-zero aoi_definitions and parameters."""
    proj = parse(open("tests/fixtures/vfd_aoi.L5X").read(), "vfd_aoi.L5X")
    assert len(proj.aoi_definitions) == 1
    aoi = proj.aoi_definitions[0]
    assert aoi.name == "VFD_Control"
    assert len(aoi.parameters) == 5
    assert len(aoi.local_tags) == 2
    assert len(aoi.routines) == 1

def test_aoi_parameters_in_all_tags():
    """all_tags() includes AOI parameters and local tags."""
    proj = parse(open("tests/fixtures/vfd_aoi.L5X").read(), "vfd_aoi.L5X")
    tags = proj.all_tags()
    names = {t.name for t in tags}
    assert "RunCmd" in names
    assert "FaultCode" in names
    assert "Ramp_Timer" in names

def test_aoi_parameter_scope():
    proj = parse(open("tests/fixtures/vfd_aoi.L5X").read(), "vfd_aoi.L5X")
    params = {t.name: t for t in proj.aoi_definitions[0].parameters}
    assert params["RunCmd"].scope == "aoi_parameter"
    assert params["RunCmd"].external_access == "Input"
    assert params["FaultCode"].external_access == "Output"

def test_aoi_fault_candidate_detected():
    """analyze() finds FaultCode as a fault candidate from AOI parameter name."""
    from mira_plc_parser.analyze import analyze
    proj = parse(open("tests/fixtures/vfd_aoi.L5X").read(), "vfd_aoi.L5X")
    rep = analyze(proj)
    fault_names = {f.name for f in rep.fault_candidates}
    assert "FaultCode" in fault_names

def test_aoi_vfd_signal_candidate_detected():
    """analyze() finds FreqCmd as a VFD signal candidate from AOI parameter name."""
    from mira_plc_parser.analyze import analyze
    proj = parse(open("tests/fixtures/vfd_aoi.L5X").read(), "vfd_aoi.L5X")
    rep = analyze(proj)
    vfd_names = {f.name for f in rep.vfd_signal_candidates}
    assert "FreqCmd" in vfd_names

def test_existing_conveyor_unaffected():
    """Existing golden test still passes after AOI changes."""
    proj = parse(open("tests/fixtures/conveyor.L5X").read(), "conveyor.L5X")
    assert len(proj.controllers) == 1
    assert len(proj.all_tags()) == 11
```

---

## Other Blind Spots Identified (not in this spec)

### AOI parameter naming conventions vs. controller tag naming conventions

The current `_VFD_ROLES`, `_FAULT_PAT`, `_ASSET_PAT` etc. vocabularies were tuned against
**controller-scoped tag names** (e.g. `Motor_Run`, `VFD_FaultCode`, `Start_PB`).

Real-world corpus observation (5 AOI-only files, 2026-06-17):
- `logix-Sys_AOI.L5X` — uptime tracker; params: `Inp_Enable`, `Inp_Interval`, `Sts_Enabled`, `Val_UpDays`
- `logix-T_DOW_AOI.L5X` — day-of-week; params: `Inp_Year`, `Inp_Month`, `Val`
- `wpi-IA_SENSOR_AOI.L5X` — sensor scaling; params: `InRawMax`, `InEUMax`, `RawSensorValue`, `OUTPUT`
- `logixaois-Email_ST.L5X` — email sender; params: `SendEmail`, `MSG_Send_Email_Error`
- `panelview-GetMEDName.L5X` — panel utility; no parameters found

Common prefix conventions in AOI parameters: `Inp_` (input), `Out_` / `OUTPUT` (output),
`Sts_` (status), `Val_` (value), `Ref_` (reference). None of these are caught by the current
vocabulary because they are architectural prefixes, not semantic keywords.

VFD-control AOIs were **not present** in the 8-file public corpus — those likely live in
enterprise/proprietary code. The synthetic `vfd_aoi.L5X` fixture covers the intended
VFD detection path; the real corpus tests the general parsing infrastructure.

**Recommendation:** Add a `_PREFIX_STRIP` step in `_annotate_roles()` that strips `Inp_`,
`Out_`, `Sts_`, `Val_`, `Ref_` prefixes before pattern-matching. This is a low-risk
improvement — it makes the heuristics work equally well against prefix-convention AOIs
and the existing plain-name controller tags.

### Description-less tag name matching threshold

The `_kw()` pattern builder uses `\b`-like letter-boundary anchors, which works well for
named tags. But real-world AOI parameters often use abbreviations not in the vocabulary:
`FltCd` instead of `FaultCode`, `CurOut` instead of `CurrentOut`. Consider adding
abbreviated forms to the VFD and fault vocabulary lists.

### `TagType="Produced"` / `TagType="Consumed"` (produced/consumed tags)

In controller exports, tags may have `TagType="Produced"` or `TagType="Consumed"` — these
are cross-controller data-sharing patterns over backplane / EtherNet/IP. The parser reads
`TagType` as a raw attribute but does not classify it. These tags should get a `produced`
or `consumed` role so `analyze.py` can flag data-sharing dependencies.

Current state in `_parse_tag()`:
```python
alias_for=el.get("AliasFor", ""),   # TagType="Alias" is handled here
```
`TagType="Produced"` / `"Consumed"` have no handler — `alias_for` stays empty and the
tag is just a plain tag. Add `produced`/`consumed` to `Tag.roles` in `_annotate_roles()`.

### `AliasFor` on non-`TagType="Alias"` tags

Some exports use `AliasFor` without `TagType="Alias"`. This is currently parsed correctly
(the attribute is read regardless), but the `is_alias` property only checks `alias_for`.
No change needed.

### Rung text truncation (CDATA)

Some real-world rungs have rung text >4000 chars. `ElementTree` handles CDATA correctly,
but the `LEFT(content, 220)` style truncation in the analysis layer may lose instruction
context. Not a parser issue — analysis layer concern.

---

## Acceptance Criteria (Phase 1.1)

- [ ] All 5 zero-count real-world L5X files from `/tmp/plc-corpus/` now return non-zero
      `aoi_definitions` count
- [ ] `FaultCode` / `FaultState` / similar parameters classified as fault candidates
- [ ] `FreqCmd` / `OutputHz` / similar parameters classified as VFD signal candidates
- [ ] All 6 new unit tests pass (`tests/test_rockwell_aoi.py`)
- [ ] Existing `conveyor.L5X` golden test still passes (no regression)
- [ ] `ruff check .` passes
- [ ] `/VERSION` bumped, `pyproject.toml` version bumped if needed

---

## Implementation Order

1. `ir.py` — add `AOI_PARAMETER` / `AOI_LOCAL` scopes, `AOIDefinition` dataclass, extend
   `PLCProject.aoi_definitions`, extend `all_tags()` and `all_routines()`
2. `parsers/rockwell_l5x.py` — add `_parse_aoi_definition()`, `_parse_aoi_parameter()`,
   `_parse_aoi_local_tag()`; update `parse()` to walk root-level AOI element
3. `analyze.py` — add `aoi_definitions`/`aoi_parameters`/`aoi_local_tags` counts
4. `tests/fixtures/vfd_aoi.L5X` — create minimal synthetic fixture
5. `tests/test_rockwell_aoi.py` — write 6 test cases
6. `__main__.py` — add AOI section to `analyze` output
7. Verify against real-world corpus files in `/tmp/plc-corpus/`
