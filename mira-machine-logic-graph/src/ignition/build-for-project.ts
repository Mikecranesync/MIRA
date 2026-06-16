/**
 * Glue layer: take a ProjectDef, load its ST file + manifest, run the
 * parser, intersect with the manifest, hand to the tag builder.
 */

import { readFileSync } from "node:fs";
import { parseStructuredText } from "../parser/st.ts";
import { loadManifest, indexByName, type ManifestVariable } from "../parser/manifest.ts";
import { buildIgnitionTags, type IgnitionTagExport } from "./tag-builder.ts";
import type { ProjectDef } from "../projects/registry.ts";

export interface BuildResult {
  export: IgnitionTagExport;
  stats: {
    declaredInSt: number;
    referencedInSt: number;
    manifestSize: number;
    tagsEmitted: number;
    droppedNoAddress: number;
    droppedUnsupportedType: number;
  };
}

export function buildTagsForProject(project: ProjectDef): BuildResult {
  const stSource = readFileSync(project.stPath, "utf8");
  const parsed = parseStructuredText(stSource);
  const manifest = loadManifest(project.manifestPath);
  const idx = indexByName(manifest);

  // Variables the ST file actually touches (either declared in a VAR
  // block, or referenced as identifiers in the body). For CCW programs
  // the declarations live in the project DB, so referencedIdentifiers
  // is the load-bearing list.
  const used = new Set<string>([
    ...parsed.variables.map((v) => v.name),
    ...parsed.referencedIdentifiers,
  ]);

  const variables: ManifestVariable[] = [];
  let droppedNoAddress = 0;
  for (const name of used) {
    const v = idx.get(name);
    if (!v) continue;
    if (!v.modbusAddress) {
      droppedNoAddress++;
      continue;
    }
    variables.push(v);
  }

  const exp = buildIgnitionTags(variables, project.ignition);

  const tagsEmitted = exp.tags.reduce((n, f) => n + f.tags.length, 0);
  const droppedUnsupportedType = variables.length - tagsEmitted;

  return {
    export: exp,
    stats: {
      declaredInSt: parsed.variables.length,
      referencedInSt: parsed.referencedIdentifiers.length,
      manifestSize: manifest.variables.length,
      tagsEmitted,
      droppedNoAddress,
      droppedUnsupportedType,
    },
  };
}
