/**
 * #4934 (Codex F1 on #4930): published consent wording is checked against the
 * trusted base, not against a pin the same commit can edit.
 */
import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareConsentRegistries, type RegistryEntry } from "../../scripts/check-consent-immutability";

const pub = (text: string): RegistryEntry => ({ status: "published", text });
const draft = (text: string): RegistryEntry => ({ status: "draft", text });
const unrecorded: RegistryEntry = { status: "text_not_recorded", text: null };

describe("compareConsentRegistries", () => {
  test("a published text edited in lockstep with its pin fails", () => {
    const v = compareConsentRegistries(
      { "c-v2": pub("I agree to A.") },
      { "c-v2": pub("I agree to B.") },
    );
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("c-v2");
  });

  test("a single changed byte in a published text fails", () => {
    expect(
      compareConsentRegistries({ v: pub("I agree.") }, { v: pub("I agree. ") }),
    ).toHaveLength(1);
  });

  test("removing a published version fails", () => {
    expect(compareConsentRegistries({ v: pub("I agree.") }, {})).toHaveLength(1);
  });

  test("un-publishing a published version fails", () => {
    expect(
      compareConsentRegistries({ v: pub("I agree.") }, { v: draft("I agree.") }),
    ).toHaveLength(1);
  });

  test("a text_not_recorded version stays unrecorded: no wording attached later", () => {
    expect(
      compareConsentRegistries({ v1: unrecorded }, { v1: pub("Words added later.") }),
    ).toHaveLength(1);
    expect(
      compareConsentRegistries({ v1: unrecorded }, { v1: { status: "text_not_recorded", text: "x" } }),
    ).toHaveLength(1);
    expect(compareConsentRegistries({ v1: unrecorded }, {})).toHaveLength(1);
  });

  test("adding a new version without touching the old one passes", () => {
    expect(
      compareConsentRegistries(
        { v1: unrecorded, v2: pub("I agree.") },
        { v1: unrecorded, v2: pub("I agree."), v3: pub("I agree, v3.") },
      ),
    ).toEqual([]);
  });

  test("drafts may be edited, removed, or published", () => {
    expect(compareConsentRegistries({ v: draft("old") }, { v: draft("new") })).toEqual([]);
    expect(compareConsentRegistries({ v: draft("old") }, {})).toEqual([]);
    expect(compareConsentRegistries({ v: draft("old") }, { v: pub("final") })).toEqual([]);
  });

  test("no base registry (first introduction) passes", () => {
    expect(compareConsentRegistries(null, { v: pub("I agree.") })).toEqual([]);
  });
});

// End to end: a throwaway git repo whose base commit publishes a version.
describe("check-consent-immutability CLI", () => {
  const script = join(import.meta.dir, "../../scripts/check-consent-immutability.ts");
  const regPath = "reg/consent-texts.ts";
  const registry = (text: string, extra = "") =>
    `export const CONSENT_TEXTS = Object.freeze({\n` +
    `  "c-v1": { version: "c-v1", status: "text_not_recorded", text: null, sha256: null, note: "" },\n` +
    `  "c-v2": { version: "c-v2", status: "published", text: ${JSON.stringify(text)}, sha256: "pin", note: "" },\n` +
    extra +
    `});\n`;

  function repoWithBase(): { dir: string; base: string } {
    const dir = mkdtempSync(join(tmpdir(), "consent-imm-"));
    const git = (...args: string[]) => {
      const r = Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir });
      if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
      return r.stdout.toString().trim();
    };
    git("init", "-q");
    mkdirSync(join(dir, "reg"));
    writeFileSync(join(dir, regPath), registry("I agree to A."));
    git("add", ".");
    git("commit", "-qm", "base");
    return { dir, base: git("rev-parse", "HEAD") };
  }

  const run = (dir: string, base: string) =>
    Bun.spawnSync(["bun", script, "--base", base, "--file", regPath], { cwd: dir });

  test("lockstep edit of a published text fails against the base commit", () => {
    const { dir, base } = repoWithBase();
    writeFileSync(join(dir, regPath), registry("I agree to B."));
    const r = run(dir, base);
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("c-v2");
  });

  test("an additive version passes against the base commit", () => {
    const { dir, base } = repoWithBase();
    writeFileSync(
      join(dir, regPath),
      registry("I agree to A.", `  "c-v3": { version: "c-v3", status: "draft", text: "New words.", sha256: null, note: "" },\n`),
    );
    expect(run(dir, base).exitCode).toBe(0);
  });

  test("an unknown base commit fails closed", () => {
    const { dir } = repoWithBase();
    expect(run(dir, "0".repeat(40)).exitCode).toBe(2);
  });

  test("a registry absent at the base passes (first introduction)", () => {
    const { dir, base } = repoWithBase();
    writeFileSync(join(dir, "reg/new.ts"), registry("Brand new."));
    const r = Bun.spawnSync(["bun", script, "--base", base, "--file", "reg/new.ts"], { cwd: dir });
    expect(r.exitCode).toBe(0);
  });

  test("a candidate without the registry fails closed", () => {
    const { dir, base } = repoWithBase();
    const r = Bun.spawnSync(["bun", script, "--base", base, "--file", "reg/absent.ts"], { cwd: dir });
    expect(r.exitCode).toBe(2);
  });
});
