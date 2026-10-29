#!/usr/bin/env node
/**
 * Consent-wording immutability gate (#4934, Codex F1/F3 on #4930).
 *
 * Compares the candidate consent registry with the registry at a trusted base
 * commit. A pin in the candidate tree cannot prove immutability, because the
 * same commit can edit the wording and the pin together; the base commit is
 * the authority instead.
 *
 * The registry is DATA (consent-texts.json), read with JSON.parse and a strict
 * schema. Nothing from the candidate is imported or executed, so candidate code
 * cannot end the process, fake a getter or change the comparison.
 *
 * Rules, for each version in the BASE registry:
 *   - published         → still present, still published, `text` byte-identical,
 *                         `sha256` identical
 *   - text_not_recorded → still present, still text_not_recorded, `text` and
 *                         `sha256` null
 *   - draft             → unconstrained (may be edited, removed, or published)
 * Every entry in both registries must also pass the schema: exact key set,
 * `version` equal to its key, a known status, and `sha256` equal to the
 * sha256 this script computes from `text` (null when `text` is null).
 * Versions new in the candidate are otherwise unconstrained. A registry absent
 * at the base (first introduction) passes.
 *
 * Plain JavaScript on node builtins only, so CI can run the BASE commit's copy
 * with `node` before any candidate dependency is installed.
 *
 * Usage: node check-consent-immutability.mjs --base <commit> [--repo <dir>] [--file <repo-relative path>]...
 * Exit: 0 pass · 1 violation · 2 setup or schema error (fail closed)
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_REGISTRY_FILES = ["mira-web/src/capabilities/consent-texts.json"];

const STATUSES = new Set(["published", "draft", "text_not_recorded"]);
const ENTRY_KEYS = ["note", "sha256", "status", "text", "version"];

export class SetupError extends Error {}

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/** Parse and strictly validate a registry. Throws SetupError on any deviation. */
export function parseRegistry(source, label) {
  let data;
  try {
    data = JSON.parse(source);
  } catch (e) {
    throw new SetupError(`${label}: not valid JSON: ${e.message}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new SetupError(`${label}: registry must be an object`);
  const out = Object.create(null);
  for (const [key, e] of Object.entries(data)) {
    const where = `${label}: ${key}`;
    if (!e || typeof e !== "object" || Array.isArray(e)) throw new SetupError(`${where}: entry must be an object`);
    const keys = Object.keys(e).sort();
    if (keys.join(",") !== ENTRY_KEYS.join(",")) throw new SetupError(`${where}: keys must be exactly ${ENTRY_KEYS.join(", ")}`);
    if (e.version !== key) throw new SetupError(`${where}: version must equal its key`);
    if (!STATUSES.has(e.status)) throw new SetupError(`${where}: unknown status ${JSON.stringify(e.status)}`);
    if (typeof e.note !== "string") throw new SetupError(`${where}: note must be a string`);
    if (e.text === null) {
      if (e.sha256 !== null) throw new SetupError(`${where}: sha256 must be null when text is null`);
      if (e.status !== "text_not_recorded") throw new SetupError(`${where}: only text_not_recorded may have no text`);
    } else {
      if (typeof e.text !== "string" || !e.text.trim()) throw new SetupError(`${where}: text must be a non-empty string or null`);
      if (e.status === "text_not_recorded") throw new SetupError(`${where}: text_not_recorded must have no text`);
      if (e.sha256 !== sha256(e.text)) throw new SetupError(`${where}: sha256 is not the sha256 of text`);
    }
    out[key] = { version: e.version, status: e.status, text: e.text, sha256: e.sha256 };
  }
  return out;
}

/** Violations of the base → candidate rules. `base` null = first introduction. */
export function compareConsentRegistries(base, candidate) {
  if (base === null) return [];
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const violations = [];
  for (const [version, was] of Object.entries(base)) {
    const now = has(candidate, version) ? candidate[version] : undefined;
    if (was.status === "published") {
      if (!now) violations.push(`${version}: published version was removed`);
      else if (now.status !== "published") violations.push(`${version}: published version changed status to ${now.status}`);
      else if (now.text !== was.text) violations.push(`${version}: published wording changed; add a new version instead`);
      else if (now.sha256 !== was.sha256) violations.push(`${version}: published sha256 changed`);
    } else if (was.status === "text_not_recorded") {
      if (!now) violations.push(`${version}: text_not_recorded version was removed`);
      else if (now.status !== "text_not_recorded" || now.text !== null || now.sha256 !== null)
        violations.push(`${version}: wording may not be attached to a text_not_recorded version`);
    }
  }
  return violations;
}

function git(root, args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout ?? "" };
}

export function main(argv) {
  let base = "";
  let repo = "";
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base") base = argv[++i] ?? "";
    else if (argv[i] === "--repo") repo = argv[++i] ?? "";
    else if (argv[i] === "--file") files.push(argv[++i] ?? "");
    else throw new SetupError(`unknown argument ${argv[i]}`);
  }
  if (!base) throw new SetupError("--base <commit> is required");
  const top = git(repo || process.cwd(), ["rev-parse", "--show-toplevel"]);
  if (!top.ok) throw new SetupError("not inside a git repository");
  const root = top.out.trim();
  if (!git(root, ["cat-file", "-e", `${base}^{commit}`]).ok)
    throw new SetupError(`base commit ${base} is not available (fetch it first)`);

  let failed = false;
  for (const rel of files.length ? files : DEFAULT_REGISTRY_FILES) {
    const candidatePath = resolve(root, rel);
    if (!existsSync(candidatePath)) throw new SetupError(`candidate registry ${rel} does not exist`);
    const candidate = parseRegistry(readFileSync(candidatePath, "utf8"), `candidate ${rel}`);
    let baseReg = null;
    if (git(root, ["cat-file", "-e", `${base}:${rel}`]).ok) {
      const shown = git(root, ["show", `${base}:${rel}`]);
      if (!shown.ok) throw new SetupError(`cannot read ${base}:${rel}`);
      baseReg = parseRegistry(shown.out, `base ${base.slice(0, 9)} ${rel}`);
    }
    const violations = compareConsentRegistries(baseReg, candidate);
    if (violations.length) {
      failed = true;
      for (const v of violations) console.error(`FAIL ${rel}: ${v}`);
    } else {
      console.log(`ok ${rel}: ${baseReg ? "published wording unchanged vs base" : "absent at base (first introduction)"}`);
    }
  }
  return failed ? 1 : 0;
}

const isEntry = () => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};
if (process.argv[1] && isEntry()) {
  let code;
  try {
    code = main(process.argv.slice(2));
  } catch (e) {
    console.error(`ERROR ${e instanceof SetupError ? e.message : e.stack}`);
    code = 2;
  }
  process.exit(code);
}
