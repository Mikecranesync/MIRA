#!/usr/bin/env bun
/**
 * Consent-wording immutability gate (#4934, Codex F1 on #4930).
 *
 * Compares the candidate consent registry with the registry at a trusted base
 * commit. A pin in the candidate tree cannot prove immutability, because the
 * same commit can edit the wording and the pin together; the base commit is
 * the authority instead.
 *
 * Rules, for each version in the BASE registry:
 *   - published         → still present, still published, `text` byte-identical
 *   - text_not_recorded → still present, still text_not_recorded, `text` null
 *   - draft             → unconstrained (may be edited, removed, or published)
 * Versions new in the candidate are unconstrained. A registry absent at the
 * base (first introduction) passes.
 *
 * Self-contained on purpose (node builtins only): CI runs the BASE commit's
 * copy of this file, so a PR cannot weaken the checker it is checked by.
 *
 * Usage: bun check-consent-immutability.ts --base <commit> [--file <repo-relative path>]...
 * Exit: 0 pass · 1 violation · 2 setup error (fail closed)
 */
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

export interface RegistryEntry {
  status: string;
  text: string | null;
}
export type Registry = Record<string, RegistryEntry>;

export const DEFAULT_REGISTRY_FILES = ["mira-web/src/capabilities/consent-texts.ts"];

export function compareConsentRegistries(base: Registry | null, candidate: Registry): string[] {
  if (base === null) return [];
  const violations: string[] = [];
  for (const [version, was] of Object.entries(base)) {
    const now = Object.prototype.hasOwnProperty.call(candidate, version) ? candidate[version] : undefined;
    if (was.status === "published") {
      if (!now) violations.push(`${version}: published version was removed`);
      else if (now.status !== "published")
        violations.push(`${version}: published version changed status to ${now.status}`);
      else if (now.text !== was.text)
        violations.push(`${version}: published wording changed; add a new version instead`);
    } else if (was.status === "text_not_recorded") {
      if (!now) violations.push(`${version}: text_not_recorded version was removed`);
      else if (now.status !== "text_not_recorded" || now.text !== null)
        violations.push(`${version}: wording may not be attached to a text_not_recorded version`);
    }
  }
  return violations;
}

class SetupError extends Error {}

function git(root: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return { ok: r.status === 0, out: r.stdout ?? "" };
}

async function loadRegistry(file: string, label: string): Promise<Registry> {
  let mod: Record<string, unknown>;
  try {
    mod = await import(pathToFileURL(file).href);
  } catch (e) {
    throw new SetupError(`${label}: cannot import ${file}: ${(e as Error).message}`);
  }
  const reg = mod.CONSENT_TEXTS;
  if (!reg || typeof reg !== "object") throw new SetupError(`${label}: ${file} exports no CONSENT_TEXTS`);
  return reg as Registry;
}

async function main(argv: string[]): Promise<number> {
  let base = "";
  const files: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base") base = argv[++i] ?? "";
    else if (argv[i] === "--file") files.push(argv[++i] ?? "");
    else throw new SetupError(`unknown argument ${argv[i]}`);
  }
  if (!base) throw new SetupError("--base <commit> is required");
  const top = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  if (!top.ok) throw new SetupError("not inside a git repository");
  const root = top.out.trim();
  if (!git(root, ["cat-file", "-e", `${base}^{commit}`]).ok)
    throw new SetupError(`base commit ${base} is not available (fetch it first)`);

  let failed = false;
  for (const rel of files.length ? files : DEFAULT_REGISTRY_FILES) {
    const candidatePath = resolve(root, rel);
    if (!existsSync(candidatePath)) throw new SetupError(`candidate registry ${rel} does not exist`);
    let baseReg: Registry | null = null;
    if (git(root, ["cat-file", "-e", `${base}:${rel}`]).ok) {
      const shown = git(root, ["show", `${base}:${rel}`]);
      if (!shown.ok) throw new SetupError(`cannot read ${base}:${rel}`);
      const tmp = join(mkdtempSync(join(tmpdir(), "consent-base-")), "registry.ts");
      writeFileSync(tmp, shown.out);
      baseReg = await loadRegistry(tmp, `base ${base.slice(0, 9)}`);
    }
    const violations = compareConsentRegistries(baseReg, await loadRegistry(candidatePath, "candidate"));
    if (violations.length) {
      failed = true;
      for (const v of violations) console.error(`FAIL ${rel}: ${v}`);
    } else {
      console.log(`ok ${rel}: ${baseReg ? "published wording unchanged vs base" : "absent at base (first introduction)"}`);
    }
  }
  return failed ? 1 : 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`ERROR ${e instanceof SetupError ? e.message : (e as Error).stack}`);
      process.exit(2);
    },
  );
}
