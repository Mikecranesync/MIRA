/** Fail-closed checks shared by run.mjs and its isolated probes. Never reads a dotenv file. */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Every dotenv variant Next loads from the project directory. */
export const NEXT_DOTENV_FILES = [".env", ".env.local", ".env.development", ".env.development.local", ".env.production", ".env.production.local", ".env.test", ".env.test.local"];

/** Throws naming only the FILE NAMES found (existence check via lstat; contents are never opened). */
export function refuseDotenv(projectDir) {
  const present = NEXT_DOTENV_FILES.filter((name) => { try { fs.lstatSync(path.join(projectDir, name)); return true; } catch { return false; } });
  if (present.length) throw new Error(`dotenv file(s) present in ${projectDir}: ${present.join(", ")} — this runner never starts Next with a dotenv file`);
}

/** Environment for a child: only these inherited names; HOME is the caller's own, or absent. Never invented. */
export function childEnv(parentEnv, extra) {
  const env = { PATH: parentEnv.PATH, ...extra };
  if (parentEnv.HOME !== undefined) env.HOME = parentEnv.HOME;
  return env;
}

/**
 * Called FROM INSIDE a child process (the server preload, the Playwright config): records what that process was
 * actually given — variable NAMES, its HOME value (a path, not a secret) and a sha256 of every value, never the values.
 * `ps eww` shows no environment on this host, so the child reports itself.
 */
export function writeEnvReport(file, env = process.env) {
  const report = {
    keys: Object.keys(env).sort(),
    home: env.HOME ?? null,
    valueSha256: Object.values(env).filter((v) => typeof v === "string").map((v) => createHash("sha256").update(v).digest("hex")),
  };
  fs.writeFileSync(file, JSON.stringify(report));
}

/** Names the OS itself adds to every process; never judged. */
const OS_INJECTED = new Set(["__CF_USER_TEXT_ENCODING"]);

/** Compare a child's own report with what it was supposed to receive. Returns a list of violations (empty = clean). */
export function envViolations(report, { allowedKeys, callerHome, forbiddenValues }) {
  const violations = [];
  const allowed = new Set(allowedKeys);
  for (const key of report.keys) if (!allowed.has(key) && !OS_INJECTED.has(key)) violations.push(`unexpected variable: ${key}`);
  if ((callerHome ?? null) !== report.home) violations.push("HOME differs from the caller's HOME");
  const seen = new Set(report.valueSha256);
  for (const value of forbiddenValues) if (seen.has(createHash("sha256").update(value).digest("hex"))) violations.push("a forbidden credential value reached the child");
  return violations;
}
