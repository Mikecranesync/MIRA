#!/usr/bin/env node
/**
 * Isolated negative probe: for EACH of the eight dotenv names Next loads, a temp project dir holding only that file
 * (content = a sentinel that must never be printed) makes run.mjs refuse with exit 4 BEFORE any child exists (no output
 * dir, no server log, no listener). A control dir without dotenv must NOT be refused for dotenv. Usage: node dotenv-probe.mjs [out-dir]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NEXT_DOTENV_FILES } from "./guards.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const base = fs.mkdtempSync(path.join(process.argv[2] ?? os.tmpdir(), "r4-dotenv-probe-"));
const SENTINEL = `DO_NOT_PRINT_${process.pid}_${Date.now()}`;
const failures = [], results = [];
const run = (hub, label) => {
  const out = path.join(base, `out-${label}`);
  const r = spawnSync(process.execPath, [path.join(here, "run.mjs"), "--hub-dir", hub, "--label", label, "--out", out, "--port", "3952"], { encoding: "utf8", env: { PATH: process.env.PATH } });
  return { r, out, text: `${r.stdout}${r.stderr}` };
};
for (const name of NEXT_DOTENV_FILES) {
  const hub = fs.mkdtempSync(path.join(base, "hub-"));
  fs.writeFileSync(path.join(hub, name), `SECRET=${SENTINEL}\n`);
  const { r, out, text } = run(hub, `probe-${name.replace(/\W/g, "_")}`);
  const spawned = fs.existsSync(out); // run.mjs creates the output dir only AFTER the dotenv check
  const row = { file: name, exit: r.status, refused: r.status === 4 && text.includes(name), sentinelPrinted: text.includes(SENTINEL), childOrOutputCreated: spawned };
  results.push(row);
  if (!row.refused || row.sentinelPrinted || row.childOrOutputCreated) failures.push(row);
}
const control = fs.mkdtempSync(path.join(base, "hub-control-"));
const c = run(control, "probe-control");
const controlRow = { exit: c.r.status, refusedForDotenv: c.text.includes("REFUSED: dotenv"), reason: (c.text.split("\n").find((l) => /ENOENT|BUILD_ID/.test(l)) ?? "").slice(0, 100) };
if (controlRow.refusedForDotenv || c.r.status === 4) failures.push({ control: controlRow });
console.log(JSON.stringify({ results, control: controlRow, failures }, null, 1));
process.exit(failures.length ? 1 : 0);
