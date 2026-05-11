#!/usr/bin/env bun
/**
 * CRA-232: generate ignition/tags_micro800.json from the Micro820
 * conveyor project. Run from anywhere:
 *
 *   bun run scripts/generate-tags.ts [--project micro820-conveyor] [--out path]
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { findProject, PROJECTS } from "../src/projects/registry.ts";
import { buildTagsForProject } from "../src/ignition/build-for-project.ts";

function parseArgs(argv: string[]): { project: string; out: string } {
  const args: { project: string; out: string } = {
    project: "micro820-conveyor",
    out: resolve(import.meta.dirname, "..", "..", "ignition", "tags_micro800.json"),
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--project" && argv[i + 1]) args.project = argv[++i];
    else if (argv[i] === "--out" && argv[i + 1]) args.out = resolve(argv[++i]);
  }
  return args;
}

const { project: projectId, out: outPath } = parseArgs(process.argv.slice(2));

const project = findProject(projectId);
if (!project) {
  console.error(`Unknown project ${projectId}. Available: ${PROJECTS.map((p) => p.id).join(", ")}`);
  process.exit(1);
}

const result = buildTagsForProject(project);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(result.export, null, 2) + "\n", "utf8");

console.log(`wrote ${outPath}`);
console.log(`stats: ${JSON.stringify(result.stats)}`);
