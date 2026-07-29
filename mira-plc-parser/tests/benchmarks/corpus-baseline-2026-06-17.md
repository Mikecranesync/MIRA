# MIRA PLC Parser — Combined Corpus Benchmark (2026-06-17)

| Status | Cov% | TargetType | File |
|--------|------|------------|------|
| ~ PARTIAL | 100% | Controller | finalyear-FinalPLC_Code.L5X |
| ~ PARTIAL | 100% | Controller | legonigel-basetest.L5X |
| ✗ UNSUPPORTED | 0% | AddOnInstructionDefinition | logix-Sys_AOI.L5X |
| ✗ UNSUPPORTED | 0% | AddOnInstructionDefinition | logix-T_DOW_AOI.L5X |
| ✗ UNSUPPORTED | 0% | AddOnInstructionDefinition | logixaois-Email_ST.L5X |
| ✓ FULL | 100% | Program | panelview-GetMEDName.L5X |
| ✗ UNSUPPORTED | 0% | Module | reh3376-XFV_100_Module.L5X |
| ✗ UNSUPPORTED | 0% | AddOnInstructionDefinition | wpi-IA_SENSOR_AOI.L5X |
| ✓ FULL | 100% | DataType | Codezzzzack1-PyMachine_vscode-RecipeEdit.L5X |
| ~ PARTIAL | 100% | Controller | Colt-H-L5X-Creator-Example.L5X |
| ✓ FULL | 100% | DataType | GTMichelli-Dev-northwest-grain-growers-Cal_Point_DataType.L5X |
| ✗ UNSUPPORTED | 0% | Module | GTMichelli-Dev-northwest-grain-growers-Water_Input_Module.L5X |
| ✓ FULL | 100% | DataType | JeremyMedders-LogixLibraries-IO_RA_1783_A195_WAP_DataType.L5X |
| ✗ UNSUPPORTED | 0% | AddOnInstructionDefinition | JeremyMedders-LogixLibraries-LmExpX_AOI.L5X |
| ✗ UNSUPPORTED | 0% | AddOnInstructionDefinition | JeremyMedders-LogixLibraries-Math_Log2_AOI.L5X |
| ✗ UNSUPPORTED | 0% | AddOnInstructionDefinition | JeremyMedders-LogixLibraries-Par_AOI.L5X |
| ✓ FULL | 100% | DataType | RickyRick89-ProjectPolyglot-P_PF755_Inp.L5X |
| ✗ UNSUPPORTED | 0% | AddOnInstructionDefinition | W-P-I-_WPI-FunctionBlocks-Axis_Jog_AOI.L5X |
| ✗ UNSUPPORTED | 0% | AddOnInstructionDefinition | atmassey-LogixAOIs-Time_Elapsed_FB.L5X |
| ✓ FULL | 100% | Program | daniel-SCAU-plckodetest-TrafficLight_Controller.L5X |
| ~ PARTIAL | 100% | Controller | hutcheb-acd-ACDTestsEmptyRedundant.L5X |
| ~ PARTIAL | 37% | Routine | nickytoothiccy-_LazyTool-YV_07663.L5X |
| ~ PARTIAL | 37% | Routine | nickytoothiccy-_LazyTool-YV_07667.L5X |
| ~ PARTIAL | 100% | Controller | ns-bhandari-PLC-Exercises-Ex_2_15.L5X |
| ~ PARTIAL | 100% | Controller | ns-bhandari-PLC-Exercises-Ex_2_16.L5X |
| ✗ UNSUPPORTED | 0% | Module | reh3376-acd-l5x-tool-lib-DI_ECP103_A_1_Module.L5X |
| ✗ UNSUPPORTED | 0% | Module | reh3376-acd-l5x-tool-lib-DO_ECP101_B_2_Module.L5X |
| ✗ UNSUPPORTED | 0% | Module | reh3376-acd-l5x-tool-lib-XFV_080_Module.L5X |

**Total: 28 files**
- FULL: 6
- PARTIAL: 8
- UNSUPPORTED: 14

## Most common gaps
- (9x) 1 AOI definition (AddOnInstructionDefini...
- (7x) 1 Module element — not parsed (hardware ...
- (4x) 1 FBD routine (FBDContent) — silently sk...
- (2x) 2 AOI local tags — not extracted...
- (2x) 2 Module elements — not parsed (hardware...
- (2x) 4 AOI parameters — not extracted...
- (2x) 17 AOI parameters — not extracted...
- (2x) AlarmDefinitions present — not extracted...
- (1x) 5 Module elements — not parsed (hardware...
- (1x) 1 SFC routine (SFCContent) — silently sk...

## Files unblocked per milestone
- **Phase 1.1 — AOI parsing (issue #2086)**: 8 files
- **Phase 1.3 — Module parsing (issue #2087)**: 5 files
- **Phase 1.2 — FBD routine parsing (issue #2088)**: 3 files