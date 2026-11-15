import type { EquipmentNode } from "./equipment-nav";

/**
 * Disconnected fixture plant for the equipment-first navigation lab.
 *
 * Drive (VFD1, AutomationDirect GS10) and MLC on the GS10 bench come first. MLC
 * is the hand label on drawing device Q1, a Schneider TeSys CA3KN22BD control
 * relay switched by PLC output _IO_EM_DO_02. It is not the PLC: PLC1
 * (Allen-Bradley Micro820) is its own row. Line 2 repeats the tag "VFD1" with the same
 * model on purpose, so the repeated-tag location rule is exercised. Utilities
 * holds a machine with no components (the whole machine is the only target).
 * Synthetic names only, no customer data.
 */
export const EQUIPMENT_FIXTURE: readonly EquipmentNode[] = [
  {
    id: "site-lw",
    level: "site",
    label: "Lake Wales plant",
    children: [
      {
        id: "area-garage",
        level: "area",
        label: "Garage",
        children: [
          {
            id: "line-bench",
            level: "line",
            label: "Bench line",
            children: [
              {
                id: "m-gs10-bench",
                level: "machine",
                label: "GS10 bench",
                tag: "CV-101",
                status: "normal",
                children: [
                  {
                    id: "asm-panel",
                    level: "assembly",
                    label: "Control panel",
                    children: [
                      { id: "c-vfd1-bench", level: "component", label: "VFD1", tag: "VFD1", detail: "AutomationDirect GS10" },
                      { id: "c-q1-mlc-bench", level: "component", label: "MLC", tag: "Q1", detail: "Schneider TeSys CA3KN22BD control relay", plcSymbol: "_IO_EM_DO_02" },
                      { id: "c-plc1-bench", level: "component", label: "PLC1", tag: "PLC1", detail: "Allen-Bradley Micro820" },
                    ],
                  },
                  { id: "c-m1-bench", level: "component", label: "M1 motor", tag: "M1", detail: "0.5 hp induction" },
                ],
              },
            ],
          },
          {
            id: "line-2",
            level: "line",
            label: "Line 2",
            children: [
              {
                id: "m-conveyor-2",
                level: "machine",
                label: "Conveyor 2",
                tag: "CV-201",
                status: "attention",
                children: [
                  { id: "c-vfd1-line2", level: "component", label: "VFD1", tag: "VFD1", detail: "AutomationDirect GS10" },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "area-utilities",
        level: "area",
        label: "Utilities",
        children: [
          { id: "m-air", level: "machine", label: "Air compressor", tag: "AC-1", status: "unknown" },
        ],
      },
    ],
  },
];

/** The bench drive: the default question target in the lab. */
export const EQUIPMENT_FIXTURE_DEFAULT_TARGET_ID = "c-vfd1-bench";
