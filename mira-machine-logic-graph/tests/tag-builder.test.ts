import { describe, expect, test } from "bun:test";
import { buildIgnitionTags } from "../src/ignition/tag-builder.ts";
import type { ManifestVariable } from "../src/parser/manifest.ts";

const v = (over: Partial<ManifestVariable>): ManifestVariable => ({
  name: "x",
  dataType: "BOOL",
  scope: "VAR",
  alias: null,
  address: null,
  modbusAddress: null,
  retain: false,
  terminalLabel: null,
  sourceDevice: null,
  direction: null,
  ...over,
});

describe("buildIgnitionTags", () => {
  test("emits one folder with sorted tags", () => {
    const out = buildIgnitionTags([
      v({ name: "motor_running", modbusAddress: "COIL:1" }),
      v({ name: "fault_alarm", modbusAddress: "COIL:3" }),
    ]);
    expect(out.tagType).toBe("Provider");
    expect(out.tags).toHaveLength(1);
    expect(out.tags[0].name).toBe("Conveyor");
    const names = (out.tags[0].tags as { name: string }[]).map((t) => t.name);
    expect(names).toEqual(["FaultAlarm", "MotorRunning"]);
  });

  test("maps COIL -> C, HR -> HR4000+addr", () => {
    const out = buildIgnitionTags([
      v({ name: "motor_running", modbusAddress: "COIL:1" }),
      v({ name: "conv_state", dataType: "INT", modbusAddress: "HR:114" }),
    ]);
    const tags = out.tags[0].tags as { name: string; opcItemPath: string; dataType: string }[];
    const motor = tags.find((t) => t.name === "MotorRunning")!;
    const state = tags.find((t) => t.name === "ConvState")!;
    expect(motor.opcItemPath).toBe("ns=1;s=[Micro820_Conveyor]C1");
    expect(motor.dataType).toBe("Boolean");
    expect(state.opcItemPath).toBe("ns=1;s=[Micro820_Conveyor]HR400114");
    expect(state.dataType).toBe("Int4");
  });

  test("skips variables without a Modbus address or unsupported type", () => {
    const out = buildIgnitionTags([
      v({ name: "no_addr", modbusAddress: null }),
      v({ name: "weird", dataType: "TON", modbusAddress: "HR:50" }),
      v({ name: "ok", modbusAddress: "COIL:5" }),
    ]);
    const names = (out.tags[0].tags as { name: string }[]).map((t) => t.name);
    expect(names).toEqual(["Ok"]);
  });

  test("attaches i3X metadata", () => {
    const out = buildIgnitionTags([v({ name: "motor_running", modbusAddress: "COIL:1" })]);
    const tag = (out.tags[0].tags as Array<{ i3x: { elementId: string; namespace: string } }>)[0];
    expect(tag.i3x.elementId).toBe("urn:i3x:micro820:motor_running");
    expect(tag.i3x.namespace).toBe("LakeWales.Line1.Conveyor.MotorRunning");
  });

  test("marks only allowlisted setpoints writable, regardless of manifest direction", () => {
    const out = buildIgnitionTags([
      v({ name: "vfd_cmd_word", dataType: "INT", modbusAddress: "HR:115", direction: "IN" }),
      v({ name: "motor_running", modbusAddress: "COIL:1", direction: "OUT" }),
      v({ name: "_IO_EM_DO_00", modbusAddress: "COIL:17", direction: "OUT" }),
    ]);
    const tags = out.tags[0].tags as { name: string; writable: boolean }[];
    expect(tags.find((t) => t.name === "VfdCmdWord")!.writable).toBe(true);
    expect(tags.find((t) => t.name === "MotorRunning")!.writable).toBe(false);
    expect(tags.find((t) => t.name === "IoEmDo00")!.writable).toBe(false);
  });
});
