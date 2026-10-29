/**
 * #4934 (Codex F1/F3 on #4930): published consent wording is checked against
 * the trusted base, as data, not against a pin the same commit can edit.
 */
import { describe, test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error plain .mjs (runs under node in CI); no type declarations
import { compareConsentRegistries, parseRegistry } from "../../scripts/check-consent-immutability.mjs";

const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
type Entry = { version: string; status: string; text: string | null; sha256: string | null; note: string };
const entry = (version: string, status: string, text: string | null, sha256 = text === null ? null : sha(text)): Entry => ({
  version,
  status,
  text,
  sha256,
  note: "",
});
const reg = (...es: Entry[]) => Object.fromEntries(es.map((e) => [e.version, e]));
const parse = (r: object) => parseRegistry(JSON.stringify(r), "t");
const cmp = (b: object | null, c: object) => compareConsentRegistries(b === null ? null : parse(b), parse(c));

describe("compareConsentRegistries", () => {
  test("a published text edited in lockstep with its hash fails", () => {
    const v = cmp(reg(entry("v2", "published", "I agree to A.")), reg(entry("v2", "published", "I agree to B.")));
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("v2");
  });

  test("a single changed byte in a published text fails", () => {
    expect(cmp(reg(entry("v", "published", "I agree.")), reg(entry("v", "published", "I agree. ")))).toHaveLength(1);
  });

  test("removing or un-publishing a published version fails", () => {
    const base = reg(entry("v", "published", "I agree."));
    expect(cmp(base, {})).toHaveLength(1);
    expect(cmp(base, reg(entry("v", "draft", "I agree.")))).toHaveLength(1);
  });

  test("a published sha256 change fails even with identical text (F3)", () => {
    const b = { v: { status: "published", text: "I agree.", sha256: "a".repeat(64), version: "v" } };
    const c = { v: { status: "published", text: "I agree.", sha256: "b".repeat(64), version: "v" } };
    expect(compareConsentRegistries(b, c)).toHaveLength(1);
  });

  test("a text_not_recorded version stays unrecorded: no wording attached later", () => {
    const base = reg(entry("v1", "text_not_recorded", null));
    expect(cmp(base, reg(entry("v1", "published", "Words added later.")))).toHaveLength(1);
    expect(cmp(base, {})).toHaveLength(1);
  });

  test("adding a new version without touching the old ones passes", () => {
    const base = reg(entry("v1", "text_not_recorded", null), entry("v2", "published", "I agree."));
    expect(cmp(base, { ...base, ...reg(entry("v3", "published", "I agree, v3.")) })).toEqual([]);
  });

  test("drafts may be edited, removed, or published", () => {
    const base = reg(entry("v", "draft", "old words"));
    expect(cmp(base, reg(entry("v", "draft", "new words")))).toEqual([]);
    expect(cmp(base, {})).toEqual([]);
    expect(cmp(base, reg(entry("v", "published", "final words")))).toEqual([]);
  });

  test("no base registry (first introduction) passes", () => {
    expect(cmp(null, reg(entry("v", "published", "I agree.")))).toEqual([]);
  });
});

describe("parseRegistry (strict schema, fails closed)", () => {
  const bad = (r: unknown) => () => parseRegistry(JSON.stringify(r), "t");
  test("a stored sha256 that is not the sha256 of the text is rejected", () => {
    expect(bad(reg(entry("v", "published", "I agree.", "0".repeat(64))))).toThrow(/sha256/);
  });
  test("version must equal its key", () => {
    expect(bad({ other: entry("v", "draft", "words here") })).toThrow(/version/);
  });
  test("extra or missing keys are rejected", () => {
    expect(bad({ v: { ...entry("v", "draft", "words here"), extra: 1 } })).toThrow(/keys/);
    const { note: _n, ...noNote } = entry("v", "draft", "words here");
    expect(bad({ v: noNote })).toThrow(/keys/);
  });
  test("unknown status, text on text_not_recorded, and no text on published are rejected", () => {
    expect(bad(reg(entry("v", "approved", "words here")))).toThrow(/status/);
    expect(bad(reg(entry("v", "text_not_recorded", "words here")))).toThrow(/text_not_recorded/);
    expect(bad(reg(entry("v", "published", null)))).toThrow(/no text/);
  });
  test("invalid JSON and non-object registries are rejected", () => {
    expect(() => parseRegistry("{", "t")).toThrow(/JSON/);
    expect(bad([])).toThrow(/object/);
  });
  test("the real registry passes its own schema", () => {
    const real = readFileSync(join(import.meta.dir, "consent-texts.json"), "utf8");
    expect(Object.keys(parseRegistry(real, "real")).sort()).toEqual(["pilot-consent-v1", "pilot-consent-v2"]);
  });
});

// End to end: a throwaway git repo whose base commit publishes a version.
describe("check-consent-immutability CLI (node)", () => {
  const script = join(import.meta.dir, "../../scripts/check-consent-immutability.mjs");
  const regPath = "reg/consent-texts.json";
  const registry = (text: string, extra: Entry[] = []) =>
    JSON.stringify(reg(entry("c-v1", "text_not_recorded", null), entry("c-v2", "published", text), ...extra), null, 2);

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

  const run = (dir: string, base: string, file = regPath, cwd = dir) =>
    Bun.spawnSync(["node", script, "--repo", dir, "--base", base, "--file", file], { cwd });

  test("lockstep edit of a published text fails against the base commit", () => {
    const { dir, base } = repoWithBase();
    writeFileSync(join(dir, regPath), registry("I agree to B."));
    const r = run(dir, base);
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("c-v2");
  });

  test("candidate code that exits 0 at load cannot pass the gate (Codex F1 round 2)", () => {
    const { dir, base } = repoWithBase();
    writeFileSync(join(dir, regPath), registry("I agree to B."));
    // A registry module that ends the process the moment anything imports it.
    writeFileSync(join(dir, "reg/consent-texts.ts"), `process.exit(0);\nexport const CONSENT_TEXTS = {};\n`);
    const r = run(dir, base);
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("c-v2: published wording changed");
  });

  test("an additive version passes against the base commit, from any cwd", () => {
    const { dir, base } = repoWithBase();
    writeFileSync(join(dir, regPath), registry("I agree to A.", [entry("c-v3", "draft", "New words here.")]));
    expect(run(dir, base, regPath, tmpdir()).exitCode).toBe(0);
  });

  test("a candidate whose hash does not match its text fails closed", () => {
    const { dir, base } = repoWithBase();
    const r0 = JSON.parse(registry("I agree to A."));
    r0["c-v2"].sha256 = "f".repeat(64);
    writeFileSync(join(dir, regPath), JSON.stringify(r0));
    expect(run(dir, base).exitCode).toBe(2);
  });

  test("an unknown base commit fails closed", () => {
    const { dir } = repoWithBase();
    expect(run(dir, "0".repeat(40)).exitCode).toBe(2);
  });

  test("a registry absent at the base passes (first introduction)", () => {
    const { dir, base } = repoWithBase();
    writeFileSync(join(dir, "reg/new.json"), registry("Brand new."));
    expect(run(dir, base, "reg/new.json").exitCode).toBe(0);
  });

  test("a candidate without the registry fails closed", () => {
    const { dir, base } = repoWithBase();
    expect(run(dir, base, "reg/absent.json").exitCode).toBe(2);
  });
});
