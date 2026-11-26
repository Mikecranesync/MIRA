#!/usr/bin/env node
/**
 * Proves the child-environment evidence can FAIL: the preload's self-report is read for (a) a clean allowlisted child,
 * (b) a child that was handed a credential-looking value, (c) a stray variable, (d) a replaced HOME, and (d2) a parent
 * with NO HOME (the child must have none). Usage: node env-probe.mjs [out-dir]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { childEnv, envViolations } from "./guards.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = fs.mkdtempSync(path.join(process.argv[2] ?? os.tmpdir(), "r4-env-probe-"));
const SECRET = `probe-secret-${process.pid}`;
const preload = pathToFileURL(path.join(here, "egress-block.mjs")).href;
const probe = (label, parentEnv, mutate = (e) => e) => {
  const report = path.join(out, `${label}.json`);
  const base = childEnv(parentEnv, { R4_ALLOWED_PORT: "3951", R4_ENV_REPORT: report, NODE_OPTIONS: `--import ${preload}` });
  const env = mutate(base);
  spawnSync(process.execPath, ["-e", ""], { env, encoding: "utf8" });
  const allowedKeys = Object.keys(childEnv(parentEnv, { R4_ALLOWED_PORT: "", R4_ENV_REPORT: "", NODE_OPTIONS: "" }));
  return envViolations(JSON.parse(fs.readFileSync(report, "utf8")), { allowedKeys, callerHome: parentEnv.HOME, forbiddenValues: [SECRET] });
};
const parent = { PATH: process.env.PATH, HOME: "/home/probe-caller" };
const cases = {
  "clean allowlisted child": { v: probe("clean", parent), expectClean: true },
  "credential value handed to the child": { v: probe("leak", parent, (e) => ({ ...e, SOME_API_TOKEN: SECRET })), expectClean: false },
  "stray variable": { v: probe("stray", parent, (e) => ({ ...e, STRAY: "1" })), expectClean: false },
  "HOME replaced": { v: probe("home", parent, (e) => ({ ...e, HOME: "/tmp/not-the-callers-home" })), expectClean: false },
  "parent without HOME -> child without HOME": { v: probe("nohome", { PATH: process.env.PATH }), expectClean: true },
  "parent without HOME but child given one": { v: probe("nohome-invented", { PATH: process.env.PATH }, (e) => ({ ...e, HOME: "/tmp/invented" })), expectClean: false },
};
const failures = Object.entries(cases).filter(([, c]) => (c.v.length === 0) !== c.expectClean).map(([n, c]) => ({ case: n, violations: c.v }));
console.log(JSON.stringify(Object.fromEntries(Object.entries(cases).map(([n, c]) => [n, c.v])), null, 1));
console.log(JSON.stringify({ failures }));
process.exit(failures.length ? 1 : 0);
