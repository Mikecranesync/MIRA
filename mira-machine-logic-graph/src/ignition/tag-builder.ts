/**
 * Builds an Ignition Designer tag-import JSON for the Micro820 conveyor
 * project from a parsed ST file + variable manifest.
 *
 * Output shape mirrors the existing ignition/tags/tags.json fixture so
 * the file can be imported into Ignition Designer (Tag Browser →
 * Import Tags) against the `Micro820_Conveyor` Modbus TCP device.
 *
 * Each tag also carries i3X-flavored metadata under `i3x`:
 *   - elementId:   stable globally-unique handle
 *   - displayName: human-friendly label
 *   - namespace:   ISA-95-style path, e.g. "Site.Cell.Conveyor.MotorRunning"
 *
 * Ignition Designer ignores unknown keys on import, so these annotations
 * are forward-compatible. They become the load-bearing fields once the
 * i3X facade lands.
 */

import type { ManifestVariable } from "../parser/manifest.ts";

export interface IgnitionTag {
  name: string;
  tagType: "OpcTag";
  opcServer: string;
  opcItemPath: string;
  dataType: "Boolean" | "Int4" | "Int2" | "Float4" | "String";
  scanClass: string;
  tooltip?: string;
  writable?: boolean;
  i3x?: {
    elementId: string;
    displayName: string;
    namespace: string;
    sourceVariable: string;
    modbusAddress: string | null;
  };
}

export interface IgnitionFolder {
  name: string;
  tagType: "Folder";
  tags: Array<IgnitionTag | IgnitionFolder>;
}

export interface IgnitionTagExport {
  name: string;
  tagType: "Provider";
  tags: IgnitionFolder[];
}

export interface BuildOptions {
  deviceName?: string;       // Ignition Modbus device name, default Micro820_Conveyor
  providerName?: string;     // Provider name, default "default"
  folderName?: string;       // Top folder, default "Conveyor"
  site?: string;             // i3X namespace site, default "LakeWales"
  cell?: string;             // i3X namespace cell, default "Line1"
  writableNames?: Set<string>; // variable names that should be writable
}

const DEFAULT_WRITABLE = new Set([
  "vfd_cmd_word",
  "vfd_freq_setpoint",
  "fault_reset_cmd",
  "conveyor_speed_cmd",
]);

const BOOL_TYPES = new Set(["BOOL"]);
const INT_TYPES = new Set(["INT", "DINT", "UINT", "UDINT", "WORD", "DWORD"]);

function toPascalCase(name: string): string {
  // _IO_EM_DI_00 -> IoEmDi00 ; motor_running -> MotorRunning
  return name
    .replace(/^_+/, "")
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join("");
}

function ignitionAddress(deviceName: string, modbusAddr: string | null): string | null {
  if (!modbusAddr) return null;
  const m = modbusAddr.match(/^(COIL|HR|IR|DI):(\d+)$/i);
  if (!m) return null;
  const kind = m[1].toUpperCase();
  const num = Number(m[2]);
  if (kind === "COIL") return `ns=1;s=[${deviceName}]C${num}`;
  if (kind === "DI") return `ns=1;s=[${deviceName}]DI${num}`;
  if (kind === "IR") return `ns=1;s=[${deviceName}]IR${300000 + num}`;
  if (kind === "HR") return `ns=1;s=[${deviceName}]HR${400000 + num}`;
  return null;
}

function ignitionDataType(dataType: string): IgnitionTag["dataType"] | null {
  const t = dataType.toUpperCase();
  if (BOOL_TYPES.has(t)) return "Boolean";
  if (INT_TYPES.has(t)) return "Int4";
  if (t === "REAL") return "Float4";
  if (t === "STRING") return "String";
  return null;
}

export function buildIgnitionTags(
  variables: ManifestVariable[],
  opts: BuildOptions = {},
): IgnitionTagExport {
  const deviceName = opts.deviceName ?? "Micro820_Conveyor";
  const providerName = opts.providerName ?? "default";
  const folderName = opts.folderName ?? "Conveyor";
  const site = opts.site ?? "LakeWales";
  const cell = opts.cell ?? "Line1";
  const writable = opts.writableNames ?? DEFAULT_WRITABLE;

  const tags: IgnitionTag[] = [];

  for (const v of variables) {
    const opcItemPath = ignitionAddress(deviceName, v.modbusAddress);
    const dataType = ignitionDataType(v.dataType);
    if (!opcItemPath || !dataType) continue; // skip vars without a Modbus address or unsupported types

    const displayName = toPascalCase(v.alias && v.alias.trim() ? v.alias : v.name);
    const tagName = toPascalCase(v.name);

    const tag: IgnitionTag = {
      name: tagName,
      tagType: "OpcTag",
      opcServer: "Ignition OPC-UA Server",
      opcItemPath,
      dataType,
      scanClass: "Default",
      tooltip: v.alias ?? v.name,
      // Manifest `direction` describes PLC data flow (PLC writes status
      // out → field), not Ignition write permission. Only explicitly
      // allowlisted setpoints are exposed as writable.
      writable: writable.has(v.name),
      i3x: {
        elementId: `urn:i3x:micro820:${v.name}`,
        displayName,
        namespace: `${site}.${cell}.${folderName}.${tagName}`,
        sourceVariable: v.name,
        modbusAddress: v.modbusAddress,
      },
    };
    tags.push(tag);
  }

  tags.sort((a, b) => a.name.localeCompare(b.name));

  return {
    name: providerName,
    tagType: "Provider",
    tags: [
      {
        name: folderName,
        tagType: "Folder",
        tags,
      },
    ],
  };
}
