/**
 * Project registry. A "project" is a Micro800 / CCW program plus its
 * variable manifest. Registered statically for now; a future revision
 * will load from disk or a DB.
 */

import { resolve } from "node:path";

export interface ProjectDef {
  id: string;
  name: string;
  stPath: string;
  manifestPath: string;
  ignition: {
    deviceName: string;
    providerName: string;
    folderName: string;
    site: string;
    cell: string;
  };
}

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");

export const PROJECTS: ProjectDef[] = [
  {
    id: "micro820-conveyor",
    name: "Micro820 Conveyor (Lake Wales line 1)",
    stPath: resolve(REPO_ROOT, "plc", "Prog2.stf"),
    manifestPath: resolve(REPO_ROOT, "research", "variable-manifest.json"),
    ignition: {
      deviceName: "Micro820_Conveyor",
      providerName: "default",
      folderName: "Conveyor",
      site: "LakeWales",
      cell: "Line1",
    },
  },
];

export function findProject(id: string): ProjectDef | undefined {
  return PROJECTS.find((p) => p.id === id);
}
