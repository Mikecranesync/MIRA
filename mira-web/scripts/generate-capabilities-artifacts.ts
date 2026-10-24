/**
 * Write public/llms.txt and public/llms-full.txt from the capabilities file.
 *
 *   bun run generate:capabilities
 *
 * Homepage JSON-LD is generated at render time from the same module.
 * tests/capabilities.test.ts fails if these files drift.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  generateLlmsFullTxt,
  generateLlmsTxt,
  loadCapabilities,
} from "../src/capabilities/marketing-claims/index.ts";

const root = join(import.meta.dir, "..");
const data = loadCapabilities();

writeFileSync(join(root, "public", "llms.txt"), generateLlmsTxt(data));
writeFileSync(join(root, "public", "llms-full.txt"), generateLlmsFullTxt(data));

console.log(`wrote public/llms.txt and public/llms-full.txt from capabilities.json (${data.updated})`);
