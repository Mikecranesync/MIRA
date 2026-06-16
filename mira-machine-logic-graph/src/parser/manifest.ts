/**
 * Cross-reference layer. Pairs ST identifiers with their declared
 * type and Modbus address from research/variable-manifest.json, which
 * is the authoritative export of the CCW Controller Variables table.
 */

import { readFileSync } from "node:fs";

export interface ManifestVariable {
  name: string;
  dataType: string;
  scope: string | null;
  alias: string | null;
  address: string | null;
  modbusAddress: string | null;
  retain: boolean;
  terminalLabel: string | null;
  sourceDevice: string | null;
  direction: string | null;
}

export interface VariableManifest {
  generatedAt: string;
  sourceFiles: string[];
  variables: ManifestVariable[];
  notes?: string[];
  gaps?: unknown[];
}

export function loadManifest(path: string): VariableManifest {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as VariableManifest;
}

export function indexByName(manifest: VariableManifest): Map<string, ManifestVariable> {
  const idx = new Map<string, ManifestVariable>();
  for (const v of manifest.variables) idx.set(v.name, v);
  return idx;
}
